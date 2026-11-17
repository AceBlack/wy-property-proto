-- ============================================================
-- 00 · 初始化
-- 智慧物业 V2 · PostgreSQL 14+
-- 执行顺序：00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 20 → 30
-- 说明：每个文件可重复执行（幂等），失败可从出错文件重跑
-- ============================================================

-- 时区与编码：账期、日结都按 Asia/Shanghai 切
SET TIME ZONE 'Asia/Shanghai';

-- 租约排他约束依赖 btree_gist（部分托管版需工单申请）
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid，用于二维码 token

-- 应用专用 schema（不用 public，避免与托管版内置对象混）
CREATE SCHEMA IF NOT EXISTS wy;
SET search_path TO wy, public;

-- ------------------------------------------------------------
-- 通用：更新时间戳触发器
-- 所有带 updated_at 的表统一挂这个，不靠应用层记得
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION wy.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 通用：禁止更新/删除（审计表、流水表用）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION wy.deny_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '该表只允许追加，禁止 % 操作（表：%）', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END $$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 通用：当前租户（RLS 策略统一用它）
-- 未设置时抛错，而不是返回空集 —— 空集是静默失败，比报错危险
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION wy.current_tenant_id() RETURNS bigint AS $$
DECLARE v text;
BEGIN
  v := current_setting('app.tenant_id', true);
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION '未设置 app.tenant_id，拒绝访问（RLS）'
      USING ERRCODE = '42501',
            HINT = '每个事务开头执行 SET LOCAL app.tenant_id = ''1''';
  END IF;
  RETURN v::bigint;
END $$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION wy.current_tenant_id() IS
  'RLS 策略统一入口。未设租户直接报错，避免"忘记设 → 返回空集 → 以为没数据"';
