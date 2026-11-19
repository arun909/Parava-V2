-- Taxonomic groups, so family names aren't repeated in every row
CREATE TABLE taxon_order (
  order_id TEXT PRIMARY KEY,           -- 'anseriformes'
  sci_name TEXT NOT NULL,
  sort     SMALLINT
);

CREATE TABLE taxon_family (
  family_id TEXT PRIMARY KEY,          -- 'anatidae'
  order_id  TEXT NOT NULL REFERENCES taxon_order (order_id),
  sci_name  TEXT NOT NULL,
  en_name   TEXT,                      -- 'Ducks, Geese, and Waterfowl' (from SoIB)
  sort      SMALLINT
);

-- The backbone: one row per species concept. taxon_id is minted once and never reused.
CREATE TABLE taxon (
  taxon_id   TEXT PRIMARY KEY,         -- 'pv00042'
  family_id  TEXT NOT NULL REFERENCES taxon_family (family_id),
  sort_order INTEGER NOT NULL,         -- India checklist order
  rank       TEXT NOT NULL DEFAULT 'species',
  state      TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'split', 'lumped', 'removed')),
  created_in TEXT NOT NULL REFERENCES source_release (release_id)
);

-- Every name in every list
CREATE TABLE taxon_name (
  taxon_id   TEXT REFERENCES taxon (taxon_id),
  authority  TEXT,                     -- 'india-v10.1', 'india-2025', 'soib-v7.1', 'ebird-2025', 'bli-2025', 'avilist'
  sci_name   TEXT,
  en_name    TEXT,
  release_id TEXT NOT NULL REFERENCES source_release (release_id),
  PRIMARY KEY (taxon_id, authority)
);

-- Every external id
CREATE TABLE taxon_xref (
  taxon_id    TEXT REFERENCES taxon (taxon_id),
  system      TEXT,                    -- 'ebird', 'avibase', 'gbif', 'inat', 'wikidata', 'xeno-canto'
  external_id TEXT NOT NULL,
  release_id  TEXT NOT NULL REFERENCES source_release (release_id),
  PRIMARY KEY (taxon_id, system)
);
CREATE UNIQUE INDEX taxon_xref_lookup ON taxon_xref (system, external_id);

-- Splits, lumps and renames between releases
CREATE TABLE taxon_change (
  change_id  INTEGER PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES source_release (release_id),
  kind       TEXT NOT NULL CHECK (kind IN ('split', 'lump', 'rename', 'new', 'removed')),
  from_taxon TEXT,
  to_taxon   TEXT,
  note       TEXT
);

-- Every category used anywhere, with order and a cross-edition label.
-- Loaders map a source's label to its code; a label not listed stops the load.
CREATE TABLE lookup (
  scheme     TEXT,                     -- 'soib-trend-2023', 'iucn', 'migratory', ...
  code       TEXT,                     -- stored in fact tables
  label      TEXT NOT NULL,            -- exactly as the source writes it
  rank       SMALLINT,
  normalized TEXT,                     -- shared meaning across editions, e.g. 'decline-strong'
  PRIMARY KEY (scheme, code)
);
CREATE UNIQUE INDEX lookup_label ON lookup (scheme, label);

-- Which source wins for each field in the current_* views (lower rank wins).
-- A source with no row for a field never supplies that field.
CREATE TABLE field_precedence (
  field     TEXT,
  source_id TEXT REFERENCES source (source_id),
  rank      SMALLINT NOT NULL,
  PRIMARY KEY (field, source_id)
);
