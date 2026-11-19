-- Parava derived database: everything computed from occurrence records.
-- Rebuilt by the monthly pipeline. Schema only for now.
-- Refers to species only by taxon_id and to places only by scope_code (checked by db:check).
-- Portable types only (see base/001_sources.sql).

CREATE TABLE pipeline_run (
  run_id            TEXT PRIMARY KEY,  -- '2026-12'
  started_at        TIMESTAMP,
  finished_at       TIMESTAMP,
  snapshot_doi      TEXT,
  checklist_version TEXT,
  git_sha           TEXT
);

-- Raw occurrences cached from the GBIF snapshot
CREATE TABLE occurrence (
  gbif_id     BIGINT PRIMARY KEY,
  taxon_id    TEXT NOT NULL,
  event_date  DATE NOT NULL,
  year        SMALLINT NOT NULL,
  week48      SMALLINT NOT NULL,       -- 1-48, four per month
  lat         DOUBLE,
  lon         DOUBLE,
  cell25      TEXT,                    -- 0.25 degree cell
  scope_code  TEXT,                    -- district
  list_key    TEXT,                    -- hash(observer, date, rounded place)
  count       INTEGER,
  dataset_key TEXT,
  licence     TEXT,
  snapshot    TEXT
);

CREATE TABLE effort (
  scope_code TEXT, year SMALLINT, week48 SMALLINT,
  n_lists INTEGER NOT NULL,
  PRIMARY KEY (scope_code, year, week48)
);

CREATE TABLE effort_cell (
  cell25 TEXT, week48 SMALLINT,
  n_lists INTEGER NOT NULL,
  PRIMARY KEY (cell25, week48)
);

-- Share of lists with the species, with a 95% interval
CREATE TABLE region_week (
  taxon_id TEXT, scope_code TEXT, week48 SMALLINT,
  n_years SMALLINT, n_lists INTEGER, n_hits INTEGER,
  freq DOUBLE, freq_lo DOUBLE, freq_hi DOUBLE,
  PRIMARY KEY (taxon_id, scope_code, week48)
);

-- Per-year weekly frequency, needed to compute phenology year by year
CREATE TABLE region_year_week (
  taxon_id TEXT, scope_code TEXT, year SMALLINT, week48 SMALLINT,
  n_lists INTEGER, n_hits INTEGER, freq DOUBLE,
  PRIMARY KEY (taxon_id, scope_code, year, week48)
);

CREATE TABLE phenology (
  taxon_id TEXT, scope_code TEXT,
  arrive_doy SMALLINT, arrive_sd_days SMALLINT, peak_week SMALLINT,
  depart_doy SMALLINT, depart_sd_days SMALLINT,
  years_used SMALLINT, confidence TEXT,
  PRIMARY KEY (taxon_id, scope_code)
);

CREATE TABLE phenology_flag (
  taxon_id TEXT, scope_code TEXT, flag TEXT,
  PRIMARY KEY (taxon_id, scope_code, flag)
);

CREATE TABLE cell_week (
  taxon_id TEXT, cell25 TEXT, week48 SMALLINT,
  freq DOUBLE,
  PRIMARY KEY (taxon_id, cell25, week48)
);

-- eBird hotspots, refreshed monthly
CREATE TABLE site (
  site_id TEXT PRIMARY KEY,            -- eBird hotspot id
  name TEXT, lat DOUBLE, lon DOUBLE,
  scope_code TEXT, cell25 TEXT,
  protected_area TEXT, ramsar BOOLEAN,
  updated_at TIMESTAMP
);

CREATE TABLE site_month (
  site_id TEXT, taxon_id TEXT, month SMALLINT,
  freq DOUBLE, n_lists INTEGER, last_seen DATE,
  PRIMARY KEY (site_id, taxon_id, month)
);

CREATE TABLE route_week (
  taxon_id TEXT, population TEXT, week48 SMALLINT,
  lon DOUBLE, lat DOUBLE, source TEXT,
  PRIMARY KEY (taxon_id, population, week48)
);

-- Which species occur in each state, computed from records
CREATE TABLE state_species (
  release_id TEXT, taxon_id TEXT, scope_code TEXT,
  occurrence TEXT CHECK (occurrence IN ('regular', 'irregular', 'vagrant', 'historical', 'uncertain')),
  n_records INTEGER, n_lists INTEGER,
  first_year SMALLINT, last_year SMALLINT,
  PRIMARY KEY (release_id, taxon_id, scope_code)
);
