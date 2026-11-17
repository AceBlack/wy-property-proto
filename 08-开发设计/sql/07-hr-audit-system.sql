-- ============================================================
-- 07 · 人资域 + 审计 + 系统 + 合同/公告
-- 审计表按月分区，只增不改不删
-- ============================================================
SET search_path TO wy, public;

-- ------------------------------------------------------------
-- 组织与员工
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org (
  tenant_id  bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  org_id     varchar(16) NOT NULL,
  name       varchar(60) NOT NULL,
  parent_id  varchar(16),
  org_type   varchar(12) NOT NULL DEFAULT '项目部'
             CHECK (org_type IN ('总部','职能部门','项目部','班组')),
  community_id varchar(16),                     -- 项目部对应的小区
  leader_emp_id varchar(16),
  sort       smallint    NOT NULL DEFAULT 0,
  enabled    boolean     NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, org_id)
);

CREATE TABLE IF NOT EXISTS employee (
  tenant_id    bigint      NOT NULL,
  emp_id       varchar(16) NOT NULL,
  emp_no       varchar(24) NOT NULL,
  name         varchar(40) NOT NULL,
  gender       varchar(4)  CHECK (gender IN ('男','女')),
  phone        varchar(20),
  phone_enc    varchar(120),
  id_card      varchar(40),
  id_card_enc  varchar(160),

  -- 两套归属：home_org 是人事档案上的，org 是岗位推出来的
  -- 合成一个字段会导致"班组调整顺手改掉档案归属，人力对不上花名册"
  home_org_id  varchar(16),
  org_id       varchar(16),
  position     varchar(30),
  level        varchar(12),

  emp_type     varchar(12) NOT NULL DEFAULT '正式'
               CHECK (emp_type IN ('正式','试用','实习','外包','退休返聘')),
  entry_date   date,
  regular_date date,
  status       varchar(12) NOT NULL DEFAULT '在职'
               CHECK (status IN ('在职','试用','离职')),
  leave_date   date,

  contract_start date,
  contract_end   date,
  probation_months smallint,
  manager_emp_id varchar(16),

  score        numeric(5,2),
  remark       varchar(200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer     NOT NULL DEFAULT 1,
  deleted_at   timestamptz,
  PRIMARY KEY (tenant_id, emp_id),
  UNIQUE (tenant_id, emp_no)
);
COMMENT ON COLUMN employee.home_org_id IS '人事档案归属（花名册口径）';
COMMENT ON COLUMN employee.org_id IS '岗位反推的班组/职能归属（工作派单口径）';

CREATE UNIQUE INDEX IF NOT EXISTS uk_emp_phone ON employee (tenant_id, phone)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_emp_org ON employee (tenant_id, org_id, status)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_emp_touch ON employee;
CREATE TRIGGER trg_emp_touch BEFORE UPDATE ON employee
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- ------------------------------------------------------------
-- 角色与权限
-- 角色由岗位反推，人工调整写覆盖层（原型口径）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role (
  tenant_id   bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  role_id     varchar(16) NOT NULL,
  name        varchar(40) NOT NULL,
  data_scope  varchar(16) NOT NULL DEFAULT '本项目'
              CHECK (data_scope IN ('全部','本项目','本部门','责任范围','仅本人')),
  perm_count  smallint    NOT NULL DEFAULT 0,
  is_builtin  boolean     NOT NULL DEFAULT true,
  enabled     boolean     NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, role_id)
);

CREATE TABLE IF NOT EXISTS permission (
  code     varchar(40) PRIMARY KEY,             -- c.employees.view
  name     varchar(60) NOT NULL,
  domain   varchar(8)  NOT NULL,                -- a/b/c/d/e/f
  sensitive boolean    NOT NULL DEFAULT false   -- 敏感能力位（揭示、导出、审批）
);

CREATE TABLE IF NOT EXISTS role_permission (
  tenant_id bigint      NOT NULL,
  role_id   varchar(16) NOT NULL,
  perm_code varchar(40) NOT NULL,
  PRIMARY KEY (tenant_id, role_id, perm_code)
);

CREATE TABLE IF NOT EXISTS employee_role (
  tenant_id  bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  emp_id     varchar(16) NOT NULL,
  role_id    varchar(16) NOT NULL,
  role_source varchar(12) NOT NULL DEFAULT 'position'
              CHECK (role_source IN ('position','override')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by varchar(16),
  PRIMARY KEY (tenant_id, emp_id, role_id)
);
COMMENT ON COLUMN employee_role.role_source IS
  'position=由岗位反推；override=人工指定。调岗时必须清掉 override，否则人走了权限还在';

-- ------------------------------------------------------------
-- 工资条（独立域，权限 c.payroll.view）
-- 状态机：草稿 → 已核算 → 待发放审批 → 已发放 → 已冲正
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll (
  id            bigserial   PRIMARY KEY,
  tenant_id     bigint      NOT NULL,
  emp_id        varchar(16) NOT NULL,
  period        char(7)     NOT NULL
                CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  gross_pay     numeric(14,2) NOT NULL DEFAULT 0,   -- 金额只由服务端算
  deduction_total numeric(14,2) NOT NULL DEFAULT 0,
  net_pay       numeric(14,2) NOT NULL DEFAULT 0,
  status        varchar(12) NOT NULL DEFAULT '草稿'
                CHECK (status IN ('草稿','已核算','待发放审批','已发放','已冲正')),
  locked_at     timestamptz,                        -- 核算锁定后金额不可变
  paid_at       timestamptz,
  approved_by   varchar(16),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, emp_id, period)
);

DROP TRIGGER IF EXISTS trg_payroll_touch ON payroll;
CREATE TRIGGER trg_payroll_touch BEFORE UPDATE ON payroll
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- ------------------------------------------------------------
-- 字典（可配置）与系统参数
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dict_type (
  tenant_id  bigint      NOT NULL,
  type_code  varchar(32) NOT NULL,              -- pay_method / pay_point / waive_reason
  name       varchar(40) NOT NULL,
  editable   boolean     NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, type_code)
);

CREATE TABLE IF NOT EXISTS dict_item (
  tenant_id  bigint      NOT NULL,
  type_code  varchar(32) NOT NULL,
  value      varchar(40) NOT NULL,
  label      varchar(40) NOT NULL,
  extra      varchar(200),                      -- 扩展属性（颜色、排序、上下限）
  sort       smallint    NOT NULL DEFAULT 0,
  enabled    boolean     NOT NULL DEFAULT true,
  is_builtin boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, type_code, value)
);

CREATE TABLE IF NOT EXISTS system_param (
  tenant_id  bigint      NOT NULL,
  param_key  varchar(60) NOT NULL,
  value      varchar(500),
  remark     varchar(200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by varchar(16),
  PRIMARY KEY (tenant_id, param_key)
);

-- ------------------------------------------------------------
-- 通知与待办
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification (
  id          bigserial   PRIMARY KEY,
  tenant_id   bigint      NOT NULL,
  channel     varchar(12) NOT NULL
              CHECK (channel IN ('站内','短信','微信','App推送')),
  target_type varchar(12) NOT NULL CHECK (target_type IN ('employee','owner','lessee')),
  target_id   varchar(16) NOT NULL,
  title       varchar(100) NOT NULL,
  content     varchar(1000),
  biz_type    varchar(24),
  biz_id      varchar(24),
  status      varchar(12) NOT NULL DEFAULT '待发送'
              CHECK (status IN ('待发送','已发送','已送达','失败','已读')),
  retry_count smallint    NOT NULL DEFAULT 0,
  external_no varchar(64),                      -- 通道回执号
  sent_at     timestamptz,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_notify_pending ON notification (tenant_id, status, created_at)
  WHERE status IN ('待发送','失败');
CREATE INDEX IF NOT EXISTS ix_notify_target ON notification (tenant_id, target_type, target_id, created_at DESC);

-- ------------------------------------------------------------
-- 经营合同与公告
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract (
  id            bigserial    PRIMARY KEY,
  tenant_id     bigint       NOT NULL,
  contract_no   varchar(32)  NOT NULL,
  name          varchar(100) NOT NULL,
  direction     varchar(8)   NOT NULL DEFAULT 'income'
                CHECK (direction IN ('income','expense')),
  type_l1       varchar(16),                    -- 多种经营/采购/服务外包/租赁
  type_l2       varchar(24),
  community_id  varchar(16),
  party_b       varchar(80),
  contact       varchar(40),
  phone         varchar(20),
  amount        numeric(14,2) NOT NULL DEFAULT 0,
  pay_cycle     varchar(12),
  sign_date     date,
  start_date    date,
  end_date      date,
  status        varchar(12)  NOT NULL DEFAULT '执行中'
                CHECK (status IN ('草稿','执行中','已到期','已终止')),
  is_multi_business boolean NOT NULL DEFAULT false,
  public_revenue    numeric(14,2) NOT NULL DEFAULT 0,   -- 公共收益分成
  ref_type      varchar(16),
  ref_id        varchar(24),
  remark        varchar(200),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  version       integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, contract_no)
);
CREATE INDEX IF NOT EXISTS ix_contract_status ON contract (tenant_id, status, end_date);

CREATE TABLE IF NOT EXISTS notice (
  id           bigserial    PRIMARY KEY,
  tenant_id    bigint       NOT NULL,
  notice_no    varchar(24)  NOT NULL,
  community_id varchar(16),
  title        varchar(120) NOT NULL,
  type         varchar(16)  NOT NULL DEFAULT '通知'
               CHECK (type IN ('通知','公告','紧急','活动')),
  content      text,
  channels     varchar(60),                     -- 站内/微信/短信
  target_scope varchar(12)  NOT NULL DEFAULT '全部'
               CHECK (target_scope IN ('全部','楼栋','指定房屋')),
  status       varchar(12)  NOT NULL DEFAULT '草稿'
               CHECK (status IN ('草稿','待审核','已发布','已下架')),
  is_top       boolean      NOT NULL DEFAULT false,
  publisher_id varchar(16),
  published_at timestamptz,
  audit_by     varchar(16),
  audit_at     timestamptz,
  read_count   integer      NOT NULL DEFAULT 0,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  version      integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, notice_no)
);

DROP TRIGGER IF EXISTS trg_notice_touch ON notice;
CREATE TRIGGER trg_notice_touch BEFORE UPDATE ON notice
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- ------------------------------------------------------------
-- 审计表（按月分区，只增不改不删）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_log (
  id          bigserial,
  tenant_id   bigint      NOT NULL,
  emp_id      varchar(16),
  action      varchar(24) NOT NULL,             -- 登录/揭示敏感/导出/查看
  target_type varchar(24),
  target_id   varchar(40),
  reason      varchar(200),                     -- 揭示敏感信息必须写
  ip          inet,
  ua          varchar(200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS operation_log (
  id          bigserial,
  tenant_id   bigint      NOT NULL,
  emp_id      varchar(16),
  module      varchar(24) NOT NULL,
  action      varchar(24) NOT NULL,
  target_type varchar(24),
  target_id   varchar(40),
  before_json jsonb,
  after_json  jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 分区自动创建：每次执行补齐「当月 + 未来 3 个月」
CREATE OR REPLACE FUNCTION wy.ensure_monthly_partitions(p_table text, p_months int DEFAULT 3)
RETURNS void AS $$
DECLARE
  v_month date := date_trunc('month', now())::date;
  v_name  text;
  v_from  date;
  v_to    date;
  i       int;
BEGIN
  FOR i IN 0..p_months LOOP
    v_from := (v_month + (i || ' month')::interval)::date;
    v_to   := (v_from + '1 month'::interval)::date;
    v_name := p_table || '_' || to_char(v_from, 'YYYYMM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS wy.%I PARTITION OF wy.%I FOR VALUES FROM (%L) TO (%L)',
      v_name, p_table, v_from, v_to);
  END LOOP;
END $$ LANGUAGE plpgsql;

SELECT wy.ensure_monthly_partitions('access_log', 3);
SELECT wy.ensure_monthly_partitions('operation_log', 3);

-- 审计表禁止改删
DROP TRIGGER IF EXISTS trg_access_log_immutable ON access_log;
CREATE TRIGGER trg_access_log_immutable BEFORE UPDATE OR DELETE ON access_log
  FOR EACH ROW EXECUTE FUNCTION wy.deny_mutation();

DROP TRIGGER IF EXISTS trg_operation_log_immutable ON operation_log;
CREATE TRIGGER trg_operation_log_immutable BEFORE UPDATE OR DELETE ON operation_log
  FOR EACH ROW EXECUTE FUNCTION wy.deny_mutation();

-- 审计表索引（在分区表上建，自动继承到分区）
CREATE INDEX IF NOT EXISTS ix_access_log_emp  ON access_log (tenant_id, emp_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_access_log_act  ON access_log (tenant_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_oplog_target    ON operation_log (tenant_id, target_type, target_id);
