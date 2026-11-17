-- ============================================================
-- 01 · 租户与空间域
-- 主数据用「业务码」做主键（H010110101 / P01），不用自增
-- 理由：这些码来自外部系统（门禁、停车、政府报表），换自增 ID 要多一层映射
-- 交易数据（账单/流水）才用 bigserial + 业务单号
-- ============================================================
SET search_path TO wy, public;

-- ------------------------------------------------------------
-- 租户（物业公司）—— 多租户的根
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant (
  id             bigserial    PRIMARY KEY,
  code           varchar(32)  NOT NULL UNIQUE,
  name           varchar(80)  NOT NULL,
  -- 私有化/独立库路由键；单库部署恒为 main
  datasource_key varchar(32)  NOT NULL DEFAULT 'main',
  status         varchar(12)  NOT NULL DEFAULT '启用'
                 CHECK (status IN ('启用','停用')),
  expire_at      date,                                  -- 授权到期（私有化 license）
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE  tenant IS '物业公司。多租户隔离的边界；不是小区，小区在 community';
COMMENT ON COLUMN tenant.datasource_key IS '预留：大客户独立库路由键，单库部署恒为 main';

CREATE TRIGGER trg_tenant_touch BEFORE UPDATE ON tenant
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- 员工与租户是多对多（一个人可能服务多家物业公司）
CREATE TABLE IF NOT EXISTS tenant_user (
  id         bigserial   PRIMARY KEY,
  tenant_id  bigint      NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  emp_id     varchar(16) NOT NULL,
  is_default boolean     NOT NULL DEFAULT false,
  status     varchar(12) NOT NULL DEFAULT '在职'
             CHECK (status IN ('在职','离职')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, emp_id)
);

-- ------------------------------------------------------------
-- 项目（小区）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community (
  tenant_id     bigint       NOT NULL REFERENCES tenant(id),
  community_id  varchar(16)  NOT NULL,
  name          varchar(80)  NOT NULL,
  short_name    varchar(40),
  address       varchar(200),
  -- 面积与户数：费用分摊的基数来源；house 建完由定时任务回写校准
  build_area    numeric(12,2) NOT NULL DEFAULT 0,
  house_count   integer       NOT NULL DEFAULT 0,
  park_count    integer       NOT NULL DEFAULT 0,
  -- 水电形态：none 不管 / card 插卡预充 / meter 抄表计费
  elec_mode     varchar(8)   NOT NULL DEFAULT 'none'
                CHECK (elec_mode IN ('none','card','meter')),
  water_mode    varchar(8)   NOT NULL DEFAULT 'none'
                CHECK (water_mode IN ('none','card','meter')),
  manager_emp_id varchar(16),
  status        varchar(12)  NOT NULL DEFAULT '在管'
                CHECK (status IN ('在管','已撤场','筹备')),
  handover_date date,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  version       integer      NOT NULL DEFAULT 1,
  deleted_at    timestamptz,
  PRIMARY KEY (tenant_id, community_id)          -- 复合主键：租户在前，天然带隔离
);
COMMENT ON COLUMN community.build_area IS '建筑面积合计；费用分摊的唯一基数，不是可售面积';

CREATE TRIGGER trg_community_touch BEFORE UPDATE ON community
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- ------------------------------------------------------------
-- 楼栋 / 单元
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building (
  tenant_id     bigint      NOT NULL,
  building_id   varchar(16) NOT NULL,
  community_id  varchar(16) NOT NULL,
  name          varchar(40) NOT NULL,          -- 1栋
  building_type varchar(16),                   -- 高层/洋房/别墅/商业
  floor_count   smallint,
  unit_count    smallint,
  build_area    numeric(12,2),
  sort          smallint    NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  PRIMARY KEY (tenant_id, building_id),
  FOREIGN KEY (tenant_id, community_id) REFERENCES community(tenant_id, community_id)
);

CREATE TABLE IF NOT EXISTS unit (
  tenant_id     bigint      NOT NULL,
  unit_id       varchar(16) NOT NULL,
  community_id  varchar(16) NOT NULL,
  building_id   varchar(16) NOT NULL,
  name          varchar(40) NOT NULL,          -- 1单元
  sort          smallint    NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  PRIMARY KEY (tenant_id, unit_id),
  FOREIGN KEY (tenant_id, building_id) REFERENCES building(tenant_id, building_id)
);

-- ------------------------------------------------------------
-- 房屋
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS house (
  tenant_id       bigint       NOT NULL,
  house_id        varchar(24)  NOT NULL,        -- H010110101
  community_id    varchar(16)  NOT NULL,
  building_id     varchar(16)  NOT NULL,
  unit_id         varchar(16)  NOT NULL,
  room            varchar(16)  NOT NULL,        -- 101
  floor           smallint,
  full_name       varchar(80)  NOT NULL,        -- 翡翠城/1栋/1单元/101
  short_name      varchar(40),

  -- 两个面积都必须存：收费和分摊用建筑面积；跟业主解释用套内面积
  build_area      numeric(10,2) NOT NULL CHECK (build_area > 0),
  inner_area      numeric(10,2) CHECK (inner_area IS NULL OR inner_area > 0),

  usage_type      varchar(8)   NOT NULL DEFAULT '住宅'
                  CHECK (usage_type IN ('住宅','商业','公寓','办公','其他')),
  house_type      varchar(16),                  -- 两室一厅
  orientation     varchar(8),                   -- 南北

  -- 使用状态六态（第 45 批定的口径）
  use_status      varchar(12)  NOT NULL DEFAULT '自住'
                  CHECK (use_status IN ('自住','出租','空置','装修中','待交付','其他')),
  property_status varchar(12)  NOT NULL DEFAULT '产权清晰'
                  CHECK (property_status IN ('产权清晰','产权争议','已抵押','查封')),
  deliver_status  varchar(12)  NOT NULL DEFAULT '已交付'
                  CHECK (deliver_status IN ('未交付','已交付','已收房')),
  deliver_date    date,

  steward_emp_id  varchar(16),                  -- 楼管（责任范围的数据来源）
  decoration_violation boolean NOT NULL DEFAULT false,
  remark          varchar(200),

  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  version         integer      NOT NULL DEFAULT 1,
  deleted_at      timestamptz,
  PRIMARY KEY (tenant_id, house_id),
  UNIQUE (tenant_id, community_id, building_id, unit_id, room),
  FOREIGN KEY (tenant_id, community_id) REFERENCES community(tenant_id, community_id)
);
COMMENT ON COLUMN house.build_area IS '建筑面积：计费与费用分摊的唯一基数';
COMMENT ON COLUMN house.inner_area IS '套内面积：只用于业主端展示，不参与任何计算';

CREATE INDEX IF NOT EXISTS ix_house_tree ON house (tenant_id, community_id, building_id, unit_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_house_steward ON house (tenant_id, steward_emp_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_house_touch BEFORE UPDATE ON house
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- ------------------------------------------------------------
-- 车位（独立表，不并入 house）
-- 理由：无面积、有车牌、有租期、有换绑历史，合表后一半字段永远为空
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking (
  tenant_id     bigint       NOT NULL,
  parking_id    varchar(24)  NOT NULL,
  community_id  varchar(16)  NOT NULL,
  park_no       varchar(24)  NOT NULL,          -- 车位号 B1-018
  zone          varchar(16),                    -- 地下/地面
  park_type     varchar(12)  NOT NULL DEFAULT '标准'
                CHECK (park_type IN ('标准','子母','微型','充电桩','货车')),
  usage_type    varchar(8)   NOT NULL DEFAULT '产权'
                CHECK (usage_type IN ('产权','人防','租赁','公摊')),
  area          numeric(10,2),
  has_charger   boolean      NOT NULL DEFAULT false,
  -- 当前绑定（历史走 parking_change_log）
  owner_id      varchar(16),
  plate_no      varchar(16),
  bind_type     varchar(8)   CHECK (bind_type IN ('产权','月租','临停')),
  expire_date   date,
  status        varchar(12)  NOT NULL DEFAULT '空闲'
                CHECK (status IN ('空闲','已租','已售','停用')),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  version       integer      NOT NULL DEFAULT 1,
  deleted_at    timestamptz,
  PRIMARY KEY (tenant_id, parking_id),
  UNIQUE (tenant_id, community_id, park_no)
);

CREATE INDEX IF NOT EXISTS ix_parking_plate ON parking (tenant_id, community_id, plate_no)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_parking_touch BEFORE UPDATE ON parking
  FOR EACH ROW EXECUTE FUNCTION wy.touch_updated_at();

-- 车位换绑历史（原型有 parking-change-logs，第 88 批口径：换绑有次数上限）
CREATE TABLE IF NOT EXISTS parking_change_log (
  id          bigserial   PRIMARY KEY,
  tenant_id   bigint      NOT NULL,
  parking_id  varchar(24) NOT NULL,
  change_type varchar(12) NOT NULL CHECK (change_type IN ('绑定','解绑','换绑','重置')),
  old_plate   varchar(16),
  new_plate   varchar(16),
  old_owner   varchar(16),
  new_owner   varchar(16),
  reason      varchar(200) NOT NULL,
  operator_id varchar(16),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_parklog ON parking_change_log (tenant_id, parking_id, created_at DESC);
