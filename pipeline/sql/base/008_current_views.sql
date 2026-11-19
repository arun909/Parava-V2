-- The latest non-superseded release of each source (a draft is used only if nothing final exists)
CREATE VIEW current_release AS
SELECT DISTINCT ON (source_id) source_id, release_id, status
FROM source_release
WHERE status <> 'superseded'
ORDER BY source_id, (status = 'final') DESC, published DESC NULLS LAST, release_id DESC;

-- Fact rows from current releases only, tagged with their source
CREATE VIEW cur_india_status AS
SELECT x.*, r.source_id FROM species_india_status x JOIN current_release r USING (release_id);
CREATE VIEW cur_legal AS
SELECT x.*, r.source_id FROM species_legal x JOIN current_release r USING (release_id);
CREATE VIEW cur_ecology AS
SELECT x.*, r.source_id FROM species_ecology x JOIN current_release r USING (release_id);
CREATE VIEW cur_population AS
SELECT x.*, r.source_id FROM species_population x JOIN current_release r USING (release_id);
CREATE VIEW cur_morphology AS
SELECT x.*, r.source_id FROM species_morphology x JOIN current_release r USING (release_id);

-- One row per species; each field comes from the best-ranked source that has a value.
-- Pattern per field: the non-null value whose source ranks lowest in field_precedence.
CREATE VIEW current_india_status AS
SELECT t.taxon_id,
  (SELECT c.migratory_status FROM cur_india_status c JOIN field_precedence p ON p.field = 'migratory_status' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.migratory_status IS NOT NULL ORDER BY p.rank LIMIT 1) AS migratory_status,
  (SELECT c.endemicity FROM cur_india_status c JOIN field_precedence p ON p.field = 'endemicity' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.endemicity IS NOT NULL ORDER BY p.rank LIMIT 1) AS endemicity,
  (SELECT c.endemic_india FROM cur_india_status c JOIN field_precedence p ON p.field = 'endemic_india' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.endemic_india IS NOT NULL ORDER BY p.rank LIMIT 1) AS endemic_india,
  (SELECT c.endemic_subcontinent FROM cur_india_status c JOIN field_precedence p ON p.field = 'endemic_subcontinent' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.endemic_subcontinent IS NOT NULL ORDER BY p.rank LIMIT 1) AS endemic_subcontinent,
  (SELECT c.endemic_himalaya FROM cur_india_status c JOIN field_precedence p ON p.field = 'endemic_himalaya' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.endemic_himalaya IS NOT NULL ORDER BY p.rank LIMIT 1) AS endemic_himalaya,
  (SELECT c.island_only FROM cur_india_status c JOIN field_precedence p ON p.field = 'island_only' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.island_only IS NOT NULL ORDER BY p.rank LIMIT 1) AS island_only,
  (SELECT c.vagrant FROM cur_india_status c JOIN field_precedence p ON p.field = 'vagrant' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.vagrant IS NOT NULL ORDER BY p.rank LIMIT 1) AS vagrant,
  (SELECT c.historical FROM cur_india_status c JOIN field_precedence p ON p.field = 'historical' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.historical IS NOT NULL ORDER BY p.rank LIMIT 1) AS historical
FROM taxon t;

CREATE VIEW current_legal AS
SELECT t.taxon_id,
  (SELECT c.iucn FROM cur_legal c JOIN field_precedence p ON p.field = 'iucn' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.iucn IS NOT NULL ORDER BY p.rank LIMIT 1) AS iucn,
  (SELECT c.wpa_schedule FROM cur_legal c JOIN field_precedence p ON p.field = 'wpa_schedule' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.wpa_schedule IS NOT NULL ORDER BY p.rank LIMIT 1) AS wpa_schedule,
  (SELECT c.cites FROM cur_legal c JOIN field_precedence p ON p.field = 'cites' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.cites IS NOT NULL ORDER BY p.rank LIMIT 1) AS cites,
  (SELECT c.cms FROM cur_legal c JOIN field_precedence p ON p.field = 'cms' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.cms IS NOT NULL ORDER BY p.rank LIMIT 1) AS cms
FROM taxon t;

CREATE VIEW current_ecology AS
SELECT t.taxon_id,
  (SELECT c.diet FROM cur_ecology c JOIN field_precedence p ON p.field = 'diet' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.diet IS NOT NULL ORDER BY p.rank LIMIT 1) AS diet,
  (SELECT c.habitat_spec FROM cur_ecology c JOIN field_precedence p ON p.field = 'habitat_spec' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.habitat_spec IS NOT NULL ORDER BY p.rank LIMIT 1) AS habitat_spec,
  (SELECT c.activity_breeding FROM cur_ecology c JOIN field_precedence p ON p.field = 'activity_breeding' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.activity_breeding IS NOT NULL ORDER BY p.rank LIMIT 1) AS activity_breeding,
  (SELECT c.activity_nonbreeding FROM cur_ecology c JOIN field_precedence p ON p.field = 'activity_nonbreeding' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.activity_nonbreeding IS NOT NULL ORDER BY p.rank LIMIT 1) AS activity_nonbreeding,
  (SELECT c.trophic_level FROM cur_ecology c JOIN field_precedence p ON p.field = 'trophic_level' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.trophic_level IS NOT NULL ORDER BY p.rank LIMIT 1) AS trophic_level,
  (SELECT c.primary_lifestyle FROM cur_ecology c JOIN field_precedence p ON p.field = 'primary_lifestyle' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.primary_lifestyle IS NOT NULL ORDER BY p.rank LIMIT 1) AS primary_lifestyle
FROM taxon t;

CREATE VIEW current_population AS
SELECT t.taxon_id,
  (SELECT c.pct1_threshold FROM cur_population c JOIN field_precedence p ON p.field = 'pct1_threshold' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.pct1_threshold IS NOT NULL ORDER BY p.rank LIMIT 1) AS pct1_threshold,
  (SELECT c.generation_years FROM cur_population c JOIN field_precedence p ON p.field = 'generation_years' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.generation_years IS NOT NULL ORDER BY p.rank LIMIT 1) AS generation_years,
  (SELECT c.n_subspecies_india FROM cur_population c JOIN field_precedence p ON p.field = 'n_subspecies_india' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.n_subspecies_india IS NOT NULL ORDER BY p.rank LIMIT 1) AS n_subspecies_india,
  (SELECT c.share_global_range_frac FROM cur_population c JOIN field_precedence p ON p.field = 'share_global_range_frac' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.share_global_range_frac IS NOT NULL ORDER BY p.rank LIMIT 1) AS share_global_range_frac
FROM taxon t;

CREATE VIEW current_morphology AS
SELECT t.taxon_id,
  (SELECT c.mass_g FROM cur_morphology c JOIN field_precedence p ON p.field = 'mass_g' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.mass_g IS NOT NULL ORDER BY p.rank LIMIT 1) AS mass_g,
  (SELECT c.length_cm FROM cur_morphology c JOIN field_precedence p ON p.field = 'length_cm' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.length_cm IS NOT NULL ORDER BY p.rank LIMIT 1) AS length_cm,
  (SELECT c.wingspan_cm FROM cur_morphology c JOIN field_precedence p ON p.field = 'wingspan_cm' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.wingspan_cm IS NOT NULL ORDER BY p.rank LIMIT 1) AS wingspan_cm,
  (SELECT c.wing_mm FROM cur_morphology c JOIN field_precedence p ON p.field = 'wing_mm' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.wing_mm IS NOT NULL ORDER BY p.rank LIMIT 1) AS wing_mm,
  (SELECT c.hand_wing_index FROM cur_morphology c JOIN field_precedence p ON p.field = 'hand_wing_index' AND p.source_id = c.source_id
   WHERE c.taxon_id = t.taxon_id AND c.hand_wing_index IS NOT NULL ORDER BY p.rank LIMIT 1) AS hand_wing_index
FROM taxon t;

-- SoIB assessments from the current SoIB release, every scope
CREATE VIEW current_assessment AS
SELECT a.*
FROM assessment a
JOIN current_release r ON r.release_id = a.release_id AND r.source_id = 'soib';

-- The app's species record: one row per active species, best value per field
CREATE VIEW current_species AS
SELECT t.taxon_id, t.sort_order,
       f.sci_name AS family_sci, f.en_name AS family_en,
       n.sci_name, n.en_name,                       -- India checklist names
       s.migratory_status, s.endemicity, s.endemic_india, s.vagrant, s.historical,
       l.iucn, l.wpa_schedule, e.diet, e.habitat_spec,
       m.mass_g, m.length_cm,
       a.priority, a.lt_status, a.cat_status, a.range_status
FROM taxon t
JOIN taxon_family f USING (family_id)
LEFT JOIN taxon_name n ON n.taxon_id = t.taxon_id AND n.authority = 'india-v10.1'
LEFT JOIN current_india_status s ON s.taxon_id = t.taxon_id
LEFT JOIN current_legal l ON l.taxon_id = t.taxon_id
LEFT JOIN current_ecology e ON e.taxon_id = t.taxon_id
LEFT JOIN current_morphology m ON m.taxon_id = t.taxon_id
LEFT JOIN current_assessment a ON a.taxon_id = t.taxon_id AND a.scope_code = 'IN'
WHERE t.state = 'active';
