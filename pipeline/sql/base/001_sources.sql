-- Parava base database: fixed facts from published releases.
--
-- Portable types only, so the schema can move to PostgreSQL later:
--   TEXT, SMALLINT, INTEGER, BIGINT, DOUBLE, BOOLEAN, DATE, TIMESTAMP.
-- No TINYINT, UBIGINT, STRUCT, MAP, UNION, GEOMETRY or list types.
-- Geometry is GeoJSON text; lists are small join tables.
-- No macros or stored functions. Every table has a primary key.
-- Foreign keys are declared within this file; db:check verifies references across files.

-- Where data comes from
CREATE TABLE source (
  source_id   TEXT PRIMARY KEY,        -- 'soib', 'india-checklist', 'ebird-tax', 'avonet', 'wikidata'
  name        TEXT NOT NULL,
  homepage    TEXT,
  licence     TEXT,                    -- 'to-confirm' blocks publishing
  attribution TEXT
);

CREATE TABLE source_release (
  release_id  TEXT PRIMARY KEY,        -- 'soib-2026-v0'
  source_id   TEXT NOT NULL REFERENCES source (source_id),
  version     TEXT,
  published   DATE,
  status      TEXT NOT NULL CHECK (status IN ('draft', 'final', 'superseded')),
  file_name   TEXT,
  file_sha256 TEXT,
  loaded_at   TIMESTAMP,
  notes       TEXT
);
-- Each release is also kept verbatim as Parquet: .data/raw/<source>/<release>/<sheet>.parquet
