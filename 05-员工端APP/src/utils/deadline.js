import { demoNow } from '@/config/personas'

/** 任务的截止时刻：scheduledDate + scheduledTime（没有时刻按 00:00 算） */
export function dueAt(task) {
  if (!task?.scheduledDate) return null
  const t = task.scheduledTime || '00:00'
  return new Date(`${task.scheduledDate}T${t}:00`)
}

/** 剩余毫秒；已完成/已转工单的任务没有「剩余」概念，返回 null */
export function remainMs(task, now = demoNow()) {
  if (!task || ['已完成', '已转工单'].includes(task.status)) return null
  const due = dueAt(task)
  if (!due) return null
  return due.getTime() - now.getTime()
}

/** 把毫秒说成人话：2 天 3 小时 / 4 小时 12 分 / 8 分钟 */
export function spanText(ms) {
  const abs = Math.abs(ms)
  const min = Math.floor(abs / 60000)
  if (min < 1) return '不到 1 分钟'
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return `${d} 天${h > 0 ? ` ${h} 小时` : ''}`
  if (h > 0) return `${h} 小时${m > 0 ? ` ${m} 分` : ''}`
  return `${m} 分钟`
}

/**
 * 时间状态三档（列表卡片直接用它上色）：
 *   overdue 已超时（红）/ soon 1 小时内到期（橙）/ normal 正常（灰）
 */
export function timeState(task, now = demoNow()) {
  const ms = remainMs(task, now)
  if (ms === null) return { key: 'done', ms: null, text: '' }
  if (ms < 0) return { key: 'overdue', ms, text: `已超时 ${spanText(ms)}` }
  if (ms < 3600 * 1000) return { key: 'soon', ms, text: `剩余 ${spanText(ms)}` }
  return { key: 'normal', ms, text: `剩余 ${spanText(ms)}` }
}

/** 日期分组标题：今天 / 昨天 / 10月17日 */
export function dateLabel(date, todayStr) {
  if (!date) return '未排期'
  if (date === todayStr) return '今天'
  const d = new Date(`${date}T00:00:00`)
  const t = new Date(`${todayStr}T00:00:00`)
  const diff = Math.round((t - d) / 86400000)
  if (diff === 1) return '昨天'
  if (diff === 2) return '前天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 时钟文案 09:12 */
export function clockText(d = demoNow()) {
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 完整时间 2026-10-20 09:12 */
export function fullTimeText(d = demoNow()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
