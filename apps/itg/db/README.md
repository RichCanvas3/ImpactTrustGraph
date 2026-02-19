# Cloudflare D1 Database Setup

This directory contains the database schema and setup instructions for the ITG application's Cloudflare D1 database.

## Database Schema

The database stores:
- **Individuals**: User profiles with email, name, social account info, EOA, and AA addresses
- **Organizations**: Organization information with ENS names, agent names, and email domains
- **Individual-Organization Associations**: Links users to organizations with role and primary org designation

## Setup Instructions

### 1. Create the D1 Database

```bash
# Install Wrangler CLI if not already installed
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create the database (if not already created)
wrangler d1 create agentic-relief-network
```

The database ID is already configured in `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "agentic-relief-network"
database_id = "f2c52166-1b8e-439e-8dec-ea3959124b0e"
```

### 2. Initialize the Database Schema

```bash
# Apply the schema to remote database
wrangler d1 execute agentic-relief-network --file=./db/schema.sql
```

Or for local development:

```bash
wrangler d1 execute agentic-relief-network --local --file=./db/schema.sql
```

### 2.1. Apply Migrations (if database already exists)

If your database was created before certain schema updates, you may need to run migrations:

```bash
# Apply migration to remote database
wrangler d1 execute agentic-relief-network --file=./db/migrations/0001_add_org_address_and_type.sql
```

Or for local development:

```bash
wrangler d1 execute agentic-relief-network --local --file=./db/migrations/0001_add_org_address_and_type.sql
```

### 3. Configure Remote D1 Access (for Next.js Development)

To use the remote D1 database from Next.js development, you have two options:

#### Option A: Use Wrangler CLI (Recommended for Remote Access)

1. **Install and Login to Wrangler**:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Set Environment Variable**:
   - Create `.env.local` file in `apps/itg/` directory
   - Add:
     ```
     USE_REMOTE_D1=true
     CLOUDFLARE_D1_DATABASE_NAME=agentic-relief-network
     ```

3. **Run Development Server**:
   ```bash
   npm run dev
   ```

   The application will use Wrangler CLI to execute queries against the remote D1 database.

#### Option B: Use Wrangler Pages Dev (Alternative)

For a more native Cloudflare experience:

```bash
# Build Next.js first
npm run build

# Use Wrangler Pages dev which provides DB binding
wrangler pages dev .next
```

### 4. Running the Application

**For Development (using remote D1 via Wrangler)**:
```bash
# Make sure .env.local has USE_REMOTE_D1=true
npm run dev
```

**For Production (Cloudflare Pages/Workers)**:
- The database binding will be automatically available via `globalThis.DB`
- No additional configuration needed when deployed to Cloudflare

### 5. Local Development with Local D1

If you prefer to use a local D1 database for development:

```bash
# Start local D1 database
wrangler d1 execute agentic-relief-network --local --file=./db/schema.sql

# Don't set USE_REMOTE_D1, or set it to false
# The app will try to use local bindings first
```

## API Routes

The following API routes are available:

- `GET /api/users/profile?email=...` - Get user profile by email
- `GET /api/users/profile?eoa=...` - Get user profile by EOA address
- `POST /api/users/profile` - Create or update user profile
- `GET /api/users/organizations?email=...` - Get all organizations for a user
- `POST /api/users/organizations` - Associate user with an organization

## Database Tables

### individuals
- Stores user profile information
- Unique constraint on email
- Indexed on email, EOA, and AA addresses

### organizations
- Stores organization information
- Unique constraint on ENS name
- Indexed on ENS name and email domain

### individual_organizations
- Junction table linking users to organizations
- Supports primary organization designation
- Unique constraint on (individual_id, organization_id)

