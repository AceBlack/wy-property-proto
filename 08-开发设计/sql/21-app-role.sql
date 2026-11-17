-- ============================================================
-- 21 · 应用角色
--
-- 为什么单独一个文件：
-- PostgreSQL 有三类角色永远绕过 RLS，FORCE 也拦不住：
--   ① 超级用户（superuser）
--   ② 带 BYPASSRLS 属性的角色
--   ③ 表 owner —— 只有 FORCE 能管住（已设）
--
-- Docker 官方镜像用 POSTGRES_USER 建的那个用户就是超级用户。
-- 拿它跑业务，RLS 等于没做 —— 而且不会报错，静默全放行。
-- 这是多租户上线后最常见的事故。
--
-- 约定：
--   wy      = 迁移/运维账号（超级用户，只在建表和备份时用）
--   wy_app  = 应用账号（NOSUPERUSER NOBYPASSRLS，业务连接只许用它）
-- ============================================================
SET search_path TO wy, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wy_app') THEN
    CREATE ROLE wy_app LOGIN PASSWORD 'wy_app_pass'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    RAISE NOTICE '已创建应用角色 wy_app（非超级用户，受 RLS 约束）';
  ELSE
    ALTER ROLE wy_app NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- schema 与对象权限
GRANT USAGE ON SCHEMA wy TO wy_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA wy TO wy_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA wy TO wy_app;
GRANT EXECUTE                         ON ALL FUNCTIONS IN SCHEMA wy TO wy_app;

-- 以后新建的表/序列也自动授权，否则加表就报 permission denied
ALTER DEFAULT PRIVILEGES IN SCHEMA wy
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wy_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA wy
  GRANT USAGE, SELECT ON SEQUENCES TO wy_app;

-- 审计表只允许追加：收回 UPDATE / DELETE
REVOKE UPDATE, DELETE ON access_log    FROM wy_app;
REVOKE UPDATE, DELETE ON operation_log FROM wy_app;
-- 流水同理（触发器也会拦，但权限层先挡一道）
REVOKE DELETE ON payment, deposit_txn FROM wy_app;

-- ------------------------------------------------------------
-- 验证：应用角色确实受 RLS 约束
-- ------------------------------------------------------------
\echo '--- 角色属性（wy 应为 t/t，wy_app 应为 f/f）---'
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname IN ('wy','wy_app') ORDER BY rolname;

\echo '--- wy_app 对 wy schema 的权限（应有 t 与 arwdDxt）---'
SELECT has_schema_privilege('wy_app','wy','USAGE') AS schema_usage,
       has_table_privilege('wy_app','wy.bill','SELECT') AS bill_select,
       has_table_privilege('wy_app','wy.access_log','UPDATE') AS log_update;
