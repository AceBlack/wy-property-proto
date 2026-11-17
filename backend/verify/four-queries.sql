-- ============================================================
-- 收费域四条查询 · 手工复核基线
--
-- 用途：后端实现与这里的输出必须逐分一致。
-- 跑法：./backend/verify/run-baseline.sh
--      或 psql "postgres://wy_app:wy_app_pass@127.0.0.1:5432/wy_property?options=-c search_path=wy,public" -f 本文件
--
-- 必须用 wy_app：用超级用户 wy 跑，RLS 被静默绕过，隔离相关的结论全部无效。
-- ============================================================
SET search_path TO wy, public;
SET TIME ZONE 'Asia/Shanghai';
SET app.tenant_id = '1';   -- 一次性脚本用会话级即可；应用里必须 SET LOCAL

\echo ''
\echo '=== 1. 三率（2026 全年，分项目）==='
SELECT b.community_id,
       max(c.name)                                        AS community_name,
       coalesce(sum(b.payable), 0)                        AS payable,
       coalesce(sum(b.waive_amount), 0)                   AS waive_amount,
       coalesce(sum(b.payable - b.waive_amount), 0)       AS net_payable,
       coalesce(sum(b.paid_amount), 0)                    AS paid_amount,
       round(coalesce(sum(b.paid_amount), 0) * 100.0
             / nullif(sum(b.payable - b.waive_amount), 0), 2) AS collection_rate,
       count(*)                                           AS bill_count
FROM bill b
LEFT JOIN community c ON c.tenant_id = b.tenant_id AND c.community_id = b.community_id
WHERE b.deleted_at IS NULL
  AND b.status <> '已作废'
  AND b.period >= '2026-01'
  AND b.period <= '2026-12'
GROUP BY b.community_id
ORDER BY b.community_id;

\echo '--- 1b. 合计（收缴率按总额重算，不是各项目百分比平均）---'
SELECT coalesce(sum(payable), 0)                    AS payable,
       coalesce(sum(waive_amount), 0)               AS waive_amount,
       coalesce(sum(payable - waive_amount), 0)     AS net_payable,
       coalesce(sum(paid_amount), 0)                AS paid_amount,
       round(coalesce(sum(paid_amount), 0) * 100.0
             / nullif(sum(payable - waive_amount), 0), 2) AS collection_rate,
       count(*)                                     AS bill_count
FROM bill
WHERE deleted_at IS NULL
  AND status <> '已作废'
  AND period >= '2026-01'
  AND period <= '2026-12';

\echo ''
\echo '=== 2. 账龄（基准日 2026-11-18，未结清）==='
WITH bucket_def(label, ord) AS (
    VALUES ('未到期', 1), ('1-30天', 2), ('31-90天', 3), ('91-180天', 4), ('180天以上', 5)
), aged AS (
    SELECT CASE
               WHEN due_date > DATE '2026-11-18'                THEN '未到期'
               WHEN (DATE '2026-11-18' - due_date) <= 30        THEN '1-30天'
               WHEN (DATE '2026-11-18' - due_date) <= 90        THEN '31-90天'
               WHEN (DATE '2026-11-18' - due_date) <= 180       THEN '91-180天'
               ELSE '180天以上'
           END AS label,
           count(*) AS bill_count,
           coalesce(sum(payable - waive_amount - paid_amount), 0) AS owed_amount
    FROM bill
    WHERE deleted_at IS NULL
      AND status IN ('待缴', '部分缴')
    GROUP BY 1
)
SELECT d.label AS bucket,
       coalesce(a.bill_count, 0) AS bill_count,
       coalesce(a.owed_amount, 0) AS owed_amount
FROM bucket_def d
LEFT JOIN aged a ON a.label = d.label
ORDER BY d.ord;

\echo ''
\echo '=== 3. 日结（2026-08-06 单日 + 区间合计）==='
SELECT (paid_at AT TIME ZONE 'Asia/Shanghai')::date AS biz_date,
       count(*)                                    AS txn_count,
       coalesce(sum(amount), 0)                    AS total_amount,
       coalesce(sum(amount) FILTER (WHERE method = '现金'), 0) AS cash_amount
FROM payment
WHERE status = '正常'
  AND paid_at >= TIMESTAMPTZ '2026-08-06 00:00:00+08'
  AND paid_at <  TIMESTAMPTZ '2026-08-07 00:00:00+08'
GROUP BY 1;

\echo '--- 3b. 各收款点（同日）---'
SELECT pay_point, count(*) AS txn_count, coalesce(sum(amount), 0) AS amount
FROM payment
WHERE status = '正常'
  AND pay_point IS NOT NULL AND btrim(pay_point) <> ''
  AND paid_at >= TIMESTAMPTZ '2026-08-06 00:00:00+08'
  AND paid_at <  TIMESTAMPTZ '2026-08-07 00:00:00+08'
GROUP BY 1 ORDER BY 1;

\echo '--- 3c. 区间合计与差额（差额应为 0）---'
SELECT count(*) AS txn_count,
       coalesce(sum(amount), 0) AS total_amount,
       coalesce(sum(amount) FILTER (WHERE method = '现金'), 0) AS cash_amount,
       coalesce(sum(amount), 0)
         - coalesce(sum(amount) FILTER (WHERE pay_point IS NOT NULL AND btrim(pay_point) <> ''), 0)
       AS difference
FROM payment
WHERE status = '正常'
  AND paid_at >= TIMESTAMPTZ '2026-08-06 00:00:00+08'
  AND paid_at <  TIMESTAMPTZ '2026-11-16 00:00:00+08';

\echo ''
\echo '=== 4. 押金三向流水（全租户）==='
SELECT count(*) AS deposit_count,
       coalesce(sum(balance), 0) AS balance_total,
       coalesce(sum(in_amount), 0) AS in_total,
       coalesce(sum(out_amount), 0) AS out_total,
       coalesce(sum(deduct_amount), 0) AS deduct_total,
       coalesce(sum(balance), 0)
         - (coalesce(sum(in_amount), 0) - coalesce(sum(out_amount), 0) - coalesce(sum(deduct_amount), 0))
       AS difference
FROM (
    SELECT d.balance,
           coalesce(sum(t.amount) FILTER (WHERE t.direction = 'I'), 0) AS in_amount,
           coalesce(sum(t.amount) FILTER (WHERE t.direction = 'O'), 0) AS out_amount,
           coalesce(sum(t.amount) FILTER (WHERE t.direction = 'D'), 0) AS deduct_amount
    FROM deposit d
    LEFT JOIN deposit_txn t ON t.deposit_id = d.id AND t.tenant_id = d.tenant_id
    GROUP BY d.id, d.balance
) x;

\echo '--- 4b. 不平的押金（应为 0 行）---'
SELECT d.id, d.deposit_no, d.balance, calc.calculated
FROM deposit d
JOIN LATERAL (
    SELECT coalesce(sum(CASE t.direction WHEN 'I' THEN t.amount WHEN 'O' THEN -t.amount WHEN 'D' THEN -t.amount END), 0) AS calculated
    FROM deposit_txn t WHERE t.deposit_id = d.id
) calc ON true
WHERE d.balance <> calc.calculated;
