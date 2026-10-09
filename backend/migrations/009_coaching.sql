-- Add shared user-authored context; retain all legacy scores and WHOOP data.
CREATE TABLE athlete_profile (
    id integer PRIMARY KEY CHECK (id = 1),
    data jsonb NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE coaching_records (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('observation','recommendation','question')),
    status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','dismissed','completed')),
    text text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
    rationale text NOT NULL CHECK (length(rationale) <= 2000),
    outcome text NOT NULL DEFAULT '' CHECK (length(outcome) <= 2000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE INDEX coaching_records_recent ON coaching_records (created_at DESC, id);
