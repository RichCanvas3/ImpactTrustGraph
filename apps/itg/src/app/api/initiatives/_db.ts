import type { D1Database } from "../../../lib/db";
import { getD1Database } from "../../../lib/d1-wrapper";

export async function getDB(): Promise<D1Database | null> {
  return await getD1Database();
}

let ensureInitiativesSchemaPromise: Promise<void> | null = null;

export async function ensureInitiativesSchema(db: D1Database) {
  if (ensureInitiativesSchemaPromise) return ensureInitiativesSchemaPromise;
  ensureInitiativesSchemaPromise = (async () => {
    // Core tables (CREATE IF NOT EXISTS is idempotent)
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS initiatives (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          summary TEXT,
          state TEXT NOT NULL DEFAULT 'draft',
          created_by_individual_id INTEGER,
          created_by_org_id INTEGER,
          governance_json TEXT,
          budget_json TEXT,
          payout_rules_json TEXT,
          metadata_json TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );`,
      )
      .run();

    // Initiative coalition org tags (multi-select)
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS initiative_coalitions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          initiative_id INTEGER NOT NULL,
          organization_id INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(initiative_id, organization_id)
        );`,
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS initiative_participants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          initiative_id INTEGER NOT NULL,
          participant_kind TEXT NOT NULL,
          individual_id INTEGER,
          organization_id INTEGER,
          role TEXT NOT NULL DEFAULT 'observer',
          status TEXT NOT NULL DEFAULT 'invited',
          invited_by_individual_id INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(initiative_id, participant_kind, individual_id, organization_id)
        );`,
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS initiative_workstreams (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          initiative_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );`,
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS initiative_outcomes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          initiative_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          metric_json TEXT,
          status TEXT NOT NULL DEFAULT 'defined',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );`,
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS opportunities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          initiative_id INTEGER NOT NULL,
          workstream_id INTEGER,
          title TEXT NOT NULL,
          description TEXT,
          required_skills_json TEXT,
          budget_json TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          created_by_individual_id INTEGER,
          created_by_org_id INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );`,
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS engagements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          initiative_id INTEGER NOT NULL,
          opportunity_id INTEGER NOT NULL,
          requesting_organization_id INTEGER,
          contributor_individual_id INTEGER,
          contributor_agent_row_id INTEGER,
          terms_json TEXT,
          status TEXT NOT NULL DEFAULT 'proposed',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );`,
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS milestones (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          engagement_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          due_at INTEGER,
          status TEXT NOT NULL DEFAULT 'pending',
          evidence_json TEXT,
          payout_json TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );`,
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS attestations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          attestation_type TEXT NOT NULL,
          payload_json TEXT,
          initiative_id INTEGER,
          opportunity_id INTEGER,
          engagement_id INTEGER,
          milestone_id INTEGER,
          actor_individual_id INTEGER,
          actor_org_id INTEGER,
          chain_id INTEGER,
          tx_hash TEXT,
          eas_uid TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );`,
      )
      .run();

    // Indexes (best-effort)
    const idx = async (sql: string) => {
      try {
        await db.prepare(sql).run();
      } catch {
        // ignore
      }
    };

    await idx("CREATE INDEX IF NOT EXISTS idx_initiatives_state ON initiatives(state)");
    await idx("CREATE INDEX IF NOT EXISTS idx_initiative_coalitions_initiative ON initiative_coalitions(initiative_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_initiative_coalitions_org ON initiative_coalitions(organization_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_initiative_participants_initiative ON initiative_participants(initiative_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_initiative_participants_individual ON initiative_participants(individual_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_initiative_participants_org ON initiative_participants(organization_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_workstreams_initiative ON initiative_workstreams(initiative_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_outcomes_initiative ON initiative_outcomes(initiative_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_opportunities_initiative ON opportunities(initiative_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status)");
    await idx("CREATE INDEX IF NOT EXISTS idx_engagements_initiative ON engagements(initiative_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_engagements_opportunity ON engagements(opportunity_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_engagements_status ON engagements(status)");
    await idx("CREATE INDEX IF NOT EXISTS idx_milestones_engagement ON milestones(engagement_id)");
    await idx("CREATE INDEX IF NOT EXISTS idx_milestones_status ON milestones(status)");
    await idx("CREATE INDEX IF NOT EXISTS idx_attestations_initiative ON attestations(initiative_id, created_at)");
    await idx("CREATE INDEX IF NOT EXISTS idx_attestations_type ON attestations(attestation_type, created_at)");
  })();
  return ensureInitiativesSchemaPromise;
}

export async function resolveIndividualIdByEoa(db: D1Database, eoa: string): Promise<number | null> {
  const cleaned = typeof eoa === "string" && /^0x[a-fA-F0-9]{40}$/.test(eoa) ? eoa.toLowerCase() : null;
  if (!cleaned) return null;
  const row = await db
    .prepare("SELECT id FROM individuals WHERE lower(eoa_address) = ?")
    .bind(cleaned)
    .first<{ id: number }>();
  return typeof row?.id === "number" ? row.id : null;
}

export async function resolveOrganizationIdsForIndividual(db: D1Database, individualId: number): Promise<number[]> {
  const rows = await db
    .prepare("SELECT organization_id FROM individual_organizations WHERE individual_id = ?")
    .bind(individualId)
    .all<{ organization_id: number }>();
  return (rows.results || [])
    .map((r) => Number(r.organization_id))
    .filter((n) => Number.isFinite(n));
}

export async function emitAttestation(db: D1Database, input: {
  attestation_type: string;
  payload?: unknown;
  initiative_id?: number | null;
  opportunity_id?: number | null;
  engagement_id?: number | null;
  milestone_id?: number | null;
  actor_individual_id?: number | null;
  actor_org_id?: number | null;
  chain_id?: number | null;
  tx_hash?: string | null;
  eas_uid?: string | null;
}) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO attestations
       (attestation_type, payload_json, initiative_id, opportunity_id, engagement_id, milestone_id,
        actor_individual_id, actor_org_id, chain_id, tx_hash, eas_uid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.attestation_type,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      input.initiative_id ?? null,
      input.opportunity_id ?? null,
      input.engagement_id ?? null,
      input.milestone_id ?? null,
      input.actor_individual_id ?? null,
      input.actor_org_id ?? null,
      input.chain_id ?? null,
      input.tx_hash ?? null,
      input.eas_uid ?? null,
      now,
    )
    .run();
}

