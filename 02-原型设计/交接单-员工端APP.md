# 员工端 APP 交接单

> **用途**：PC 管理后台（`03-原型`）已达交付状态，员工端 APP 另开任务。
> 新任务**先读本文**，再动手。本文是 PC 端与新任务之间唯一的交接物——
> 对话上下文不跨任务继承，文件与 `.workbuddy/memory/` 继承。
>
> **写于**：2026-10-31 上午 · 对应 PC 端第 42 批收尾状态

---

## 一、这个任务要做什么

做一套**员工端 App 高保真原型**（不接真后端），陪 PC 端一起用于方案评审。
**不是把 PC 页面缩小**：手机上的三个硬约束是单手操作、信号差/断网、相机留证，原型必须体现它们。

**P0 范围**（本任务第一里程碑）：一线员工 + 班组长两类人，跑通一条主线——

```
今日任务 → 接单 → 开工打卡 → 逐项判定 → 不达标拍照+说明 → 提交
                                      └→ 异常转单（生成工单）
```

---

## 二、开工前必读（按顺序，读完再写代码）

| 顺序 | 文件 | 读它为了 |
|---|---|---|
| 1 | 本文 | 范围、约定、验收 |
| 2 | `02-原型设计/README.md` 第「六」章 P0–P2 巡检体系那几节 | 两类任务（执行/监督）的职责边界、PC 与移动端分工 |
| 3 | `04-契约/openapi.yaml` 的 `inspect` / `workorders` / `notices` 段 | 接口形状，移动端只消费不新增业务规则 |
| 4 | `03-原型/src/api/inspect.js`（40 行） | 可复用的执行接口签名 |
| 5 | `03-原型/src/views/f/InspectExec.vue` | **移动端作业台的 PC 预览**，交互已跑通过一次，直接抄结构 |
| 6 | `.workbuddy/memory/2026-10-30.md`、`2026-10-31.md` | 最近两天的决策与踩过的坑 |

---

## 三、可直接复用的资产（这是本项目最大的省力点）

### 3.1 数据（`03-原型/src/mock/`，40 张表，一份数据两处引用）

| 表 | 量 | 移动端用途 |
|---|---|---|
| `inspectTasks.json` | **306**（执行 240 / 监督 66）；已完成 217 / 待执行 40 / 执行中 20 / 逾期 17 / 已转工单 12 | 今日任务、我的任务、超时 |
| `inspectTemplates.json` | 16（12 执行 + 4 监督） | 逐项判定的表单来源 |
| `inspectPlans.json` | 23 | 只读（排班依据） |
| `workOrders.json` | 150 | 工单处理、异常转单的结果 |
| `notices.json` | 106 | 消息/公告 |
| `employees.json` | 120 | 登录人、责任员工候选、班组成员 |
| `attendance.json` | 315（人×月） | 考勤（P2） |
| `orgs.json` / `roles.json` / `permissions.json` | 21 / 15 / 72 | 组织与权限判定 |
| `communities.json` | 3（翡翠城 / 锦绣家园 / 星光天地） | 项目切换 |

### 3.2 业务函数（`03-原型/src/utils/api.js`，**不要重写规则**）

| 函数 | 作用 | 备注 |
|---|---|---|
| `submitInspectResult(taskId, payload)` | 提交执行结果（唯一入口） | 内部校验「监督任务不合格项必须指定责任员工」并写回 `issueItems` / `hitEmployees` / 冲突标记；http 模式对应 `POST /inspect-tasks/{id}/submit` |
| `inspectExecData(taskId)` | 执行页聚合数据（模板 + 任务 + 责任员工候选） | **契约里还没有这个聚合接口**，移动端专用，后续要补 `GET /mobile/tasks/{id}/exec` |
| `inspectSummary(communityId)` | 巡检 KPI（total/done/overdue/toWo/issueRate/avgScore） | 首页「本月完成率」必须调它，**页面不许自己 reduce** |
| `getInspectTaskDetail(taskId)` / `queryInspectTasks({...})` | 任务详情 / 列表 | 已有契约 |
| `createWorkOrder` / `updateWorkOrderField` / `getWorkOrder` | 工单（异常转单就是 create） | `src/api/workorders.js` |

### 3.3 视觉（`03-原型/src/styles/tokens.css`）

只拷 `--biz-*` 变量（主色 `#5b6cff`、辅色 `#2ed9a3`、渐变 `--biz-gradient`、文字三级灰、圆角），
**不要拷** `--el-color-*`（那是 Element Plus 的）和 `--layout-min-w`（PC 布局变量，手机上没意义）。

### 3.4 权限码（移动端只做「能不能进 / 能不能点」，不新增）

`f.inspect.view` / `f.inspect.exec`（执行）/ `f.inspectTasks.view` / `f.workorders.view` `f.workorders.edit` /
`f.woDetail.view` / `f.rectify.view` `f.rectify.edit` / `f.supFinding.view` / `a.sensitive.view`（敏感字段揭示）/
`c.payroll.view`（工资条，P2）/ `e.downloads.view`

> 角色对照：一线 = 环境保洁 / 秩序维护员 / 工程维修 / 客服专员；班组长 = 部门经理（四个主管岗）。

---

## 四、明确不做（写进页面注释，防止后来者顺手加）

- 报表、模板配置、计划编排、角色权限矩阵、组织维护 —— **全部留在 PC**
- 账单/收费/月结/税务 —— 移动端不碰钱
- 代填他人任务 —— 后台已刻意移除执行入口，移动端同理：只能做自己的
- 业主端功能（缴费/报事/投票）—— **另一个任务**，别混进来

---

## 五、技术栈与工程约定

### 5.1 选型

- **uni-app + Vue 3**（`npx degit dcloudio/uni-preset-vue#vite`，JS 模板，与 PC 原型同为 JS 不用 TS）
- **不用 Element Plus**，也不用重 UI 库；手写移动端基础件（≈10 个）：`Cell` / `ActionSheet` / `TabBar` / `Steps` / `PhotoPicker` / `Empty` / `Toast` / `Sheet` / `Tag` / `NavBar`
- 演示跑 **H5**（`npm run dev:h5`），`manifest.json` 保留 App 配置；不做真机打包

### 5.2 目录约定

```
05-员工端APP/
  src/
    pages/          一屏一个页面（uni-app 默认约定）
    components/     移动端基础件
    mock/           → 见 5.3
    styles/tokens.css   （只含 --biz-*）
    utils/          与 PC 同名的 format/perm 小工具（可拷可简化）
  pages.json        页面栈 + tabBar（uni-app 的"路由"，不是 vue-router）
  manifest.json     应用配置（appid 留空，H5 可跑）
  vite.config.js    alias + server.fs.allow（见 5.3）
```

### 5.3 mock 共享（二选一，**默认选 A**）

**A. 软链接式引用（推荐，永远一份数据）**

```js
// vite.config.js
import { fileURLToPath, URL } from 'node:url'
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@pc': fileURLToPath(new URL('../03-原型/src', import.meta.url))  // 只读引用
    }
  },
  server: { fs: { allow: ['..'] } }
})
```

用法：`import { inspectTasks } from '@pc/mock'`、`import { inspectSummary } from '@pc/utils/api'`。
前提：**PC 端数据不再变动**。若 PC 还要改数据，改用 B。

**B. 拷贝一份 + 一致性检查**：把 `03-原型/src/mock` 拷到 `src/mock`，并写一条检查脚本比对 md5
（PC 端已有 `scripts/check.mjs` 的"双份 mock 一致"可照抄）。

### 5.4 uni-app 特有注意（这几条不知道会白干半天）

| 坑 | 说明 |
|---|---|
| 没有 vue-router | 路由是 `pages.json` + `uni.navigateTo/redirectTo/switchTab`，页面栈语义不同，别照搬 PC 的 router 结构 |
| 尺寸用 rpx | 750 设计稿基准；`1rpx = 屏宽/750`。设计稿按 375 宽画时，数值 ×2 写 rpx |
| tabBar 在 `pages.json` 里 | 不是组件；图标要先备好（可用纯色 PNG 或字体图标，原型阶段可先只写文字） |
| 无 DOM 自由操作 | 不要写 `document.querySelector`；相机/相册/扫码用 `uni.chooseImage` / `uni.scanCode` |
| H5 下扫码不可用 | `uni.scanCode` 在 H5 无实现 → 必须做降级：手动输入编号 |
| H5 路由模式 | `manifest.json` 里 `h5.router.mode = 'hash'`，否则刷新 404 |
| 多屏预览 | 想在浏览器里"一屏一个手机框并排看"，用 iframe 嵌 `/#/pages/xxx/xxx` —— 建议另做一个 `preview.html` 画廊页，不塞进 App |

---

## 六、P0 页面清单（10 屏）

| # | 页面 | 关键交互 |
|---|---|---|
| 1 | 登录/选角色 | 原型用：选角色即登录（对齐 PC 顶栏"以某角色查看"） |
| 2 | 首页 | 今日任务数 / 待接单 / 超时（红）；`inspectSummary` 取数 |
| 3 | 任务列表 | 待执行 / 执行中 / 已完成；按日期分组；超时置顶 |
| 4 | 任务详情 | 模板项预览、位置、截止时间、被检班组（监督任务） |
| 5 | 开工打卡 | 时间 + 定位；**信号弱时给出降级提示**（"无法定位，将记为人工打卡，需主管复核"） |
| 6 | 逐项执行 | 达标/不达标开关；不达标 → 拍照 + 选原因 + 说明（原因取 `INSPECT_ISSUE_REASONS`） |
| 7 | 监督核验 | 部门经理专属：被检岗位/班组 + **问题项必须指定责任员工**（漏选要拦） |
| 8 | 提交结果 | 完成 X/Y 项、异常 N 项、得分；提交后回首页 |
| 9 | 异常转单 | 类型/紧急度/描述（带图）→ 生成工单 → 显示工单号 |
| 10 | 我的 | 本月完成率、待办、消息、账号 |

**必须有但最容易漏的三态**：断网（本地暂存 + 待同步标记）、拍照/无相机（占位图 + 说明）、
超时（卡片上直接给剩余时间，不要只写状态）。

---

## 七、验收与自检

1. `npm run build:h5` 通过
2. 10 屏全部渲染，**零 console 错误**（照抄 PC 的 `scripts/e2e/smoke.mjs` 思路，用 puppeteer 逐屏截图）
3. 主线可点通：首页 → 任务 → 打卡 → 逐项 → 提交 → 转单，一条脚本跑完
4. **与 PC 数字对得上**（新增检查，很重要）：同一份 mock 下抽 3 个数比对——
   - 巡检任务总数 **306**、待执行 **40**、执行中 **20**
   - 员工 **120**
   - 公告 **106**
   两边不一致说明有人各算了一套
5. 口径自检：`inspectSummary` 的 done/overdue 与 PC `/f/inspect-tasks` 列表筛选结果一致

---

## 八、已定口径（照做，不要重新设计）

| # | 口径 | 为什么 |
|---|---|---|
| 1 | **两类任务**：执行（一线自查）/ 监督（班组长查下属） | 考核归口不同，混了达标率就算错部门 |
| 2 | **监督任务不合格项必须指定责任员工** | 不指定，问题归不到人，考核扣不到谁头上 |
| 3 | 归属靠 `executorOrgId`（数据里显式存），**不靠姓名反查员工表** | PC 端踩过：靠姓名反查导致"本部门"过滤后剩 0 条 |
| 4 | 首页/列表的 KPI 一律调数据层函数，页面不 reduce | PC 端统一纪律，否则列表一个数、看板另一个数 |
| 5 | 敏感字段默认脱敏，看明文要 `a.sensitive.view` 且写访问日志 | 员工看业主手机号同样留痕 |
| 6 | 写操作在原型里是内存态，刷新还原 | 与 PC 一致，避免"演示完数据脏了" |

---

## 九、开工顺序（照着做，别一上来画十个页面）

1. **初始化工程**：`05-员工端APP/` 用 uni-app CLI 建，跑通 `dev:h5` 出现 Hello 页
2. **接 tokens + mock**：`@pc` alias 通，首页能打印出 `inspectTasks.length === 306`
3. **设备框与 tabBar**：先做 3 个空白 Tab（任务 / 消息 / 我的），确认 H5 下 tabBar 正常
4. **主线五屏**：任务列表 → 详情 → 打卡 → 逐项 → 提交（先不做拍照，用占位）
5. **补齐三态**：断网 / 拍照 / 超时；再补异常转单与监督核验（第 6、7 屏）
6. **截图自检脚本 + 数字对齐检查**，跑通再交

---

## 十、给新任务的第一句话（可直接粘贴）

> 读 `02-原型设计/交接单-员工端APP.md`，按里面的 P0 范围开工：
> 在 `05-员工端APP/` 用 uni-app（Vue3 + Vite，JS 模板）建工程，复用 `03-原型` 的 mock 与 `--biz-*` tokens
> （`@pc` alias 只读引用），先跑通「任务列表 → 详情 → 打卡 → 逐项执行 → 提交」五屏，
> 再补断网/拍照/超时三态。不要引入 Element Plus，不要照搬 vue-router。
