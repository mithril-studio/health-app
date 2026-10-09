-- App-owned records are never replaced by the Intervals cache sync.
CREATE TABLE local_sessions (
    id text PRIMARY KEY,
    day date NOT NULL,
    data jsonb NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX local_sessions_day ON local_sessions(day);
CREATE TABLE whoop_workouts (LIKE local_sessions INCLUDING ALL);
CREATE TABLE whoop_connection (
    id integer PRIMARY KEY CHECK (id = 1),
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamptz NOT NULL,
    last_success timestamptz,
    error text
);
CREATE TABLE whoop_oauth_states (
    state_hash text PRIMARY KEY,
    session_hash text NOT NULL,
    expires_at timestamptz NOT NULL
);
