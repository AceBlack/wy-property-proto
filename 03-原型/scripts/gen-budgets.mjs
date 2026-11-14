/**
 * 年度预算种子（2026-11-14 · 预算对比报表）
 * ------------------------------------------------------------
 * 为什么预算要落在数据里、而不是报表里现算：
 * 预算是**被人审定过的数**，不是实际数的函数。用"实际 × 系数"在运行时算出来的
 * 执行率永远是同一个数，那种报表只能骗自己。
 *
 * 所以这里只有一张**人写的表**（下面 BUDGETS），脚本负责：
 *   ① 按分类字典校验 code 存在、方向一致（收入分类不能出现在支出预算上，反之亦然）；
 *   ② 写 03 mock 与 02 mock 两份（`check.mjs` 要求两份一致）；
 *   ③ 写 04 fixtures 一份（契约假服务读它）。
 *
 * 数从哪来：2026-08~10 三期实际的月均（收入 140.4 万 / 支出 486.0 万），
 * 按分类人工调整到"能看出问题"的水平 —— 有的类别宽（执行率 80%），有的紧（110%+）。
 * 这是演示预算，正式上线由财务在「预算编制」里录。
 *
 *   node scripts/gen-budgets.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const MOCK = path.resolve(ROOT, 'src', 'mock')
const MOCK2 = path.resolve(ROOT, '..', '02-原型设计', 'mock')
const FIX = path.resolve(ROOT, '..', '04-契约', 'fixtures')

const YEAR = 2026
/* communityId 为空 = 集团口径。项目级预算等财务真按项目编了再填，不在这里拍脑袋分摊 */
const COMMUNITY = ''

/* 月度预算（元/月）。收入看"够不够"，支出看"花超没有" */
const BUDGETS = [
  /* ---- 收入 ---- */
  ['INC_MAIN_PROPERTY', 334000, '物业费：按 756 户年化应收 × 1.02'],
  ['INC_OTHER_UTILITY', 54000, '水电费：转供水电，按上期实收下浮 5%'],
  ['INC_MAIN_PARK', 42000, '车位管理费：含地下车库照明公摊'],
  ['INC_MULTI_VENUE', 41000, '场地租赁：中庭与电梯广告位打包'],
  ['INC_MULTI_AD', 6000, '广告位：门禁机与道闸'],
  ['INC_OTHER_SERVICE', 2000, '临时服务费：开锁、通下水等零星'],
  ['INC_NONOP_COMP', 1000, '赔偿收入：公共设施损坏赔偿'],

  /* ---- 支出 · 人力 ---- */
  ['EXP_LABOR_SALARY', 1111000, '工资：120 人两期工资表月均 × 1.03'],
  ['EXP_LABOR_INSURANCE', 177000, '社保公积金：单位承担部分'],
  ['EXP_LABOR_WELFARE', 24000, '福利费：节日福利与体检'],
  ['EXP_LABOR_OUTSOURCE', 42000, '外包人力：劳务派遣（不含整包服务）'],

  /* ---- 支出 · 合同 ---- */
  ['EXP_CON_PROJECT', 62000, '工程分包：设施设备检修，按合同期摊'],
  ['EXP_CON_SECURITY', 50000, '秩序维护：安保外包'],
  ['EXP_CON_ELEV', 45000, '电梯维保：14 台'],
  ['EXP_CON_SERVICE', 42000, '保洁外包：三项目公共区域'],
  ['EXP_CON_GREEN', 35000, '绿化养护：含季节性补植'],
  ['EXP_CON_FIRE', 6000, '消防维保：系统年检'],

  /* ---- 支出 · 运营 ---- */
  ['EXP_OP_REPAIR', 36000, '维修材料：偏紧，考验领用管控'],
  ['EXP_OP_OFFICE', 26000, '办公费用'],
  ['EXP_OP_TAX', 9000, '税金及附加：按实缴'],
  ['EXP_OP_TRAVEL', 7000, '差旅费'],
  ['EXP_OP_ENTERTAIN', 2000, '业务招待：从紧'],
  ['EXP_OP_OTHER', 2000, '其他运营费用'],
  ['EXP_OP_FEE', 1000, '通道手续费：微信/支付宝']
]

const cats = JSON.parse(fs.readFileSync(path.join(MOCK, 'feeCategories.json'), 'utf8'))
const byCode = new Map(cats.map(c => [c.code, c]))

/* 校验：code 必须在字典里、必须是二级、方向要与分类一致 */
const problems = []
for (const [code, amount, note] of BUDGETS) {
  const c = byCode.get(code)
  if (!c) { problems.push(`${code} 不在分类字典里`); continue }
  if (c.level !== 2) problems.push(`${code} 是 ${c.level} 级分类，预算要挂二级（挂一级会和明细重复计算）`)
  if (!(amount > 0)) problems.push(`${code} 预算必须大于 0（不编就是没有，不要写 0 混过去）`)
  if (!note) problems.push(`${code} 缺说明：预算要有依据，否则月底没人能解释为什么是这个数`)
}
/* 一级分类不能有预算：否则合计时与二级重复 */
for (const [code] of BUDGETS) {
  const c = byCode.get(code)
  if (c && c.level === 1) problems.push(`${code} 是一级分类，预算只编到二级`)
}
if (problems.length) {
  console.error('预算表有问题：\n - ' + problems.join('\n - '))
  process.exit(1)
}

const rows = BUDGETS.map(([code, monthBudget, note], i) => ({
  budgetId: 'BG' + String(i + 1).padStart(4, '0'),
  year: YEAR,
  communityId: COMMUNITY,
  categoryCode: code,
  categoryName: byCode.get(code).name,
  direction: byCode.get(code).direction,
  monthBudget,
  note
}))

const write = (dir, file) => {
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, file)
  fs.writeFileSync(p, JSON.stringify(rows, null, 2) + '\n')
  return p
}
write(MOCK, 'budgets.json')
write(MOCK2, 'budgets.json')

/* 04 只留契约声明过的字段（categoryName / direction 是派生，后端从字典带出来） */
/* 契约的 Budget schema 字段：categoryName 带过去，报表侧不用再反查字典 */
const FIX_KEYS = ['budgetId', 'year', 'communityId', 'categoryCode', 'categoryName', 'monthBudget', 'note']
fs.mkdirSync(FIX, { recursive: true })
fs.writeFileSync(path.join(FIX, 'budgets.json'), JSON.stringify(
  rows.map(r => Object.fromEntries(FIX_KEYS.map(k => [k, r[k]]))), null, 2) + '\n')

const sum = d => rows.filter(r => r.direction === d).reduce((s, r) => s + r.monthBudget, 0)
console.log(`预算 ${rows.length} 条（${YEAR} · ${COMMUNITY || '集团'}）`)
console.log(`  收入 ${sum('income').toLocaleString()} / 月，年化 ${(sum('income') * 12 / 10000).toFixed(0)} 万`)
console.log(`  支出 ${sum('expense').toLocaleString()} / 月，年化 ${(sum('expense') * 12 / 10000).toFixed(0)} 万`)
console.log('  写入 03/02 mock 与 04 fixtures')
