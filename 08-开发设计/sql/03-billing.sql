-- ============================================================
-- 03 · 计费域：收费项 / 单价 / 账单 / 调账 / 平摊
-- 全系统的心脏。这里定错，对账永远差几分钱
-- ============================================================
SET search_path TO wy, public;

-- ------------------------------------------------------------
-- 收费项
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fee_item (
  id           bigserial    PRIMARY KEY,
  tenant_id    bigint       NOT NULL,
  item_code    varchar(16)  NOT NULL,           -- FI01
  name         varchar(40)  NOT NULL,
  category     varchar(16)  NOT NULL,           -- 常规服务费/公摊/代收/能耗/押金/经营性/工本费
  calc_type    varchar(12)  NOT NULL
               CHECK (calc_type IN ('按面积','按户','按车位','按用量','按次','固定','一次性')),
  cycle        varchar(8)   NOT NULL DEFAULT '月'
               CHECK (cycle IN ('月','季','年','按次','一次性')),
  unit         varchar(16)  NOT NULL,           -- 元/㎡·月
  ref_price    numeric(14,4),                   -- 新建项目时的默认价，真实价在 fee_item_price
  tax_rate     numeric(5,2) NOT NULL DEFAULT 0,
  tax_category varchar(20),
  direction    varchar(8)   NOT NULL DEFAULT 'billable'
               CHECK (direction IN ('billable','deposit')),
  meter_type   varchar(8)   CHECK (meter_type IN ('elec','water')),
  status       varchar(12)  NOT NULL DEFAULT '启用'
               CHECK (status IN ('启用','停用')),
  sort         smallint     NOT NULL DEFAULT 0,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  version      integer      NOT NULL DEFAULT 1,
  deleted_at   timestamptz,
  UNIQUE (tenant_id, item_code)
);

DROP TRIGGER IF EXISTS trg_fee_item_touch ON fee_item;
CREATE TRIGGER trg_fee_item_touch BEFORE UPDATE ON fee_item
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- ------------------------------------------------------------
-- 项目级单价（按生效期分段）
-- 客户 3 月调价，1-2 月的账不能跟着变 —— 所以分段，不覆盖
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fee_item_price (
  id             bigserial    PRIMARY KEY,
  tenant_id      bigint       NOT NULL,
  community_id   varchar(16)  NOT NULL,
  item_id        bigint       NOT NULL REFERENCES fee_item(id),
  biz_type       varchar(16)  NOT NULL DEFAULT '住宅',   -- 同项目分业态定价
  price          numeric(14,4) NOT NULL CHECK (price >= 0),
  effective_from date         NOT NULL,
  effective_to   date,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  created_by     varchar(16),
  UNIQUE (tenant_id, community_id, item_id, biz_type, effective_from),
  CONSTRAINT ck_price_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
COMMENT ON TABLE fee_item_price IS
  '价格分段；账单落库时把当时 price 存快照，历史账单不随调价变化';

-- ------------------------------------------------------------
-- 账单
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill (
  id            bigserial    PRIMARY KEY,
  tenant_id     bigint       NOT NULL,
  bill_no       varchar(20)  NOT NULL,
  community_id  varchar(16)  NOT NULL,
  house_id      varchar(24),
  parking_id    varchar(24),
  item_id       bigint       NOT NULL REFERENCES fee_item(id),
  period        char(7)      NOT NULL
                CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  -- ==== 金额（全部快照，不 join 主表）====
  quantity      numeric(14,4) NOT NULL DEFAULT 0,
  unit          varchar(16)   NOT NULL,
  price         numeric(14,4) NOT NULL,
  amount        numeric(14,2) NOT NULL,          -- 原价 = round(quantity*price,2)
  waive_amount  numeric(14,2) NOT NULL DEFAULT 0,-- 减免额；净应缴 = payable - waive_amount
  late_fee      numeric(14,2) NOT NULL DEFAULT 0,
  payable       numeric(14,2) NOT NULL,          -- 应缴原价 = amount + late（减免不冲减，单列）
  paid_amount   numeric(14,2) NOT NULL DEFAULT 0,-- 物化缓存，真源在 payment_allocation

  -- ==== 归属快照 ====
  owner_id      varchar(16),                     -- 开账时的业主；换主不追溯
  item_name     varchar(40)   NOT NULL,
  tax_rate      numeric(5,2)  NOT NULL DEFAULT 0,

  -- ==== 状态与期限 ====
  status        varchar(12)   NOT NULL DEFAULT '待缴'
                CHECK (status IN ('待缴','部分缴','已缴','已减免','已作废')),
  due_date      date          NOT NULL,
  note          varchar(200),

  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    varchar(16),
  version       integer       NOT NULL DEFAULT 1,
  deleted_at    timestamptz,

  CONSTRAINT ck_bill_payable
    CHECK (payable = amount + late_fee),
  CONSTRAINT ck_bill_paid_range
    CHECK (paid_amount >= 0 AND paid_amount <= payable),
  CONSTRAINT ck_bill_waive
    CHECK (waive_amount >= 0 AND waive_amount <= amount),
  CONSTRAINT ck_bill_subject
    CHECK ( (house_id IS NOT NULL AND parking_id IS NULL)
         OR (house_id IS NULL AND parking_id IS NOT NULL) ),
  UNIQUE (tenant_id, bill_no),
  FOREIGN KEY (tenant_id, house_id)   REFERENCES house(tenant_id, house_id),
  FOREIGN KEY (tenant_id, parking_id) REFERENCES parking(tenant_id, parking_id)
);

-- 同一房 + 同一科目 + 同一账期，只能有一张有效账单（作废后可重开）
CREATE UNIQUE INDEX IF NOT EXISTS uk_bill_house
  ON bill (tenant_id, house_id, item_id, period)
  WHERE house_id IS NOT NULL AND status <> '已作废' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_bill_parking
  ON bill (tenant_id, parking_id, item_id, period)
  WHERE parking_id IS NOT NULL AND status <> '已作废' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_bill_period ON bill (tenant_id, community_id, period, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bill_aging ON bill (tenant_id, community_id, status, due_date)
  WHERE status IN ('待缴','部分缴') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bill_house ON bill (tenant_id, house_id, period)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_bill_touch ON bill;
CREATE TRIGGER trg_bill_touch BEFORE UPDATE ON bill
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

COMMENT ON COLUMN bill.owner_id IS '开账时的业主快照。房屋换主后，历史账单的催缴对象不变';
COMMENT ON COLUMN bill.paid_amount IS '物化缓存。真源是 payment_allocation 汇总，由事务或定时任务维护';

-- ------------------------------------------------------------
-- 调账（原型缺这张表）
-- 客户问"这户为什么少 300"，没有这张表答不出来
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_adjust (
  id             bigserial    PRIMARY KEY,
  tenant_id      bigint       NOT NULL,
  bill_id        bigint       NOT NULL REFERENCES bill(id),
  adjust_type    varchar(12)  NOT NULL
                 CHECK (adjust_type IN ('减免','滞纳金','改价','作废','恢复')),
  amount         numeric(14,2) NOT NULL,        -- 正数增加应缴，负数减少
  reason_id      varchar(16),                   -- 减免原因，取 dict_item
  reason_text    varchar(200),
  before_payable numeric(14,2) NOT NULL,
  after_payable  numeric(14,2) NOT NULL,
  approved_by    varchar(16),
  approved_at    timestamptz,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  created_by     varchar(16),
  CONSTRAINT ck_adjust_delta CHECK (after_payable - before_payable = amount)
);
CREATE INDEX IF NOT EXISTS ix_adjust_bill ON bill_adjust (tenant_id, bill_id, created_at DESC);

-- 减免原因必填（原型第 83 批口径：减免必须选原因，不能自由文本）
ALTER TABLE bill_adjust DROP CONSTRAINT IF EXISTS ck_adjust_waive_reason;
ALTER TABLE bill_adjust ADD CONSTRAINT ck_adjust_waive_reason
  CHECK (adjust_type <> '减免' OR reason_id IS NOT NULL);

-- ------------------------------------------------------------
-- 平摊明细：一笔收款跨多账期（预缴 12 个月）时的拆分
-- 与 payment_allocation 的区别：
--   payment_allocation = 钱分到「哪几张账单」
--   bill_share         = 一张账单内部的「哪几个账期」
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bill_share (
  id          bigserial   PRIMARY KEY,
  tenant_id   bigint      NOT NULL,
  bill_id     bigint      NOT NULL REFERENCES bill(id),
  period      char(7)     NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bill_id, period)
);
