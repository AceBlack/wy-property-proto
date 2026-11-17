-- ============================================================
-- 每日数据自检
-- 用法：psql -d wy_property -f 08-开发设计/sql/daily-check.sql
-- 判据：每一段都应返回 0 行。有行返回 = 该不变式被破坏，当天必须修
-- 建议：挂 CI 定时任务（每日 06:00），结果发群
-- ============================================================
SET search_path TO wy, public;

\echo '=== 1. 金额字段用浮点（应为 0 行）==='
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'wy'
  AND data_type IN ('real', 'double precision')
  AND (column_name LIKE '%amount%' OR column_name LIKE '%price%'
       OR column_name LIKE '%fee%'   OR column_name LIKE '%balance%');

\echo '=== 2. 业务表缺 tenant_id（应为 0 行）==='
SELECT c.relname AS table_without_tenant
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'wy'
  AND c.relkind IN ('r','p')
  AND c.relname NOT IN ('tenant','permission')
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'wy' AND col.table_name = c.relname
      AND col.column_name = 'tenant_id'
  );

\echo '=== 3. 开了 RLS 但没 FORCE（应为 0 行；有行 = 隔离可绕过）==='
SELECT c.relname AS rls_not_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'wy'
  AND c.relrowsecurity = true
  AND c.relforcerowsecurity = false;

\echo '=== 4. 账单平衡：payable ≠ amount − waive + late（应为 0 行）==='
SELECT id, bill_no, amount, waive_amount, late_fee, payable
FROM bill
WHERE payable <> amount - waive_amount + late_fee
  AND deleted_at IS NULL;

\echo '=== 5. 账单已收超过应缴（应为 0 行）==='
SELECT id, bill_no, payable, paid_amount
FROM bill
WHERE paid_amount > payable
  AND deleted_at IS NULL;

\echo '=== 6. 押金恒等式：balance ≠ ΣI − ΣO − ΣD（应为 0 行）==='
SELECT d.id, d.deposit_no, d.balance, calc.calculated
FROM deposit d
JOIN LATERAL (
  SELECT COALESCE(SUM(CASE t.direction
                        WHEN 'I' THEN  t.amount
                        WHEN 'O' THEN -t.amount
                        WHEN 'D' THEN -t.amount
                      END), 0) AS calculated
  FROM deposit_txn t WHERE t.deposit_id = d.id
) calc ON true
WHERE d.balance <> calc.calculated;

\echo '=== 7. 收款分摊平衡：amount ≠ Σ分摊 + 预收（应为 0 行）==='
WITH alloc AS (
  SELECT payment_id, SUM(amount) AS total FROM payment_allocation GROUP BY payment_id
), prepay AS (
  SELECT payment_id, SUM(amount) AS total FROM prepay_flow
  WHERE direction = 'I' AND payment_id IS NOT NULL GROUP BY payment_id
)
SELECT p.id, p.pay_no, p.amount,
       COALESCE(a.total,0) AS allocated,
       COALESCE(pp.total,0) AS prepaid,
       p.amount - COALESCE(a.total,0) - COALESCE(pp.total,0) AS diff
FROM payment p
LEFT JOIN alloc  a  ON a.payment_id  = p.id
LEFT JOIN prepay pp ON pp.payment_id = p.id
WHERE p.status = '正常'
  AND p.amount <> COALESCE(a.total,0) + COALESCE(pp.total,0);

\echo '=== 8. 账单物化已收 ≠ 分摊汇总（应为 0 行）==='
WITH alloc AS (
  SELECT bill_id, SUM(amount) AS total FROM payment_allocation GROUP BY bill_id
)
SELECT b.id, b.bill_no, b.paid_amount, COALESCE(a.total,0) AS alloc_total
FROM bill b
LEFT JOIN alloc a ON a.bill_id = b.id
WHERE b.deleted_at IS NULL
  AND b.paid_amount <> COALESCE(a.total, 0);

\echo '=== 9. 账单状态与金额矛盾（应为 0 行）==='
SELECT id, bill_no, status, payable, paid_amount
FROM bill
WHERE deleted_at IS NULL
  AND (
    (status = '已缴'   AND paid_amount <> payable) OR
    (status = '待缴'   AND paid_amount <> 0) OR
    (status = '部分缴' AND (paid_amount = 0 OR paid_amount >= payable))
  );

\echo '=== 10. 跨租户脏数据：子表与主表 tenant_id 不一致（应为 0 行）==='
SELECT a.id AS allocation_id, a.tenant_id, p.tenant_id AS payment_tenant
FROM payment_allocation a
JOIN payment p ON p.id = a.payment_id
WHERE a.tenant_id <> p.tenant_id;

SELECT b.id AS bill_id, b.tenant_id, h.tenant_id AS house_tenant
FROM bill b
JOIN house h ON h.tenant_id = b.tenant_id AND h.house_id = b.house_id
WHERE b.tenant_id <> h.tenant_id;

\echo '=== 11. 公司级费用挂了项目 / 项目级没挂（应为 0 行）==='
SELECT id, level, community_id, amount
FROM expense
WHERE (level = 'company' AND community_id IS NOT NULL)
   OR (level = 'project' AND community_id IS NULL);

\echo '=== 12. 分摊快照不平：Σamount ≠ 池子总额（无分摊时应 0 行）==='
SELECT r.rule_id, r.period, SUM(r.amount) AS allocated,
       (SELECT COALESCE(SUM(e.amount),0) FROM expense e
        WHERE e.tenant_id = r.tenant_id AND e.period = r.period
          AND e.level = 'company' AND e.status = '已付款') AS pool
FROM allocation_result r
GROUP BY r.tenant_id, r.rule_id, r.period
HAVING SUM(r.amount) <> (
  SELECT COALESCE(SUM(e.amount),0) FROM expense e
  WHERE e.tenant_id = r.tenant_id AND e.period = r.period
    AND e.level = 'company' AND e.status = '已付款'
);

\echo ''
\echo '=== 自检完成：以上每段都应显示 0 行 ==='
