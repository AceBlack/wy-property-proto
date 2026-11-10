/**
 * 车位规则的**纯函数**（批次 79）
 * ------------------------------------------------------------
 * 为什么单独一个文件：`check:data` 用 node 直接跑，不能 import 带 uni / store 的模块。
 * 这个项目已经有三份同款：`identity-rule.mjs`（实名匹配）、`refund-rule.mjs`（退款分档）、
 * `activity-rule.mjs`（活动阶段）。规则抽出来，页面与自检用同一份 —— 否则
 * "页面上写的 30 天"和"自检里的 30 天"迟早对不上。
 *
 * 这里**不读演示时钟**：`today` 一律当参数传进来，纯函数才能拿固定日期断言。
 */

const DAY = 86400000

export const parseDay = s => {
  if (!s) return null
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 剩余天数：正数 = 还剩几天，负数 = 已过期几天，null = 日期不可解析 */
export function daysBetween(date, today) {
  const a = parseDay(date)
  const b = parseDay(today)
  if (!a || !b) return null
  return Math.round((a - b) / DAY)
}

/**
 * 到期分档。
 *
 * 阈值 30 / 90 是**业主视角**（还有一个月 / 一个季度），不是后台的分桶口径
 * （后台 `parkingExpireBuckets()` 用 30/90/180 做统计）。两边用途不同，不要强行统一。
 */
export function expiryOf(date, today) {
  const days = daysBetween(date, today)
  if (days === null) return { date: '', days: null, tone: 'muted', text: '未登记到期日' }
  if (days < 0) return { date, days, tone: 'danger', text: `已过期 ${Math.abs(days)} 天` }
  if (days <= 30) return { date, days, tone: 'danger', text: `剩 ${days} 天` }
  if (days <= 90) return { date, days, tone: 'warn', text: `剩 ${days} 天` }
  return { date, days, tone: 'ok', text: `剩 ${days} 天` }
}

const pad2 = n => String(n).padStart(2, '0')

/** 加 N 个月：按日对齐，月末越界回落到当月最后一天（1-31 加一个月不是 2-31） */
export function addMonths(date, n) {
  const d = parseDay(date)
  if (!d) return date
  const day = d.getDate()
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, lastDay))
  return `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`
}

/**
 * 预缴后的到期日：**已过期的从今天起算**。
 * 把过期那段也卖一遍，业主会问"我明明补的是从到期日开始算"。
 */
export function nextExpire(expireDate, today, months) {
  const base = daysBetween(expireDate, today) < 0 || !expireDate ? today : expireDate
  return addMonths(base, months)
}

/** 车牌：省份简称 + 字母 + 5~6 位（新能源 6 位），允许中间带间隔点 */
export const PLATE_RE = /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][·]?[A-Z0-9]{5,6}$/

/** 统一成「川B·SFV7D」：去空格与横线、转大写、自动补间隔点 */
export function normalizePlate(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/^([京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z])(?![·])/, '$1·')
}

export const validPlate = raw => PLATE_RE.test(normalizePlate(raw))

/**
 * 本月已换绑次数：只数**本车位**本自然月。
 * 按业主数会误伤真的有两个车位的人 —— 他换两个车位是两件事，不是刷次数。
 */
export function usedThisMonth(logs, parkId, today) {
  const m = String(today || '').slice(0, 7)
  const mine = (logs || [])
    .filter(l => l.parkId === parkId && String(l.at || '').slice(0, 7) === m)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
  /**
   * **以最后一次「物业重置」为界**，重置之前的记录不计入。
   *
   * 与后台 H2 同一口径：业主把车牌填错，客服重置一次，不该同时占掉他下个月的名额。
   * 所以重置不是"把计数清零"，而是插一条分界线 —— 记录本身要留着，
   * 那是留痕的意义（出纠纷时能证明"什么时候、谁、改成什么"）。
   * 两端各写一套的话，接口模式与本地模式在"重置之后"就会给出不同的剩余次数。
   */
  const lastReset = [...mine].reverse().find(l => l.source === '物业重置')
  const from = lastReset ? mine.indexOf(lastReset) + 1 : 0
  return mine.slice(from).filter(l => l.source !== '物业重置').length
}

/** 下月 1 日（提示"什么时候恢复"用，别只写"下月"） */
export function nextMonthFirst(today) {
  const [y, m] = String(today || '').split('-').map(Number)
  if (!y || !m) return ''
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`
}
