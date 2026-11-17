-- ============================================================
-- 一次性数据修正：部分扣除（余额 0）→ 已退还
--
-- 背景（2026-11-18 业务确认）：
--   "部分扣除" = 扣了一部分、**还能再退** → 余额必须 > 0，是中间态。
--   但库里 45 笔"部分扣除"余额全是 0，流水都是 I = O + D（扣一部分、余款已退），
--   实质是"已退还"，状态没推进而已。
--
-- 判据（三条同时满足才改，避免误伤）：
--   ① status = '部分扣除'
--   ② balance = 0
--   ③ ΣI − ΣO − ΣD = 0 且存在 O 向（确实退过钱）
--
-- 运行：psql "postgres://wy_app:wy_app_pass@127.0.0.1:5432/wy_property?options=-c search_path=wy,public" -f 本文件
-- 先跑第 1 段导出备份，再跑第 2 段更新。
-- ============================================================
SET search_path TO wy, public;
-- 一次性运维脚本：会话级设租户即可（业务连接里必须用 SET LOCAL）
SET app.tenant_id = '1';

-- 1. 备份：由 run-fix 脚本在更新前导出到 verify/out/（psql 的 \copy 是客户端路径，交给 shell 做更稳）

\echo '=== 2. 更新（带三重判据）==='
WITH target AS (
    SELECT d.id
    FROM deposit d
    WHERE d.tenant_id = 1
      AND d.status = '部分扣除'
      AND d.balance = 0
      AND EXISTS (SELECT 1 FROM deposit_txn t WHERE t.deposit_id = d.id AND t.direction = 'O')
      AND coalesce((SELECT sum(CASE t.direction WHEN 'I' THEN t.amount WHEN 'O' THEN -t.amount WHEN 'D' THEN -t.amount END)
                    FROM deposit_txn t WHERE t.deposit_id = d.id), 0) = 0
)
UPDATE deposit d
SET status = '已退还', updated_at = now(), version = version + 1
FROM target
WHERE d.id = target.id
RETURNING d.id, d.deposit_no, d.status;

\echo '=== 3. 复核：状态分布与恒等式 ==='
SELECT status, count(*), sum(amount) AS amount, sum(balance) AS balance
FROM deposit
GROUP BY status
ORDER BY count(*) DESC;
