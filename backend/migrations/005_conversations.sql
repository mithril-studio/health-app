CREATE TABLE IF NOT EXISTS chat_conversations (
    id text PRIMARY KEY CHECK (id = 'web' OR id ~ '^web:[a-f0-9]{32}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);
-- Keep every existing browser message in its original channel.
INSERT INTO chat_conversations (id) VALUES ('web') ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS agent_messages_channel_id ON agent_messages(channel, id);
