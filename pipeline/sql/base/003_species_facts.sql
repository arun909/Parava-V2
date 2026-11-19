-- Species facts that don't depend on place. Each row is one release's view of one species,
-- so two sources can disagree side by side until a current_* view picks one.

-- Status in India (SoIB; India checklist)
CREATE TABLE species_india_status (
  release_id           TEXT REFERENCES source_release (release_id),
  taxon_id             TEXT REFERENCES taxon (taxon_id),
  migratory_status     TEXT,           -- lookup 'migratory' (SoIB classes, as written)
  endemicity           TEXT,           -- lookup 'endemicity'
  endemic_india        BOOLEAN,
  endemic_subcontinent BOOLEAN,
  endemic_himalaya     BOOLEAN,
  island_only          BOOLEAN,
  vagrant              BOOLEAN,        -- India checklist: recorded < 10 years since 2000
  historical           BOOLEAN,        -- India checklist: only records before 2000
  PRIMARY KEY (release_id, taxon_id)
);

-- SoIB's combined migratory classes split into parts:
-- 'Resident & Altitudinal Migrant' -> 'resident', 'altitudinal-migrant'
CREATE TABLE species_migratory_part (
  release_id TEXT REFERENCES source_release (release_id),
  taxon_id   TEXT REFERENCES taxon (taxon_id),
  part       TEXT,                     -- lookup 'migratory-part'
  extirpated BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (release_id, taxon_id, part)
);

-- Endemic bird areas a species is restricted to (India checklist's ten columns)
CREATE TABLE species_endemic_region (
  release_id TEXT REFERENCES source_release (release_id),
  taxon_id   TEXT REFERENCES taxon (taxon_id),
  region     TEXT,                     -- lookup 'endemic-region'
  PRIMARY KEY (release_id, taxon_id, region)
);

-- Legal and international status
CREATE TABLE species_legal (
  release_id   TEXT REFERENCES source_release (release_id),
  taxon_id     TEXT REFERENCES taxon (taxon_id),
  iucn         TEXT,                   -- lookup 'iucn'
  wpa_schedule TEXT,                   -- lookup 'wpa'
  cites        TEXT,                   -- lookup 'cites'
  cms          TEXT,                   -- lookup 'cms'
  PRIMARY KEY (release_id, taxon_id)
);

-- Ecology (SoIB from EltonTraits; AVONET)
CREATE TABLE species_ecology (
  release_id           TEXT REFERENCES source_release (release_id),
  taxon_id             TEXT REFERENCES taxon (taxon_id),
  diet                 TEXT,           -- lookup 'diet'
  habitat_spec         TEXT,           -- lookup 'habitat'
  activity_breeding    TEXT,           -- lookup 'activity'
  activity_nonbreeding TEXT,           -- lookup 'activity'
  trophic_level        TEXT,           -- AVONET
  primary_lifestyle    TEXT,           -- AVONET
  PRIMARY KEY (release_id, taxon_id)
);

-- Population figures
CREATE TABLE species_population (
  release_id              TEXT REFERENCES source_release (release_id),
  taxon_id                TEXT REFERENCES taxon (taxon_id),
  pct1_threshold          INTEGER,     -- 1% waterbird threshold, individuals
  generation_years        DOUBLE,
  n_subspecies_india      SMALLINT,
  share_global_range_frac DOUBLE,      -- 0-1 (SoIB calls it "Percent of Global Range")
  PRIMARY KEY (release_id, taxon_id)
);

-- Size and shape (AVONET; Wikidata for length and wingspan)
CREATE TABLE species_morphology (
  release_id      TEXT REFERENCES source_release (release_id),
  taxon_id        TEXT REFERENCES taxon (taxon_id),
  mass_g          DOUBLE,
  length_cm       DOUBLE,
  wingspan_cm     DOUBLE,
  wing_mm         DOUBLE,
  tail_mm         DOUBLE,
  tarsus_mm       DOUBLE,
  beak_culmen_mm  DOUBLE,
  beak_depth_mm   DOUBLE,
  beak_width_mm   DOUBLE,
  hand_wing_index DOUBLE,
  PRIMARY KEY (release_id, taxon_id)
);

-- Names in Indian languages (Wikidata, then our review)
CREATE TABLE taxon_local_name (
  taxon_id     TEXT REFERENCES taxon (taxon_id),
  lang         TEXT,                   -- 'hi', 'ta', 'ml', 'bn', ...
  name         TEXT,
  script       TEXT,                   -- 'Deva', 'Taml', ...
  translit     TEXT,                   -- Latin spelling for search, e.g. 'navrang'
  is_preferred BOOLEAN,
  release_id   TEXT NOT NULL REFERENCES source_release (release_id),
  reviewed     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (taxon_id, lang, name)
);

-- Rare or experimental fields, without a schema change
CREATE TABLE species_extra (
  release_id TEXT REFERENCES source_release (release_id),
  taxon_id   TEXT REFERENCES taxon (taxon_id),
  key        TEXT,                     -- 'sci_authority', 'alt_names', 'selected_nrl', ...
  value_text TEXT,
  value_num  DOUBLE,
  unit       TEXT,
  PRIMARY KEY (release_id, taxon_id, key)
);

-- India checklist appendices: species not on the main list
-- (1 = arrived with human help; 2 = origin unknown)
CREATE TABLE checklist_appendix (
  release_id TEXT REFERENCES source_release (release_id),
  appendix   SMALLINT CHECK (appendix IN (1, 2)),
  sl_no      SMALLINT,
  order_sci  TEXT,
  family_sci TEXT,
  sci_name   TEXT NOT NULL,
  en_name    TEXT,
  authority  TEXT,
  PRIMARY KEY (release_id, appendix, sl_no)
);
