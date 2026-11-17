# 收费域数据访问层（backend/）

> 2026-11-18 · 阶段 1 第一条任务 · 对应 `08-开发设计/05-后端交接单.md` §四
> 范围：**只做数据访问层，不做接口层**。没有 Controller，没有 web starter。

## 一、这一版做完了什么

四条查询全部跑通，结果与 psql 手工查询**逐分一致**：

| # | 查询 | 基线（对账用） | 状态 |
|---|---|---|---|
| 1 | 三率（按项目、按账期） | 星光天地 85.06% / 翡翠城 81.67% / 锦绣家园 84.42%（2026 全年）；合计 83.73% / 4,308 张 | ✅ |
| 2 | 账龄分档（未结清按 due_date） | 1-30 天 525 张 152,236.02 · 31-90 天 223 张 65,949.10 · 91-180 天 3 张 1,047.62 · 180 天+ 2 张 723.83 | ✅ |
| 3 | 日结（按 paid_at 分日） | 2026-08-06：35 笔 12,866.46 / 现金 240.00；区间合计 3,619 笔 1,192,152.20，**差额 0** | ✅ |
| 4 | 押金三向流水 | 352 笔，Σbalance = ΣI − ΣO − ΣD = 665,637.00，**差额 0** | ✅ |

验收对照（交接单 §四）：

```
☑ 四条查询结果与 psql 手工查询完全一致（95 个测试，0 失败）
☑ 接口层第一批：三率 / 账龄 / 押金台账 / 账单列表按契约出字段，401/403/400 语义有测试
☑ 连接串用 wy_app；每个事务开头 set_config('app.tenant_id', ?, true)
☑ 单元测试覆盖：金额舍入 / 跨年账期 / 零面积 / 全额减免
☑ 未写任何 DDL（表结构一行未动）
```

## 二、怎么跑

```bash
# 0. 一次性把工具链挂到当前 shell（不改 ~/.zshrc）
source backend/dev-env.sh

# 1. 起库（若还没起）
cd 08-开发设计 && docker compose up -d
./sql/run-all.sh && ./sql/migrate/run-migrate.sh

# 2. 跑测试（JDK 17 装在 ~/.jdks；Maven 用仓库自带 wrapper，版本锁在 .mvn/wrapper）
./backend/run-tests.sh

# 3. 手工复核基线（同一套 SQL，用于和后端输出对账）
./backend/verify/run-baseline.sh
```

本机没有 Homebrew，JDK 与 Maven 是直接解压安装的：

| 项 | 路径 | 版本 |
|---|---|---|
| JDK | `~/.jdks/jdk-17.0.21+9/Contents/Home` | Temurin 17.0.21 |
| Maven（仓库自带 `mvnw`） | `.mvn/wrapper/maven-wrapper.properties` | 3.9.16 |
| Maven（全局备用） | `~/.tools/apache-maven-3.9.16` | 3.9.16 |

`run-tests.sh` 的查找顺序：`JAVA_HOME` 环境变量 → `~/.jdks` 默认路径；Maven 优先用 `./mvnw`，再退全局。
换机器只需装 JDK 17，Maven 由 wrapper 自动拉。

## 三、目录

```
backend/
├── pom.xml                       Spring Boot 3.2.12 / Java 17 / MyBatis 3.0.3
├── mvnw / .mvn/wrapper/          Maven Wrapper（3.9.16 锁定）
├── dev-env.sh                    source 一次即挂好 JAVA_HOME / PATH
├── run-tests.sh                  验收入口（mvn test）
├── verify/
│   ├── four-queries.sql          四条查询的手工基线（与实现同口径）
│   └── run-baseline.sh           在 wy-pg 上跑上面的 SQL
└── src/
    ├── main/java/com/wy/property/
    │   ├── common/tenant/        TenantContext + TenantTransactionTemplate（SET LOCAL）
    │   ├── common/money/         Money：一律按分比较、HALF_UP 舍入
    │   ├── common/period/        PeriodRange：账期闭区间，跨年可用
    │   ├── common/error/         ForbiddenException（→ 403）
    │   ├── config/               RlsStartupGuard + Jackson（BigDecimal 平铺）
    │   ├── auth/                 JWT 签发/校验、请求过滤、数据范围
    │   ├── web/                  统一响应封套、错误码映射
    │   └── billing/
    │       ├── collection/       三率
    │       ├── aging/            账龄
    │       ├── settlement/       日结
    │       ├── deposit/          押金：三向流水 + 现金台账 + 收退政策校验
    │       ├── community/        CommunityGuard：项目归属校验（越权 403）
    │       └── report/           报表接口：/reports/aging-live、/reports/deposit-ledger
    ├── main/resources/mapper/billing/*.xml   手写 SQL
    └── test/java/...             4 个算法单测 + 7 个连真库/政策测试 + 1 个接口黑盒测试
```

## 四、五个必须知道的实现决定

### ① 租户只能通过 `TenantTransactionTemplate` 设，且必须是事务级

```java
tenantTx.execute(() -> mapper.selectByCommunity(...));   // 内部：开事务 → set_config(..., true) → 执行
```

- `set_config('app.tenant_id', ?, true)` 等价 `SET LOCAL`，事务结束自动失效。
- 连接池 `autoCommit=false`，否则 `SET LOCAL` 当场失效。
- **会话级 `SET` 一律禁止**：连接归还池子后，下一个请求会带着上一个租户的 ID。
  测试 `pooledConnectionDoesNotLeakTenant` 专门守这条（tenant1 → tenant2 → tenant1）。

### ② 启动就拦住超级用户

`RlsStartupGuard` 连上库先看 `rolsuper`。是超级用户直接抛异常、拒绝启动。

原因见 `01-数据库设计.md` §2.3b：超级用户永远绕过 RLS，**而且不报错**。
用 `wy` 跑业务，所有隔离用例都会假通过。

同时也校验 `search_path` 含 `wy`——`wy_app` 默认 `search_path` 是 `"$user", public`，
不设就是一堆 `relation does not exist`。

### ③ 金额比较一律转整数分

```java
Money.compare(a, b)   // 内部转 cents，不用 doubleValue
```

这不是洁癖：迁移时 `210.64 >= 300.92 - 90.28` 在 double 下是 `false`，
15 张账单被误判成部分缴。`MoneyTest` 里留了这条回归。

### ④ 日结按营业日切日，时区钉死 Asia/Shanghai

`paid_at` 是 `timestamptz`。按机器时区切日，服务器在 UTC 时整天的账会错位到前一天。
SQL 里显式 `(paid_at AT TIME ZONE 'Asia/Shanghai')::date`，区间用左闭右开的
`Asia/Shanghai` 零点，不用 `payment.period`（那是三率口径，跨期缴费时两者不同）。

### ⑤ 账龄五档恒定输出，基准日必传

- SQL 用 `VALUES` 先建 5 档再 `LEFT JOIN`，空档补 0、顺序固定。
  在应用层补空档容易漏档，顺序还依赖调用方。
- 基准日由入参传入（`AgingRepository.query(referenceDate, communityId)`），
  不隐式用 `now()`——否则昨天的报表明天复算不出来。
- `未到期` 单独一档：还没到期不是欠费，混进 1-30 天会让催缴名单虚高。

## 五、接口层（第一批：报表读接口）

第一次开 HTTP，只开两条报表读接口。**不造端点、不硬套现有模型**——路径与字段严格按
`04-契约/openapi.yaml`。

| 方法 | 路径 | 数据来源 | 契约 schema |
|---|---|---|---|
| GET | `/reports/three-rate` | `ThreeRateRepository.query` | `ThreeRate` |
| GET | `/reports/aging-live` | `AgingRepository.queryLive` | `AgingLive` |
| GET | `/reports/deposit-ledger` | `DepositLedgerRepository.query` | `DepositLedger` |
| GET | `/reports/daily-revenue` | `DailyRevenueRepository.query` | `DailyRevenue`（三段 + 七格 + 差额） |
| GET | `/bills` | `BillRepository.query` | `BillPage`（分页 + 筛选） |

```bash
# 本地拿一个令牌（正式登录接口 /auth/login 在下一批）
TOKEN=$(... JwtService.issue(1, "u-gm", "gm", null) ...)
curl "localhost:8080/reports/aging-live?asOf=2026-11-18" -H "Authorization: Bearer $TOKEN"
curl "localhost:8080/reports/deposit-ledger?from=2026-01-01&to=2026-12-31" -H "Authorization: Bearer $TOKEN"
```

### 统一约定

| 项 | 约定 |
|---|---|
| 成功 | `{code:0, message:"ok", data:{...}}` |
| 错误 | `{code:40001/40101/40301/40914, message, traceId}`，与契约 `ErrorResponse` 一致 |
| 认证 | `Authorization: Bearer <JWT HS256>`，claims：`tid`（租户）、`sub`（用户）、`role`、`cid`（项目范围） |
| 租户 | 过滤器解析令牌后写 `TenantContext`，请求结束 **clear**（线程池复用会串租户） |
| 数据范围 | `AccessScope.resolveCommunity`：有范围的角色不传 `communityId` 时收敛到自己项目，不放开成全租户 |
| 金额 | `BigDecimal` 平铺序列化（不开这条会出 `3.2239E+2`） |

### 已知缺口（按契约，不猜）

| 缺口 | 说明 | 处理 |
|---|---|---|
| 三率的 `receivable` 口径 | 契约写"面积 × 单价 × 期数（不看开单）" | **已按理论应收实现**（2026-11-18 确认）。库里价目只有"住宅"，商业 120 户 / 公寓 44 户没有价目 → 单列 `pricingGaps`，不参与合计与收缴率 |
| 三率缺 `prepayRate` / `prepayReceivable` | 预缴率 = 归属期 > T2 的已收 ÷ 其应收；分母要"未来账期应收" | 分子已有（`prepayReceived`），分母要定预收展望期（矩阵铺到 2027-12），下一批补 |
| 水电/固定费用不进三率 | 《费用与财务体系》批 3：水电按用量，抄表前无应收 | 已用 400 拒绝（`itemId=FI05/FI06/FI08` 会报"不参与三率"），不静默给 0 |
| 押金收退写接口未开 | `/deposits/{id}/refund`、`/deposits/{id}/check` | 两步流程（审批 → 待打款）缺一张 `deposit_refund` 表，且 `deposit.status` 的 CHECK 不含"待退款"。状态机已实现为 `DepositRefundFlow`（8 条单测），DDL 见 `06-押金现金与日结口径建议.md` §7.4 |
| 无 `/auth/login` | 本期令牌由 `JwtService` 直接签发，供测试与联调 | 下一批接登录 + Redis 黑名单 |

## 六、与现有文档不一致的地方（以库为准，已核对）

| 项 | 文档写的 | 库里实际 | 处理 |
|---|---|---|---|
| `deposit` 是否有 `deleted_at` | `01-数据库设计` §4.7 的 DDL 没写，文档未提 | **没有这一列** | 押金不软删，靠 `status` 收口；SQL 去掉该条件 |
| `payment_allocation` 行数 | `sql/migrate/README.md`：3,682 | **3,619** | 与 3,619 笔"正常"收款一一对应；`daily-check` 第 7/8 段仍 0 行，以库为准 |
| `deposit_txn` 构成 | 352 收 / 212 退 / 71 扣 | **352 / 226 / 57**（合计 635 笔不变） | 恒等式差额 0，以库为准 |
| 收款状态构成 | 未写 | 4,070 笔 = 3,619 正常 + **451 已冲红** | 日结只算"正常"，已冲红不计 |
| 账龄档位标签 | 契约 `0-30天`；`01-数据库设计` 与迁移 README 写 `1-30天` | 档界都是 0–30 天，只是标签不同 | **已按契约改**：枚举、SQL、测试、基线文字统一成 `0-30天` |
| 押金状态枚举 | 契约 7 态（有"待退款"，无"待收/部分退还/已结清"）；DDL 9 态 | 库里在用 6 种（在押/装修中/部分扣除/已逾期/已退还/已没收） | **未合并**：写接口（退款/验收）前必须先定 9↔7 映射，本次不猜 |
| `/reports/aging-live` 分档 | 同接口 description 写 6 档（多了 31-60 / 61-90）；schema 枚举与 mock 都是 5 档 | 实现按 5 档 | 建议改 description，别改实现——否则前后端全要改 |
| 日结口径 | 契约 `/reports/daily-revenue` 差额含押金；`SettlementRepository` 的现金交班只算 `payment` | 是两张报表，不是一个口径 | **已确认（2026-11-18）：差额对"收款点全方式"**。日报按此实现；抽屉现金看"现金 / 车辆现金"两格 |

后两条数据差异建议在下次迁移时回写 `sql/migrate/README.md`（本次不动 `sql/` 的建表脚本）。

## 七、已知限制 / 下一步

| 项 | 说明 |
|---|---|
| 押金：一次性固定金额 | 押金与面积/价目无关（装修 3000 / 门禁卡 50 / 非机动车牌 20），不参与三率、不参与应收矩阵；只作负债台账与日结往来款 | 见《开发计划-费用与财务体系》§11.4 |
| 押金：口径已定，日结不并入 | 2026-11-18 确认：禁止收现金押金、退款必须原路且退原付款人、押金不开票（增值税会计线下补录）。押金现金流 100% 非现金，**不进日结抽屉**。已实现 `DepositPolicy` + `DepositPolicyAuditRepository` + `DepositStatus`（9↔7 映射）+ `DepositRefundFlow`（审批→待打款→已打款）。数据已修正 45 笔"部分扣除（余额 0）"→"已退还"。结构缺口：`deposit_refund` 表、`deposit.status` CHECK 增"待退款"、`deposit` 缺 `payer_id`、`deposit_txn` 缺账户与税额字段 |
| 没有接口层 | 本期刻意不做。下一步接 `04-契约/openapi.yaml` 的 billing 段时，`ForbiddenException` → 403、`TenantNotSetException` → 401/500 的映射在 `@RestControllerAdvice` 里做 |
| 跨租户 403 的落点 | 现在是 `CommunityGuard` 抛 `ForbiddenException`（数据范围在仓储层强制）。Controller 不许再判断一遍 |
| Flyway 未接 | 表结构仍靠 `sql/*.sql`。接 Flyway 时第一条迁移从 `sql/00-init.sql` 起、按域拆 |
| 无 CI | 建议把 `./backend/run-tests.sh` + `sql/daily-check.sql` 挂到每日 06:00 |

## 八、给下一个人

**先跑 `./backend/run-tests.sh`。** 95 个测试里，凡是数字对不上，先看是"代码错"还是"数据变了"：

- 三率/账龄/日结/押金四条基线都写在测试里，是**硬编码的快照**（基准日固定 2026-11-18）。
  数据再迁一次，这些数字会变——那时要更新的是基线，不是放宽断言。
- 不许为了让测试变绿去改 `<=` 为 `<`。差一分钱就是错，财务系统里没有"差不多"。
