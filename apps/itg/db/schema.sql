-- Cloudflare D1 Database Schema for ITG User Profiles and Organizations

-- Individuals table: stores user profile information
CREATE TABLE IF NOT EXISTS individuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
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
  participant_agent_account TEXT, -- Participant agent AA (0x...)
  participant_agent_id TEXT, -- ERC-8004 agentId as string
  participant_chain_id INTEGER, -- chain for participant agent (default sepolia)
  participant_did TEXT, -- did:8004:chainId:agentId
  participant_uaid TEXT, -- UAID for the participant smart account (e.g., HCS-14)
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
  org_type TEXT, -- Type: 'organization', 'coalition', 'contributor'
  email_domain TEXT NOT NULL, -- e.g., 'richcanvas.io'
  agent_account TEXT, -- Agent's account address (0x...)
  uaid TEXT, -- UAID for the organization's smart account (optional)
  chain_id INTEGER NOT NULL DEFAULT 11155111, -- Sepolia by default
  session_package TEXT, -- JSON string of sessionPackage for agent configuration
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_individuals_email ON individuals(email);
CREATE INDEX IF NOT EXISTS idx_individuals_eoa ON individuals(eoa_address);
CREATE INDEX IF NOT EXISTS idx_individuals_aa ON individuals(aa_address);
CREATE INDEX IF NOT EXISTS idx_organizations_ens_name ON organizations(ens_name);
CREATE INDEX IF NOT EXISTS idx_organizations_email_domain ON organizations(email_domain);
CREATE INDEX IF NOT EXISTS idx_individual_organizations_individual ON individual_organizations(individual_id);
CREATE INDEX IF NOT EXISTS idx_individual_organizations_org ON individual_organizations(organization_id);
CREATE INDEX IF NOT EXISTS idx_individual_organizations_primary ON individual_organizations(individual_id, is_primary) WHERE is_primary = 1;

