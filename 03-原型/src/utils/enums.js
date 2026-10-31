// 枚举单一来源（2026-10-30）
//
// 背景：这套原型里「状态值」曾经两次分叉——`部分缴 / 部分缴费` 让欠费统计错降 1194 元，
// `入场 / 进场` 让通行小计显示 0。根因是页面各自写一份字符串数组，接口/数据改了页面不知道。
//
// 规则（后续开发沿用）：
//   ① **状态类**枚举一律从 `utils/dict.js` 的配色表派生 —— 那里已经是为了"配色"维护的全集，
//      再抄一份必然分叉；字典里新增状态，这里自动跟着变，页面也自动多一个选项。
//   ② **非状态类**枚举（缴费方式、工单类型等）在下面显式声明，因为它们的取值不参与配色。
//   ③ 页面禁止再出现 `['已缴', '未缴', ...]` 这类字面量数组，用 `ENUM.xxx` 或 api 的 `xxxOpts()`。
//   ④ 数据侧由「口径自检」(/e/audit) 校验：每一行的状态值必须落在枚举内，否则报红。

import { DICT } from '@/utils/dict'

/** dict 里已有的域，直接取键作为枚举全集（键顺序 = 字典里的书写顺序，也是页面下拉的顺序） */
const fromDict = domain => Object.keys(DICT[domain] || {})

export const ENUM = {
  /* ---------- 状态类：从字典派生 ---------- */
  billStatus: fromDict('bill'),                 // 已缴 / 未缴 / 部分缴 / 逾期 / 已减免 / 已作废
  woStatus: fromDict('workOrder'),
  priority: fromDict('priority'),
  qualityStatus: fromDict('quality'),           // 已闭环 / 整改中 / 待复核 / 已超时
  qualityGrade: fromDict('grade'),              // 优秀 / 良好 / 合格 / 不合格
  passDirection: ['入场', '出场'],               // 不是配色域，但方向值只有两种，显式写死更清楚
  tenantStatus: fromDict('tenantStatus'),
  tenantVerify: fromDict('tenantVerify'),
  contractStatus: fromDict('contract'),
  noticeStatus: fromDict('notice'),
  invoiceStatus: ['已开票', '未开票', '已冲红'],
  rectifyStatus: fromDict('rectify'),
  inspectStatus: fromDict('inspect'),
  deductionLevel: fromDict('rectifyLevel'),

  /* ---------- 非状态类：与数据取值严格对齐 ---------- */
  woType: ['入户维修', '公共区域维修', '投诉建议', '咨询', '报事', '其他'],
  payMethod: ['现金', '微信支付', '支付宝', 'POS刷卡', '银行代扣', '预存抵扣'],
  payChannel: ['现金', '微信支付', '支付宝', 'POS刷卡', '银行代扣', '预存抵扣'],
  passChannel: ['车牌识别', 'ETC', '人工'],
  tenantSource: ['业主自助', '物业补录'],
  qualitySource: ['现场抽查', '任务评价'],
  billSubject: ['house', 'park'],
  dataScope: ['全部项目', '指定项目', '本项目', '本部门', '责任范围', '仅本人']
}

/** 每个枚举对应哪个 dict 域（自检/文档用；没有配色域的是 null） */
export const ENUM_DICT_DOMAIN = {
  billStatus: 'bill', woStatus: 'workOrder', priority: 'priority',
  qualityStatus: 'quality', qualityGrade: 'grade',
  tenantStatus: 'tenantStatus', tenantVerify: 'tenantVerify',
  contractStatus: 'contract', noticeStatus: 'notice', rectifyStatus: 'rectify',
  inspectStatus: 'inspect', deductionLevel: 'rectifyLevel'
}

/** 某枚举的中文名（自检页展示、错误提示用） */
export const ENUM_LABEL = {
  billStatus: '账单状态', woStatus: '工单状态', priority: '工单优先级', qualityStatus: '品质整改状态',
  qualityGrade: '品质等级', passDirection: '通行方向', tenantStatus: '在住状态', tenantVerify: '租户核验状态',
  contractStatus: '合同状态', noticeStatus: '公告状态', invoiceStatus: '开票状态',
  woType: '工单类型', payMethod: '缴费方式', passChannel: '识别方式', tenantSource: '租户来源',
  qualitySource: '品质记录来源', billSubject: '账单对象', dataScope: '数据范围'
}

/** 合法值判断 */
export const isValidEnum = (name, value) => (ENUM[name] || []).includes(value)

/** 越界即抛错：表单提交、写操作前置校验统一用它 */
export function assertEnum(name, value, { allowEmpty = false } = {}) {
  if ((value === '' || value === null || value === undefined) && allowEmpty) return value
  if (!isValidEnum(name, value)) {
    const label = ENUM_LABEL[name] || name
    throw new Error(`${label}取值「${value}」不在枚举内（合法值：${(ENUM[name] || []).join(' / ')}）`)
  }
  return value
}
