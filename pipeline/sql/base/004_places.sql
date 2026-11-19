-- Every place or habitat a fact can be about. Places are a column, never separate tables.
CREATE TABLE scope (
  scope_code   TEXT PRIMARY KEY,       -- 'IN', 'IN-KL', 'IN-KL-ER', 'hab:woodland'
  kind         TEXT NOT NULL CHECK (kind IN ('country', 'state', 'district', 'habitat')),
  parent_code  TEXT REFERENCES scope (scope_code),
  name_en      TEXT NOT NULL,
  geom_geojson TEXT,                   -- official boundaries as GeoJSON; NULL until loaded
  valid_from   DATE,
  valid_to     DATE                    -- set for places that no longer exist
);

-- How each source spells a place
CREATE TABLE scope_alias (
  source_id  TEXT REFERENCES source (source_id),
  alias      TEXT,
  scope_code TEXT NOT NULL REFERENCES scope (scope_code),
  PRIMARY KEY (source_id, alias)
);

-- SoIB assessments: one row per release x species x scope
CREATE TABLE assessment (
  release_id           TEXT REFERENCES source_release (release_id),
  taxon_id             TEXT REFERENCES taxon (taxon_id),
  scope_code           TEXT REFERENCES scope (scope_code),
  selected             BOOLEAN,        -- Selected for SoIB
  selected_lt          BOOLEAN,        -- Selected for Long-term Trend
  selected_cat         BOOLEAN,        -- Selected for Current Annual Trend
  priority             TEXT,           -- lookup 'soib-priority-2023' or 'soib-concern-2020'
  lt_status            TEXT,           -- lookup 'soib-trend-2023' or 'soib-trend-2020'
  cat_status           TEXT,
  range_status         TEXT,           -- lookup 'soib-range-2023' or 'soib-range-2020'; national only
  lt_mean_pct          DOUBLE,
  lt_lci_pct           DOUBLE,
  lt_uci_pct           DOUBLE,
  cat_mean_pct         DOUBLE,
  cat_lci_pct          DOUBLE,
  cat_uci_pct          DOUBLE,
  range_mean_km2       DOUBLE,
  range_lci_km2        DOUBLE,
  range_uci_km2        DOUBLE,
  is_key_species       BOOLEAN,        -- state sheets only
  n_grids              INTEGER,
  coverage_pre2000_pct DOUBLE,
  coverage_current_pct DOUBLE,
  coverage_latest_pct  DOUBLE,         -- "Range Coverage (2025)"
  grid_coverage_mean   DOUBLE,
  grid_coverage_ci     DOUBLE,
  decline_3gen_pct     DOUBLE,         -- national only
  regional_red_list    TEXT,           -- lookup 'iucn'; national only
  PRIMARY KEY (release_id, taxon_id, scope_code)
);
