/**
 * 预存账户 / 预存流水 / 商业平台账户镜像（2026-11-11）
 * ----------------------------------------------------------------
 * 前两个是**投影**：`prepayAccounts` 已经存在于 03 的 mock 里（137 条），
 * 但 04 fixtures 一直没导 —— 业主端要展示"我的预存余额"，假服务得先有这份数据。
 *
 * 只导 **fixtures 业主（60 人）名下的账户**（15 条），其余 122 条指向没导出的业主，
 * 导进来就是永远读不到的行（与车位那次同一个理由）。
 *
 * 另外补一条**演示种子**（PA90001 张建国 / 0501）：原数据里他没有预存账户，
 * 而他是业主端所有走查的主角 —— 没有账户，余额/充值/抵扣三条路都演示不了。
 * 种子的余额、累计充值、累计抵扣与流水三者必须自洽（脚本会校验）：
 *   1500 充值 - 582.86 抵扣 = 917.14 余额
 * 917.14 抵 0501 的 1179.78 欠费 → 抵掉两张 + 第三张抵一部分，正好演示部分抵扣
 * （353.13 + 248.94 + 315.07 = 917.14，第三张 352.07 还剩 37.00）。
 *
 * 商业平台账户（`commerce-account.json`）是**镜像数据**，不是物业的账：
 * 只读、带 `syncedAt`。按业务约定**不展示余额**（那是商业平台的负债，
 * 与物业预存是两笔钱），只给积分与优惠券，且**不能在物业端抵扣账单**。
 *
 * 用法：node scripts/gen-account-fixtures.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.resolve(ROOT, '../03-原型/src/mock')
const OUT = path.join(ROOT, 'fixtures')

const readSrc = f => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'))
const readFx = f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))
const write = (name, rows) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(rows, null, 2) + '\n')
  console.log(`  ${name}  ${Array.isArray(rows) ? rows.length + ' 条' : '对象'}`)
}
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

const owners = readFx('owners.json')
const ownerSet = new Set(owners.map(o => o.ownerId))

/* ============================ ① 预存账户 ============================ */
const ACCOUNT_KEYS = [
  'accountId', 'ownerId', 'ownerName', 'phone', 'communityId', 'houseId', 'houseName',
  'balance', 'totalRecharge', 'totalDeduct', 'lastRechargeDate', 'lastDeductDate',
  'status', 'autoDeduct'
]

const srcAccounts = readSrc('prepayAccounts.json')
const accounts = srcAccounts
  .filter(a => ownerSet.has(a.ownerId))
  .map(a => pick(a, ACCOUNT_KEYS))

/* 演示种子：张建国 / 0501（原数据没有账户） */
const DEMO_ACCOUNT_ID = 'PA90001'
if (!accounts.some(a => a.accountId === DEMO_ACCOUNT_ID)) {
  accounts.unshift({
    accountId: DEMO_ACCOUNT_ID,
    ownerId: 'OW00001',
    ownerName: '张建国',
    phone: '13800138001',
    communityId: 'P01',
    houseId: 'H010110501',
    houseName: '翡翠城 1栋1单元0501',
    balance: 917.14,
    totalRecharge: 1500,
    totalDeduct: 582.86,
    lastRechargeDate: '2026-09-28',
    lastDeductDate: '2026-09-29',
    status: '正常',
    autoDeduct: false
  })
}
write('prepay-accounts.json', accounts)

/* ============================ ② 预存流水 ============================ */
/**
 * 流水是**余额的唯一解释**：`balance` 只是最后一行之后的结果。
 * 所以种子必须能对上（脚本会校验），否则页面会出现"余额 800，可流水只加了 500"。
 */
const flows = [
  {
    logId: 'PL900001',
    accountId: DEMO_ACCOUNT_ID,
    type: '充值',
    amount: 1000,
    balance: 1000,
    method: '微信支付',
    operator: '张建国',
    time: '2026-08-30 10:12',
    remark: '微信充值 ¥1000',
    /* 营销位占位：活动赠送（本期不实现规则，字段先留着，后台配置后即生效） */
    giftType: '',
    giftDesc: ''
  },
  {
    logId: 'PL900002',
    accountId: DEMO_ACCOUNT_ID,
    type: '充值',
    amount: 500,
    balance: 1500,
    method: '微信支付',
    operator: '张建国',
    time: '2026-09-28 19:40',
    remark: '微信充值 ¥500',
    giftType: '',
    giftDesc: ''
  },
  {
    logId: 'PL900003',
    accountId: DEMO_ACCOUNT_ID,
    type: '抵扣',
    amount: 582.86,
    balance: 917.14,
    method: '余额抵扣',
    operator: '张建国',
    time: '2026-09-29 09:05',
    remark: '抵扣 2026-08 物业服务费与水费',
    giftType: '',
    giftDesc: '',
    /* 抵扣必须能追溯到账单：哪几张、每张多少 */
    bills: [
      { billId: 'BL000039', period: '2026-08', itemName: '物业服务费', amount: 352.07 },
      { billId: 'BL000040', period: '2026-08', itemName: '水费', amount: 230.79 }
    ]
  },
  /* 另一位业主的历史流水，用来证明"不是只有演示户在用" */
  {
    logId: 'PL000101',
    accountId: (accounts.find(a => a.ownerId === 'OW00006') || {}).accountId || '',
    type: '充值',
    amount: 5000,
    balance: 5000,
    method: '银行转账',
    operator: '雷天佑',
    time: '2025-10-30 14:20',
    remark: '银行转账充值 ¥5000',
    giftType: '',
    giftDesc: ''
  },
  {
    logId: 'PL000102',
    accountId: (accounts.find(a => a.ownerId === 'OW00006') || {}).accountId || '',
    type: '抵扣',
    amount: 191,
    balance: 4809,
    method: '余额抵扣',
    operator: '物业前台',
    time: '2026-05-22 11:00',
    remark: '抵扣 2026-04 物业服务费',
    giftType: '',
    giftDesc: ''
  }
].filter(f => f.accountId)

write('prepay-flows.json', flows)

/* ============================ ③ 商业平台账户镜像 ============================ */
/**
 * **只读镜像**，不是物业的账：
 *   - 不给 `balance`：商业平台储值与物业预存是两笔钱，放一起业主会问"能不能交物业费"；
 *   - `syncedAt` 必给：物业这边只保证"这个时间点的样子"；
 *   - 券带 `claimUrl`：领取与核销都在商业平台，物业端只做展示与引导。
 */
const commerce = [
  {
    ownerId: 'OW00001',
    memberName: '张建国',
    syncedAt: '2026-10-20 07:00',
    points: 1280,
    pointsExpiring: 200,
    pointsExpireAt: '2026-12-31',
    level: '银卡会员',
    levelNext: '金卡会员',
    levelProgress: { current: 1280, next: 2000 },
    coupons: [
      {
        couponId: 'CP001',
        title: '邻里中心通用券',
        type: '满减',
        faceValue: 20,
        threshold: 100,
        scope: '邻里中心 · 生活服务',
        validFrom: '2026-10-01',
        validTo: '2026-11-30',
        status: '可领取',
        claimUrl: 'https://example.com/commerce/coupon/CP001'
      },
      {
        couponId: 'CP002',
        title: '生鲜到家免配送费',
        type: '免邮',
        faceValue: 8,
        threshold: 0,
        scope: '生鲜到家',
        validFrom: '2026-10-15',
        validTo: '2026-11-15',
        status: '可领取',
        claimUrl: 'https://example.com/commerce/coupon/CP002'
      },
      {
        couponId: 'CP003',
        title: '邻里节 8 折券',
        type: '折扣',
        faceValue: 0,
        threshold: 0,
        scope: '邻里节活动商家',
        validFrom: '2026-09-01',
        validTo: '2026-10-10',
        status: '已过期',
        claimUrl: 'https://example.com/commerce/coupon/CP003'
      }
    ]
  }
]
write('commerce-account.json', commerce)

/* ============================ ④ 自检 ============================ */
const problems = []

if (new Set(accounts.map(a => a.accountId)).size !== accounts.length) problems.push('accountId 有重复')
const accById = new Map(accounts.map(a => [a.accountId, a]))
for (const a of accounts) {
  if (!ownerSet.has(a.ownerId)) problems.push(`账户 ${a.accountId} 的业主不在档案里`)
  if (!a.houseId) problems.push(`账户 ${a.accountId} 没有挂房`)
  if (Number(a.balance) < 0) problems.push(`账户 ${a.accountId} 余额为负`)
}
/* 一个房最多一个有效账户 —— 业主端按房取余额，两个账户就会取到哪一个都不对 */
const livePerHouse = new Map()
for (const a of accounts.filter(x => x.status !== '已销户')) {
  livePerHouse.set(a.houseId, (livePerHouse.get(a.houseId) || 0) + 1)
}
for (const [h, n] of livePerHouse) if (n > 1) problems.push(`房屋 ${h} 有 ${n} 个有效预存账户`)

/* 流水与账户必须自洽：最后一行的 balance = 账户余额 */
for (const [id, acc] of accById) {
  const mine = flows.filter(f => f.accountId === id).sort((a, b) => String(a.time).localeCompare(String(b.time)))
  if (!mine.length) continue
  const last = mine[mine.length - 1]
  if (r2(last.balance) !== r2(acc.balance)) {
    problems.push(`账户 ${id} 余额 ${acc.balance}，但最后一条流水是 ${last.balance}`)
  }
  /* 充值合计 / 抵扣合计也要对得上 */
  const sumIn = r2(mine.filter(f => f.type === '充值').reduce((s, f) => s + f.amount, 0))
  const sumOut = r2(mine.filter(f => f.type === '抵扣').reduce((s, f) => s + f.amount, 0))
  if (mine.length > 1 && r2(sumIn - sumOut) !== r2(acc.balance)) {
    problems.push(`账户 ${id} 流水净额 ${r2(sumIn - sumOut)} 与余额 ${acc.balance} 不一致`)
  }
}

for (const c of commerce) {
  if (!ownerSet.has(c.ownerId)) problems.push(`商业账户 ${c.ownerId} 不在业主档案里`)
  if ('balance' in c) problems.push(`商业账户 ${c.ownerId} 不该有 balance（两个余额不能混）`)
  if (!c.syncedAt) problems.push(`商业账户 ${c.ownerId} 缺 syncedAt`)
  if (!Array.isArray(c.coupons)) problems.push(`商业账户 ${c.ownerId} 缺优惠券`)
}

if (problems.length) {
  console.error('\n✘ 自检未通过：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

const demo = accById.get(DEMO_ACCOUNT_ID)
console.log(`\n✔ 预存账户 ${accounts.length} 条（其中演示种子 1 条）· 流水 ${flows.length} 条 · 商业镜像 ${commerce.length} 条`)
console.log(`  演示：${demo.ownerName} ${demo.houseName} 余额 ¥${demo.balance}（充值 ${demo.totalRecharge} − 抵扣 ${demo.totalDeduct}）`)
console.log(`  商业：积分 ${commerce[0].points} · ${commerce[0].coupons.length} 张券（不展示余额，也不能抵物业费）`)
