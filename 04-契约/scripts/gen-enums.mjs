/**
 * 枚举字典生成（契约用）
 * ----------------------------------------------------------------
 * 目的：让「值」只有一个来源。原型里的枚举散在 mock 数据、dict.js、各页面常量里，
 * 已经分叉过两次（部分缴 / 部分缴费、入场 / 进场）。这里从**真实数据**里取值集合，
 * 生成 enums.json 给后端建字典表、给前端做校验、给契约测试做断言。
 *
 * 用法：node scripts/gen-enums.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MOCK = path.resolve(ROOT, '..', '02-原型设计', 'mock')
const OUT = path.resolve(ROOT, 'enums.json')

const read = f => JSON.parse(fs.readFileSync(path.join(MOCK, f), 'utf8'))
const uniq = (rows, key) => [...new Set(rows.map(r => r[key]))].filter(v => v !== undefined && v !== null)

const owners = read('owners.json')
const bills = read('bills.json')
const payments = read('payments.json')
const workOrders = read('workOrders.json')
const tenants = read('tenants.json')
const contracts = read('contracts.json')
const notices = read('notices.json')
const inspectTasks = read('inspectTasks.json')
const qualityChecks = read('qualityChecks.json')

/** 枚举定义：name → { field, table, usedBy, note } */
const DEFS = [
  { name: 'billStatus', table: bills, field: 'status', usedBy: ['Bill.status'], note: '账单状态；「已减免」「已作废」不计入应收' },
  { name: 'billItem', table: bills, field: 'itemName', usedBy: ['Bill.itemName'], note: '收费科目名称（科目主数据见 /fee-items）' },
  { name: 'payMethod', table: payments, field: 'method', usedBy: ['Payment.method'], note: '收款方式；现金需日结实点' },
  { name: 'payChannel', table: payments, field: 'channel', usedBy: ['Payment.channel'], note: '收款渠道；与 method 不强绑定（POS 可刷微信）' },
  { name: 'invoiceStatus', table: payments, field: 'invoiceStatus', usedBy: ['Payment.invoiceStatus'], note: '开票状态；退款时已开票转「已冲红」' },
  { name: 'woStatus', table: workOrders, field: 'status', usedBy: ['WorkOrder.status'], note: '终态：已完工 / 已关闭 / 已评价；已取消不进 SLA' },
  { name: 'woType', table: workOrders, field: 'type', usedBy: ['WorkOrder.type'] },
  { name: 'woSource', table: workOrders, field: 'source', usedBy: ['WorkOrder.source'], note: '来源：业主自助 / 前台代报 / 电话 / 巡检转单' },
  { name: 'woPriority', table: workOrders, field: 'priority', usedBy: ['WorkOrder.priority'], note: '缺省 SLA：特急 2h / 紧急 4h / 普通 24h / 低 48h（工作日历）' },
  { name: 'woPayStatus', table: workOrders, field: 'payStatus', usedBy: ['WorkOrder.payStatus'] },
  { name: 'tenantVerify', table: tenants, field: 'verifyStatus', usedBy: ['Tenant.verifyStatus'], note: '待核验 / 已核验 / 信息不全' },
  { name: 'tenantSource', table: tenants, field: 'source', usedBy: ['Tenant.source'], note: '业主自助 / 物业补录' },
  { name: 'contractStatus', table: contracts, field: 'status', usedBy: ['Contract.status'] },
  { name: 'noticeStatus', table: notices, field: 'status', usedBy: ['Notice.status'] },
  { name: 'tenantStatus', values: ['在住', '已搬离'], usedBy: ['Tenant.status'], note: '在住 / 已搬离；搬离后保留记录可回溯（seed 里全是「在住」，已搬离由操作产生）' },
  { name: 'inspectTaskType', table: inspectTasks, field: 'taskType', usedBy: ['InspectTask.taskType'], note: '执行 = 一线做；监督 = 部门经理查下属落地情况（问题必须指定责任员工）' },
  { name: 'inspectStatus', table: inspectTasks, field: 'status', usedBy: ['InspectTask.status'] },
  { name: 'inspectPost', table: inspectTasks, field: 'post', usedBy: ['InspectTask.post'], note: '历史数据里有「保洁 / 保安」旧称，已按「环境 / 安保」统一，保留旧值仅为兼容' },
  { name: 'qualityGrade', table: qualityChecks, field: 'grade', usedBy: ['QualityCheck.grade'], note: '≥90 优秀 / ≥80 良好 / ≥70 合格 / <70 不合格' },
  /* 整改状态不是从 quality_checks 直接取的（那张表记的是检查状态），用静态声明保证唯一来源 */
  { name: 'rectifyStatus', values: ['待整改', '待复核', '已闭环', '已退回'], usedBy: ['RectifyOrder.status'], note: '已退回 = 复核不通过，整改项归零重做' },
  { name: 'rectifyLevel', values: ['轻微', '一般', '重大'], usedBy: ['RectifyOrder.level'], note: '重大 = 一票否决；一般 = 扣 ≥6 分' },
  /* 报表三类枚举都不是业务表里取的值，用静态声明 */
  { name: 'reportCode', values: ['arrears', 'collection-rate', 'dept-target'], usedBy: ['ReportCode'], note: '英文短代码（路由与批次号用）；中文名由前端字典渲染' },
  { name: 'reportBatchStatus', values: ['成功', '运行中', '失败'], usedBy: ['ReportSnapshot.status'], note: '失败批次保留可查，但不参与「最新成功批次」选取' },
  { name: 'agingBucket', values: ['未到期', '0-30天', '31-90天', '91-180天', '180天以上'], usedBy: ['ArrearsRow.aging'], note: '账龄按 statDate 与 dueDate 的天数差分档——所以报表必须落快照' },
  { name: 'reportPeriodType', values: ['日', '月', '年'], usedBy: ['ReportMeta.periodType', 'ReportRetentionType.periodType'], note: '对外中文、内部 day/month/year；混用会导致「找不到批次」' },
  /* 月结两态：反结不是删除，记录留着但期间解封 */
  { name: 'monthCloseStatus', values: ['已结账', '已反结'], usedBy: ['MonthClose.status'], note: '已反结 = 期间解封、报表批次作废并回到试算，记录不删除' }
]

const enums = {}
for (const d of DEFS) {
  const values = d.values
    ? [...d.values]
    : uniq(d.table, d.field).sort((a, b) => String(a).localeCompare(String(b), 'zh'))
  enums[d.name] = { values, usedBy: d.usedBy, ...(d.note ? { note: d.note } : {}) }
}

const out = {
  generatedAt: new Date().toISOString().slice(0, 19),
  source: '02-原型设计/mock/*.json（seed_dataset.py 生成）',
  note: '值本身为中文，后端请用 @JsonValue/@JsonCreator 直接映射，不要另造英文 code——否则前后端各存一套必然分叉',
  enums
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`enums.json 已生成：${Object.keys(enums).length} 个枚举`)
for (const [k, v] of Object.entries(enums)) console.log(`  ${k}: ${v.values.length} 值  ${v.values.slice(0, 6).join(' / ')}${v.values.length > 6 ? ' …' : ''}`)
