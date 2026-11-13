/**
 * 生成批 5 的两份 mock：费用报销单（expenses）与手工补录（manualEntries）
 * ------------------------------------------------------------------
 * 为什么单独写脚本而不是手写 JSON：
 *   ① 140 条报销要有月份、项目、类型、金额的合理分布，手写必然前后矛盾；
 *   ② 两份 mock（03/src/mock 与 02-原型设计/mock）必须逐字节相同，
 *      手工复制一次就可能忘一次，脚本一次写两处。
 *
 * 口径：
 *   · 只生成「2026-01 ~ 2026-10」的已发生费用（演示时钟 TODAY=2026-10-21）；
 *   · 报销单状态只有三种会进支出归集：已付款（现金口径）、待付款（已发生未付）、审批中/已驳回不进；
 *   · 手工补录里的税费**只能是补录**（分类字典 EXP_OP_TAX 的 allowSources 只有 manual）。
 *
 * 重跑：node scripts/seed-expense-mock.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_A = path.join(ROOT, 'src', 'mock')
const OUT_B = path.join(ROOT, '..', '02-原型设计', 'mock')

const TODAY = '2026-10-21'

/* 确定性随机：同一条数据每次重跑都一样，diff 才看得清改了什么 */
let _s = 20261113
const rnd = () => { _s = (_s * 1103515245 + 12345) % 2147483648; return _s / 2147483648 }
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const between = (a, b) => a + rnd() * (b - a)
const r2 = n => Math.round(n * 100) / 100
const pad = (n, w = 4) => String(n).padStart(w, '0')
const d2 = n => String(n).padStart(2, '0')

const employees = JSON.parse(fs.readFileSync(path.join(OUT_A, 'employees.json'), 'utf8'))
const communities = JSON.parse(fs.readFileSync(path.join(OUT_A, 'communities.json'), 'utf8'))

const COMMS = communities.map(c => ({ id: c.communityId, name: c.name }))
const EMP = employees.filter(e => e.status !== '离职')

/** 项目 → 该项目部门的人（申请人要选真人，不能随机编名字） */
const empsOfCommunity = cid => {
  const list = EMP.filter(e => (e.orgId || '').includes(cid.replace('P0', 'P0')))
  return list.length ? list : EMP
}

/* ---------------- ① 费用报销单 ---------------- */

/** 类型 → 分类二级 + 金额区间 + 报销说明模板 */
const EXP_TYPES = [
  { type: '维修材料', categoryId: 'EXP_OP_REPAIR', min: 320, max: 18600, w: 34,
    reasons: ['单元门禁配件更换', '水泵房维修材料', '消防设施配件', '公共照明灯具与线材', '电梯门机配件'] },
  { type: '办公费', categoryId: 'EXP_OP_OFFICE', min: 120, max: 3200, w: 24,
    reasons: ['服务中心办公用品', '打印耗材与纸张', '前台物料与表单印刷', '保洁工具补充'] },
  { type: '差旅费', categoryId: 'EXP_OP_TRAVEL', min: 480, max: 6800, w: 15,
    reasons: ['集团项目巡检差旅', '外出培训差旅', '供应商考察差旅', '跨项目支援差旅'] },
  { type: '招待费', categoryId: 'EXP_OP_ENTERTAIN', min: 260, max: 4200, w: 15,
    reasons: ['业委会沟通接待', '供应商洽谈接待', '社区活动接待'] },
  { type: '其他', categoryId: 'EXP_OP_OTHER', min: 90, max: 2600, w: 12,
    reasons: ['临时用工费用', '快递与跑腿', '零星杂费'] }
]

/** 按权重展开成一个可抽样的数组 */
const EXP_POOL = EXP_TYPES.flatMap(t => Array.from({ length: t.w }, () => t))

const addDays = (date, n) => {
  const dt = new Date(date + 'T00:00:00')
  dt.setDate(dt.getDate() + n)
  return dt.toISOString().slice(0, 10)
}

const expenses = []
let exSeq = 0
for (let m = 1; m <= 10; m++) {
  const period = `2026-${d2(m)}`
  for (const c of COMMS) {
    /* 每项目每月 3~6 条：三个项目规模不一样，P01 最多 */
    const base = c.id === 'P01' ? 5 : (c.id === 'P02' ? 4 : 3)
    const n = base + Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) {
      const t = pick(EXP_POOL)
      const day = 1 + Math.floor(rnd() * (m === 10 ? 18 : 27))
      const happenDate = `${period}-${d2(day)}`
      const amount = r2(between(t.min, t.max))

      /* 付款日 = 发生日 + 3~15 天；超过今天就是"待付款" */
      const payDate = addDays(happenDate, 3 + Math.floor(rnd() * 13))
      let status = '已付款'
      if (payDate > TODAY) status = '待付款'
      /* 3% 被驳回、2% 还在审批：这两类不进支出归集，但列表要能看见 */
      const dice = rnd()
      if (dice < 0.03) status = '已驳回'
      else if (dice < 0.05) status = '审批中'

      const cands = empsOfCommunity(c.id)
      const applicant = pick(cands)
      exSeq += 1
      expenses.push({
        expenseId: 'EX' + pad(exSeq),
        applyNo: `EXP-${period.replace('-', '')}-${pad(exSeq, 3)}`,
        expenseType: t.type,
        categoryId: t.categoryId,
        amount,
        happenDate,
        period,
        communityId: c.id,
        communityName: c.name,
        orgId: applicant.orgId,
        applicant: applicant.name,
        applicantEmpId: applicant.empId,
        status,
        payDate: status === '已付款' ? payDate : '',
        invoiceCount: 1 + Math.floor(rnd() * 3),
        reason: `${pick(t.reasons)}（${c.name}）`
      })
    }
  }
}

/* ---------------- ② 手工补录 ---------------- */

/**
 * 只有四类会走补录，且都不是"日常发生"的费用：
 *   税金及附加（只能是补录）、通道手续费（银行/支付平台扣，无单据流）、
 *   赔偿收入（营业外）、其他运营费用（无票或票在外地）。
 */
const manual = []
let meSeq = 0
const addEntry = e => {
  meSeq += 1
  manual.push({
    entryId: 'ME' + pad(meSeq),
    entryNo: `BL-2026-${pad(meSeq, 3)}`,
    ...e,
    createdAt: `${e.bizDate} 09:${d2(10 + Math.floor(rnd() * 40))}`
  })
}

/* 税费：按季度，三个项目分别申报（增值税及附加，税率按 6% + 附加 12% 估算） */
const QUARTERS = [
  { period: '2026-03', bizDate: '2026-04-15', label: '2026 年一季度' },
  { period: '2026-06', bizDate: '2026-07-15', label: '2026 年二季度' },
  { period: '2026-09', bizDate: '2026-10-15', label: '2026 年三季度' }
]
const TAX_BASE = { P01: 186400, P02: 112800, P03: 96800 }
for (const q of QUARTERS) {
  for (const c of COMMS) {
    const vat = r2(TAX_BASE[c.id] * 0.06)
    const surcharge = r2(vat * 0.12)
    addEntry({
      direction: 'expense',
      categoryCode: 'EXP_OP_TAX',
      categoryName: '税金及附加',
      amount: r2(vat + surcharge),
      period: q.period,
      bizDate: q.bizDate,
      objectType: '项目',
      objectName: c.name,
      communityId: c.id,
      source: '增值税及附加',
      attachment: `${q.label}完税凭证.pdf`,
      reason: `${q.label}增值税 ¥${vat} + 附加税 ¥${surcharge}`,
      operator: '财务 · 陈瑞',
      status: '已入账',
      taxVat: vat,
      taxSurcharge: surcharge
    })
  }
}

/* 通道手续费：支付平台按月扣，没有发票流，只能补录 */
for (let m = 1; m <= 9; m++) {
  const period = `2026-${d2(m)}`
  addEntry({
    direction: 'expense',
    categoryCode: 'EXP_OP_FEE',
    categoryName: '通道手续费',
    amount: r2(between(320, 1860)),
    period,
    bizDate: `${period}-28`,
    objectType: '项目',
    objectName: '集团 / 全项目',
    communityId: '',
    source: '支付通道结算',
    attachment: `${period} 通道结算单.xlsx`,
    reason: `${period} 微信 / 支付宝通道手续费`,
    operator: '财务 · 陈瑞',
    status: '已入账'
  })
}

/* 赔偿收入：营业外，业主损坏公物赔偿 */
for (const it of [
  { name: '翡翠城 3栋 电梯轿厢划伤赔偿', amount: 800, date: '2026-05-18', cid: 'P01' },
  { name: '星光天地 地下车库道闸撞损赔偿', amount: 1500, date: '2026-08-09', cid: 'P03' },
  { name: '锦绣家园 单元门玻璃破损赔偿', amount: 420, date: '2026-09-22', cid: 'P02' }
]) {
  addEntry({
    direction: 'income',
    categoryCode: 'INC_NONOP_COMP',
    categoryName: '赔偿收入',
    amount: it.amount,
    period: it.date.slice(0, 7),
    bizDate: it.date,
    objectType: '项目',
    objectName: COMMS.find(c => c.id === it.cid).name,
    communityId: it.cid,
    source: '业主赔偿',
    attachment: '赔偿协议.pdf',
    reason: it.name,
    operator: '财务 · 陈瑞',
    status: '已入账'
  })
}

/* 其他运营费用：无票或票据在外地，只能补录 */
addEntry({
  direction: 'expense',
  categoryCode: 'EXP_OP_OTHER',
  categoryName: '其他运营费用',
  amount: 2680,
  period: '2026-07',
  bizDate: '2026-07-31',
  objectType: '项目',
  objectName: '翡翠城',
  communityId: 'P01',
  source: '临时清运',
  attachment: '情况说明.docx',
  reason: '装修垃圾临时清运，清运队无法开票',
  operator: '财务 · 陈瑞',
  status: '已入账'
})

/* ---------------- ③ 写两份 ---------------- */

const write = (dir, name, data) => {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n', 'utf8')
}
write(OUT_A, 'expenses.json', expenses)
write(OUT_B, 'expenses.json', expenses)
write(OUT_A, 'manualEntries.json', manual)
write(OUT_B, 'manualEntries.json', manual)

/* index.js 两份同步：加 import 与导出 */
const addToIndex = dir => {
  const p = path.join(dir, 'index.js')
  let s = fs.readFileSync(p, 'utf8')
  if (!s.includes("import expenses from")) {
    s = s.replace('import merchants from "./merchants.json";',
      'import merchants from "./merchants.json";\n// 批 5（2026-11-13）：费用报销与手工补录 —— 支出归集的两条来源\nimport expenses from "./expenses.json";\nimport manualEntries from "./manualEntries.json";')
  }
  if (!s.includes('expenses, manualEntries }')) {
    s = s.replace(/, merchants };/, ', merchants, expenses, manualEntries };')
  }
  fs.writeFileSync(p, s, 'utf8')
}
addToIndex(OUT_A)
addToIndex(OUT_B)

const sumBy = (list, k) => list.reduce((m, x) => { m[x[k]] = (m[x[k]] || 0) + 1; return m }, {})
console.log('expenses', expenses.length, sumBy(expenses, 'status'))
console.log('  按类型', sumBy(expenses, 'expenseType'))
console.log('  已付款金额', r2(expenses.filter(e => e.status === '已付款').reduce((s, e) => s + e.amount, 0)))
console.log('manualEntries', manual.length, sumBy(manual, 'categoryCode'))
console.log('  税费合计', r2(manual.filter(m => m.categoryCode === 'EXP_OP_TAX').reduce((s, m) => s + m.amount, 0)))
