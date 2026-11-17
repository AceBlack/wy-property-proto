SET search_path TO wy, public;
-- community: 3 行
INSERT INTO wy.community (tenant_id, community_id, name, short_name, address, build_area, house_count, park_count, elec_mode, water_mode, status) VALUES
  (1, 'P01', '翡翠城', '翡翠城', '成都市高新区天府大道南段 1288 号', 38838.44, 352, 0, 'meter', 'meter', '在管'),
  (1, 'P02', '锦绣家园', '锦绣家园', '成都市武侯区武侯大道 566 号', 31605.39, 284, 0, 'meter', 'meter', '在管'),
  (1, 'P03', '星光天地', '星光天地', '成都市锦江区红星路三段 88 号', 21749.40, 120, 0, 'meter', 'meter', '在管');
