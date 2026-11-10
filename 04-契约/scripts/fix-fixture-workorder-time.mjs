/**
 * 把契约 fixture 里 4 张工单的时间，与原型 seed 对齐（幂等）。
 *
 * 为什么需要这一步
 * ------------------------------------------------------------
 * `04-契约/fixtures/work-orders.json` **不是**由 `gen-fixtures.mjs` 生成的
 * （那个脚本里根本没有 work-orders），它是独立维护的 120 条样例。
 * 所以改 seed 不会自动同步过来 —— 两边会各自漂：seed 修好了，契约这边还是旧值。
 *
 * 做法：按 woId 抄 seed 的四个时间字段 + isOverdue，不自己再算一遍平移，
 * 免得两边用不同的规则得出不同的时间。
 */
import fs from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const SEED = path.resolve(HERE, '../../03-原型/src/mock/workOrders.json')
const FIXTURE = path.resolve(HERE, '../fixtures/work-orders.json')

/** 演示时刻：与 `05-员工端APP/src/config/personas.js` 的 DEMO 一致 */
const NOW = '2026-10-21 10:00'

const FIELDS = ['createTime', 'acceptTime', 'arriveTime', 'finishTime']

const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'))
const seedById = new Map(seed.map(o => [o.woId, o]))
const orders = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

let touched = 0
for (const o of orders) {
  const s = seedById.get(o.woId)
  if (!s) continue
  /* 只在契约这边确实越界时才抄，避免把"契约有意不同的样例"也覆盖掉 */
  const bad = FIELDS.some(k => o[k] && o[k] > NOW)
  if (!bad) continue

  for (const k of FIELDS) o[k] = s[k] || ''
  if ('isOverdue' in o) o.isOverdue = s.isOverdue
  touched += 1
  console.log(`✓ ${o.woId} 与 seed 对齐：create ${o.createTime} / finish ${o.finishTime || '-'}`)
}

if (touched) {
  fs.writeFileSync(FIXTURE, JSON.stringify(orders, null, 2) + '\n')
  console.log(`\n写入 ${FIXTURE}（${touched} 张）`)
} else {
  console.log('契约 fixture 已是修过的状态，无需改动')
}

/* ---------- 自检 ---------- */
const after = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
const bad = after.filter(o => FIELDS.some(k => o[k] && o[k] > NOW))
console.log(`\n自检：契约工单 ${after.length} 条，时间越界 ${bad.length} 条`)
if (bad.length) {
  bad.slice(0, 6).forEach(o => console.log(`   ${o.woId} ${o.createTime}`))
  process.exitCode = 1
}
