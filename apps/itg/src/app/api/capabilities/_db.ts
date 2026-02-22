import type { D1Database } from "../../../lib/db";

export type AppRole = "admin" | "coordinator" | "org_admin" | "contributor" | "funder";

function now(): number {
  return Math.floor(Date.now() / 1000);
}

let ensurePromise: Promise<void> | null = null;

export async function ensureCapabilitiesSchema(db: D1Database) {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    // Regions / Locations
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS regions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE, -- e.g. us, us-tx, us-tx-dallas
          name TEXT NOT NULL,
          kind TEXT NOT NULL, -- country|state|metro|county|city|custom
          parent_region_id INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (parent_region_id) REFERENCES regions(id) ON DELETE SET NULL
        );`,
      )
      .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_regions_parent ON regions(parent_region_id)").run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS locations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          label TEXT, -- freeform label like "Home" / "HQ"
          address1 TEXT,
          address2 TEXT,
          city TEXT,
          state TEXT,
          postal TEXT,
          country TEXT,
          region_id INTEGER,
          lat REAL,
          lon REAL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE SET NULL
        );`,
      )
      .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_locations_region ON locations(region_id)").run();

    // Entity ↔ location mapping (multiple locations per entity)
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS individual_locations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          individual_id INTEGER NOT NULL,
          location_id INTEGER NOT NULL,
          kind TEXT NOT NULL DEFAULT 'home', -- home|work|service_area|other
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (individual_id) REFERENCES individuals(id) ON DELETE CASCADE,
          FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
          UNIQUE(individual_id, location_id, kind)
        );`,
      )
      .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_individual_locations_ind ON individual_locations(individual_id)").run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS organization_locations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id INTEGER NOT NULL,
          location_id INTEGER NOT NULL,
          kind TEXT NOT NULL DEFAULT 'hq', -- hq|service_area|other
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
          FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
          UNIQUE(organization_id, location_id, kind)
        );`,
      )
      .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_organization_locations_org ON organization_locations(organization_id)").run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS initiative_locations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          initiative_id INTEGER NOT NULL,
          location_id INTEGER NOT NULL,
          kind TEXT NOT NULL DEFAULT 'region', -- region|event|service_area|other
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE CASCADE,
          FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
          UNIQUE(initiative_id, location_id, kind)
        );`,
      )
      .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_initiative_locations_init ON initiative_locations(initiative_id)").run();

    // Capability catalog
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS capability_classifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE, -- e.g. identity, availability, initiative_management
          label TEXT NOT NULL,
          description TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );`,
      )
      .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_cap_class_sort ON capability_classifications(sort_order)").run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS capability_types (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          classification_id INTEGER NOT NULL,
          key TEXT NOT NULL UNIQUE, -- e.g. languages, home_location, availability_hours_per_week
          label TEXT NOT NULL,
          description TEXT,
          value_kind TEXT NOT NULL, -- text|number|enum|multi_enum|location
          unit TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (classification_id) REFERENCES capability_classifications(id) ON DELETE CASCADE
        );`,
      )
      .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_cap_types_class ON capability_types(classification_id)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_cap_types_sort ON capability_types(sort_order)").run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS capability_type_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          capability_type_id INTEGER NOT NULL,
          role TEXT NOT NULL, -- admin|coordinator|org_admin|contributor|funder
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (capability_type_id) REFERENCES capability_types(id) ON DELETE CASCADE,
          UNIQUE(capability_type_id, role)
        );`,
      )
      .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_cap_type_roles_role ON capability_type_roles(role)").run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS capability_type_options (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          capability_type_id INTEGER NOT NULL,
          key TEXT NOT NULL, -- stable machine key
          label TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (capability_type_id) REFERENCES capability_types(id) ON DELETE CASCADE,
          UNIQUE(capability_type_id, key)
        );`,
      )
      .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_cap_options_type ON capability_type_options(capability_type_id)").run();

    // Individual capability values
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS individual_capabilities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          individual_id INTEGER NOT NULL,
          capability_type_id INTEGER NOT NULL,
          value_text TEXT,
          value_number REAL,
          value_json TEXT, -- arrays/objects
          location_id INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (individual_id) REFERENCES individuals(id) ON DELETE CASCADE,
          FOREIGN KEY (capability_type_id) REFERENCES capability_types(id) ON DELETE CASCADE,
          FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
          UNIQUE(individual_id, capability_type_id)
        );`,
      )
      .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_ind_caps_ind ON individual_capabilities(individual_id)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_ind_caps_type ON individual_capabilities(capability_type_id)").run();
  })();
  return ensurePromise;
}

export async function seedCapabilitiesIfEmpty(db: D1Database) {
  await ensureCapabilitiesSchema(db);

  const existing = await db.prepare("SELECT COUNT(*) as n FROM capability_types").first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return;

  const ts = now();

  // Seed minimal regions (extend later)
  try {
    await db
      .prepare("INSERT OR IGNORE INTO regions (key, name, kind, parent_region_id, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)")
      .bind("us", "United States", "country", ts, ts)
      .run();
    const us = await db.prepare("SELECT id FROM regions WHERE key = ?").bind("us").first<{ id: number }>();
    const usId = us?.id ?? null;
    if (usId) {
      await db
        .prepare("INSERT OR IGNORE INTO regions (key, name, kind, parent_region_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind("us-tx", "Texas", "state", usId, ts, ts)
        .run();
      await db
        .prepare("INSERT OR IGNORE INTO regions (key, name, kind, parent_region_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind("us-co", "Colorado", "state", usId, ts, ts)
        .run();
    }
  } catch {
    // ignore
  }

  // Seed classifications
  const classifications = [
    { key: "identity", label: "Identity", description: "Personal info that helps match you to work.", sort: 10 },
    { key: "availability", label: "Availability", description: "When and how you can contribute.", sort: 20 },
    { key: "coordinator_ops", label: "Initiative Operations", description: "Capabilities for managing initiatives, review, and fulfillment.", sort: 30 },
    { key: "contributor_fulfillment", label: "Fulfillment", description: "Capabilities for delivering work in initiatives.", sort: 40 },
  ];
  for (const c of classifications) {
    await db
      .prepare(
        `INSERT INTO capability_classifications (key, label, description, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(c.key, c.label, c.description, c.sort, ts, ts)
      .run();
  }

  const classId = async (key: string) =>
    (await db.prepare("SELECT id FROM capability_classifications WHERE key = ?").bind(key).first<{ id: number }>())?.id ?? null;

  const identityId = await classId("identity");
  const availId = await classId("availability");
  const coordId = await classId("coordinator_ops");
  const contribId = await classId("contributor_fulfillment");

  const types: Array<{
    classId: number | null;
    key: string;
    label: string;
    description: string;
    kind: "text" | "number" | "enum" | "multi_enum" | "location";
    unit?: string | null;
    sort: number;
    roles: AppRole[];
    options?: Array<{ key: string; label: string; sort: number }>;
  }> = [
    {
      classId: identityId,
      key: "languages",
      label: "Languages",
      description: "Languages you can work in.",
      kind: "multi_enum",
      sort: 10,
      roles: ["admin", "coordinator", "org_admin", "contributor", "funder"],
      options: [
        { key: "en", label: "English", sort: 10 },
        { key: "es", label: "Spanish", sort: 20 },
        { key: "fr", label: "French", sort: 30 },
      ],
    },
    {
      classId: identityId,
      key: "home_location",
      label: "Location",
      description: "Where you live (for matching and logistics).",
      kind: "location",
      sort: 20,
      roles: ["admin", "coordinator", "org_admin", "contributor", "funder"],
    },
    {
      classId: availId,
      key: "availability_hours_per_week",
      label: "Availability (hours/week)",
      description: "Approximate weekly availability.",
      kind: "number",
      unit: "hours/week",
      sort: 10,
      roles: ["coordinator", "contributor", "org_admin", "funder", "admin"],
    },
    {
      classId: availId,
      key: "work_mode",
      label: "Work mode",
      description: "How you prefer to work.",
      kind: "enum",
      sort: 20,
      roles: ["coordinator", "contributor", "org_admin", "funder", "admin"],
      options: [
        { key: "remote", label: "Remote", sort: 10 },
        { key: "hybrid", label: "Hybrid", sort: 20 },
        { key: "onsite", label: "Onsite", sort: 30 },
      ],
    },
    {
      classId: coordId,
      key: "initiative_review_experience",
      label: "Review experience",
      description: "Your experience reviewing and approving work (milestones/claims).",
      kind: "enum",
      sort: 10,
      roles: ["coordinator", "admin"],
      options: [
        { key: "new", label: "New", sort: 10 },
        { key: "some", label: "Some", sort: 20 },
        { key: "expert", label: "Expert", sort: 30 },
      ],
    },
    {
      classId: coordId,
      key: "initiative_domains",
      label: "Domains",
      description: "Domains you can coordinate (e.g., workforce, housing).",
      kind: "multi_enum",
      sort: 20,
      roles: ["coordinator", "admin"],
      options: [
        { key: "workforce", label: "Workforce", sort: 10 },
        { key: "housing", label: "Housing", sort: 20 },
        { key: "health", label: "Health", sort: 30 },
      ],
    },
    {
      classId: contribId,
      key: "fulfillment_skills",
      label: "Skills",
      description: "Skills you can bring to initiatives.",
      kind: "multi_enum",
      sort: 10,
      roles: ["contributor", "admin"],
      options: [
        { key: "software", label: "Software", sort: 10 },
        { key: "data", label: "Data", sort: 20 },
        { key: "design", label: "Design", sort: 30 },
        { key: "ops", label: "Operations", sort: 40 },
      ],
    },
    {
      classId: contribId,
      key: "travel_radius_km",
      label: "Travel radius",
      description: "How far you can travel for onsite work.",
      kind: "number",
      unit: "km",
      sort: 20,
      roles: ["contributor", "admin"],
    },
  ];

  for (const t of types) {
    if (!t.classId) continue;
    await db
      .prepare(
        `INSERT INTO capability_types
         (classification_id, key, label, description, value_kind, unit, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(t.classId, t.key, t.label, t.description, t.kind, t.unit ?? null, t.sort, ts, ts)
      .run();

    const typeRow = await db.prepare("SELECT id FROM capability_types WHERE key = ?").bind(t.key).first<{ id: number }>();
    const typeId = typeRow?.id ?? null;
    if (!typeId) continue;

    for (const r of t.roles) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO capability_type_roles (capability_type_id, role, created_at, updated_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(typeId, r, ts, ts)
        .run();
    }

    if (t.options?.length) {
      for (const o of t.options) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO capability_type_options (capability_type_id, key, label, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(typeId, o.key, o.label, o.sort, ts, ts)
          .run();
      }
    }
  }
}

