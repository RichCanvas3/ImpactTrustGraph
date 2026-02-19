# Impact Agent

A Next.js A2A (Agent-to-Agent) provider application for ITG agents, aligned with the [agentic-trust provider app pattern](https://github.com/Agentic-Trust-Layer/agentic-trust).

## Features

- **Domain/ENS Mapping**: Automatic mapping between domain names and ENS names for multi-agent routing
- **Agent Card Endpoint**: `/.well-known/agent-card.json` - Standard A2A discovery endpoint
- **A2A API Endpoint**: `/api/a2a` - Handles incoming A2A messages with domain-based routing
- **Feedback Auth Support**: Built-in support for `agent.feedback.requestAuth` skill
- **Challenge Verification**: Automatic verification of client challenges using `@agentic-trust/core`
- **Session Package Integration**: Agent card generated from session package

## Domain/ENS Mapping

The app supports multiple routing methods for accessing agent-specific endpoints:

### Subdomain Routing
Access agents via subdomain:
- `{agent-name}.8004-agent.eth` → Routes to that agent's endpoints
- Example: `example-itg.8004-agent.eth/.well-known/agent-card.json`

### Path-Based Routing
Access agents via path:
- `/{agent-name}/.well-known/agent-card.json` → Routes to that agent's endpoints
- Example: `/example-itg/.well-known/agent-card.json`

### Default Agent
If no domain/agent name is specified, uses the default agent from environment variables.

## Getting Started

### Installation

```bash
pnpm install
```

### Configuration

Create `.env.local` and configure:

```env
# Server Configuration
PORT=3001

# Agent Configuration
AGENT_NAME=default-itg
AGENT_DESCRIPTION=Description of my agent
AGENT_ID=123
AGENT_ADDRESS=0x...

# Provider Configuration
PROVIDER_BASE_URL=http://localhost:3001
PROVIDER_ORGANIZATION=My Organization

# Session Package (from ITG admin app)
AGENTIC_TRUST_SESSION_PACKAGE_PATH=./sessionPackage.json.secret

# Agentic Trust Configuration
AGENTIC_TRUST_RPC_URL_SEPOLIA=https://...
AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA=0x...
AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA=0x...
AGENTIC_TRUST_DISCOVERY_URL=https://...
AGENTIC_TRUST_DISCOVERY_API_KEY=...
```

### Running

Development:
```bash
pnpm dev
```

Production:
```bash
pnpm build
pnpm start
```

## Endpoints

### `GET /.well-known/agent-card.json`

Returns the agent card for A2A discovery. The card is generated from the session package and environment variables. Supports domain-based routing to return agent-specific cards.

### `POST /api/a2a`

Handles A2A messages. Supports:
- Authentication via challenge verification
- Skill-based requests (e.g., `agent.feedback.requestAuth`)
- Custom skill handlers
- Domain-based routing to agent-specific handlers

### `GET /health`

Health check endpoint that returns agent information based on domain routing.

## Skills

### `agent.feedback.requestAuth`

Issues a signed ERC-8004 feedbackAuth for clients to submit feedback. Requires:
- `clientAddress` in payload
- Optional: `agentId`, `expirySeconds`

### `agent.feedback.request` (agents-admin only)

Stores a feedback request in the database. This skill is **only available on the `agents-admin` subdomain**. Requires:
- `clientAddress` (EOA address) in payload
- `targetAgentId` (agent ID to give feedback to) in payload
- `comment` (reason for feedback) in payload

The feedback request is stored in the `agent_feedback_requests` table with status `pending`.

### `agent.feedback.getRequests` (agents-admin only)

Retrieves all feedback requests associated with a wallet address. This skill is **only available on the `agents-admin` subdomain**. Requires:
- `clientAddress` (EOA address) in payload

Returns an array of feedback requests with their details (id, clientAddress, targetAgentId, comment, status, createdAt, updatedAt).

### `agent.feedback.getRequestsByAgent` (agents-admin only)

Retrieves all feedback requests for a specific agent. This skill is **only available on the `agents-admin` subdomain**. Requires:
- `targetAgentId` (agent ID) in payload

Returns an array of feedback requests with their details (id, clientAddress, targetAgentId, comment, status, createdAt, updatedAt) for the specified agent.

### `agent.validation.respond`

Processes validation requests by validating ENS names and submitting validation responses. Requires:
- `agentId` in payload
- Optional: `chainId`, `requestHash`

### `general_movie_chat`

Example skill for movie-related questions.

## Architecture

This app follows the provider app pattern from [agentic-trust](https://github.com/Agentic-Trust-Layer/agentic-trust):

- **Next.js App Router**: Uses Next.js 14+ App Router for routing
- **Middleware**: Domain/ENS mapping middleware extracts agent information from requests
- **Server-Side API Routes**: All A2A operations happen in Next.js API routes
- **ProviderApp Singleton**: Uses `ProviderApp` singleton from `@agentic-trust/core` for agent operations

### Domain Mapping Flow

1. Request comes in with domain/path
2. Middleware extracts agent name from:
   - Hostname subdomain: `{agent-name}.8004-agent.eth`
   - Path prefix: `/{agent-name}/...`
3. Middleware resolves ENS name: `{agent-name}.8004-agent.eth`
4. Middleware queries agent information from `@agentic-trust/core`
5. Agent info added to request headers
6. API routes use agent info from headers

## Alignment with agentic-trust Provider App

This app aligns with the provider app pattern from the [agentic-trust repository](https://github.com/Agentic-Trust-Layer/agentic-trust):

- ✅ Next.js structure (not Express)
- ✅ `/.well-known/agent-card.json` endpoint
- ✅ `/api/a2a` endpoint
- ✅ Domain/ENS mapping for multi-agent support
- ✅ Uses `ProviderApp` singleton pattern
- ✅ Server-side API routes for all operations



## Database Schema

The service uses Cloudflare D1 database. Required tables:

### `organizations`
Stores organization and agent information, including session packages.

### `agent_feedback_requests`
Stores feedback requests from clients. Schema:
```sql
CREATE TABLE IF NOT EXISTS agent_feedback_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_address TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  feedback_auth TEXT NULL,
  feedback_tx_hash TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

The `feedback_auth` field stores the signed feedback auth payload (as JSON string) when a feedback request is approved via the `agent.feedback.requestAuth` skill.

The `feedback_tx_hash` field stores the transaction hash of the feedback that was actually submitted on-chain.

### `messages`
Stores inbox messages between users (wallet addresses) and agents (by DID:8004).

```sql
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_client_address TEXT NULL,
  from_agent_did TEXT NULL,
  from_agent_name TEXT NULL,
  to_client_address TEXT NULL,
  to_agent_did TEXT NULL,
  to_agent_name TEXT NULL,
  subject TEXT NULL,
  body TEXT NOT NULL,
  context_type TEXT NULL,
  context_id TEXT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER NULL
);
```

## Database Migrations

To add the `feedback_auth` column to an existing `agent_feedback_requests` table:

```bash
# Apply migration to remote database
wrangler d1 execute agentic-relief-network --file=./db/migrations/0001_add_feedback_auth.sql

# Or for local development
wrangler d1 execute agentic-relief-network --local --file=./db/migrations/0001_add_feedback_auth.sql
```

## Cloudflare Deployment

```bash
wrangler deploy
wrangler tail
```