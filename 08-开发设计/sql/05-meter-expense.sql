-- ============================================================
-- 05 · 计量域 + 费用域
-- 计量：抄表、公摊
-- 费用：支出（含公司级）、预算、分摊规则（口径未定，先建表不用）
-- ============================================================
SET search_path TO wy, public;

-- ------------------------------------------------------------
-- 表计
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meter (
  tenant_id     bigint      NOT NULL,
  meter_id      varchar(24) NOT NULL,
  meter_no      varchar(32) NOT NULL,
  meter_type    varchar(8)  NOT NULL CHECK (meter_type IN ('elec','water','gas')),
  unit          varchar(8)  NOT NULL DEFAULT 'kWh',
  community_id  varchar(16) NOT NULL,
  -- 表挂在哪：房屋表 或 公共表（公摊总表没有 house_id）
  house_id      varchar(24),
  parking_id    varchar(24),
  is_public     boolean     NOT NULL DEFAULT false,   -- 公共总表
  item_id       bigint      REFERENCES fee_item(id),  -- 对应收费项（单价来源）
  factor        numeric(8,4) NOT NULL DEFAULT 1,      -- 倍率（互感器）
  install_date  date,
  last_reading  numeric(14,4),
  last_read_date date,
  status        varchar(12) NOT NULL DEFAULT '正常'
                CHECK (status IN ('正常','停用','换表','拆除')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  version       integer     NOT NULL DEFAULT 1,
  deleted_at    timestamptz,
  PRIMARY KEY (tenant_id, meter_id),
  UNIQUE (tenant_id, meter_no),
  CONSTRAINT ck_meter_owner
    CHECK (is_public OR house_id IS NOT NULL OR parking_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_meter_house ON meter (tenant_id, house_id) WHERE house_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_meter_public ON meter (tenant_id, community_id, meter_type) WHERE is_public;

DROP TRIGGER IF EXISTS trg_meter_touch ON meter;
CREATE TRIGGER trg_meter_touch BEFORE UPDATE ON meter
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- ------------------------------------------------------------
-- 抄表读数
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meter_reading (
  id              bigserial    PRIMARY KEY,
  tenant_id       bigint       NOT NULL,
  meter_id        varchar(24)  NOT NULL,
  period          char(7)      NOT NULL
                  CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  last_reading    numeric(14,4),
  current_reading numeric(14,4) NOT NULL,
  usage_qty       numeric(14,4) NOT NULL,       -- 用量落库，不随时算
  read_date       date         NOT NULL,
  reader_id       varchar(16),
  is_abnormal     boolean      NOT NULL DEFAULT false,
  abnormal_note   varchar(200),
  bill_id         bigint,                        -- 推单后回填
  created_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, meter_id, period),
  CONSTRAINT ck_reading_usage CHECK (usage_qty >= -99999),
  FOREIGN KEY (tenant_id, meter_id) REFERENCES meter(tenant_id, meter_id)
);
CREATE INDEX IF NOT EXISTS ix_reading_period ON meter_reading (tenant_id, period, meter_id);

-- ------------------------------------------------------------
-- 公摊结果（总表 − 分户 = 差量，按面积摊到户）
-- 存差量不存每户结果：每户结果在账单上；规则可能重算，差量是事实
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meter_share (
  id              bigserial    PRIMARY KEY,
  tenant_id       bigint       NOT NULL,
  community_id    varchar(16)  NOT NULL,
  period          char(7)      NOT NULL,
  meter_type      varchar(8)   NOT NULL CHECK (meter_type IN ('elec','water')),
  total_usage     numeric(14,4) NOT NULL,       -- 总表
  sum_house_usage numeric(14,4) NOT NULL,       -- 分户合计
  share_usage     numeric(14,4) NOT NULL,       -- 差量 = 总 − 分户
  basis_area      numeric(12,2) NOT NULL,       -- 参与分摊的建筑面积合计
  unit_price      numeric(14,4),                -- 该期单价（快照）
  created_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, community_id, period, meter_type),
  CONSTRAINT ck_share_nonneg CHECK (share_usage >= 0),
  CONSTRAINT ck_share_area CHECK (basis_area > 0)
);

-- ------------------------------------------------------------
-- 支出分类（两级）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_category (
  tenant_id   bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  category_id varchar(16) NOT NULL,
  parent_id   varchar(16),
  name        varchar(40) NOT NULL,
  level       smallint    NOT NULL DEFAULT 1 CHECK (level IN (1,2)),
  -- 税金只允许手工补录（第 84 批口径）
  manual_only boolean     NOT NULL DEFAULT false,
  sort        smallint    NOT NULL DEFAULT 0,
  enabled     boolean     NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, category_id)
);

-- ------------------------------------------------------------
-- 支出（四类来源汇入：采购/合同/报销/手工）
-- level 区分项目级与公司级：公司级 community_id 必须为空
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense (
  id            bigserial    PRIMARY KEY,
  tenant_id     bigint       NOT NULL,
  community_id  varchar(16),
  level         varchar(8)   NOT NULL DEFAULT 'project'
                CHECK (level IN ('project','company')),
  category_id   varchar(16)  NOT NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  period        char(7)      NOT NULL
                CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  incurred_date date,                            -- 发生日
  paid_date     date,                            -- 支付日（支出归月口径）
  status        varchar(12)  NOT NULL DEFAULT '待付款'
                CHECK (status IN ('待付款','已付款','已作废')),
  source        varchar(12)  NOT NULL
                CHECK (source IN ('采购','合同','报销','手工')),
  source_id     varchar(24),
  supplier      varchar(80),
  remark        varchar(200),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    varchar(16),
  version       integer      NOT NULL DEFAULT 1,
  CONSTRAINT ck_expense_level
    CHECK ( (level = 'project' AND community_id IS NOT NULL)
         OR (level = 'company' AND community_id IS NULL) )
);
CREATE INDEX IF NOT EXISTS ix_expense_period ON expense (tenant_id, period, status, level);
CREATE INDEX IF NOT EXISTS ix_expense_comm   ON expense (tenant_id, community_id, period)
  WHERE community_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_expense_touch ON expense;
CREATE TRIGGER trg_expense_touch BEFORE UPDATE ON expense
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- ------------------------------------------------------------
-- 预算（按项目 × 科目 × 月度编制）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget (
  id           bigserial    PRIMARY KEY,
  tenant_id    bigint       NOT NULL,
  community_id varchar(16)  NOT NULL,
  item_id      bigint       NOT NULL REFERENCES fee_item(id),
  period       char(7)      NOT NULL,
  amount       numeric(14,2) NOT NULL CHECK (amount >= 0),
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   varchar(16),
  version      integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, community_id, item_id, period)
);

DROP TRIGGER IF EXISTS trg_budget_touch ON budget;
CREATE TRIGGER trg_budget_touch BEFORE UPDATE ON budget
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- ------------------------------------------------------------
-- 费用分摊（口径未定，表先建好，功能后开）
-- 见 02-原型设计/口径确认单-01-费用分摊.md
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS allocation_rule (
  id            bigserial    PRIMARY KEY,
  tenant_id     bigint       NOT NULL,
  name          varchar(60)  NOT NULL,
  -- 基数：area 建筑面积 / revenue 应收 / house 户数 / custom 手工比例
  basis         varchar(12)  NOT NULL
                CHECK (basis IN ('area','revenue','house','custom')),
  -- 期间：actual 当月实际 / budget 年度预算÷12
  timing        varchar(12)  NOT NULL DEFAULT 'actual'
                CHECK (timing IN ('actual','budget')),
  -- 分摊范围：哪些支出分类进池
  category_ids  varchar(400),                   -- JSON 数组
  effective_from date        NOT NULL,
  effective_to   date,
  enabled       boolean      NOT NULL DEFAULT true,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    varchar(16)
);

CREATE TABLE IF NOT EXISTS allocation_result (
  id           bigserial    PRIMARY KEY,
  tenant_id    bigint       NOT NULL,
  rule_id      bigint       NOT NULL REFERENCES allocation_rule(id),
  period       char(7)      NOT NULL,
  community_id varchar(16)  NOT NULL,
  basis_value  numeric(14,4) NOT NULL,          -- 该项目的基数（面积/收入/户数）
  basis_total  numeric(14,4) NOT NULL,          -- 全部项目基数合计
  ratio        numeric(9,6) NOT NULL,           -- basis_value / basis_total
  amount       numeric(14,2) NOT NULL,          -- 摊到的金额
  created_at   timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rule_id, period, community_id),
  CONSTRAINT ck_alloc_ratio CHECK (ratio >= 0 AND ratio <= 1)
);
COMMENT ON TABLE allocation_result IS
  '月度分摊快照。自检：Σamount 应等于池子总额（差一分都不行）';
