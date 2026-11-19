-- Parava content database: what we author, select or review. Schema only for now.
-- Refers to species only by taxon_id (checked by db:check). Portable types only.

-- Photos and calls
CREATE TABLE media (
  media_id    TEXT PRIMARY KEY,
  taxon_id    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('photo', 'audio')),
  source_id   TEXT,                    -- 'inat', 'commons', 'xeno-canto'
  external_id TEXT,
  url         TEXT NOT NULL,
  sex         TEXT,
  age         TEXT,
  sound_type  TEXT,                    -- 'song', 'call', 'alarm'
  width_px    SMALLINT,
  height_px   SMALLINT,
  duration_s  SMALLINT,
  credit      TEXT NOT NULL,
  licence     TEXT NOT NULL,
  rank        SMALLINT,
  selected    BOOLEAN NOT NULL DEFAULT FALSE,
  release_id  TEXT
);

-- Text from Wikipedia and from our editors
CREATE TABLE species_text (
  taxon_id    TEXT,
  lang        TEXT,
  field       TEXT,                    -- 'summary', 'id_tips', 'behaviour', 'where_to_look'
  body        TEXT NOT NULL,
  source_id   TEXT,
  licence     TEXT,
  author      TEXT,
  reviewed_at DATE,
  release_id  TEXT,
  PRIMARY KEY (taxon_id, lang, field, source_id)
);

CREATE TABLE confusion_pair (
  taxon_a   TEXT,
  taxon_b   TEXT,
  notes_key TEXT,
  PRIMARY KEY (taxon_a, taxon_b)
);

CREATE TABLE sensitivity (
  taxon_id TEXT PRIMARY KEY,
  level    TEXT NOT NULL CHECK (level IN ('district', 'state', 'hidden')),
  reason   TEXT,
  source   TEXT                        -- 'ebird-sensitive-list', 'parava'
);

-- Editor fixes to local names from Wikidata
CREATE TABLE local_name_correction (
  correction_id INTEGER PRIMARY KEY,
  taxon_id      TEXT NOT NULL,
  lang          TEXT NOT NULL,
  name          TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('add', 'remove', 'prefer')),
  note          TEXT,
  author        TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL
);
