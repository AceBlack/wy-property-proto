-- ============================================================
-- 06 · 工单域 + 现场 + 资产域
-- 工单：SLA 全部由服务端算，前端只展示
-- ============================================================
SET search_path TO wy, public;

-- ------------------------------------------------------------
-- 工单
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_order (
  id              bigserial    PRIMARY KEY,
  tenant_id       bigint       NOT NULL,
  wo_no           varchar(24)  NOT NULL,
  community_id    varchar(16)  NOT NULL,
  house_id        varchar(24),
  owner_id        varchar(16),
  -- 报修人（可能是业主、租户、或路人）
  reporter_type   varchar(8)   NOT NULL DEFAULT 'owner'
                  CHECK (reporter_type IN ('owner','lessee','other')),
  reporter_name   varchar(40),
  reporter_phone  varchar(20),

  type            varchar(16)  NOT NULL
                  CHECK (type IN ('报修','投诉','咨询','建议','公共维修')),
  category        varchar(24),
  source          varchar(12)  NOT NULL DEFAULT '前台'
                  CHECK (source IN ('业主端','员工端','电话','前台','巡检','其他')),
  priority        varchar(8)   NOT NULL DEFAULT '普通'
                  CHECK (priority IN ('紧急','高','普通','低')),
  status          varchar(12)  NOT NULL DEFAULT '待派单'
                  CHECK (status IN ('待派单','待接单','处理中','待确认','已完成','已取消')),

  title           varchar(80)  NOT NULL,
  description     text,
  is_public       boolean      NOT NULL DEFAULT false,  -- 公共区域报修

  -- SLA：起算/暂停/超时全部服务端算
  sla_hours       smallint,
  sla_due_at      timestamptz,
  sla_used_hours  numeric(8,2) NOT NULL DEFAULT 0,
  sla_breached    boolean      NOT NULL DEFAULT false,
  paused_at       timestamptz,                          -- 待确认状态停表
  paused_seconds  integer      NOT NULL DEFAULT 0,      -- 累计暂停秒数

  -- 时间戳链
  created_at      timestamptz  NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  arrived_at      timestamptz,
  finished_at     timestamptz,
  confirmed_at    timestamptz,

  -- 费用
  fee_type        varchar(12)  CHECK (fee_type IN ('免费','有偿','质保内')),
  material_fee    numeric(14,2) NOT NULL DEFAULT 0,
  labor_fee       numeric(14,2) NOT NULL DEFAULT 0,
  total_fee       numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount     numeric(14,2) NOT NULL DEFAULT 0,
  bill_id         bigint,                               -- 有偿工单生成的账单

  assignee_emp_id varchar(16),
  score           smallint     CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  comment         varchar(500),

  updated_at      timestamptz  NOT NULL DEFAULT now(),
  version         integer      NOT NULL DEFAULT 1,
  deleted_at      timestamptz,
  UNIQUE (tenant_id, wo_no),
  CONSTRAINT ck_wo_fee CHECK (total_fee = material_fee + labor_fee),
  CONSTRAINT ck_wo_paid CHECK (paid_amount <= total_fee),
  FOREIGN KEY (tenant_id, community_id) REFERENCES community(tenant_id, community_id)
);

CREATE INDEX IF NOT EXISTS ix_wo_sla ON work_order (tenant_id, status, sla_due_at)
  WHERE status NOT IN ('已完成','已取消');
CREATE INDEX IF NOT EXISTS ix_wo_comm ON work_order (tenant_id, community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_wo_assignee ON work_order (tenant_id, assignee_emp_id, status)
  WHERE assignee_emp_id IS NOT NULL;

CREATE TRIGGER trg_wo_touch BEFORE UPDATE ON work_order
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- 工单流转日志
CREATE TABLE IF NOT EXISTS wo_log (
  id         bigserial   PRIMARY KEY,
  tenant_id  bigint      NOT NULL,
  wo_id      bigint      NOT NULL REFERENCES work_order(id),
  action     varchar(16) NOT NULL,              -- 创建/接单/到场/挂起/完成/确认/退回/取消/改派
  from_status varchar(12),
  to_status   varchar(12),
  emp_id     varchar(16),
  note       varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_wolog ON wo_log (tenant_id, wo_id, created_at);

-- 附件（照片/视频，带水印标记）
CREATE TABLE IF NOT EXISTS wo_attachment (
  id         bigserial   PRIMARY KEY,
  tenant_id  bigint      NOT NULL,
  wo_id      bigint      NOT NULL REFERENCES work_order(id),
  kind       varchar(12) NOT NULL DEFAULT '现场'
             CHECK (kind IN ('现场','完工','材料','签名','其他')),
  object_key varchar(300) NOT NULL,             -- OSS 路径：/t/{tenantId}/wo/{woId}/xxx.jpg
  mime_type  varchar(60),
  size_bytes bigint,
  has_watermark boolean  NOT NULL DEFAULT false, -- 照片是否已打水印
  lat        numeric(10,6),
  lng        numeric(10,6),
  uploaded_by varchar(16),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_woatt ON wo_attachment (tenant_id, wo_id);

-- ------------------------------------------------------------
-- 巡检与整改
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspect_plan (
  id           bigserial   PRIMARY KEY,
  tenant_id    bigint      NOT NULL,
  community_id varchar(16) NOT NULL,
  name         varchar(80) NOT NULL,
  cycle        varchar(12) NOT NULL CHECK (cycle IN ('每日','每周','每月','每季','自定义')),
  item_count   smallint    NOT NULL DEFAULT 0,
  enabled      boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE IF NOT EXISTS inspect_task (
  id           bigserial   PRIMARY KEY,
  tenant_id    bigint      NOT NULL,
  plan_id      bigint,
  community_id varchar(16) NOT NULL,
  task_no      varchar(24) NOT NULL,
  plan_date    date        NOT NULL,
  executor_id  varchar(16),
  status       varchar(12) NOT NULL DEFAULT '待执行'
               CHECK (status IN ('待执行','执行中','已完成','已逾期','已取消')),
  item_total   smallint    NOT NULL DEFAULT 0,
  item_done    smallint    NOT NULL DEFAULT 0,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, task_no)
);
CREATE INDEX IF NOT EXISTS ix_inspect_status ON inspect_task (tenant_id, community_id, status, plan_date);

CREATE TABLE IF NOT EXISTS rectify_order (
  id           bigserial   PRIMARY KEY,
  tenant_id    bigint      NOT NULL,
  rectify_no   varchar(24) NOT NULL,
  community_id varchar(16) NOT NULL,
  source_type  varchar(12) NOT NULL,           -- 巡检/品质检查/工单/主管发现
  source_id    bigint,
  content      varchar(500) NOT NULL,
  severity     varchar(8)  NOT NULL DEFAULT '一般'
               CHECK (severity IN ('轻微','一般','严重')),
  status       varchar(12) NOT NULL DEFAULT '待整改'
               CHECK (status IN ('待整改','待复核','已通过','已驳回')),
  assignee_id  varchar(16),
  deadline     date,
  submit_at    timestamptz,
  review_at    timestamptz,
  -- 提交人与复核人必须不同（原型已有这条守卫，别在后端丢掉）
  reviewer_id  varchar(16),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, rectify_no),
  CONSTRAINT ck_rectify_reviewer
    CHECK (reviewer_id IS NULL OR reviewer_id <> assignee_id)
);

-- ------------------------------------------------------------
-- 资产
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_category (
  tenant_id   bigint      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  category_id varchar(16) NOT NULL,
  parent_id   varchar(16),
  name        varchar(40) NOT NULL,
  code_prefix varchar(8),
  sort        smallint    NOT NULL DEFAULT 0,
  enabled     boolean     NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, category_id)
);

CREATE TABLE IF NOT EXISTS asset (
  tenant_id    bigint       NOT NULL,
  asset_id     varchar(24)  NOT NULL,
  asset_no     varchar(32)  NOT NULL,
  name         varchar(80)  NOT NULL,
  category_id  varchar(16)  NOT NULL,
  community_id varchar(16)  NOT NULL,
  brand        varchar(40),
  model        varchar(60),
  sn           varchar(60),
  buy_date     date,
  price        numeric(14,2) CHECK (price IS NULL OR price >= 0),
  vendor       varchar(80),
  warranty_end date,
  holder_emp_id varchar(16),
  org_id       varchar(16),
  location     varchar(120),
  status       varchar(12)  NOT NULL DEFAULT '在用'
               CHECK (status IN ('在用','闲置','维修中','报废','借用')),
  qr_token     varchar(40),                     -- 二维码扫码定位
  remark       varchar(200),
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   varchar(16),
  version      integer      NOT NULL DEFAULT 1,
  deleted_at   timestamptz,
  PRIMARY KEY (tenant_id, asset_id),
  UNIQUE (tenant_id, asset_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_asset_qr ON asset (tenant_id, qr_token)
  WHERE qr_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_asset_cat ON asset (tenant_id, community_id, category_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_asset_touch BEFORE UPDATE ON asset
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

CREATE TABLE IF NOT EXISTS maintenance_record (
  id           bigserial   PRIMARY KEY,
  tenant_id    bigint      NOT NULL,
  asset_id     varchar(24) NOT NULL,
  maint_type   varchar(12) NOT NULL CHECK (maint_type IN ('保养','维修','年检','校准')),
  maint_date   date        NOT NULL,
  content      varchar(500),
  cost         numeric(14,2) NOT NULL DEFAULT 0,
  vendor       varchar(80),
  next_date    date,
  operator_id  varchar(16),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_maint_asset ON maintenance_record (tenant_id, asset_id, maint_date DESC);
