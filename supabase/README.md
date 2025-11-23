# Supabase Migrations

This directory contains database migrations for Supabase. Migrations are SQL files that define schema changes and are applied in chronological order.

## Quick Start

### Option 1: Using Supabase CLI (Recommended)

1. **Install Supabase CLI** (if not already installed):
   ```bash
   npm install -g supabase
   # or
   brew install supabase/tap/supabase
   ```

2. **Initialize Supabase** (if not already initialized):
   ```bash
   npm run db:setup
   # or manually:
   supabase init
   ```

3. **Start local Supabase**:
   ```bash
   npm run db:start
   # or directly:
   supabase start
   ```
   This will automatically apply all migrations in the `migrations/` directory.

   **Note for Podman users**: The npm scripts automatically detect and configure Podman. If running Supabase CLI directly, set:
   ```bash
   export DOCKER_HOST=unix:///var/run/docker.sock  # for rootful Podman
   # or
   export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock  # for rootless
   supabase start
   ```

4. **Apply migrations** (for remote Supabase):
   ```bash
   supabase db push
   ```

### Option 2: Manual SQL Execution

If you don't have Supabase CLI installed, you can apply migrations manually:

1. Open your Supabase dashboard (or local Supabase Studio at `http://localhost:54323`)
2. Go to SQL Editor
3. Copy and paste the contents of migration files from `supabase/migrations/` directory
4. Run the SQL

## Available Scripts

- `npm run db:migrate:status` - List all migration files and show instructions
- `npm run db:migrate` - Apply migrations using Supabase CLI (`supabase db reset`)
- `npm run db:status` - Check migration status using Supabase CLI
- `npm run db:setup` - Initialize Supabase in the project
- `npm run db:start` - Start local Supabase (auto-detects Podman/Docker)
- `npm run db:stop` - Stop local Supabase

**Note**: All npm scripts automatically detect and configure Podman if you're using it instead of Docker.

## Migration Files

Migration files are named with the format: `YYYYMMDDHHMMSS_description.sql`

Example: `20240120000000_create_stream_events.sql`

### Creating a New Migration

1. Create a new file in `supabase/migrations/` with a timestamp prefix:
   ```bash
   touch supabase/migrations/$(date +%Y%m%d%H%M%S)_your_description.sql
   ```

2. Or use Supabase CLI:
   ```bash
   supabase migration new your_description
   ```

3. Write your SQL in the file:
   ```sql
   -- Your migration SQL here
   CREATE TABLE IF NOT EXISTS your_table (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     -- ...
   );
   ```

### Existing Migrations

- `20240120000000_create_stream_events.sql` - Creates the `stream_events` table for storing n8n workflow execution stream events
- `20251123041748_create_chat_tables.sql` - Creates `chat_sessions` and `chat_messages` tables for AI chat persistence with full AI SDK UIMessage compatibility

## Local Development Setup

For local development with Supabase:

1. **Start Supabase locally**:
   ```bash
   npm run db:start
   # or directly:
   supabase start
   ```

2. **View Supabase Studio**:
   - Dashboard: `http://localhost:54323`
   - API URL: `http://localhost:54321`
   - Anon Key: Check output of `supabase start`

3. **Update your `.env.local`**:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key_from_supabase_start>
   ```

4. **Apply migrations**:
   Migrations are automatically applied when you run `supabase start`, but you can reset the database with:
   ```bash
   npm run db:migrate
   # or directly:
   supabase db reset
   ```

### Using Podman instead of Docker

The project automatically detects and configures Podman. **Analytics is disabled by default** in `config.toml` for Podman compatibility (Vector service has permission issues with Podman socket).

If you encounter issues:

1. **Ensure Podman Machine is running** (for rootful Podman):
   ```bash
   podman machine start
   ```
   Socket location: `/var/run/docker.sock`

2. **For rootless Podman**, ensure the socket is running:
   ```bash
   systemctl --user start podman.socket
   ```
   Socket location: `/run/user/$(id -u)/podman/podman.sock`

3. **Use npm scripts** (recommended):
   The npm scripts automatically detect and configure Podman:
   ```bash
   npm run db:start    # Automatically detects Podman and sets DOCKER_HOST
   ```

4. **Manual configuration** (if needed):
   ```bash
   export DOCKER_HOST=unix:///var/run/docker.sock  # for rootful Podman
   supabase start
   ```

## Production Deployment

For production (remote Supabase):

1. **Link your project**:
   ```bash
   supabase link --project-ref your-project-ref
   ```

2. **Push migrations**:
   ```bash
   supabase db push
   ```

   Or apply manually via Supabase Dashboard → SQL Editor.

## Migration Best Practices

1. **Always use `IF NOT EXISTS`** for tables and indexes to make migrations idempotent
2. **Use transactions** when possible (Supabase CLI handles this automatically)
3. **Test migrations locally** before applying to production
4. **Never modify existing migration files** - create new migrations instead
5. **Keep migrations small and focused** - one logical change per migration
6. **Use descriptive names** for migration files

## Troubleshooting

### Supabase CLI not found

Install it globally:
```bash
npm install -g supabase
# or
brew install supabase/tap/supabase
```

### Migration conflicts

If you have conflicts between local and remote migrations:
1. Pull remote migrations: `supabase db pull`
2. Resolve conflicts manually
3. Push updated migrations: `supabase db push`

### Local database reset

To completely reset your local database:
```bash
supabase db reset
```

This will:
- Drop all tables
- Apply all migrations from scratch
- Reset any seed data

## Schema Files

Note: The `schema/` directory contains reference SQL files for documentation purposes. Always use migrations in `supabase/migrations/` for actual schema changes.

