// 报表配置：一张表 = 一份配置，页面只负责渲染，不写死任何列
// ready:true 表示已接通数据；未接通的在报表中心置灰并标注批次，避免误以为已交付
//
// 口径纪律：金额一律来自 api.js（isDebt / feeSummary），页面禁止自行 filter/reduce

import { billPeriodOpts, communityOpts, inspectPostOpts, qualityPeriodOpts, supFindingSupervisorOpts } from '@/utils/api'

/** 筛选控件：type 决定渲染成什么 */
const F = {
  community: { key: 'communityId', label: '项目', type: 'select', opts: () => communityOpts(), width: 150 },
  period: { key: 'period', label: '账期', type: 'select', opts: () => billPeriodOpts(), width: 120 },
  kw: { key: 'kw', label: '关键字', type: 'text', placeholder: '房号 / 业主 / 账单号', width: 180 },
  kwBuilding: { key: 'kw', label: '楼栋', type: 'text', placeholder: '楼栋名，如 3栋', width: 180 },
  inspectPost: { key: 'post', label: '岗位', type: 'select', opts: () => inspectPostOpts(), width: 120 },
  evalPeriod: { key: 'period', label: '评价周期', type: 'select', opts: () => qualityPeriodOpts(), width: 120 },
  supervisor: { key: 'supervisor', label: '主管', type: 'select', opts: () => supFindingSupervisorOpts(), width: 120 }
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
  },
  {
    // 2026-10-30 拍板：账龄类是**跑批产物**，不做实时算（实时算会让同一张表每刷新一次一个数）
    code: 'arrears-aging', name: '欠费账龄统计', group: 'G 统计（跑批）', prio: 'P0', ready: true,
    snapshot: 'arrears', snapshotType: 'point',
    desc: '按「楼栋 × 账龄」统计欠费规模：哪栋欠得多、欠了多久、主要欠什么科目，催缴排班照这张表排',
    filters: [F.community, F.kwBuilding],
    note: '账龄 = 统计日 − 到期日；「未到期」单列一档（没到期的不算逾期）；作废账单不进表；' +
      '车位账单没有楼栋，不在本表（差额在费用明细表里核对）',
    columns: [
      { prop: 'communityName', label: '项目', width: 110 },
      { prop: 'buildingName', label: '楼栋', width: 90 },
      { prop: 'aging', label: '账龄', width: 100 },
      { prop: 'billCount', label: '欠费笔数', width: 100, align: 'right' },
      { prop: 'houseCount', label: '涉及房屋', width: 100, align: 'right' },
      { prop: 'ownerCount', label: '涉及业主', width: 100, align: 'right' },
      { prop: 'payable', label: '涉及应收', width: 120, align: 'right', money: true },
      { prop: 'unpaid', label: '欠费金额', width: 120, align: 'right', money: true, strong: true },
      { prop: 'avgOverdueDays', label: '平均逾期', width: 100, align: 'right', unit: '天' },
      { prop: 'topItem', label: '主要科目', minWidth: 120, tip: true }
    ],
    summaryFields: [
      { k: 'count', l: '欠费笔数' },
      { k: 'payable', l: '涉及应收', money: true },
      { k: 'paid', l: '其中已逾期', money: true, warn: true },
      { k: 'unpaid', l: '欠费合计', money: true, warn: true }
    ]
  },
  {
    code: 'collection-rate', name: '收缴率统计', group: 'G 统计（跑批）', prio: 'P0', ready: true,
    snapshot: 'collection-rate', snapshotType: 'period',
    desc: '按「账期 × 科目」统计应收、已收与收缴率，减免与作废单列，避免把公司让利算成业主欠费',
    filters: [F.community, F.period],
    note: '收缴率 = 已收 ÷ 应收；分母**剔除已作废与已减免**——减免是公司决策不是业主欠费，' +
      '算进分母会让收缴率永远达标不了。应收为 0 时显示「—」而不是 0%',
    columns: [
      { prop: 'period', label: '账期', width: 90 },
      { prop: 'itemName', label: '科目', width: 130 },
      { prop: 'communityName', label: '项目', width: 110 },
      { prop: 'billCount', label: '账单数', width: 90, align: 'right' },
      { prop: 'payable', label: '应收', width: 120, align: 'right', money: true },
      { prop: 'paid', label: '已收', width: 120, align: 'right', money: true },
      { prop: 'unpaid', label: '未收', width: 120, align: 'right', money: true, strong: true },
      { prop: 'reduction', label: '减免', width: 100, align: 'right', money: true },
      { prop: 'voided', label: '作废', width: 100, align: 'right', money: true },
      { prop: 'rate', label: '收缴率', width: 100, align: 'right', unit: '%' }
    ],
    summaryFields: [
      { k: 'count', l: '账期 × 科目' },
      { k: 'payable', l: '应收合计', money: true },
      { k: 'paid', l: '已收合计', money: true },
      { k: 'unpaid', l: '未收合计', money: true, warn: true },
      { k: 'deduct', l: '减免合计', money: true }
    ]
  },
  {
    code: 'dept-quality', name: '部门达标率', group: 'F 现场', prio: 'P2', ready: true,
    snapshot: 'dept-target', snapshotType: 'period',
    desc: '按「部门 × 周期」看完成率、合格率、加权达标率与问题发现情况',
    filters: [F.evalPeriod, F.community, F.inspectPost],
    note: '达标率 = 合格率 × 权重 + 完成率 × 权重（权重按岗位可配）；完成率分母只算执行任务，' +
      '监督任务不进分母（否则越查越低）；得分再扣问题：自查 ×1、抽查 ×3',
    columns: [
      { prop: 'deptName', label: '部门', minWidth: 120 },
      { prop: 'post', label: '岗位', width: 76 },
      { prop: 'communityName', label: '项目', width: 100 },
      { prop: 'planned', label: '应执行', width: 84, align: 'right', unit: '次' },
      { prop: 'finished', label: '已完成', width: 84, align: 'right', unit: '次' },
      { prop: 'doneRate', label: '完成率', width: 86, align: 'right', unit: '%' },
      { prop: 'passRate', label: '合格率', width: 86, align: 'right', unit: '%' },
      { prop: 'weighted', label: '加权达标率', width: 104, align: 'right', unit: '%', strong: true },
      { prop: 'selfIssues', label: '自查问题', width: 92, align: 'right', unit: '项' },
      { prop: 'crossIssues', label: '抽查问题', width: 92, align: 'right', unit: '项', warn: true },
      { prop: 'score', label: '得分', width: 82, align: 'right' },
      { prop: 'grade', label: '等级', width: 82 },
      { prop: 'evaluated', label: '评价状态', width: 96, bool: ['已评价', '待评价'] }
    ],
    summaryFields: [
      { k: 'count', l: '部门数' },
      { k: 'payable', l: '应执行次数', money: false },
      { k: 'paid', l: '平均达标率', money: false },
      { k: 'unpaid', l: '问题合计', money: false, warn: true },
      { k: 'deduct', l: '抽查问题', money: false }
    ]
  },
  {
    code: 'sup-finding', name: '主管发现问题数', group: 'F 现场', prio: 'P1', ready: true,
    desc: '按「部门经理 × 周期」考核监督任务完成情况、问题检出量与申报冲突，看谁在真查、谁在走过场',
    fetchCode: 'supFinding',
    filters: [F.evalPeriod, F.community, F.inspectPost, F.supervisor],
    note: '只统计「监督」任务（一线执行任务不计）；发现问题数 = 监督任务异常项合计，每项都必须指定责任员工；' +
      '次均 = 发现问题 ÷ 已完成监督任务；申报冲突 = 下属报「零异常」却被查出问题的次数；' +
      '抽查未发现取评价记录录入值，主动发现率 = 自查 ÷（自查 + 抽查未发现）',
    columns: [
      { prop: 'supervisor', label: '主管', width: 90 },
      { prop: 'deptName', label: '部门', minWidth: 120 },
      { prop: 'post', label: '岗位', width: 76 },
      { prop: 'communityName', label: '项目', width: 100 },
      { prop: 'planned', label: '监督任务', width: 88, align: 'right', unit: '次' },
      { prop: 'done', label: '已完成', width: 84, align: 'right', unit: '次' },
      { prop: 'doneRate', label: '完成率', width: 84, align: 'right', unit: '%' },
      { prop: 'issues', label: '发现问题', width: 90, align: 'right', unit: '项', strong: true },
      { prop: 'perTask', label: '次均问题', width: 90, align: 'right' },
      { prop: 'issueRate', label: '问题检出率', width: 100, align: 'right', unit: '%' },
      { prop: 'conflicts', label: '申报冲突', width: 90, align: 'right', unit: '次', warn: true },
      { prop: 'crossMissed', label: '抽查未发现', width: 100, align: 'right', unit: '项', warn: true },
      { prop: 'proactive', label: '主动发现率', width: 100, align: 'right', unit: '%' }
    ],
    summaryFields: [
      { k: 'count', l: '考核主管', money: false },
      { k: 'payable', l: '监督任务', money: false },
      { k: 'paid', l: '发现问题', money: false, warn: true },
      { k: 'unpaid', l: '申报冲突', money: false, warn: true },
      { k: 'deduct', l: '抽查未发现', money: false }
    ]
  }
  ,
  {
    // 2026-10-29：工单列表去树后，「哪栋报修集中」由这张报表回答（原来靠左树看节点数）
    code: 'wo-by-building', name: '工单按楼栋分布', group: 'F 现场', prio: 'P1', ready: true,
    desc: '按楼栋统计工单量与处理压力：谁家报修多、多少没闭环、多少超时、每百户多少单',
    fetchCode: 'woBuilding',
    filters: [F.community],
    note: '只统计有房屋归属的工单（入户维修类）；公共区域 / 投诉 / 咨询类没有楼栋，不在本表；每百户 = 工单数 / 有工单的户数 × 100',
    columns: [
      { prop: 'communityName', label: '项目', width: 110 },
      { prop: 'buildingName', label: '楼栋', width: 120 },
      { prop: 'count', label: '工单数', width: 90, align: 'right', strong: true },
      { prop: 'open', label: '未闭环', width: 90, align: 'right' },
      { prop: 'overdue', label: '已超时', width: 90, align: 'right', warn: true },
      { prop: 'urgent', label: '紧急及以上', width: 110, align: 'right' },
      { prop: 'houseCount', label: '涉及户数', width: 90, align: 'right' },
      { prop: 'perHundred', label: '每百户工单', width: 110, align: 'right' },
      { prop: 'topType', label: '主要类型', minWidth: 120, tip: true }
    ],
    summaryFields: [
      { k: 'count', l: '楼栋数' },
      { k: 'payable', l: '工单合计', money: false },
      { k: 'paid', l: '未闭环', money: false },
      { k: 'unpaid', l: '已超时', money: false, warn: true }
    ]
  }
]

export const reportOf = code => REPORTS.find(r => r.code === code)
export const readyReports = () => REPORTS.filter(r => r.ready)
