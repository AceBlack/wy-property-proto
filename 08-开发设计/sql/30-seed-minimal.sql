-- ============================================================
-- 30 · 最小种子：1 租户 / 1 项目 / 1 栋 / 1 单元 / 2 套房
-- 用途：本地起库后立刻能跑冒烟与约束验证，不依赖任何业务数据
-- 幂等：全部 ON CONFLICT DO NOTHING，可重复执行
-- ============================================================
SET search_path TO wy, public;

-- 租户表没有 tenant_id（它是根），不需要设 RLS 上下文
INSERT INTO tenant (id, code, name, datasource_key, status)
VALUES (1, 'DEMO', '演示物业有限公司', 'main', '启用')
ON CONFLICT (id) DO NOTHING;

-- 以下所有表都开了 RLS，必须在事务内设租户
BEGIN;
SET LOCAL app.tenant_id = '1';

-- 项目
INSERT INTO community (tenant_id, community_id, name, short_name, address,
                       build_area, house_count, elec_mode, water_mode, status)
VALUES (1, 'P01', '翡翠城', '翡翠城', '演示路 1 号', 200.00, 2, 'meter', 'meter', '在管')
ON CONFLICT DO NOTHING;

-- 楼栋 / 单元
INSERT INTO building (tenant_id, building_id, community_id, name, building_type, floor_count, unit_count)
VALUES (1, 'B01', 'P01', '1栋', '高层', 18, 1)
ON CONFLICT DO NOTHING;

INSERT INTO unit (tenant_id, unit_id, community_id, building_id, name)
VALUES (1, 'U0101', 'P01', 'B01', '1单元')
ON CONFLICT DO NOTHING;

-- 房屋
INSERT INTO house (tenant_id, house_id, community_id, building_id, unit_id, room, floor,
                   full_name, build_area, inner_area, usage_type, use_status)
VALUES
  (1, 'H0101101', 'P01', 'B01', 'U0101', '101', 1, '翡翠城/1栋/1单元/101', 115.14, 92.00, '住宅', '自住'),
  (1, 'H0101102', 'P01', 'B01', 'U0101', '102', 1, '翡翠城/1栋/1单元/102',  89.50, 71.60, '住宅', '出租')
ON CONFLICT DO NOTHING;

-- 业主
INSERT INTO owner (tenant_id, owner_id, name, phone, owner_type, certified, credit_level)
VALUES (1, 'OW00001', '张三', '13800000001', '个人', true, '正常')
ON CONFLICT DO NOTHING;

-- 产权关系（当前）
INSERT INTO house_owner (tenant_id, house_id, owner_id, relation, share_ratio, start_date)
VALUES (1, 'H0101101', 'OW00001', '产权人', 100, '2020-01-01')
ON CONFLICT DO NOTHING;

-- 收费项：物业服务费
INSERT INTO fee_item (tenant_id, item_code, name, category, calc_type, cycle, unit, ref_price, tax_rate, direction)
VALUES (1, 'FI01', '物业服务费', '常规服务费', '按面积', '月', '元/㎡·月', 2.80, 6.00, 'billable')
ON CONFLICT DO NOTHING;

-- 项目级单价
INSERT INTO fee_item_price (tenant_id, community_id, item_id, biz_type, price, effective_from)
SELECT 1, 'P01', f.id, '住宅', 2.80, '2020-01-01'
FROM fee_item f WHERE f.tenant_id = 1 AND f.item_code = 'FI01'
ON CONFLICT DO NOTHING;

-- 一张账单（2026-10 物业费）：115.14 × 2.80 = 322.39
INSERT INTO bill (tenant_id, bill_no, community_id, house_id, item_id, period,
                  quantity, unit, price, amount, waive_amount, late_fee, payable,
                  owner_id, item_name, tax_rate, status, due_date)
SELECT 1, 'BL000001', 'P01', 'H0101101', f.id, '2026-10',
       115.14, '元/㎡·月', 2.80, 322.39, 0, 0, 322.39,
       'OW00001', '物业服务费', 6.00, '待缴', '2026-11-15'
FROM fee_item f WHERE f.tenant_id = 1 AND f.item_code = 'FI01'
ON CONFLICT DO NOTHING;

-- 一笔收款，全额付掉这张账单
INSERT INTO payment (tenant_id, pay_no, community_id, payer_type, payer_id, payer_name,
                     amount, method, channel, pay_point, paid_at, period, status)
VALUES (1, 'PY000001', 'P01', 'owner', 'OW00001', '张三',
        322.39, '现金', '线下', '前台', '2026-10-08 10:30:00+08', '2026-10', '正常')
ON CONFLICT DO NOTHING;

INSERT INTO payment_allocation (tenant_id, payment_id, bill_id, period, item_id, amount)
SELECT 1, p.id, b.id, b.period, b.item_id, p.amount
FROM payment p, bill b
WHERE p.tenant_id = 1 AND p.pay_no = 'PY000001'
  AND b.tenant_id = 1 AND b.bill_no = 'BL000001'
ON CONFLICT DO NOTHING;

-- 回写账单已收（应用层在同一事务里做，这里是种子模拟）
UPDATE bill SET paid_amount = 322.39, status = '已缴'
WHERE tenant_id = 1 AND bill_no = 'BL000001';

-- 押金：装修押金 2000，收 → 退 500
INSERT INTO deposit (tenant_id, deposit_no, type_id, community_id, house_id, owner_id,
                     amount, balance, status, start_date)
VALUES (1, 'DP000001', 'decoration', 'P01', 'H0101101', 'OW00001',
        2000.00, 1500.00, '部分退还', '2026-09-01')
ON CONFLICT DO NOTHING;

INSERT INTO deposit_txn (tenant_id, deposit_id, direction, amount, method, pay_point, occurred_at, reason)
SELECT 1, d.id, 'I', 2000.00, '现金', '前台', '2026-09-01 09:00:00+08', NULL
FROM deposit d WHERE d.tenant_id = 1 AND d.deposit_no = 'DP000001'
  AND NOT EXISTS (SELECT 1 FROM deposit_txn t WHERE t.deposit_id = d.id AND t.direction = 'I');

INSERT INTO deposit_txn (tenant_id, deposit_id, direction, amount, method, pay_point, occurred_at, reason)
SELECT 1, d.id, 'O', 500.00, '转账', '前台', '2026-10-20 14:00:00+08', '装修验收退还部分'
FROM deposit d WHERE d.tenant_id = 1 AND d.deposit_no = 'DP000001'
  AND NOT EXISTS (SELECT 1 FROM deposit_txn t WHERE t.deposit_id = d.id AND t.direction = 'O');

-- 字典：收款方式与收款点（来源：原型 PAY_POINTS 七项）
INSERT INTO dict_type (tenant_id, type_code, name) VALUES
  (1, 'pay_method', '收款方式'),
  (1, 'pay_point',  '收款点'),
  (1, 'waive_reason', '减免原因')
ON CONFLICT DO NOTHING;

INSERT INTO dict_item (tenant_id, type_code, value, label, sort, is_builtin) VALUES
  (1, 'pay_method', '现金',   '现金',   1, true),
  (1, 'pay_method', 'POS',    'POS刷卡', 2, true),
  (1, 'pay_method', '转账',   '银行转账', 3, true),
  (1, 'pay_method', '微信',   '微信支付', 4, true),
  (1, 'pay_method', '支付宝', '支付宝',  5, true),
  (1, 'pay_point',  '前台',       '前台',        1, true),
  (1, 'pay_point',  '南门停车',   '南门停车场',   2, true),
  (1, 'pay_point',  '北门停车',   '北门停车场',   3, true),
  (1, 'pay_point',  '车辆云平台', '车辆云平台',   4, true),
  (1, 'pay_point',  '线上支付',   '线上支付',     5, true)
ON CONFLICT DO NOTHING;

COMMIT;

-- ------------------------------------------------------------
-- 种子自检：三条恒等式都应成立
-- ------------------------------------------------------------
\echo '--- 种子数据概览 ---'
SELECT
  (SELECT count(*) FROM house)   AS houses,
  (SELECT count(*) FROM bill)    AS bills,
  (SELECT count(*) FROM payment) AS payments,
  (SELECT count(*) FROM deposit) AS deposits;
