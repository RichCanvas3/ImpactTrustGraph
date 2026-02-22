/**
 * Backfill canonical `agents` table and FK references from `organizations` + `individuals`.
 *
 * - Canonical key is UAID.
 * - UAID discovery order:
 *   1) existing table uaid
 *   2) parse from agent_card_json (uaid or agent.uaid)
 *
 * Usage:
 *   node scripts/backfill-agents.mjs --env apps/itg/.env
 *   node scripts/backfill-agents.mjs --env apps/itg/.env --dry-run
 *   node scripts/backfill-agents.mjs --env apps/itg/.env --limit 50
 *   node scripts/backfill-agents.mjs --env apps/itg/.env --migrate-uaid-only
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = { envPath: null, dryRun: false, limit: null, migrateUaidOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--env") out.envPath = argv[i + 1] || null;
    if (a === "--dry-run") out.dryRun = true;
    if (a === "--migrate-uaid-only") out.migrateUaidOnly = true;
    if (a === "--limit") {
      const v = Number.parseInt(String(argv[i + 1] || ""), 10);
      out.limit = Number.isFinite(v) && v > 0 ? v : null;
    }
  }
  return out;
}

function loadDotEnvFile(envPath) {
  if (!envPath) return;
  const abs = path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
  if (!fs.existsSync(abs)) return;

  const raw = fs.readFileSync(abs, "utf8");
  const lines = raw.split(/\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Triple-quoted multiline: KEY = """ ... """
    if (value.startsWith('"""')) {
      value = value.slice(3);
      const parts = [];
      // same-line close
      const closeIdx = value.indexOf('"""');
      if (closeIdx >= 0) {
        parts.push(value.slice(0, closeIdx));
      } else {
        parts.push(value);
        while (i + 1 < lines.length) {
          i += 1;
          const l = lines[i] ?? "";
          const end = l.indexOf('"""');
          if (end >= 0) {
            parts.push(l.slice(0, end));
            break;
          }
          parts.push(l);
        }
      }
      const joined = parts.join("\n");
      if (process.env[key] == null) process.env[key] = joined;
      continue;
    }

    // Strip simple quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function parseUaidFromJson(jsonStr) {
  if (typeof jsonStr !== "string" || !jsonStr.trim()) return null;
  try {
    const obj = JSON.parse(jsonStr);
    const v =
      (typeof obj?.uaid === "string" && obj.uaid.trim() ? obj.uaid.trim() : null) ??
      (typeof obj?.agent?.uaid === "string" && obj.agent.uaid.trim() ? obj.agent.uaid.trim() : null) ??
      null;
    return v;
  } catch {
    return null;
  }
}

async function d1Query({ accountId, apiToken, databaseId }, sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params: params.length ? params : undefined }),
    },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`D1 API error (${res.status}): ${JSON.stringify(json)}`);
  }
  if (!json?.success) {
    throw new Error(`D1 API response unsuccessful: ${JSON.stringify(json)}`);
  }
  const result = json?.result?.[0] || {};
  return {
    results: Array.isArray(result.results) ? result.results : [],
    meta: result.meta || {},
  };
}

async function ensureSchema(d1) {
  await d1Query(
    d1,
    `CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uaid TEXT UNIQUE,
      ens_name TEXT,
      agent_name TEXT,
      email_domain TEXT,
      session_package TEXT,
      agent_card_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );`,
  );
  // best-effort indexes/columns in org/indiv
  await d1Query(d1, "ALTER TABLE organizations ADD COLUMN uaid TEXT", []).catch(() => {});
  await d1Query(d1, "ALTER TABLE organizations ADD COLUMN agent_row_id INTEGER", []).catch(() => {});
  await d1Query(d1, "ALTER TABLE organizations ADD COLUMN agent_card_json TEXT", []).catch(() => {});
  await d1Query(d1, "ALTER TABLE organizations ADD COLUMN session_package TEXT", []).catch(() => {});
  await d1Query(d1, "ALTER TABLE organizations ADD COLUMN org_metadata TEXT", []).catch(() => {});
  await d1Query(d1, "ALTER TABLE individuals ADD COLUMN participant_uaid TEXT", []).catch(() => {});
  await d1Query(d1, "ALTER TABLE individuals ADD COLUMN participant_agent_row_id INTEGER", []).catch(() => {});
  await d1Query(d1, "CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_uaid_unique ON agents(uaid) WHERE uaid IS NOT NULL").catch(
    () => {},
  );
}

function ident(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(String(name || ""))) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
  return String(name);
}

async function tableColumns(d1, table) {
  const t = ident(table);
  const info = await d1Query(d1, `PRAGMA table_info(${t})`, []);
  return new Set((info.results || []).map((r) => r.name));
}

function selOrNull(cols, colName) {
  return cols.has(colName) ? colName : "NULL";
}

async function rebuildAgentsUaidOnly(d1, { dryRun }) {
  const cols = await tableColumns(d1, "agents");
  if (!cols.has("agent_account") && !cols.has("chain_id")) return false;

  const backup = `agents_backup_${Date.now()}`;
  console.log(JSON.stringify({ table: "agents", action: "rebuild", backup }, null, 2));
  if (dryRun) return true;

  await d1Query(d1, `ALTER TABLE agents RENAME TO ${ident(backup)}`, []);
  await d1Query(
    d1,
    `CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uaid TEXT UNIQUE,
      ens_name TEXT,
      agent_name TEXT,
      email_domain TEXT,
      session_package TEXT,
      agent_card_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );`,
    [],
  );

  const bcols = await tableColumns(d1, backup);
  await d1Query(
    d1,
    `INSERT INTO agents (id, uaid, ens_name, agent_name, email_domain, session_package, agent_card_json, created_at, updated_at)
     SELECT ${selOrNull(bcols, "id")},
            ${selOrNull(bcols, "uaid")},
            ${selOrNull(bcols, "ens_name")},
            ${selOrNull(bcols, "agent_name")},
            ${selOrNull(bcols, "email_domain")},
            ${selOrNull(bcols, "session_package")},
            ${selOrNull(bcols, "agent_card_json")},
            ${selOrNull(bcols, "created_at")},
            ${selOrNull(bcols, "updated_at")}
     FROM ${ident(backup)}`,
    [],
  );
  await d1Query(d1, "CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_uaid_unique ON agents(uaid) WHERE uaid IS NOT NULL", []).catch(
    () => {},
  );
  await d1Query(d1, "CREATE INDEX IF NOT EXISTS idx_agents_ens_name ON agents(ens_name)", []).catch(() => {});
  return true;
}

async function rebuildOrganizationsUaidOnly(d1, { dryRun }) {
  const cols = await tableColumns(d1, "organizations");
  if (!cols.has("agent_account") && !cols.has("chain_id")) return false;

  const backup = `organizations_backup_${Date.now()}`;
  console.log(JSON.stringify({ table: "organizations", action: "rebuild", backup }, null, 2));
  if (dryRun) return true;

  await d1Query(d1, `ALTER TABLE organizations RENAME TO ${ident(backup)}`, []);
  await d1Query(
    d1,
    `CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ens_name TEXT NOT NULL UNIQUE,
      agent_name TEXT NOT NULL,
      org_name TEXT,
      org_address TEXT,
      email_domain TEXT NOT NULL,
      uaid TEXT,
      agent_row_id INTEGER,
      session_package TEXT,
      agent_card_json TEXT,
      org_metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );`,
    [],
  );
  const bcols = await tableColumns(d1, backup);
  await d1Query(
    d1,
    `INSERT INTO organizations (
       id, ens_name, agent_name, org_name, org_address, email_domain,
       uaid, agent_row_id, session_package, agent_card_json, org_metadata, created_at, updated_at
     )
     SELECT ${selOrNull(bcols, "id")},
            ${selOrNull(bcols, "ens_name")},
            ${selOrNull(bcols, "agent_name")},
            ${selOrNull(bcols, "org_name")},
            ${selOrNull(bcols, "org_address")},
            ${selOrNull(bcols, "email_domain")},
            ${selOrNull(bcols, "uaid")},
            ${selOrNull(bcols, "agent_row_id")},
            ${selOrNull(bcols, "session_package")},
            ${selOrNull(bcols, "agent_card_json")},
            ${selOrNull(bcols, "org_metadata")},
            ${selOrNull(bcols, "created_at")},
            ${selOrNull(bcols, "updated_at")}
     FROM ${ident(backup)}`,
    [],
  );
  await d1Query(d1, "CREATE INDEX IF NOT EXISTS idx_organizations_ens_name ON organizations(ens_name)", []).catch(() => {});
  await d1Query(d1, "CREATE INDEX IF NOT EXISTS idx_organizations_email_domain ON organizations(email_domain)", []).catch(() => {});
  return true;
}

async function rebuildIndividualsUaidOnly(d1, { dryRun }) {
  const cols = await tableColumns(d1, "individuals");
  const unwanted = ["participant_agent_account", "participant_agent_id", "participant_chain_id", "participant_did"];
  const hasUnwanted = unwanted.some((c) => cols.has(c));
  if (!hasUnwanted) return false;

  const backup = `individuals_backup_${Date.now()}`;
  console.log(JSON.stringify({ table: "individuals", action: "rebuild", backup, drop: unwanted.filter((c) => cols.has(c)) }, null, 2));
  if (dryRun) return true;

  await d1Query(d1, `ALTER TABLE individuals RENAME TO ${ident(backup)}`, []);
  await d1Query(
    d1,
    `CREATE TABLE IF NOT EXISTS individuals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      role TEXT,
      first_name TEXT,
      last_name TEXT,
      phone_number TEXT,
      social_display_name TEXT,
      social_account_id TEXT,
      social_account_type TEXT,
      eoa_address TEXT,
      aa_address TEXT,
      participant_ens_name TEXT,
      participant_agent_name TEXT,
      participant_uaid TEXT,
      participant_agent_row_id INTEGER,
      participant_metadata TEXT,
      trust_tier TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );`,
    [],
  );

  const bcols = await tableColumns(d1, backup);
  await d1Query(
    d1,
    `INSERT INTO individuals (
       id, email, role, first_name, last_name, phone_number, social_display_name, social_account_id, social_account_type,
       eoa_address, aa_address, participant_ens_name, participant_agent_name, participant_uaid, participant_agent_row_id,
       participant_metadata, trust_tier, created_at, updated_at
     )
     SELECT ${selOrNull(bcols, "id")},
            ${selOrNull(bcols, "email")},
            ${selOrNull(bcols, "role")},
            ${selOrNull(bcols, "first_name")},
            ${selOrNull(bcols, "last_name")},
            ${selOrNull(bcols, "phone_number")},
            ${selOrNull(bcols, "social_display_name")},
            ${selOrNull(bcols, "social_account_id")},
            ${selOrNull(bcols, "social_account_type")},
            ${selOrNull(bcols, "eoa_address")},
            ${selOrNull(bcols, "aa_address")},
            ${selOrNull(bcols, "participant_ens_name")},
            ${selOrNull(bcols, "participant_agent_name")},
            ${selOrNull(bcols, "participant_uaid")},
            ${selOrNull(bcols, "participant_agent_row_id")},
            ${selOrNull(bcols, "participant_metadata")},
            ${selOrNull(bcols, "trust_tier")},
            ${selOrNull(bcols, "created_at")},
            ${selOrNull(bcols, "updated_at")}
     FROM ${ident(backup)}`,
    [],
  );
  await d1Query(d1, "CREATE INDEX IF NOT EXISTS idx_individuals_email ON individuals(email)", []).catch(() => {});
  await d1Query(d1, "CREATE INDEX IF NOT EXISTS idx_individuals_eoa ON individuals(eoa_address)", []).catch(() => {});
  return true;
}

async function migrateUaidOnly(d1, { dryRun }) {
  const a = await rebuildAgentsUaidOnly(d1, { dryRun });
  const o = await rebuildOrganizationsUaidOnly(d1, { dryRun });
  const i = await rebuildIndividualsUaidOnly(d1, { dryRun });
  console.log(JSON.stringify({ migrated: { agents: !!a, organizations: !!o, individuals: !!i } }, null, 2));
}

async function getStats(d1) {
  const oTotal = await d1Query(d1, "SELECT COUNT(*) as n FROM organizations", []);
  const oUaidNull = await d1Query(d1, "SELECT COUNT(*) as n FROM organizations WHERE uaid IS NULL OR TRIM(uaid) = ''", []);
  const oAgentRowNull = await d1Query(d1, "SELECT COUNT(*) as n FROM organizations WHERE agent_row_id IS NULL", []);
  const oBrokenFk = await d1Query(
    d1,
    `SELECT COUNT(*) as n
     FROM organizations o
     LEFT JOIN agents a ON a.id = o.agent_row_id
     WHERE o.agent_row_id IS NOT NULL AND a.id IS NULL`,
    [],
  );

  const a = await d1Query(d1, "SELECT COUNT(*) as n FROM agents", []);
  const aNull = await d1Query(d1, "SELECT COUNT(*) as n FROM agents WHERE uaid IS NULL", []);
  const oMissing = await d1Query(
    d1,
    "SELECT COUNT(*) as n FROM organizations WHERE (uaid IS NOT NULL AND TRIM(uaid) != '') AND agent_row_id IS NULL",
    [],
  );
  const iTotalWithUaid = await d1Query(
    d1,
    "SELECT COUNT(*) as n FROM individuals WHERE participant_uaid IS NOT NULL AND TRIM(participant_uaid) != ''",
    [],
  );
  const iMissing = await d1Query(
    d1,
    "SELECT COUNT(*) as n FROM individuals WHERE (participant_uaid IS NOT NULL AND TRIM(participant_uaid) != '') AND participant_agent_row_id IS NULL",
    [],
  );
  const iBrokenFk = await d1Query(
    d1,
    `SELECT COUNT(*) as n
     FROM individuals i
     LEFT JOIN agents a ON a.id = i.participant_agent_row_id
     WHERE i.participant_agent_row_id IS NOT NULL AND a.id IS NULL`,
    [],
  );
  return {
    orgs_total: Number(oTotal.results?.[0]?.n || 0),
    orgs_uaid_null_or_empty: Number(oUaidNull.results?.[0]?.n || 0),
    orgs_agent_row_id_null: Number(oAgentRowNull.results?.[0]?.n || 0),
    orgs_agent_row_id_broken_fk: Number(oBrokenFk.results?.[0]?.n || 0),
    agents_total: Number(a.results?.[0]?.n || 0),
    agents_uaid_null: Number(aNull.results?.[0]?.n || 0),
    orgs_missing_agent_row_id: Number(oMissing.results?.[0]?.n || 0),
    individuals_with_participant_uaid: Number(iTotalWithUaid.results?.[0]?.n || 0),
    individuals_missing_participant_agent_row_id: Number(iMissing.results?.[0]?.n || 0),
    individuals_participant_agent_row_id_broken_fk: Number(iBrokenFk.results?.[0]?.n || 0),
  };
}

async function upsertAgentByUaid(d1, { uaid, ens_name, agent_name, email_domain, session_package, agent_card_json }) {
  const now = Math.floor(Date.now() / 1000);
  const existing = await d1Query(d1, "SELECT id FROM agents WHERE uaid = ? LIMIT 1", [uaid]);
  const existingId = existing.results?.[0]?.id ? Number(existing.results[0].id) : null;
  if (existingId) {
    await d1Query(
      d1,
      `UPDATE agents
       SET uaid = ?,
           ens_name = COALESCE(?, ens_name),
           agent_name = COALESCE(?, agent_name),
           email_domain = COALESCE(?, email_domain),
           session_package = COALESCE(?, session_package),
           agent_card_json = COALESCE(?, agent_card_json),
           updated_at = ?
       WHERE id = ?`,
      [
        uaid,
        ens_name ?? null,
        agent_name ?? null,
        email_domain ?? null,
        session_package ?? null,
        agent_card_json ?? null,
        now,
        existingId,
      ],
    );
    return existingId;
  }

  const ins = await d1Query(
    d1,
    `INSERT INTO agents
     (uaid, ens_name, agent_name, email_domain, session_package, agent_card_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uaid,
      ens_name ?? null,
      agent_name ?? null,
      email_domain ?? "unknown",
      session_package ?? null,
      agent_card_json ?? null,
      now,
      now,
    ],
  );
  const newId = Number(ins.meta?.last_row_id || 0);
  return newId || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnvFile(args.envPath);

  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
  const databaseId = String(process.env.CLOUDFLARE_D1_DATABASE_ID || "").trim();
  const databaseName = String(process.env.CLOUDFLARE_D1_DATABASE_NAME || "impact").trim();

  if (!accountId || !apiToken || !databaseId) {
    throw new Error("Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / CLOUDFLARE_D1_DATABASE_ID in env");
  }

  const d1 = { accountId, apiToken, databaseId, databaseName };
  await ensureSchema(d1);

  if (args.migrateUaidOnly) {
    console.log(JSON.stringify({ phase: "migrate_uaid_only", dry_run: args.dryRun }, null, 2));
    await migrateUaidOnly(d1, { dryRun: args.dryRun });
  }

  const before = await getStats(d1);
  console.log(JSON.stringify({ phase: "before", db: databaseName, ...before }, null, 2));

  const limit = args.limit;

  // Organizations
  const orgs = await d1Query(
    d1,
    `SELECT id, ens_name, agent_name, org_name, email_domain, uaid, agent_row_id, session_package, agent_card_json, org_metadata
     FROM organizations
     ORDER BY id ASC` + (limit ? ` LIMIT ${limit}` : ""),
    [],
  );

  let updatedOrgs = 0;
  let updatedAgents = 0;
  let orgsMissingUaid = 0;
  const orgsMissingUaidSample = [];

  for (const o of orgs.results) {
    let uaid = typeof o.uaid === "string" && o.uaid.trim() ? o.uaid.trim() : null;
    if (!uaid) uaid = parseUaidFromJson(o.agent_card_json);

    if (!uaid) {
      orgsMissingUaid += 1;
      if (orgsMissingUaidSample.length < 20) {
        orgsMissingUaidSample.push({
          id: o.id,
          ens_name: o.ens_name ?? null,
        });
      }
      continue;
    }

    if (!args.dryRun) {
      const agentId = await upsertAgentByUaid(d1, {
        uaid,
        ens_name: o.ens_name ?? null,
        agent_name: o.agent_name ?? null,
        email_domain: o.email_domain ?? "unknown",
        session_package: o.session_package ?? null,
        agent_card_json: o.agent_card_json ?? null,
      });
      if (agentId) updatedAgents += 1;

      const currentAgentRowId = o.agent_row_id != null ? Number(o.agent_row_id) : null;
      const needsOrgUpdate =
        currentAgentRowId !== agentId ||
        (typeof o.uaid !== "string" || !o.uaid.trim());

      if (needsOrgUpdate) {
        await d1Query(
          d1,
          `UPDATE organizations
           SET uaid = ?,
               agent_row_id = COALESCE(?, agent_row_id),
               updated_at = ?
           WHERE id = ?`,
          [
            uaid,
            agentId,
            Math.floor(Date.now() / 1000),
            o.id,
          ],
        );
        updatedOrgs += 1;
      }
    } else {
      // dry-run counts
      updatedAgents += 1;
    }
  }

  // Individuals (participant agent)
  const individuals = await d1Query(
    d1,
    `SELECT id, participant_uaid, participant_ens_name, participant_agent_name, participant_agent_row_id
     FROM individuals
     WHERE participant_uaid IS NOT NULL AND TRIM(participant_uaid) != ''
     ORDER BY id ASC` + (limit ? ` LIMIT ${limit}` : ""),
    [],
  );

  let updatedIndividuals = 0;
  let individualsMissingAgentRowId = 0;

  for (const ind of individuals.results) {
    const uaid = typeof ind.participant_uaid === "string" && ind.participant_uaid.trim() ? ind.participant_uaid.trim() : null;
    if (!uaid) continue;

    if (!args.dryRun) {
      const agentId = await upsertAgentByUaid(d1, {
        uaid,
        ens_name: ind.participant_ens_name ?? null,
        agent_name: ind.participant_agent_name ?? null,
        email_domain: "unknown",
        session_package: null,
        agent_card_json: null,
      });
      if (agentId) updatedAgents += 1;
      const current = ind.participant_agent_row_id != null ? Number(ind.participant_agent_row_id) : null;
      if (!current || current !== agentId) {
        await d1Query(
          d1,
          `UPDATE individuals
           SET participant_agent_row_id = COALESCE(?, participant_agent_row_id),
               updated_at = ?
           WHERE id = ?`,
          [agentId, Math.floor(Date.now() / 1000), ind.id],
        );
        updatedIndividuals += 1;
      }
      if (!agentId) individualsMissingAgentRowId += 1;
    } else {
      // dry-run counts
      updatedAgents += 1;
    }
  }

  const after = await getStats(d1);
  console.log(
    JSON.stringify(
      {
        phase: "after",
        db: databaseName,
        dryRun: args.dryRun,
        processed: {
          orgs_total: orgs.results.length,
          individuals_total_with_participant_uaid: individuals.results.length,
        },
        updated: {
          organizations: updatedOrgs,
          individuals: updatedIndividuals,
          agents_upserts: updatedAgents,
        },
        missing: {
          orgs_missing_uaid: orgsMissingUaid,
          individuals_missing_agent_row_id: individualsMissingAgentRowId,
        },
        ...(orgsMissingUaidSample.length ? { orgs_missing_uaid_sample: orgsMissingUaidSample } : {}),
        ...after,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(`[backfill-agents] failed: ${e?.message || String(e)}`);
  process.exit(1);
});

