/**
 * 增量补齐契约工单：P01 的可抢单从 1 张补到 8 张
 *
 * 为什么不重跑 `gen-fixtures.mjs`：那个脚本头部有明确警告 —— 整目录重跑会把
 * houses 从 220 砍回 160、`bills` / `tenants` 里指向 161~220 的房屋变孤儿、
 * 「张建国的两套房」查不到。所以按它自己的建议写增量脚本。
 *
 * 背景：抢单池的口径是「商业服务 + 收费 + 待派单 + 无人接」（公区维修没提成，不进池）。
 * 契约 fixture 里 P01 只有 1 张符合，PC 的 seed 有 8 张 —— 演示时一线点进「可抢」
 * 只看到一张，会以为功能没做好。缺的 7 张（WO000151~157）从 PC seed 投影过来。
 *
 * 幂等：已存在的 woId 会跳过，重复跑不会产生重复单。
 *
 *   node scripts/gen-grab-workorders.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, '../fixtures/work-orders.json')
const SEED = path.join(HERE, '../../03-原型/src/mock/workOrders.json')

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/* ---------- SLA：与 gen-fixtures 同一套工作日历 ---------- */
const CAL = {
  workStart: 9, workEnd: 18,
  holidays: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']
}
const parse = s => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null
}
const fmt = d => {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const isWork = d => d.getDay() !== 0 && d.getDay() !== 6 && !CAL.holidays.includes(fmt(d).slice(0, 10))

function addWorkHours(from, hours) {
  const d = new Date(from.getTime())
  let left = hours
  while (left > 0) {
    if (!isWork(d)) { d.setDate(d.getDate() + 1); d.setHours(CAL.workStart, 0, 0, 0); continue }
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), CAL.workStart, 0)
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), CAL.workEnd, 0)
    if (d < dayStart) d.setTime(dayStart.getTime())
    if (d >= dayEnd) { d.setDate(d.getDate() + 1); d.setHours(CAL.workStart, 0, 0, 0); continue }
    const avail = (dayEnd - d) / 3600000
    if (left <= avail) return new Date(d.getTime() + left * 3600000)
    left -= avail
    d.setDate(d.getDate() + 1)
    d.setHours(CAL.workStart, 0, 0, 0)
  }
  return d
}

/* ---------- 投影：只保留契约声明过的字段 ---------- */
const CUR = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
const SEEDED = JSON.parse(fs.readFileSync(SEED, 'utf8'))

/* 缺的这 7 张：PC seed 里 P01 可抢池中契约还没有的那些 */
const grabOf = arr => arr.filter(w =>
  w.communityId === 'P01' && w.type === '商业服务' && w.feeType === '收费' &&
  w.status === '待派单' && !w.assignee
)

const have = new Set(CUR.map(w => w.woId))
const missing = grabOf(SEEDED).filter(w => !have.has(w.woId))

if (!missing.length) {
  console.log('没有缺的可抢单，无需补。')
  process.exit(0)
}

const project = w => {
  const slaHours = Number(w.slaHours) || 24
  const create = parse(w.createTime)
  const out = {
    woId: w.woId,
    woNo: w.woNo,
    communityId: w.communityId,
    houseId: w.houseId,
    houseName: w.houseName,
    ownerId: w.ownerId,
    ownerName: w.ownerName,
    type: w.type,
    category: w.category,
    source: w.source,
    priority: w.priority,
    status: w.status,
    title: w.title,
    description: w.description,
    dispatchMode: w.dispatchMode || '',
    assignee: w.assignee || '',
    createTime: w.createTime,
    acceptTime: w.acceptTime || '',
    arriveTime: w.arriveTime || '',
    finishTime: w.finishTime || '',
    feeType: w.feeType,
    payStatus: w.payStatus || '未支付',
    score: Number(w.score) || 0,
    isPublic: !!w.isPublic,
    priceCode: w.priceCode || '',
    serviceName: w.serviceName || '',
    serviceCost: r2(w.serviceCost),
    slaHours,
    materialFee: r2(w.materialFee),
    laborFee: r2(w.laborFee),
    totalFee: r2(w.totalFee),
    /* 待派单的单还没开始处理：已用工时 0、未超时；到期时间照工作日历算 */
    slaDueAt: create ? fmt(addWorkHours(create, slaHours)) : '',
    slaUsedHours: 0,
    slaBreached: false,
    _ver: 1,
    addons: Array.isArray(w.addons) ? w.addons : [],
    paidAmount: 0
  }
  return out
}

const added = missing.map(project)
const next = [...CUR, ...added].sort((a, b) => String(a.woId).localeCompare(String(b.woId)))
fs.writeFileSync(FIXTURE, JSON.stringify(next, null, 2) + '\n')

console.log(`补入 ${added.length} 张可抢单：${added.map(w => w.woId).join(', ')}`)
console.log(`工单总数 ${CUR.length} → ${next.length}`)
console.log(`P01 可抢池：${grabOf(next).length} 张`)
