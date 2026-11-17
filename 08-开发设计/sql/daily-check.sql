-- ============================================================
-- 智慧物业 V2 · 每日数据自检
-- 用法：psql -d wy_property -f 08-开发设计/sql/daily-check.sql
-- 判据：每一段都应返回 0 行。有行返回 = 该不变式被破坏，必须当天修。
-- 建议：挂进 CI 定时任务，结果邮件/群通知
-- ============================================================

\echo '=== 1. 金额字段是否用了浮点（应为 0 行）==='
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND data_type IN ('real', 'double precision')
  AND (column_name LIKE '%amount%' OR column_name LIKE '%price%'
       OR column_name LIKE '%fee%'   OR column_name LIKE '%balance%');

\echo '=== 2. 有没有业务表缺 tenant_id（应为 0 行）==='
SELECT c.relname AS table_without_tenant
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname NOT IN ('tenant', 'dict_type', 'dict_item', 'flyway_schema_history')
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name = c.relname
      AND col.column_name = 'tenant_id'
  );

\echo '=== 3. 开了 RLS 但没 FORCE（应为 0 行；有行 = 隔离可被绕过）==='
SELECT relname AS rls_not_forced
FROM pg_class
WHERE relrowsecurity = true
  AND relforcerowsecurity = false;

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

\echo '=== 7. 收款分摊平衡：payment.amount ≠ Σ allocation（应为 0 行）==='
-- 注意：预收场景下差额会进 prepay_account，这里只查"已完全分摊"的收款
SELECT p.id, p.pay_no, p.amount, COALESCE(a.total, 0) AS allocated
FROM payment p
LEFT JOIN (
  SELECT payment_id, SUM(amount) AS total
  FROM payment_allocation GROUP BY payment_id
) a ON a.payment_id = p.id
WHERE p.status = '正常'
  AND COALESCE(a.total, 0) > 0
  AND p.amount <> COALESCE(a.total, 0);

\echo '=== 8. 账单状态与金额不一致（应为 0 行）==='
-- 已缴但没收够 / 待缴却有已收 / 已缴未收满
SELECT id, bill_no, status, payable, paid_amount
FROM bill
WHERE deleted_at IS NULL
  AND (
    (status = '已缴'   AND paid_amount <> payable) OR
    (status = '待缴'   AND paid_amount <> 0) OR
    (status = '部分缴' AND (paid_amount = 0 OR paid_amount >= payable))
  );

\echo '=== 9. 收款流水被改过（应为 0 行；靠版本号比审计日志）==='
-- 只有存在审计表时才有意义；没有则跳过
SELECT p.id, p.pay_no, p.version
FROM payment p
WHERE p.version > 1
  AND p.status = '正常';

\echo '=== 10. 跨租户脏数据：子表 tenant_id 与主表不一致（应为 0 行）==='
SELECT a.id AS allocation_id, a.tenant_id, p.tenant_id AS payment_tenant
FROM payment_allocation a
JOIN payment p ON p.id = a.payment_id
WHERE a.tenant_id <> p.tenant_id;

SELECT b.id AS bill_id, b.tenant_id, h.tenant_id AS house_tenant
FROM bill b
JOIN house h ON h.house_code = b.house_id
WHERE b.tenant_id <> h.tenant_id;

\echo '=== 自检完成。以上每段都应显示 0 行 ==='
