-- Single-owner installation. The singleton lock serializes issuance and redemption.
CREATE TABLE telegram_link (
    id integer PRIMARY KEY CHECK (id = 1),
    chat_id text CHECK (chat_id ~ '^[1-9][0-9]*$'),
    bot_id text,
    linked_at timestamptz,
    pairing_token_hash text,
    pairing_expires_at timestamptz
);
INSERT INTO telegram_link(id) VALUES (1);
