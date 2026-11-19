-- Scopes: India, eBird's 37 Indian regions (states and UTs), and SoIB's 4 habitats.
-- State codes are eBird's subnational1 codes, checked against the eBird API
-- (ref/region/list/subnational1/IN) on 2026-11-19: all 37 match. eBird keeps Dadra and Nagar
-- Haveli (IN-DN) and Daman and Diu (IN-DD) as separate regions and uses IN-TS for Telangana.
INSERT INTO scope (scope_code, kind, parent_code, name_en, valid_from, valid_to) VALUES
('IN', 'country', NULL, 'India', NULL, NULL);

INSERT INTO scope (scope_code, kind, parent_code, name_en, valid_from, valid_to) VALUES
('IN-AN', 'state', 'IN', 'Andaman and Nicobar Islands', NULL, NULL),
('IN-AP', 'state', 'IN', 'Andhra Pradesh', NULL, NULL),
('IN-AR', 'state', 'IN', 'Arunachal Pradesh', NULL, NULL),
('IN-AS', 'state', 'IN', 'Assam', NULL, NULL),
('IN-BR', 'state', 'IN', 'Bihar', NULL, NULL),
('IN-CH', 'state', 'IN', 'Chandigarh', NULL, NULL),
('IN-CT', 'state', 'IN', 'Chhattisgarh', NULL, NULL),
('IN-DN', 'state', 'IN', 'Dadra and Nagar Haveli', NULL, NULL),
('IN-DD', 'state', 'IN', 'Daman and Diu', NULL, NULL),
('IN-DL', 'state', 'IN', 'Delhi', NULL, NULL),
('IN-GA', 'state', 'IN', 'Goa', NULL, NULL),
('IN-GJ', 'state', 'IN', 'Gujarat', NULL, NULL),
('IN-HR', 'state', 'IN', 'Haryana', NULL, NULL),
('IN-HP', 'state', 'IN', 'Himachal Pradesh', NULL, NULL),
('IN-JK', 'state', 'IN', 'Jammu and Kashmir', NULL, NULL),
('IN-JH', 'state', 'IN', 'Jharkhand', NULL, NULL),
('IN-KA', 'state', 'IN', 'Karnataka', NULL, NULL),
('IN-KL', 'state', 'IN', 'Kerala', NULL, NULL),
('IN-LA', 'state', 'IN', 'Ladakh', NULL, NULL),
('IN-LD', 'state', 'IN', 'Lakshadweep', NULL, NULL),
('IN-MP', 'state', 'IN', 'Madhya Pradesh', NULL, NULL),
('IN-MH', 'state', 'IN', 'Maharashtra', NULL, NULL),
('IN-MN', 'state', 'IN', 'Manipur', NULL, NULL),
('IN-ML', 'state', 'IN', 'Meghalaya', NULL, NULL),
('IN-MZ', 'state', 'IN', 'Mizoram', NULL, NULL),
('IN-NL', 'state', 'IN', 'Nagaland', NULL, NULL),
('IN-OR', 'state', 'IN', 'Odisha', NULL, NULL),
('IN-PY', 'state', 'IN', 'Puducherry', NULL, NULL),
('IN-PB', 'state', 'IN', 'Punjab', NULL, NULL),
('IN-RJ', 'state', 'IN', 'Rajasthan', NULL, NULL),
('IN-SK', 'state', 'IN', 'Sikkim', NULL, NULL),
('IN-TN', 'state', 'IN', 'Tamil Nadu', NULL, NULL),
('IN-TS', 'state', 'IN', 'Telangana', NULL, NULL),
('IN-TR', 'state', 'IN', 'Tripura', NULL, NULL),
('IN-UP', 'state', 'IN', 'Uttar Pradesh', NULL, NULL),
('IN-UL', 'state', 'IN', 'Uttarakhand', NULL, NULL),
('IN-WB', 'state', 'IN', 'West Bengal', NULL, NULL);

-- SoIB habitat sheets
INSERT INTO scope (scope_code, kind, parent_code, name_en, valid_from, valid_to) VALUES
('hab:woodland', 'habitat', NULL, 'Woodland', NULL, NULL),
('hab:cropland', 'habitat', NULL, 'Cropland', NULL, NULL),
('hab:one',      'habitat', NULL, 'Open Natural Ecosystems', NULL, NULL),
('hab:pa',       'habitat', NULL, 'Protected Areas', NULL, NULL);
