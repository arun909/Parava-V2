-- eBird hotspots (eBird API) and the eBird Basic Dataset (EBD). Portable types only.
-- Species by taxon_id, places by scope_code (checked by db:check).

-- Which release each derived table was last loaded from
CREATE TABLE source_load (
  release_id  TEXT PRIMARY KEY,        -- 'ebird-api-2026-11-19', 'ebird-ebd-2026-10'
  source_id   TEXT NOT NULL,
  file_name   TEXT,
  file_sha256 TEXT,
  loaded_at   TIMESTAMP NOT NULL,
  notes       TEXT
);

-- Hotspot details from the eBird API
ALTER TABLE site ADD COLUMN state_code TEXT;
ALTER TABLE site ADD COLUMN n_species_all_time INTEGER;
ALTER TABLE site ADD COLUMN n_checklists_all_time INTEGER;
ALTER TABLE site ADD COLUMN latest_obs_at TIMESTAMP;
ALTER TABLE site ADD COLUMN release_id TEXT;

-- One row per eBird checklist (EBD sampling event file)
CREATE TABLE ebd_checklist (
  list_id      TEXT PRIMARY KEY,       -- SAMPLING EVENT IDENTIFIER, 'S208571490'
  group_id     TEXT,                   -- GROUP IDENTIFIER: shared copies of one outing
  observer_id  TEXT,
  obs_date     DATE NOT NULL,
  year         SMALLINT NOT NULL,
  week48       SMALLINT NOT NULL,
  time_started TEXT,                   -- 'HH:MM:SS', local
  state_code   TEXT NOT NULL,          -- eBird state, 'IN-KL'
  scope_code   TEXT NOT NULL,          -- eBird district when known, else the state
  lat          DOUBLE,
  lon          DOUBLE,
  cell25       TEXT,
  locality_id  TEXT,                   -- eBird location, 'L123456' (hotspot or personal)
  locality_type TEXT,                  -- 'H' hotspot, 'P' personal, ...
  protocol     TEXT,                   -- 'Traveling', 'Stationary', 'Incidental', ...
  duration_min INTEGER,
  distance_km  DOUBLE,
  n_observers  SMALLINT,
  complete     BOOLEAN NOT NULL,       -- ALL SPECIES REPORTED
  release_id   TEXT NOT NULL
);

-- One row per species per checklist (EBD observation file, rolled up to species)
CREATE TABLE ebd_observation (
  list_id    TEXT,
  taxon_id   TEXT,
  how_many   INTEGER,                  -- NULL when counted as 'X' (present, not counted)
  approved   BOOLEAN NOT NULL,         -- FALSE: not (yet) accepted by eBird reviewers
  release_id TEXT NOT NULL,
  PRIMARY KEY (list_id, taxon_id)
);

-- EBD names that didn't map to a species on the India checklist, for review
CREATE TABLE ebd_unmatched (
  release_id TEXT,
  sci_name   TEXT,
  category   TEXT,
  exotic     TEXT,
  n_rows     BIGINT NOT NULL,
  PRIMARY KEY (release_id, sci_name, category, exotic)
);
