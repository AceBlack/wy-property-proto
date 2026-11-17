-- ============================================================
-- 20 · 多租户 RLS：统一施加
-- 不手写 40 遍策略，用 DO 块遍历所有含 tenant_id 的表
-- 好处：以后新增表自动纳入，不会漏
-- ============================================================
SET search_path TO wy, public;

DO $$
DECLARE
  r      record;
  v_cnt  int := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'wy'
      AND c.relkind IN ('r', 'p')                     -- 普通表 + 分区表父表
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'wy'
          AND col.table_name   = c.relname
          AND col.column_name  = 'tenant_id'
      )
  LOOP
    -- ENABLE：启用 RLS
    EXECUTE format('ALTER TABLE wy.%I ENABLE ROW LEVEL SECURITY', r.tbl);
    -- FORCE：表 owner 也受约束。漏了这一行，应用账号（通常就是 owner）直接绕过
    EXECUTE format('ALTER TABLE wy.%I FORCE  ROW LEVEL SECURITY', r.tbl);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON wy.%I', r.tbl);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON wy.%I
        USING      (tenant_id = wy.current_tenant_id())
        WITH CHECK (tenant_id = wy.current_tenant_id())
    $f$, r.tbl);

    v_cnt := v_cnt + 1;
  END LOOP;

  RAISE NOTICE '已施加 RLS 的表：% 张', v_cnt;
END $$;

-- ------------------------------------------------------------
-- 验证：开了 RLS 但没 FORCE 的表（应该 0 行）
-- ------------------------------------------------------------
SELECT c.relname AS rls_not_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'wy'
  AND c.relrowsecurity = true
  AND c.relforcerowsecurity = false;

-- 验证：含 tenant_id 但没开 RLS 的表（应该 0 行）
SELECT c.relname AS missing_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'wy'
  AND c.relkind IN ('r','p')
  AND c.relrowsecurity = false
  AND EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema='wy' AND col.table_name=c.relname AND col.column_name='tenant_id'
  );

-- ------------------------------------------------------------
-- 应用层怎么用（写在这里，防止有人写成会话级 SET）
-- ------------------------------------------------------------
-- ✅ 正确：事务级，事务结束自动失效
--     BEGIN;
--     SET LOCAL app.tenant_id = '1';
--     SELECT ...;
--     COMMIT;
--
-- ❌ 错误：会话级，连接池复用时下一个请求会带着上一个租户
--     SET app.tenant_id = '1';
--
-- 连接池必须 autoCommit=false，否则 SET LOCAL 立即失效。
-- 未设置时 wy.current_tenant_id() 会直接报错（42501），不会静默返回空集。
