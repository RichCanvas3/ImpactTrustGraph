-- Cloudflare D1 Database Schema for ITG User Profiles and Organizations

-- Individuals table: stores user profile information
CREATE TABLE IF NOT EXISTS individuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  role TEXT, -- coordinator | contributor | org-admin | funder | admin
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  social_display_name TEXT,
  social_account_id TEXT, -- Web3Auth social account identifier
  social_account_type TEXT, -- e.g., 'google', 'facebook', 'twitter', etc.
  eoa_address TEXT, -- Externally Owned Account address (0x...)
  aa_address TEXT, -- Account Abstraction address (0x...)
  participant_ens_name TEXT, -- e.g., 'alice.8004-agent.eth'
  participant_agent_name TEXT, -- e.g., 'alice'
  participant_uaid TEXT, -- UAID for the participant smart account (canonical agent identifier)
  participant_agent_row_id INTEGER, -- FK to agents.id (best-effort)
  participant_metadata TEXT, -- JSON: role-specific fields (skills, availability, coalition, etc.)
  trust_tier TEXT, -- Observer | Advisor | Coordinator | Steward (optional)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Organizations table: stores organization information
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ens_name TEXT NOT NULL UNIQUE, -- e.g., 'richcanvas-itg.8004-agent.eth'
  agent_name TEXT NOT NULL, -- e.g., 'richcanvas-itg'
  org_name TEXT, -- Display name of the organization
  org_address TEXT, -- Physical address of the organization
  email_domain TEXT NOT NULL, -- e.g., 'richcanvas.io'
  uaid TEXT, -- UAID for the organization's smart account (canonical agent identifier)
  agent_row_id INTEGER, -- FK to agents.id (best-effort)
  session_package TEXT, -- JSON string of sessionPackage for agent configuration
  org_metadata TEXT, -- JSON: role-specific org fields (sector, programs, funder compliance, etc.)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Agents table: canonical agent records (modeled after admin app)
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uaid TEXT UNIQUE, -- UAID for smart-agent operations (canonical)
  ens_name TEXT, -- e.g. 'name.8004-agent.eth' or did:ens:...
  agent_name TEXT,
  email_domain TEXT, -- org or ENS base domain (e.g. 8004-agent.eth or example.com)
  session_package TEXT,
  agent_card_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Individual-Organization associations table
CREATE TABLE IF NOT EXISTS individual_organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  individual_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT 0, -- The primary org (based on email domain)
  role TEXT, -- e.g., 'owner', 'member', 'admin', etc.
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (individual_id) REFERENCES individuals(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(individual_id, organization_id)
);

-- Organization roles/tags (multi-select)
-- coalition | contributor | funding | member
CREATE TABLE IF NOT EXISTS organization_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(organization_id, role)
);

-- Initiatives: core program container
CREATE TABLE IF NOT EXISTS initiatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,
  state TEXT NOT NULL DEFAULT 'draft', -- draft|chartered|funded|executing|evaluating|closed
  created_by_individual_id INTEGER,
  created_by_org_id INTEGER,
  governance_json TEXT, -- JSON
  budget_json TEXT, -- JSON
  payout_rules_json TEXT, -- JSON
  metadata_json TEXT, -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (created_by_individual_id) REFERENCES individuals(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_org_id) REFERENCES organizations(id) ON DELETE SET NULL
);

-- Coalition org tags for initiatives (multi-select)
CREATE TABLE IF NOT EXISTS initiative_coalitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initiative_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(initiative_id, organization_id)
);

-- Initiative participants (individuals and/or organizations)
CREATE TABLE IF NOT EXISTS initiative_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initiative_id INTEGER NOT NULL,
  participant_kind TEXT NOT NULL, -- individual|organization
  individual_id INTEGER,
  organization_id INTEGER,
  role TEXT NOT NULL DEFAULT 'observer', -- steward|coordinator|org_admin|contributor|funder|observer
  status TEXT NOT NULL DEFAULT 'invited', -- invited|active|removed
  invited_by_individual_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE CASCADE,
  FOREIGN KEY (individual_id) REFERENCES individuals(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_individual_id) REFERENCES individuals(id) ON DELETE SET NULL,
  UNIQUE(initiative_id, participant_kind, individual_id, organization_id)
);

-- Workstreams within an initiative
CREATE TABLE IF NOT EXISTS initiative_workstreams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initiative_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active|archived
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE CASCADE
);

-- Outcomes (initiative-level)
CREATE TABLE IF NOT EXISTS initiative_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initiative_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  metric_json TEXT, -- JSON
  status TEXT NOT NULL DEFAULT 'defined', -- defined|tracking|verified|archived
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE CASCADE
);

-- Opportunities (needs) within an initiative
CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initiative_id INTEGER NOT NULL,
  workstream_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  required_skills_json TEXT, -- JSON
  budget_json TEXT, -- JSON
  status TEXT NOT NULL DEFAULT 'draft', -- draft|open|filled|closed
  created_by_individual_id INTEGER,
  created_by_org_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE CASCADE,
  FOREIGN KEY (workstream_id) REFERENCES initiative_workstreams(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_individual_id) REFERENCES individuals(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_org_id) REFERENCES organizations(id) ON DELETE SET NULL
);

-- Engagements (contributor ↔ initiative work agreement), created from an opportunity
CREATE TABLE IF NOT EXISTS engagements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initiative_id INTEGER NOT NULL,
  opportunity_id INTEGER NOT NULL,
  requesting_organization_id INTEGER,
  contributor_individual_id INTEGER,
  contributor_agent_row_id INTEGER, -- best-effort FK to agents.id (from individuals.participant_agent_row_id)
  terms_json TEXT, -- JSON
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed|active|completed|terminated
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE CASCADE,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  FOREIGN KEY (requesting_organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  FOREIGN KEY (contributor_individual_id) REFERENCES individuals(id) ON DELETE SET NULL,
  FOREIGN KEY (contributor_agent_row_id) REFERENCES agents(id) ON DELETE SET NULL
);

-- Milestones (engagement-level checkpoints)
CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engagement_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  due_at INTEGER, -- unix epoch seconds
  status TEXT NOT NULL DEFAULT 'pending', -- pending|submitted|verified|rejected
  evidence_json TEXT, -- JSON
  payout_json TEXT, -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
);

-- Off-chain attestations (event log across lifecycle objects)
CREATE TABLE IF NOT EXISTS attestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attestation_type TEXT NOT NULL, -- initiative.created, participant.added, opportunity.published, etc.
  payload_json TEXT, -- JSON
  initiative_id INTEGER,
  opportunity_id INTEGER,
  engagement_id INTEGER,
  milestone_id INTEGER,
  actor_individual_id INTEGER,
  actor_org_id INTEGER,
  chain_id INTEGER,
  tx_hash TEXT,
  eas_uid TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE CASCADE,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_individual_id) REFERENCES individuals(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_org_id) REFERENCES organizations(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_individuals_email ON individuals(email);
CREATE INDEX IF NOT EXISTS idx_individuals_eoa ON individuals(eoa_address);
CREATE INDEX IF NOT EXISTS idx_individuals_aa ON individuals(aa_address);
CREATE INDEX IF NOT EXISTS idx_organizations_ens_name ON organizations(ens_name);
CREATE INDEX IF NOT EXISTS idx_organizations_email_domain ON organizations(email_domain);
CREATE INDEX IF NOT EXISTS idx_agents_uaid ON agents(uaid);
CREATE INDEX IF NOT EXISTS idx_agents_ens_name ON agents(ens_name);
CREATE INDEX IF NOT EXISTS idx_individual_organizations_individual ON individual_organizations(individual_id);
CREATE INDEX IF NOT EXISTS idx_individual_organizations_org ON individual_organizations(organization_id);
CREATE INDEX IF NOT EXISTS idx_individual_organizations_primary ON individual_organizations(individual_id, is_primary) WHERE is_primary = 1;
CREATE INDEX IF NOT EXISTS idx_organization_roles_org ON organization_roles(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_roles_role ON organization_roles(role);

CREATE INDEX IF NOT EXISTS idx_initiatives_state ON initiatives(state);
CREATE INDEX IF NOT EXISTS idx_initiative_coalitions_initiative ON initiative_coalitions(initiative_id);
CREATE INDEX IF NOT EXISTS idx_initiative_coalitions_org ON initiative_coalitions(organization_id);
CREATE INDEX IF NOT EXISTS idx_initiative_participants_initiative ON initiative_participants(initiative_id);
CREATE INDEX IF NOT EXISTS idx_initiative_participants_individual ON initiative_participants(individual_id);
CREATE INDEX IF NOT EXISTS idx_initiative_participants_org ON initiative_participants(organization_id);
CREATE INDEX IF NOT EXISTS idx_workstreams_initiative ON initiative_workstreams(initiative_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_initiative ON initiative_outcomes(initiative_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_initiative ON opportunities(initiative_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_engagements_initiative ON engagements(initiative_id);
CREATE INDEX IF NOT EXISTS idx_engagements_opportunity ON engagements(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_engagements_status ON engagements(status);
CREATE INDEX IF NOT EXISTS idx_milestones_engagement ON milestones(engagement_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status ON milestones(status);
CREATE INDEX IF NOT EXISTS idx_attestations_initiative ON attestations(initiative_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attestations_type ON attestations(attestation_type, created_at);

