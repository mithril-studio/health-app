CREATE TABLE IF NOT EXISTS activities (
    id text PRIMARY KEY, day date NOT NULL, data jsonb NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_day ON activities(day);
CREATE TABLE IF NOT EXISTS events (LIKE activities INCLUDING ALL);
CREATE TABLE IF NOT EXISTS wellness (LIKE activities INCLUDING ALL);
CREATE TABLE IF NOT EXISTS fitness_daily (LIKE activities INCLUDING ALL);
CREATE TABLE IF NOT EXISTS sport_settings (
    id text PRIMARY KEY, data jsonb NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activity_intervals (LIKE sport_settings INCLUDING ALL);
CREATE TABLE IF NOT EXISTS activity_streams (LIKE sport_settings INCLUDING ALL);
CREATE TABLE IF NOT EXISTS curve_cache (LIKE sport_settings INCLUDING ALL);
CREATE TABLE IF NOT EXISTS sync_state (
    resource text PRIMARY KEY, cursor_date date, last_success timestamptz,
    error text, oldest date, newest date
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
    bucket text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS work_items (
    key text PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(), error text, result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_due ON work_items(available_at) WHERE status <> 'succeeded';
CREATE TABLE IF NOT EXISTS agent_messages (
    id bigserial PRIMARY KEY, message_key text NOT NULL UNIQUE, channel text NOT NULL,
    role text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pending_deletions (
    token text PRIMARY KEY, event_id text NOT NULL, snapshot jsonb NOT NULL,
    expires_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending',
    operation_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS write_operations (
    id text PRIMARY KEY, name text NOT NULL, args jsonb NOT NULL, remote_body jsonb NOT NULL,
    path text NOT NULL, method text NOT NULL, status text NOT NULL DEFAULT 'pending',
    result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS write_audit (
    id bigserial PRIMARY KEY, operation_id text NOT NULL REFERENCES write_operations(id),
    action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(operation_id, action)
);
