-- Athlete-entered running benchmarks are independent of the Intervals sync cache.
CREATE TABLE IF NOT EXISTS athlete_scores (
    id integer PRIMARY KEY CHECK (id = 1),
    lt1_hr integer CHECK (lt1_hr BETWEEN 30 AND 250),
    lt2_hr integer CHECK (lt2_hr BETWEEN 30 AND 250),
    vo2max double precision CHECK (vo2max BETWEEN 5 AND 100),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (lt1_hr IS NULL OR lt2_hr IS NULL OR lt1_hr < lt2_hr)
);
