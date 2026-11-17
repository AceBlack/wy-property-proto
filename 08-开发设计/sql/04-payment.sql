-- ============================================================
-- 04 · 收款域：收款流水 / 分摊 / 预付 / 押金 / 发票
-- 铁律：流水只增不改；押金是负债，不是收入
-- ============================================================
SET search_path TO wy, public;

-- ------------------------------------------------------------
-- 收款流水
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment (
  id             bigserial    PRIMARY KEY,
  tenant_id      bigint       NOT NULL,
  pay_no         varchar(24)  NOT NULL,
  community_id   varchar(16)  NOT NULL,

  payer_type     varchar(8)   NOT NULL DEFAULT 'owner'
                 CHECK (payer_type IN ('owner','lessee','other')),
  payer_id       varchar(16),
  payer_name     varchar(40),

  amount         numeric(14,2) NOT NULL CHECK (amount > 0),

  -- 渠道 ≠ 收款点：
  --   method   = 钱怎么走（现金/微信/POS/车辆云平台）
  --   pay_point= 谁在收、跟谁交班（前台/南门/车辆云平台）
  -- 两者都走 dict_item（客户会加窗口、换设备），不写死 CHECK
  method         varchar(16)  NOT NULL,
  channel        varchar(16),                    -- 线下/微信/支付宝/银联
  pay_point      varchar(16),
  channel_txn_no varchar(64),                    -- 支付平台流水号：幂等键

  -- 两个时间，两个口径：
  --   paid_at = 钱到账（现金收入、日结）
  --   period  = 归属账期（三率）；跨期时以 payment_allocation.period 为准
  paid_at        timestamptz  NOT NULL,
  period         char(7)
                 CHECK (period IS NULL OR period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  operator_id    varchar(16),
  operator_name  varchar(40),

  status         varchar(12)  NOT NULL DEFAULT '正常'
                 CHECK (status IN ('正常','已冲红')),
  reversed_by    bigint,                          -- 被哪张红字单冲掉
  remark         varchar(200),

  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  version        integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, pay_no),
  FOREIGN KEY (tenant_id, community_id) REFERENCES community(tenant_id, community_id)
);

COMMENT ON COLUMN payment.method IS '收款方式，取 dict_item(type=pay_method)';
COMMENT ON COLUMN payment.pay_point IS '收款点，取 dict_item(type=pay_point)。与 method 是两个维度';

-- 幂等：同一支付平台的同一笔交易只能入账一次
CREATE UNIQUE INDEX IF NOT EXISTS uk_payment_idem
  ON payment (tenant_id, channel, channel_txn_no)
  WHERE channel_txn_no IS NOT NULL AND channel_txn_no <> '';

CREATE INDEX IF NOT EXISTS ix_payment_paid_at ON payment (tenant_id, community_id, paid_at)
  WHERE status = '正常';
CREATE INDEX IF NOT EXISTS ix_payment_point ON payment (tenant_id, community_id, pay_point, paid_at)
  WHERE status = '正常';
CREATE INDEX IF NOT EXISTS ix_payment_payer ON payment (tenant_id, payer_type, payer_id, paid_at DESC);

CREATE TRIGGER trg_payment_touch BEFORE UPDATE ON payment
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- 流水不可变：金额、到账时间、渠道流水号一旦写入不许改（冲红走反向单）
CREATE OR REPLACE FUNCTION wy.deny_payment_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.amount <> OLD.amount
     OR NEW.paid_at <> OLD.paid_at
     OR NEW.channel_txn_no IS DISTINCT FROM OLD.channel_txn_no THEN
    RAISE EXCEPTION '收款流水不可修改，请用红字单冲回（30101）'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_immutable ON payment;
CREATE TRIGGER trg_payment_immutable BEFORE UPDATE ON payment
  FOR EACH ROW EXECUTE FUNCTION wy.deny_payment_mutation();

-- ------------------------------------------------------------
-- 收款分摊：一笔钱付多张账单（原型缺这张表）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_allocation (
  id          bigserial   PRIMARY KEY,
  tenant_id   bigint      NOT NULL,
  payment_id  bigint      NOT NULL REFERENCES payment(id),
  bill_id     bigint      NOT NULL REFERENCES bill(id),
  period      char(7)     NOT NULL,           -- 冗余账单账期，三率查询免 join
  item_id     bigint      NOT NULL,           -- 冗余科目，收支分项免 join
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payment_id, bill_id)
);
CREATE INDEX IF NOT EXISTS ix_alloc_bill   ON payment_allocation (tenant_id, bill_id);
CREATE INDEX IF NOT EXISTS ix_alloc_period ON payment_allocation (tenant_id, period, item_id);
CREATE INDEX IF NOT EXISTS ix_alloc_pay    ON payment_allocation (tenant_id, payment_id);

COMMENT ON TABLE payment_allocation IS
  '收款分摊。平衡约束：Σamount = payment.amount − 预收部分（应用层事务保证，daily-check 校验）';

-- ------------------------------------------------------------
-- 预付余额（客户账上的钱 = 负债）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prepay_account (
  id          bigserial   PRIMARY KEY,
  tenant_id   bigint      NOT NULL,
  house_id    varchar(24) NOT NULL,
  owner_id    varchar(16),
  balance     numeric(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, house_id)
);

CREATE TABLE IF NOT EXISTS prepay_flow (
  id          bigserial   PRIMARY KEY,
  tenant_id   bigint      NOT NULL,
  account_id  bigint      NOT NULL REFERENCES prepay_account(id),
  direction   char(1)     NOT NULL CHECK (direction IN ('I','O')),   -- 入账/抵扣
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_id  bigint,                          -- 入账时关联收款
  bill_id     bigint,                          -- 抵扣时关联账单
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_prepay_flow ON prepay_flow (tenant_id, account_id, occurred_at DESC);

-- ------------------------------------------------------------
-- 押金（负债，三向流水）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deposit (
  id             bigserial    PRIMARY KEY,
  tenant_id      bigint       NOT NULL,
  deposit_no     varchar(24)  NOT NULL,
  type_id        varchar(16)  NOT NULL,        -- 装修/门禁卡/租金…（dict_item）
  community_id   varchar(16)  NOT NULL,
  house_id       varchar(24),
  owner_id       varchar(16),
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),   -- 应收押金
  balance        numeric(14,2) NOT NULL DEFAULT 0,            -- 物化：ΣI − ΣO − ΣD
  status         varchar(12)  NOT NULL DEFAULT '待收'
                 CHECK (status IN ('待收','在账','部分退还','已结清','已没收')),
  start_date     date         NOT NULL,
  plan_end_date  date,
  closed_at      timestamptz,
  remark         varchar(200),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  version        integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, deposit_no),
  FOREIGN KEY (tenant_id, community_id) REFERENCES community(tenant_id, community_id)
);

CREATE INDEX IF NOT EXISTS ix_deposit_house ON deposit (tenant_id, house_id);
CREATE INDEX IF NOT EXISTS ix_deposit_status ON deposit (tenant_id, community_id, status);

CREATE TRIGGER trg_deposit_touch BEFORE UPDATE ON deposit
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

CREATE TABLE IF NOT EXISTS deposit_txn (
  id          bigserial   PRIMARY KEY,
  tenant_id   bigint      NOT NULL,
  deposit_id  bigint      NOT NULL REFERENCES deposit(id),
  direction   char(1)     NOT NULL CHECK (direction IN ('I','O','D')),
              -- I 收（负债增加）/ O 退（负债减少）/ D 扣（负债转收入）
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  method      varchar(16),
  pay_point   varchar(16),
  occurred_at timestamptz NOT NULL,           -- 影响日结的现金流
  reason      varchar(200),                   -- D 向扣款必须写
  ref_no      varchar(24),
  operator_id varchar(16),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_deposit_deduct_reason
    CHECK (direction <> 'D' OR (reason IS NOT NULL AND length(btrim(reason)) >= 4))
);
CREATE INDEX IF NOT EXISTS ix_deposit_txn_time ON deposit_txn (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_deposit_txn_dep  ON deposit_txn (tenant_id, deposit_id, occurred_at);

-- 押金流水只增不改
DROP TRIGGER IF EXISTS trg_deposit_txn_immutable ON deposit_txn;
CREATE TRIGGER trg_deposit_txn_immutable BEFORE UPDATE OR DELETE ON deposit_txn
  FOR EACH ROW EXECUTE FUNCTION wy.deny_mutation();

COMMENT ON TABLE deposit_txn IS
  '押金三向流水。恒等式：deposit.balance = ΣI − ΣO − ΣD（daily-check 校验）';

-- ------------------------------------------------------------
-- 发票（原型只有 invoiceNo 字段）
-- 一票多单：交 12 个月物业费开一张票，对应 12 张账单
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice (
  id           bigserial    PRIMARY KEY,
  tenant_id    bigint       NOT NULL,
  invoice_no   varchar(32),
  invoice_type varchar(16)  NOT NULL
               CHECK (invoice_type IN ('增值税普通发票','增值税专用发票','电子发票')),
  title_type   varchar(8)   NOT NULL CHECK (title_type IN ('个人','单位')),
  title        varchar(80)  NOT NULL,
  tax_no       varchar(24),
  amount       numeric(14,2) NOT NULL,          -- 价税合计
  tax_amount   numeric(14,2) NOT NULL DEFAULT 0,
  status       varchar(12)   NOT NULL DEFAULT '待开'
               CHECK (status IN ('待开','已开','已红冲','已作废')),
  issued_at    timestamptz,
  channel      varchar(16),                     -- 税务UKey/百望/航信
  red_against  bigint,                          -- 红冲的原始发票
  remark       varchar(200),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  version      integer       NOT NULL DEFAULT 1,
  CONSTRAINT ck_invoice_taxno CHECK (title_type <> '单位' OR tax_no IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_invoice_no ON invoice (tenant_id, invoice_no)
  WHERE invoice_no IS NOT NULL;

CREATE TRIGGER trg_invoice_touch BEFORE UPDATE ON invoice
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

CREATE TABLE IF NOT EXISTS invoice_item (
  id         bigserial    PRIMARY KEY,
  tenant_id  bigint       NOT NULL,
  invoice_id bigint       NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  bill_id    bigint,
  payment_id bigint,
  item_name  varchar(40)  NOT NULL,
  tax_rate   numeric(5,2) NOT NULL,
  amount     numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_invoice_item_ref
    CHECK (bill_id IS NOT NULL OR payment_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_invoice_item ON invoice_item (tenant_id, invoice_id);
