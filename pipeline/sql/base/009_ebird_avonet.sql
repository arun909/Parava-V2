-- Sources and category lists for the eBird taxonomy (DB3), eBird reference data, the eBird Basic
-- Dataset and AVONET (DB4). Parava is non-commercial (decided 2026-11-19), so eBird's
-- non-commercial terms apply.
INSERT INTO source (source_id, name, homepage, licence, attribution) VALUES
('ebird-api', 'eBird API 2.0 (regions, hotspots)', 'https://documenter.getpostman.com/view/664302/S1ENwy59',
 'ebird-api-terms', 'eBird. Cornell Lab of Ornithology, Ithaca, New York.'),
('ebird-ebd', 'eBird Basic Dataset', 'https://ebird.org/data/download',
 'ebird-data-terms', 'eBird Basic Dataset. Cornell Lab of Ornithology, Ithaca, New York.');

-- eBird taxonomy categories (only 'species' rows map to our backbone)
INSERT INTO lookup (scheme, code, label, rank, normalized) VALUES
('ebird-category', 'species',    'species',    1, NULL),
('ebird-category', 'issf',       'issf',       2, NULL),
('ebird-category', 'form',       'form',       3, NULL),
('ebird-category', 'intergrade', 'intergrade', 4, NULL),
('ebird-category', 'hybrid',     'hybrid',     5, NULL),
('ebird-category', 'slash',      'slash',      6, NULL),
('ebird-category', 'spuh',       'spuh',       7, NULL),
('ebird-category', 'domestic',   'domestic',   8, NULL),
-- AVONET (labels exactly as written in Supplementary dataset 1)
('avonet-trophic-level', 'carnivore', 'Carnivore', 1, NULL),
('avonet-trophic-level', 'herbivore', 'Herbivore', 2, NULL),
('avonet-trophic-level', 'omnivore',  'Omnivore',  3, NULL),
('avonet-trophic-level', 'scavenger', 'Scavenger', 4, NULL),
('avonet-lifestyle', 'aerial',      'Aerial',      1, NULL),
('avonet-lifestyle', 'aquatic',     'Aquatic',     2, NULL),
('avonet-lifestyle', 'generalist',  'Generalist',  3, NULL),
('avonet-lifestyle', 'insessorial', 'Insessorial', 4, NULL),
('avonet-lifestyle', 'terrestrial', 'Terrestrial', 5, NULL);
