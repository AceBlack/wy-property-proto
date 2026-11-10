/**
 * 修工单种子里的两处时间问题（幂等，可反复跑）。
 *
 * 问题一：一张挂了 40 天的单还在抢单池里，且标「SLA 超时」
 * ------------------------------------------------------------
 * WO000054 是 2026-09-10 16:15 创建、slaHours 12 的付费单，到演示时刻仍未接。
 * 一张付费单四十天没人接、也没升级派单，真实业务里早该由项目经理改派了 ——
 * 留着它在抢单池，评审时看到「SLA 超时」挂在一张四十天前的单上，
 * 问的是"你们的流程是不是坏的"，而不是"抢单好不好用"。
 * 处理：把创建时间挪到演示当天早上，SLA 与 isOverdue 跟着重算。
 *
 * 问题二：3 张单的整条时间链落在演示时刻之后
 * ------------------------------------------------------------
 * 演示时钟是 2026-10-21 10:00（PC 的 `format.TODAY` + `personas.nowTime`）。
 * WO000048 / WO000052 / WO000063 的 create/accept/arrive/finish 全在 10-21 13:30 之后，
 * 严重的那张完工时间是 10-22 08:04 —— 比"今天"还晚一天。
 * 它们不会出现在抢单池，但会出现在「我处理过的」列表里，时间显示成今天下午/明天。
 *
 * 处理：整条时间链**按天平移**，相对间隔不动 ——
 * 平移只改日期，`durationHours`、SLA、评分这些派生值全部不受影响。
 */
import fs from 'node:fs'
import path from 'node:path'

const FILE = path.resolve(import.meta.dirname, '../src/mock/workOrders.json')

/** 演示时刻：与 `05-员工端APP/src/config/personas.js` 的 DEMO 一致 */
const NOW = '2026-10-21 10:00'

const orders = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const byId = new Map(orders.map(o => [o.woId, o]))
let touched = 0

/* ---------- 问题一：四十天的抢单池陈单 ---------- */
{
  const w = byId.get('WO000054')
  if (w && w.createTime === '2026-09-10 16:15') {
    w.createTime = '2026-10-21 07:40'
    /* slaHours 是 12 → 到期 19:40，演示时刻 10:00 还没超 */
    w.isOverdue = false
    /* 未接单的单不该有受理/到场时间 */
    w.acceptTime = ''
    w.arriveTime = ''
    w.finishTime = ''
    touched += 1
    console.log('✓ WO000054 创建时间 2026-09-10 → 2026-10-21 07:40，SLA 不再超时')
  }
}

/* ---------- 问题二：整条时间链平移 ---------- */
/* 只平移日期部分，时分秒原样保留 —— 间隔不变，`durationHours` 就不会漂 */
const SHIFT = {
  /* 已评价：原 10-21 18:40 ~ 10-22 08:04，前移 2 天 */
  WO000048: -2,
  /* 待确认：原 10-21 13:30 起，前移 1 天 */
  WO000052: -1,
  /* 已评价：原 10-21 20:50 ~ 10-22 13:29，前移 3 天 */
  WO000063: -3,
  /* 处理中：创建 09:12 / 受理 09:28 都在演示时刻之前，但**到场 10:13 越界** ——
     只判 createTime 会漏掉它。前移 1 天后整条链都落在 10-20。 */
  WO000001: -1
}

/** 任一时间字段晚于演示时刻就算越界（只看 createTime 会漏掉"创建在过去、到场在未来"） */
const anyFuture = w =>
  ['createTime', 'acceptTime', 'arriveTime', 'finishTime'].some(k => w[k] && w[k] > NOW)

const shiftDate = (text, days) => {
  if (!text) return text
  const [d, t] = String(text).split(' ')
  const dt = new Date(`${d}T00:00:00`)
  dt.setDate(dt.getDate() + days)
  const pad = n => String(n).padStart(2, '0')
  const nd = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
  return t ? `${nd} ${t}` : nd
}

for (const [id, days] of Object.entries(SHIFT)) {
  const w = byId.get(id)
  if (!w || !anyFuture(w)) continue   // 已修过就跳过（幂等）
  for (const k of ['createTime', 'acceptTime', 'arriveTime', 'finishTime']) {
    if (w[k]) w[k] = shiftDate(w[k], days)
  }
  touched += 1
  console.log(`✓ ${id} 时间链前移 ${-days} 天 → create ${w.createTime} / finish ${w.finishTime || '-'}`)
}

if (touched) {
  fs.writeFileSync(FILE, JSON.stringify(orders, null, 2) + '\n')
  console.log(`\n写入 ${FILE}（${touched} 张）`)
} else {
  console.log('已经是修过的状态，无需改动')
}

/* ---------- 自检 ---------- */
const after = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const future = after.filter(o => o.createTime > NOW)
const bad = after.filter(o =>
  ['acceptTime', 'arriveTime', 'finishTime'].some(k => o[k] && o[k] > NOW)
)
console.log(`\n自检：创建时间晚于演示时刻 ${future.length} 张 · 其他时间越界 ${bad.length} 张`)
if (future.length || bad.length) {
  console.log('⚠️ 仍有越界，需要人工确认：')
  ;[...future, ...bad].slice(0, 6).forEach(o =>
    console.log(`   ${o.woId} create=${o.createTime} accept=${o.acceptTime || '-'} finish=${o.finishTime || '-'}`)
  )
  process.exitCode = 1
}
