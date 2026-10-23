// 报表配置：一张表 = 一份配置，页面只负责渲染，不写死任何列
// ready:true 表示已接通数据；未接通的在报表中心置灰并标注批次，避免误以为已交付
//
// 口径纪律：金额一律来自 api.js（isDebt / feeSummary），页面禁止自行 filter/reduce

import { billPeriodOpts, communityOpts, inspectPostOpts } from '@/utils/api'

/** 筛选控件：type 决定渲染成什么 */
const F = {
  community: { key: 'communityId', label: '项目', type: 'select', opts: () => communityOpts(), width: 150 },
  period: { key: 'period', label: '账期', type: 'select', opts: () => billPeriodOpts(), width: 120 },
  kw: { key: 'kw', label: '关键字', type: 'text', placeholder: '房号 / 业主 / 账单号', width: 180 },
  inspectPost: { key: 'post', label: '岗位', type: 'select', opts: () => inspectPostOpts(), width: 120 }
}

export const REPORTS = [
  {
    code: 'fee-detail', name: '费用明细表', group: 'B 费用', prio: 'P0', ready: true,
    desc: '每一笔应收的账期、科目、应收 / 已收 / 未收，财务对账的主表',
    fetchCode: 'bills',
    filters: [F.community, F.period, F.kw],
    note: '应收取 payable（含滞纳金、减减免），已收取 paidAmount；已减免、已作废不计入欠费',
    columns: [
      { prop: 'billId', label: '账单号', width: 130 },
      { prop: 'period', label: '账期', width: 90 },
      { prop: 'itemName', label: '科目', width: 120 },
      { prop: 'houseName', label: '房屋 / 车位', minWidth: 180, tip: true },
      { prop: 'ownerName', label: '业主', width: 90 },
      { prop: 'payable', label: '应收', width: 110, align: 'right', money: true },
      { prop: 'paidAmount', label: '已收', width: 110, align: 'right', money: true },
      { prop: 'unpaid', label: '未收', width: 110, align: 'right', money: true, strong: true },
      { prop: 'status', label: '状态', width: 90, tag: 'bill' },
      { prop: 'overdueDays', label: '逾期天数', width: 90, align: 'right' }
    ],
    summaryFields: [
      { k: 'count', l: '记录数' },
      { k: 'payable', l: '应收合计', money: true },
      { k: 'paid', l: '已收合计', money: true },
      { k: 'unpaid', l: '未收合计', money: true, warn: true }
    ]
  },
  {
    code: 'debt-detail', name: '欠费明细表', group: 'B 费用', prio: 'P0', ready: true,
    desc: '欠费口径 = 未缴 / 部分缴 / 逾期且 unpaid > 0，按账龄倒序，催缴直接照这张表打',
    fetchCode: 'bills', defaultFilters: { vf: 'debt' },
    filters: [F.community, F.kw],
    columns: [
      { prop: 'billId', label: '账单号', width: 130 },
      { prop: 'period', label: '账期', width: 90 },
      { prop: 'itemName', label: '科目', width: 120 },
      { prop: 'houseName', label: '房屋 / 车位', minWidth: 180, tip: true },
      { prop: 'ownerName', label: '业主', width: 90 },
      { prop: 'payable', label: '应收', width: 110, align: 'right', money: true },
      { prop: 'paidAmount', label: '已收', width: 110, align: 'right', money: true },
      { prop: 'unpaid', label: '欠费金额', width: 120, align: 'right', money: true, strong: true },
      { prop: 'overdueDays', label: '逾期天数', width: 100, align: 'right' },
      { prop: 'status', label: '状态', width: 90, tag: 'bill' }
    ],
    note: '欠费 = 未缴 / 部分缴 / 逾期且 unpaid > 0，与费用驾驶舱「欠费」同源；应收减已收即欠费',
    summaryFields: [
      { k: 'count', l: '欠费笔数' },
      { k: 'payable', l: '涉及应收', money: true },
      { k: 'paid', l: '已收部分', money: true },
      { k: 'unpaid', l: '欠费合计', money: true, warn: true }
    ]
  },
  {
    code: 'unpaid-house', name: '未收费房屋', group: 'B 费用', prio: 'P0', ready: true,
    desc: '房屋维度聚合欠费，按欠费金额倒序；用于锁定重点催缴对象',
    fetchCode: 'unpaidHouses',
    filters: [F.community, F.kw],
    columns: [
      { prop: 'fullName', label: '房屋', minWidth: 180, tip: true },
      { prop: 'communityName', label: '项目', width: 110 },
      { prop: 'ownerName', label: '业主', width: 90 },
      { prop: 'useStatus', label: '使用状态', width: 100, tag: 'house' },
      { prop: 'area', label: '面积', width: 90, align: 'right', unit: '㎡' },
      { prop: 'debtCount', label: '欠费笔数', width: 90, align: 'right' },
      { prop: 'debt', label: '欠费金额', width: 120, align: 'right', money: true, strong: true },
      { prop: 'maxOverdue', label: '最长逾期', width: 100, align: 'right', unit: '天' }
    ],
    note: '仅统计有 houseId 的账单；车位欠费不在本表口径内（差额可在费用明细表中核对）',
    summaryFields: [
      { k: 'count', l: '涉及房屋' },
      { k: 'unpaid', l: '房屋欠费合计', money: true, warn: true }
    ]
  },
  {
    code: 'pay-detail', name: '缴费明细表', group: 'B 费用', prio: 'P1', ready: true,
    desc: '每一笔收款的时间、渠道、方式与开票状态，用于对账与开票',
    fetchCode: 'payments',
    filters: [F.community, F.kw],
    note: '已收取 payment.amount；开票状态为「未开票」的可在流水页批量开票',
    columns: [
      { prop: 'payId', label: '流水号', width: 130 },
      { prop: 'payTime', label: '收款时间', width: 120 },
      { prop: 'ownerName', label: '业主', width: 90 },
      { prop: 'houseName', label: '房屋 / 车位', minWidth: 180, tip: true },
      { prop: 'itemName', label: '科目', width: 120 },
      { prop: 'amount', label: '收款金额', width: 120, align: 'right', money: true, strong: true },
      { prop: 'method', label: '支付方式', width: 100 },
      { prop: 'channel', label: '渠道', width: 100 },
      { prop: 'invoiceStatus', label: '开票', width: 90, tag: 'invoice' }
    ],
    summaryFields: [
      { k: 'count', l: '流水笔数' },
      { k: 'paid', l: '收款合计', money: true, warn: true }
    ]
  },
  {
    code: 'business', name: '营业报表', group: 'B 费用', prio: 'P1', ready: true,
    desc: '按「项目 × 科目」汇总应收 / 已收 / 未收与收缴率，经营分析主表',
    fetchCode: 'business',
    filters: [F.community, F.kw],
    note: '收缴率 = 已收 ÷ 应收；分母剔除「已作废」与「已减免」账单（Q1 口径），应收为 0 时显示「—」而不是 0%',
    columns: [
      { prop: 'communityName', label: '项目', width: 110 },
      { prop: 'itemName', label: '科目', width: 130 },
      { prop: 'count', label: '账单数', width: 90, align: 'right' },
      { prop: 'payable', label: '应收', width: 120, align: 'right', money: true },
      { prop: 'paid', label: '已收', width: 120, align: 'right', money: true },
      { prop: 'unpaid', label: '未收', width: 120, align: 'right', money: true, strong: true },
      { prop: 'rate', label: '收缴率', width: 100, align: 'right', unit: '%' }
    ],
    summaryFields: [
      { k: 'payable', l: '应收合计', money: true },
      { k: 'paid', l: '已收合计', money: true },
      { k: 'unpaid', l: '未收合计', money: true, warn: true }
    ]
  },
  {
    code: 'repair-summary', name: '报修汇总表', group: 'F 现场', prio: 'P1', ready: true,
    desc: '按「项目 × 工单类型」汇总工单量、完工量、超时量与平均处理时长',
    fetchCode: 'repair',
    filters: [F.community, F.kw],
    note: '平均时长只统计已填写处理时长的工单；超时以 isOverdue 为准',
    columns: [
      { prop: 'communityName', label: '项目', width: 110 },
      { prop: 'type', label: '工单类型', width: 130 },
      { prop: 'count', label: '工单量', width: 90, align: 'right' },
      { prop: 'done', label: '已完工', width: 90, align: 'right' },
      { prop: 'overdue', label: '超时', width: 90, align: 'right', strong: true },
      { prop: 'avgHours', label: '平均时长', width: 110, align: 'right', unit: '小时' }
    ],
    summaryFields: [
      { k: 'count', l: '工单总量' },
      { k: 'payable', l: '已完工', money: false },
      { k: 'paid', l: '超时量', money: false, warn: true }
    ]
  },
  {
    code: 'deposit', name: '装修押金报表', group: 'B 费用', prio: 'P0', ready: true,
    desc: '装修押金的收、扣、退与在账余额，验收超期的单独立项催退',
    fetchCode: 'deposits',
    filters: [F.community, F.kw],
    note: '押金场景只保留「装修押金」一种（租约押金、车位押金均不存在）；在账 = 收取 − 已退 − 扣除',
    columns: [
      { prop: 'depositId', label: '押金单号', width: 110 },
      { prop: 'houseName', label: '房屋', minWidth: 158, tip: true },
      { prop: 'ownerName', label: '业主', width: 70 },
      { prop: 'amount', label: '收取', width: 95, align: 'right', money: true },
      { prop: 'status', label: '状态', width: 88, tag: 'deposit' },
      { prop: 'deductAmount', label: '扣除', width: 85, align: 'right', money: true },
      { prop: 'refundAmount', label: '已退', width: 95, align: 'right', money: true },
      { prop: 'balance', label: '在账', width: 95, align: 'right', money: true, strong: true },
      { prop: 'overdueDays', label: '逾期', width: 72, align: 'right', unit: '天' }
    ],
    summaryFields: [
      { k: 'count', l: '押金笔数' },
      { k: 'payable', l: '收取合计', money: true },
      { k: 'paid', l: '已退合计', money: true },
      { k: 'deduct', l: '扣除合计', money: true },
      { k: 'unpaid', l: '在账余额', money: true, warn: true }
    ]
  },
  {
    code: 'inspect', name: '巡检报表', group: 'F 现场', prio: 'P2', ready: true,
    desc: '按「计划 × 项目」看完成率、异常项分布与转单情况',
    fetchCode: 'inspect',
    filters: [F.community, F.inspectPost, F.kw],
    note: '完成率 = 已完成 / 应执行；异常项 = 各任务 issueCount 合计；转单数按项目内异常项占比分摊到计划',
    columns: [
      { prop: 'planName', label: '巡检计划', minWidth: 170, tip: true },
      { prop: 'communityName', label: '项目', width: 100 },
      { prop: 'post', label: '岗位', width: 76 },
      { prop: 'executor', label: '执行人', width: 90 },
      { prop: 'planned', label: '应执行', width: 84, align: 'right', unit: '次' },
      { prop: 'done', label: '已完成', width: 84, align: 'right', unit: '次' },
      { prop: 'doneRate', label: '完成率', width: 92, align: 'right', unit: '%', strong: true },
      { prop: 'late', label: '逾期/超时', width: 92, align: 'right', unit: '次', warn: true },
      { prop: 'issues', label: '异常项', width: 84, align: 'right', unit: '项' },
      { prop: 'transferred', label: '转工单', width: 84, align: 'right', unit: '单' },
      { prop: 'avgDuration', label: '平均耗时', width: 92, align: 'right', unit: '分钟' }
    ],
    summaryFields: [
      { k: 'count', l: '计划 × 项目' },
      { k: 'planned', l: '应执行', money: false },
      { k: 'doneRate', l: '完成率', money: false },
      { k: 'issues', l: '异常项', money: false, warn: true }
    ]
  }
]

export const reportOf = code => REPORTS.find(r => r.code === code)
export const readyReports = () => REPORTS.filter(r => r.ready)
