/**
 * 押金台账演示数据补齐（2026-11-13）
 * ------------------------------------------------------------
 * 原数据集 304 条全是装修押金，页面上看不出"押金类型"这一维，
 * 于是"升级成通用押金台账"改完也没法验。这里补四类：
 *   门禁卡押金 / 非机动车牌押金（按数量，无需验收）
 *   履约保证金 / 租约押金（金额不固定，需验收或退租核验）
 *
 * 固定种子、可重复执行：已存在非装修类型时直接跳过。
 * 只写 03-原型/src/mock（02-原型设计/mock 没有押金表，check 不比对）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MOCK = path.join(ROOT, 'src', 'mock')
const FILE = path.join(MOCK, 'decorationDeposits.json')

const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const owners = JSON.parse(fs.readFileSync(path.join(MOCK, 'owners.json'), 'utf8'))
const houses = JSON.parse(fs.readFileSync(path.join(MOCK, 'houses.json'), 'utf8'))
const communities = JSON.parse(fs.readFileSync(path.join(MOCK, 'communities.json'), 'utf8'))

if (rows.some(r => r.type && r.type !== '装修押金')) {
  console.log('已存在非装修押金，跳过')
  process.exit(0)
}

let seed = 20261113
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const r2 = n => Math.round(n * 100) / 100

const HOUSE = new Map(houses.map(h => [h.houseId, h]))
const OWNER = new Map(owners.map(o => [o.ownerId, o]))
const COMM = new Map(communities.map(c => [c.communityId, c.name]))

let seq = rows.reduce((m, r) => Math.max(m, Number(String(r.depositId).replace(/\D/g, '')) || 0), 0)

const SPECS = [
  {
    type: '门禁卡押金', prefix: 'MJ', n: 12, fixed: 50, qty: [1, 3],
    statuses: ['在押', '在押', '已退还']
  },
  {
    type: '非机动车牌押金', prefix: 'CP', n: 12, fixed: 20, qty: [1, 2],
    statuses: ['在押', '已退还']
  },
  {
    type: '履约保证金', prefix: 'LY', n: 12, range: [20000, 80000],
    statuses: ['在押', '在押', '已退还']
  },
  {
    type: '租约押金', prefix: 'ZY', n: 12, range: [3000, 9000],
    statuses: ['在押', '在押', '部分扣除', '已退还'],
    deduct: [300, 1200]
  }
]

const out = []
for (const spec of SPECS) {
  for (let i = 0; i < spec.n; i++) {
    seq += 1
    const h = houses[Math.floor(rnd() * houses.length)]
    const o = OWNER.get(h.ownerId) || owners[Math.floor(rnd() * owners.length)]
    const qty = spec.qty ? spec.qty[0] + Math.floor(rnd() * (spec.qty[1] - spec.qty[0] + 1)) : 1
    const amount = spec.fixed ? spec.fixed * qty : Math.round(spec.range[0] + rnd() * (spec.range[1] - spec.range[0]))
    const status = pick(spec.statuses)
    const day = 1 + Math.floor(rnd() * 27)
    const month = 6 + Math.floor(rnd() * 4)      // 2026-06 ~ 2026-09
    const paidDate = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const deduct = status === '部分扣除' ? Math.round(spec.deduct[0] + rnd() * (spec.deduct[1] - spec.deduct[0])) : 0
    const refund = status === '已退还' ? amount : (status === '部分扣除' ? r2(amount - deduct) : 0)
    out.push({
      depositId: 'DP' + String(seq).padStart(5, '0'),
      applyNo: `${spec.prefix}2026-${String(seq).padStart(4, '0')}`,
      communityId: h.communityId,
      communityName: COMM.get(h.communityId) || '',
      houseId: h.houseId,
      houseName: h.fullName,
      ownerId: o.ownerId,
      ownerName: o.name,
      phone: o.phone,
      type: spec.type,
      quantity: qty,
      amount,
      paidDate,
      startDate: '',
      planEndDate: '',
      checkDate: status === '已退还' || status === '部分扣除' ? paidDate : null,
      status,
      deductAmount: deduct,
      deductReason: deduct ? '欠费抵扣 / 设施损坏赔偿' : '',
      refundAmount: refund,
      refundDate: refund ? '2026-10-20' : null,
      balance: r2(amount - refund - deduct),
      overdueDays: 0,
      operator: '高秀兰',
      remark: spec.type === '履约保证金' ? '供应商履约担保，合同期满退还' : '',
      _isNew: false
    })
  }
}

const all = rows.concat(out)
fs.writeFileSync(FILE, JSON.stringify(all, null, 2) + '\n')
const byType = {}
for (const r of all) byType[r.type] = (byType[r.type] || 0) + 1
console.log('写入', out.length, '条；类型分布', byType)
