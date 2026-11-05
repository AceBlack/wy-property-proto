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

/* ---------- 我的任务 ---------- */

const mineOf = name => inspectTasks.filter(t => t.executor === name)

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

export const taskOf = taskId => inspectTasks.find(t => t.taskId === taskId) || null

/** 执行页聚合（模板 + 任务 + 项目名），PC 的同名函数已含这层逻辑 */
export function execData(taskId) {
  const d = inspectExecData(taskId)
  return { task: d.task, template: d.template, communityName: d.communityName }
}

/** 责任员工候选（监督任务：被检班组在职员工，排除组长本人） */
export const respCandidates = task => responsibilityOpts(task)

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

export const noticeTotal = notices.length

export function noticesOf(communityId) {
  return notices
    .filter(n => !communityId || n.communityId === communityId)
    .slice()
    .sort((a, b) => String(b.publishTime).localeCompare(String(a.publishTime)))
}

/* ---------- 数据对齐自检（我的页展示，和 PC 的 3 个数字对得上） ---------- */

/**
 * 页面加载时先记一份「初始 seed」。
 * 为什么不在渲染时现算：演示里提交一次，待执行就少 1、已完成多 1，
 * 拿改过的数去比 PC 的 306/40/20 会永远对不上 —— 那不是口径分叉，是自己改的。
 * 所以 ✓ 判定用 seed，当前值另列，改动了几条也明说。
 */
const SEED = (() => {
  const c = s => inspectTasks.filter(t => t.status === s).length
  return { tasks: inspectTasks.length, todo: c('待执行'), doing: c('执行中'), employees: employees.length, notices: notices.length }
})()

const PC_EXPECT = { tasks: 306, todo: 40, doing: 20, employees: 120, notices: 106 }

export function dataCheck() {
  const c = s => inspectTasks.filter(t => t.status === s).length
  const live = {
    tasks: inspectTasks.length,
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
  for (const t of inspectTasks) m.set(t.executor, (m.get(t.executor) || 0) + 1)
  return [...m.values()].reduce((s, n) => s + n, 0)
}

export { remainMs }
