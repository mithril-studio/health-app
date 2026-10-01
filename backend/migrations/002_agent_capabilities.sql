CREATE TABLE IF NOT EXISTS agent_capabilities (
    token_hash text PRIMARY KEY, operation_prefix text NOT NULL,
    read_only boolean NOT NULL, budget integer NOT NULL, used integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL
);
