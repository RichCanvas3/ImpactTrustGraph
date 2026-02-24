# Production deployment

Local runs use `.env`; production does not load that file. Set the **same env vars as in `.env`** in your deployment (Cloudflare Pages/Workers, Vercel, etc. → Environment variables).

## Env vars to mirror from `.env` (you don’t have `AGENTIC_TRUST_ADMIN_PRIVATE_KEY` locally)

Set these in production so behavior matches local:

- **RPC / bundler:** `AGENTIC_TRUST_RPC_URL_SEPOLIA`, `AGENTIC_TRUST_BUNDLER_URL_SEPOLIA` (and chain-specific ones you use)
- **Discovery:** `AGENTIC_TRUST_DISCOVERY_URL`, `AGENTIC_TRUST_DISCOVERY_API_KEY` (or `GRAPHQL_ACCESS_CODE`)
- **ENS (for agent/ENS flows):** `AGENTIC_TRUST_ENS_PRIVATE_KEY_SEPOLIA`, `AGENTIC_TRUST_ENS_ORG_ADDRESS_SEPOLIA`, `AGENTIC_TRUST_ENS_REGISTRY_SEPOLIA`, `AGENTIC_TRUST_ENS_RESOLVER_SEPOLIA`
- **Registries:** `AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA`, `AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA`, etc.
- **D1 (if used):** `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `USE_REMOTE_D1=true`

## If you still see “AGENTIC_TRUST_ADMIN_PRIVATE_KEY” in production

That key is **not** in your local `.env`. If the error appears only in production, add the same server-side vars above first. If it still fails, add `AGENTIC_TRUST_ADMIN_PRIVATE_KEY` in production (e.g. an ENS signer key or a dedicated admin key for the server).
