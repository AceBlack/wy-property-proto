-- ============================================================
-- 02 · 主体域：业主 / 家庭成员 / 承租人 / 租约 / 产权变更
-- 关键：tenant 已被物业公司占用，房屋承租人一律叫 lessee
-- ============================================================
SET search_path TO wy, public;

-- ------------------------------------------------------------
-- 业主
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owner (
  tenant_id      bigint      NOT NULL,
  owner_id       varchar(16) NOT NULL,          -- OW00005
  name           varchar(40) NOT NULL,
  phone          varchar(20) NOT NULL,
  phone_enc      varchar(120),                  -- 加密存储（合规：可解密需授权）
  id_card        varchar(40),
  id_card_enc    varchar(160),
  gender         varchar(4)  CHECK (gender IN ('男','女')),
  owner_type     varchar(12) NOT NULL DEFAULT '个人'
                 CHECK (owner_type IN ('个人','单位')),
  -- 认证与注册
  certified      boolean     NOT NULL DEFAULT false,
  face_registered boolean    NOT NULL DEFAULT false,
  app_registered boolean     NOT NULL DEFAULT false,
  register_date  date,
  -- 画像（第 43 批：25 列核对结果）
  credit_level   varchar(8)  NOT NULL DEFAULT '正常'
                 CHECK (credit_level IN ('优秀','正常','关注','风险')),
  owner_category varchar(16),
  economic_level varchar(16),
  political_status varchar(16),
  wedding_date   date,
  employer       varchar(80),
  job_title      varchar(40),
  occupation     varchar(40),
  work_address   varchar(200),
  hobbies        varchar(200),
  pets           varchar(100),
  positive_notes varchar(500),
  negative_notes varchar(500),
  emergency_contact varchar(40),
  emergency_phone   varchar(20),
  remark         varchar(200),

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer     NOT NULL DEFAULT 1,
  deleted_at     timestamptz,
  PRIMARY KEY (tenant_id, owner_id)
);
COMMENT ON COLUMN owner.phone_enc IS '手机号密文；列表接口只回掩码，明文走揭示接口并留痕';

CREATE UNIQUE INDEX IF NOT EXISTS uk_owner_phone ON owner (tenant_id, phone)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_owner_name ON owner (tenant_id, name)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_owner_touch ON owner;
CREATE TRIGGER trg_owner_touch BEFORE UPDATE ON owner
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- 家庭成员 / 同住人
CREATE TABLE IF NOT EXISTS owner_member (
  tenant_id   bigint      NOT NULL,
  member_id   varchar(16) NOT NULL,
  owner_id    varchar(16) NOT NULL,
  name        varchar(40) NOT NULL,
  phone       varchar(20),
  relation    varchar(16),                      -- 配偶/子女/父母/同住人
  id_card     varchar(40),
  is_resident boolean     NOT NULL DEFAULT true,-- 是否同住
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  PRIMARY KEY (tenant_id, member_id),
  FOREIGN KEY (tenant_id, owner_id) REFERENCES owner(tenant_id, owner_id)
);

-- ------------------------------------------------------------
-- 标签（第 44 批：12 个内置词条，权限三分）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owner_tag (
  tenant_id  bigint      NOT NULL,
  tag_id     varchar(16) NOT NULL,
  name       varchar(24) NOT NULL,
  color      varchar(16),
  is_builtin boolean     NOT NULL DEFAULT false,
  -- 可见范围三分：谁能看、谁能打、谁能删
  visibility varchar(12) NOT NULL DEFAULT '内部'
             CHECK (visibility IN ('公开','内部','敏感')),
  enabled    boolean     NOT NULL DEFAULT true,
  sort       smallint    NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, tag_id)
);

CREATE TABLE IF NOT EXISTS owner_tag_rel (
  tenant_id  bigint      NOT NULL,
  owner_id   varchar(16) NOT NULL,
  tag_id     varchar(16) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by varchar(16),
  PRIMARY KEY (tenant_id, owner_id, tag_id)
);

-- ------------------------------------------------------------
-- 房屋产权关系（含历史）
-- 房子换业主后，历史账单的催缴对象不能跟着变 —— 所以账单里存 owner_id 快照
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS house_owner (
  id          bigserial   PRIMARY KEY,
  tenant_id   bigint      NOT NULL,
  house_id    varchar(24) NOT NULL,
  owner_id    varchar(16) NOT NULL,
  relation    varchar(12) NOT NULL DEFAULT '产权人'
              CHECK (relation IN ('产权人','共有人','承租人','其他')),
  share_ratio numeric(5,2) NOT NULL DEFAULT 100,  -- 产权份额 %
  start_date  date        NOT NULL,
  end_date    date,                               -- NULL = 当前
  reason      varchar(120),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_house_owner_range CHECK (end_date IS NULL OR end_date >= start_date)
);
-- 同一套房同一时刻只能有一个主产权人（份额合计由应用校验）
CREATE UNIQUE INDEX IF NOT EXISTS uk_house_owner_current ON house_owner (tenant_id, house_id, owner_id)
  WHERE end_date IS NULL;
CREATE INDEX IF NOT EXISTS ix_house_owner_house ON house_owner (tenant_id, house_id);

-- ------------------------------------------------------------
-- 承租人（物业口语里的"租户"）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lessee (
  tenant_id    bigint      NOT NULL,
  lessee_id    bigint      GENERATED BY DEFAULT AS IDENTITY,
  lessee_type  varchar(8)  NOT NULL DEFAULT '个人'
               CHECK (lessee_type IN ('个人','公司')),
  name         varchar(80) NOT NULL,
  phone        varchar(20),
  id_card      varchar(40),
  house_id     varchar(24),                     -- 当前承租房（历史在 lease）
  source       varchar(12),                     -- 业主登记/中介/自主
  verify_status varchar(12) NOT NULL DEFAULT '待核验'
                CHECK (verify_status IN ('待核验','已核验','已驳回')),
  certified    boolean     NOT NULL DEFAULT false,
  face_registered boolean  NOT NULL DEFAULT false,
  status       varchar(12) NOT NULL DEFAULT '在租'
               CHECK (status IN ('在租','已退租','已终止')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer     NOT NULL DEFAULT 1,
  deleted_at   timestamptz,
  PRIMARY KEY (tenant_id, lessee_id)
);

-- ------------------------------------------------------------
-- 租约（原型缺这张表）
-- 原型把 leaseStart/leaseEnd/rent 挂在承租人上，一套房租过 5 次就无处存
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease (
  id             bigserial    PRIMARY KEY,
  tenant_id      bigint       NOT NULL,
  lease_no       varchar(24)  NOT NULL,
  house_id       varchar(24)  NOT NULL,
  lessee_id      bigint       NOT NULL,
  owner_id       varchar(16)  NOT NULL,         -- 出租人
  start_date     date         NOT NULL,
  end_date       date         NOT NULL,
  monthly_rent   numeric(14,2) CHECK (monthly_rent IS NULL OR monthly_rent >= 0),
  deposit_amount numeric(14,2),
  -- 租金是否由物业代收（决定要不要生成账单）
  collect_by     varchar(12)  NOT NULL DEFAULT '业主自收'
                 CHECK (collect_by IN ('物业代收','业主自收')),
  status         varchar(12)  NOT NULL DEFAULT '草稿'
                 CHECK (status IN ('草稿','生效','已到期','已终止')),
  terminate_reason varchar(200),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  version        integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, lease_no),
  CONSTRAINT ck_lease_range CHECK (end_date >= start_date),
  FOREIGN KEY (tenant_id, lessee_id) REFERENCES lessee(tenant_id, lessee_id),
  FOREIGN KEY (tenant_id, house_id)  REFERENCES house(tenant_id, house_id)
);

-- 同一套房的有效租约时间区间不能重叠 —— 由数据库强制，应用层写错直接报错
ALTER TABLE lease DROP CONSTRAINT IF EXISTS ex_lease_no_overlap;
ALTER TABLE lease ADD CONSTRAINT ex_lease_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    house_id  WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = '生效');

COMMENT ON CONSTRAINT ex_lease_no_overlap ON lease IS
  '一套房同一时段只能有一份生效租约；退租后再租不冲突（旧约状态非生效）';
