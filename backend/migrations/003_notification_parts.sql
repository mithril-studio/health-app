CREATE TABLE IF NOT EXISTS notification_parts (
    work_key text NOT NULL REFERENCES work_items(key), part integer NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(work_key,part)
);
