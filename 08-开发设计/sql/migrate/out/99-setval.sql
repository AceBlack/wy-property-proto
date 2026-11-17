SET search_path TO wy, public;

-- 显式指定主键后，序列必须推到 max，否则后续自增会撞号
SELECT setval(pg_get_serial_sequence('wy.bill', 'id'),                COALESCE((SELECT max(id) FROM wy.bill), 1));
SELECT setval(pg_get_serial_sequence('wy.payment', 'id'),             COALESCE((SELECT max(id) FROM wy.payment), 1));
SELECT setval(pg_get_serial_sequence('wy.deposit', 'id'),             COALESCE((SELECT max(id) FROM wy.deposit), 1));
SELECT setval(pg_get_serial_sequence('wy.deposit_txn', 'id'),         COALESCE((SELECT max(id) FROM wy.deposit_txn), 1));
SELECT setval(pg_get_serial_sequence('wy.payment_allocation', 'id'),  COALESCE((SELECT max(id) FROM wy.payment_allocation), 1));
SELECT setval(pg_get_serial_sequence('wy.fee_item', 'id'),            COALESCE((SELECT max(id) FROM wy.fee_item), 1));
SELECT setval(pg_get_serial_sequence('wy.house_owner', 'id'),         COALESCE((SELECT max(id) FROM wy.house_owner), 1));
SELECT setval(pg_get_serial_sequence('wy.lease', 'id'),               COALESCE((SELECT max(id) FROM wy.lease), 1));
SELECT setval(pg_get_serial_sequence('wy.meter_reading', 'id'),       COALESCE((SELECT max(id) FROM wy.meter_reading), 1));
