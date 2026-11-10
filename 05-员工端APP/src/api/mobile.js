/**
 * 员工端数据层。
 *
 * 原则（交接单 §3.2 / §八.4）：业务规则不重写，一律调用 PC 端 utils/api.js；
 * 本文件只补三类**移动端专有**的取数：
 *   1) 按「登录人」取任务 —— PC 的 scopeFilter 是「按 PC 角色锚点」算数据范围，
 *      移动端登录的是具体某个人（executor === 本人），语义不同，不能直接复用；
 *   2) 时间三态（剩余 / 超时）—— 移动端卡片上就要给出，PC 列表没有这个字段；
 *   3) 打卡 —— PC 端没有执行入口，这个写操作只存在于移动端（契约待补）。
 * 归属仍然只看 executorOrgId，不靠姓名反查（交接单 §八.3）。
 */
import { communities, employees, inspectTasks, notices } from '@pc/mock'
import {
  INSPECT_ISSUE_REASONS,
  getInspectTaskDetail,
  inspectExecData,
  orgNameOf,
  responsibilityOpts,
  submitInspectResult
} from '@pc/utils/api'
import { DEMO, demoNow } from '@/config/personas'
import { IS_API, get, loginAs } from './client'
import { dateLabel, remainMs, timeState } from '@/utils/deadline'

/* ---------- 原样透出，页面不直接碰 PC 模块 ---------- */
export {
  INSPECT_ISSUE_REASONS,
  getInspectTaskDetail,
  inspectExecData,
  orgNameOf,
  responsibilityOpts,
  submitInspectResult
}

/* ---------- 字典 ---------- */
export const TASK_TABS = [
  { key: 'todo', label: '待执行', statuses: ['待执行', '逾期'] },
  { key: 'doing', label: '执行中', statuses: ['执行中'] },
  { key: 'done', label: '已完成', statuses: ['已完成', '已转工单'] }
]

export const STATUS_COLOR = {
  待执行: 'var(--biz-ins-todo)',
  执行中: 'var(--biz-ins-doing)',
  已完成: 'var(--biz-ins-done)',
  逾期: 'var(--biz-ins-overdue)',
  已转工单: 'var(--biz-ins-towo)'
}

const COMMUNITY_OF = new Map(communities.map(c => [c.communityId, c]))
export const communityNameOf = id => COMMUNITY_OF.get(id)?.name || '-'
export const communityAddressOf = id => COMMUNITY_OF.get(id)?.address || ''

/* ---------- 数据来源 ---------- */

/*
 * mock 模式下 `TASKS` 就是 `@pc/mock` 的种子数组（同一个引用，写操作照旧改它）；
 * HTTP 模式下它换成 `/inspect-tasks` 的返回。
 *
 * 只换"数据从哪来"，下面的派生函数一行都不改 —— 它们本来就只吃一个数组，
 * 这也是这层能用最小改动接上接口的原因：**派生逻辑与取数本来就该分开**。
 */
let TASKS = inspectTasks

/** 当前数据源（自检与 smoke 用它，避免页面各自 import 种子造成"改过的数看不见"） */
export const allTasks = () => TASKS

/**
 * 拉「我的任务」。
 *
 * 为什么按 executor 姓名而不是按部门：一线登录的是**具体的人**，
 * 而 PC 的 scopeFilter 是按角色锚点算数据范围 —— 语义不同，不能复用（见文件头）。
 * 周明这类"计划上的运营设定值"不在员工名册里，没有工号可依，只能按姓名取。
 */
export async function loadTasks(persona) {
  if (!IS_API) return TASKS
  if (!persona?.name) return TASKS
  await loginAs(persona.id)

  /* 分页拉：假服务（和真后端）都限 size ≤ 100，一次给 200 会被 400 拒掉。
     顺手做成循环是有意的 —— 一线一个月 100+ 条任务很正常，
     只拉首页的话"已完成"页签会少一截，而少的那截没人会去数。 */
  const PAGE_SIZE = 100
  const MAX_PAGE = 10
  const all = []
  for (let pageNo = 1; pageNo <= MAX_PAGE; pageNo += 1) {
    const r = await get('/inspect-tasks', { executor: persona.name, pageNo, size: PAGE_SIZE })
    const rows = Array.isArray(r?.rows) ? r.rows : []
    all.push(...rows)
    if (!rows.length || all.length >= Number(r?.total || 0)) break
  }
  TASKS = all
  return TASKS
}

/* ---------- 我的任务 ---------- */

const mineOf = name => TASKS.filter(t => t.executor === name)

/** 列表行：把「剩余时间 / 日期标签 / 项目名 / 被检班组名」这些展示字段一次算好 */
export function taskRow(task, now = demoNow()) {
  return {
    taskId: task.taskId,
    planName: task.planName,
    taskType: task.taskType,
    status: task.status,
    statusColor: STATUS_COLOR[task.status] || 'var(--biz-text-3)',
    scheduledDate: task.scheduledDate,
    scheduledTime: task.scheduledTime,
    communityName: communityNameOf(task.communityId),
    post: task.post,
    targetDeptName: task.targetDept ? orgNameOf(task.targetDept) : '',
    itemCount: task.itemCount || 0,
    normalCount: task.normalCount || 0,
    issueCount: task.issueCount || 0,
    doneTime: task.doneTime || '',
    score: task.score || 0,
    refWoId: task.refWoId || '',
    time: timeState(task, now),
    dayLabel: dateLabel(task.scheduledDate, DEMO.today)
  }
}

/**
 * 某人的某个页签 → { pinned, groups }
 * pinned = 已超时的（不管哪天，全部置顶，卡片上直接写超时多久）
 * groups = 其余按日期倒序分组，组内按计划时刻正序
 */
export function listForTab(name, tabKey, now = demoNow()) {
  const tab = TASK_TABS.find(t => t.key === tabKey) || TASK_TABS[0]
  const rows = mineOf(name)
    .filter(t => tab.statuses.includes(t.status))
    .map(t => taskRow(t, now))

  const isPinned = r => r.time.key === 'overdue' || r.status === '逾期'
  const pinned = rows
    .filter(isPinned)
    .sort((a, b) => String(a.scheduledDate + a.scheduledTime).localeCompare(String(b.scheduledDate + b.scheduledTime)))
  const rest = rows.filter(r => !isPinned(r))

  const byDate = new Map()
  for (const r of rest) {
    if (!byDate.has(r.scheduledDate)) byDate.set(r.scheduledDate, [])
    byDate.get(r.scheduledDate).push(r)
  }
  const groups = [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, tasks]) => ({
      date,
      label: dateLabel(date, DEMO.today),
      tasks: tasks.sort((a, b) => String(a.scheduledTime).localeCompare(String(b.scheduledTime)))
    }))

  return { pinned, groups, count: rows.length }
}

/** 页签角标数量 */
export function tabCounts(name) {
  const rows = mineOf(name)
  const out = {}
  for (const t of TASK_TABS) out[t.key] = rows.filter(r => t.statuses.includes(r.status)).length
  return out
}

/** 首页/我的用的 KPI。完成率口径与 PC deptAchievement 一致：已完成 + 已转工单 */
export function kpiOf(name, now = demoNow()) {
  const list = mineOf(name)
  const period = DEMO.today.slice(0, 7)
  const month = list.filter(t => String(t.scheduledDate).slice(0, 7) === period)
  const by = (arr, s) => arr.filter(t => t.status === s).length
  const finished = by(month, '已完成') + by(month, '已转工单')
  const today = list.filter(t => t.scheduledDate === DEMO.today)
  const openStatus = ['待执行', '执行中', '逾期']

  return {
    period,
    monthTotal: month.length,
    monthDone: by(month, '已完成'),
    monthToWo: by(month, '已转工单'),
    monthOverdue: by(month, '逾期'),
    rate: month.length ? (finished / month.length) * 100 : 0,
    avgScore: month.filter(t => t.score).length
      ? month.filter(t => t.score).reduce((s, t) => s + t.score, 0) / month.filter(t => t.score).length
      : 0,
    todayTotal: today.length,
    todayOpen: today.filter(t => openStatus.includes(t.status)).length,
    openTotal: list.filter(t => openStatus.includes(t.status)).length,
    overdueTotal: list.filter(t => t.status === '逾期' || timeState(t, now).key === 'overdue').length
  }
}

/** 某天待办（首页用） */
export function todayRows(name, now = demoNow()) {
  return mineOf(name)
    .filter(t => t.scheduledDate === DEMO.today)
    .map(t => taskRow(t, now))
    .sort((a, b) => String(a.scheduledTime).localeCompare(String(b.scheduledTime)))
}

/* ---------- 单个任务 ---------- */

export const taskOf = taskId => {
  const local = TASKS.find(t => t.taskId === taskId)
  if (local) return local
  /* 直链进来（分享/刷新）时列表还没拉，用执行页缓存兜住 —— 否则详情页判"任务不存在" */
  return IS_API ? EXEC_CACHE.get(taskId)?.task || null : null
}

/* ---------- 执行页聚合 ---------- */

/*
 * HTTP 模式下执行页的数据从 `/mobile/tasks/{id}/exec` 来（一屏一请求）。
 *
 * 为什么用「预加载 + 同步读缓存」而不是把 execData 改成 async：
 * exec / checkin / wo-create 三个页面都是**进页面时同步取一次**再算 items，
 * 改成 async 要连模板里的初始化一起改，而缓存版只需要在 onLoad 开头加一行 await。
 * 代价是多一个 Map —— 但它只在这个页面生命周期内有值，退出即失效。
 */
const EXEC_CACHE = new Map()

/**
 * 预取执行页数据（HTTP 模式下必须先调；mock 模式下是空操作）。
 *
 * `personaLike` 由页面传进来 —— 不在这里 import store：`store/app.js` 已经
 * import 了本文件的 `submitInspectResult`，反向再 import 会成环。
 */
export async function loadTaskExec(taskId, personaLike) {
  if (!IS_API || !taskId) return null
  if (EXEC_CACHE.has(taskId)) return EXEC_CACHE.get(taskId)
  if (personaLike?.id) await loginAs(personaLike.id)
  const d = await get(`/mobile/tasks/${taskId}/exec`)
  EXEC_CACHE.set(taskId, d)
  return d
}

/** 详情页要的四个字段：任务 / 模板 / 来源计划 / 所属项目 */
export async function taskDetailOf(taskId, personaLike) {
  if (!IS_API) {
    const d = await getInspectTaskDetail(taskId)
    if (!d) return null
    return { task: d.task, template: d.template, plan: d.plan, community: d.community }
  }
  const d = await loadTaskExec(taskId, personaLike)
  if (!d) return null
  return { task: d.task, template: d.template, plan: d.plan, community: d.community }
}

/** 执行页聚合（模板 + 任务 + 项目名），PC 的同名函数已含这层逻辑 */
export function execData(taskId) {
  if (IS_API) {
    const d = EXEC_CACHE.get(taskId)
    return {
      task: d?.task || null,
      template: d?.template || null,
      communityName: d?.communityName || d?.community?.name || ''
    }
  }
  const d = inspectExecData(taskId)
  return { task: d.task, template: d.template, communityName: d.communityName }
}

/** 责任员工候选（监督任务：被检班组在职员工，排除组长本人） */
export const respCandidates = task => {
  if (IS_API) return EXEC_CACHE.get(task?.taskId)?.workers || []
  return responsibilityOpts(task)
}

/**
 * 开工打卡（移动端专有写操作）。
 * 待执行 → 执行中；已打卡不重复写。
 * 断网/无定位时按人工打卡记，需主管复核（交接单 §六 第 5 屏）。
 */
export function checkIn(taskId, { type = 'GPS围栏', gps = '', manual = false } = {}) {
  const t = taskOf(taskId)
  if (!t) throw new Error('任务不存在')
  if (['已完成', '已转工单'].includes(t.status)) throw new Error('任务已完成，无需打卡')
  t.checkedIn = true
  t.checkinType = manual ? '人工打卡' : type
  if (gps) t.gps = gps
  if (t.status === '待执行') t.status = '执行中'
  return { ...t }
}

/* ---------- 消息 ---------- */

/**
 * 公告类型，顺序是**按"影响当下"排的，不是按条数**：
 * 停水停电 / 维修施工是"今天要停水"这种即时影响，排前面；
 * 政策公示是例行阅知，排最后。PC 的 `NOTICE_TYPES` 是同一组值，
 * 这里只额外定了顺序与配色 —— 两端的分类学必须一样，否则同一份数据分出来不一样。
 */
export const NOTICE_TYPES = [
  { key: '停水停电', tone: 'warn' },
  { key: '维修施工', tone: 'warn' },
  { key: '安全提示', tone: 'danger' },
  { key: '收费通知', tone: 'info' },
  { key: '社区活动', tone: 'ok' },
  { key: '政策公告', tone: 'plain' }
]

const NOTICE_TONE = new Map(NOTICE_TYPES.map(t => [t.key, t.tone]))

/** 类型徽标的色调（页面按这个给颜色，不在模板里写一串 if） */
export const noticeToneOf = type => NOTICE_TONE.get(type) || 'plain'

/**
 * 员工能看到的公告。
 *
 * 三条口径，原来的实现漏了两条半：
 *   1. **只给「已发布」**。原来连草稿（4 条）、待审核（9 条）、已撤回（2 条）一起下发 ——
 *      等于把没发布的内容给员工看了。这条最要紧，不是显示问题而是越权。
 *   2. **全公司公告要算进来**：`communityId` 为空的 10 条挂在集团层面，
 *      原来的 `n.communityId === communityId` 把它们全过滤掉了，员工永远收不到集团通知。
 *   3. **置顶优先，其次按发布时间倒序**：置顶的通常是停水这类急事，沉在列表里等于没发。
 */
export function noticesOf(communityId) {
  return notices
    .filter(n => n.status === '已发布')
    .filter(n => {
      if (!n.communityId) return true              // 集团层面，人人可见
      return !communityId || n.communityId === communityId
    })
    .slice()
    .sort((a, b) => {
      if (!!b.top !== !!a.top) return b.top ? 1 : -1
      return String(b.publishTime).localeCompare(String(a.publishTime))
    })
}

/**
 * 消息页签：`全部` + 6 个类型，各带条数。
 * 只列**有内容**的类型 —— 本项目一条「收费通知」都没有时还摆一个 0 的页签，
 * 点进去是空态，纯属让人多点一次。
 */
export function noticeTabsOf(rows) {
  const all = [{ key: 'all', label: '全部公告', count: rows.length }]
  const by = new Map()
  for (const r of rows) by.set(r.type, (by.get(r.type) || 0) + 1)
  const typed = NOTICE_TYPES
    .filter(t => by.get(t.key))
    .map(t => ({ key: t.key, label: t.key, count: by.get(t.key) }))
  return [...all, ...typed]
}

/** 员工可见公告总数（原来数的是 `notices.length` = 106 条含草稿，头部数字是错的） */
export function noticeTotalOf(communityId) {
  return noticesOf(communityId).length
}

/* ---------- 数据对齐自检（我的页展示，和 PC 的 3 个数字对得上） ---------- */

/**
 * 页面加载时先记一份「初始 seed」。
 * 为什么不在渲染时现算：演示里提交一次，待执行就少 1、已完成多 1，
 * 拿改过的数去比 PC 的 306/40/20 会永远对不上 —— 那不是口径分叉，是自己改的。
 * 所以 ✓ 判定用 seed，当前值另列，改动了几条也明说。
 */
const SEED = (() => {
  const c = s => TASKS.filter(t => t.status === s).length
  return { tasks: TASKS.length, todo: c('待执行'), doing: c('执行中'), employees: employees.length, notices: notices.length }
})()

const PC_EXPECT = { tasks: 306, todo: 40, doing: 20, employees: 120, notices: 106 }

export function dataCheck() {
  const c = s => TASKS.filter(t => t.status === s).length
  const live = {
    tasks: TASKS.length,
    todo: c('待执行'),
    doing: c('执行中'),
    employees: employees.length,
    notices: notices.length
  }
  const rows = [
    ['巡检任务', 'tasks'],
    ['待执行', 'todo'],
    ['执行中', 'doing'],
    ['员工', 'employees'],
    ['公告', 'notices']
  ].map(([label, key]) => ({
    label,
    key,
    live: live[key],
    seed: SEED[key],
    pc: PC_EXPECT[key],
    ok: SEED[key] === PC_EXPECT[key],
    changed: live[key] !== SEED[key]
  }))
  const drifted = rows.reduce((s, r) => s + Math.abs(r.live - r.seed), 0)
  return { rows, drifted }
}

/** 所有人的任务数之和必须等于总任务数（防止「我的」口径漏算） */
export const sumOfPersonalTasks = () => {
  const m = new Map()
  for (const t of TASKS) m.set(t.executor, (m.get(t.executor) || 0) + 1)
  return [...m.values()].reduce((s, n) => s + n, 0)
}

export { remainMs }
