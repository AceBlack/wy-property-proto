/**
 * 演示时钟与登录身份。
 *
 * 为什么要「演示日期」：mock 里巡检任务的 scheduledDate 落在 2026-09-14 ~ 2026-10-21，
 * 审批 / 整改 / 工单的日期也在 10 月，如果直接用系统当天，「今日」「剩余时间」全都不对。
 * 所以全 App 统一用 DEMO.today 作为「今天」，界面上明确标出这个日期，不假装是真实今天。
 *
 * **日期跟随 PC，不在这里另写一个**（2026-11-08 收口）：
 * 原来这里硬写 '2026-10-20'，而 PC 的 `utils/format.TODAY` 与假服务的 `DATA_DATE` 都是 '2026-10-21'。
 * 差一天的后果不是"显示不同"，而是同一场活动在两端阶段不同（AC0015 的报名截止日正好卡在 10-20）、
 * 打卡日期与工单超时各算一天。现在从 PC 导入，PC 改日期员工端自动跟，不会再有第二次分叉。
 */
import { TODAY } from '@pc/utils/format'

export const DEMO = {
  today: TODAY,
  /** 演示时刻：卡在这一天的 10:00 —— 09:00 的监督任务已超时、14:00 的执行任务还剩 4 小时 */
  nowTime: '10:00',
  get nowText() {
    return `${this.today} ${this.nowTime}`
  }
}

/** 演示时钟（固定值，便于截图与断言稳定） */
export function demoNow() {
  return new Date(`${DEMO.today}T${DEMO.nowTime}:00`)
}

/** 写操作落库用的时间戳（与演示时钟一致，避免出现"10-31 提交、10-20 计划"的怪记录） */
export const stamp = () => DEMO.nowText

/**
 * 移动端能力码。
 * 前 6 条是 PC 已有的权限位，后 4 条是本轮新增（已在 README 的「待进契约」里列清）：
 *   c.notices.read        公告阅读（PC 的 c.notices.view 语义是"管理公告"，只有总经理/项目经理有）
 *   c.attendance.self     考勤本人查询（一线没有任何 c.employees.* 权限）
 *   c.payroll.self        工资条本人查询（PC 的 c.payroll.view 是全表，不能给一线）
 *   f.approval.handle     业务审批处理（PC 的 87 条审批只有 currentNode 岗位名，没有权限位）
 *   f.workorders.dispatch 指派他人（项目经理把单派给维修工；与工单列表同一个 func，权限矩阵不新增行）
 *   f.rectify.recheck     整改复核（PC 侧品质督导做，项目经理也有权）
 */
export const CAP = {
  inspView: 'f.inspect.view',
  inspExec: 'f.inspect.exec',
  woView: 'f.workorders.view',
  woEdit: 'f.workorders.edit',
  woDispatch: 'f.workorders.dispatch',
  approve: 'f.approval.handle',
  rectify: 'f.rectify.edit',
  recheck: 'f.rectify.recheck',
  building: 'a.stewards.view',
  ownersView: 'a.owners.view',
  ownersEdit: 'a.owners.edit',
  tenantsView: 'a.tenants.view',
  tenantsEdit: 'a.tenants.edit',
  tagDictView: 'e.ownerTags.view',
  contactsView: 'c.contacts.view',
  neighborItemView: 'n.items.view',
  neighborItemAudit: 'n.items.audit',
  neighborReportView: 'n.reports.view',
  neighborReportHandle: 'n.reports.handle',
  neighborActView: 'n.activities.view',
  neighborActEnroll: 'n.activities.enroll',
  /* 租售信息（PC 第 69 批）。审核口径与邻里**不同**：楼管在邻里只读，
     在租售里却是审核人和回拨人 —— 两个模块各用各的码，别为了"统一"合并。 */
  listingView: 'a.listings.view',
  metersView: 'b.meters.view',
  metersRead: 'b.meters.read',
  listingAudit: 'a.listings.audit',
  listViewing: 'a.listings.viewing',
  billsView: 'b.bills.view',
  sensitive: 'a.sensitive.view',
  finance: 'e.reports.view',
  noticeRead: 'c.notices.read',
  attendanceSelf: 'c.attendance.self',
  payrollSelf: 'c.payroll.self',
  templatesView: 'f.inspectTemplates.view'
}

/**
 * 4 个演示身份。都取自 mock 里真有数据的执行人/员工，否则点进去是空列表。
 * 一线执行人里有几位是「计划上的运营设定值」，不在员工名册（PC 端踩过这个坑），
 * 所以 empNo / empId 可以为空 —— 界面会如实标注，不编一个工号出来。
 */
export const PERSONAS = [
  {
    id: 'zhou-ming',
    name: '周明',
    post: '工程维修',
    roleName: '工程维修',
    roleId: 'R-ENG',
    team: '',
    orgId: 'O-P01-T2',
    orgName: '翡翠城 · 工程组',
    communityId: 'P01',
    empId: '',
    empNo: '',
    lead: false,
    desc: '一线 · 巡检 + 接工单，今日 3 单待办',
    /* 抄表：一线维修工现场录读数（2026-11-14） */
    perms: [CAP.inspView, CAP.inspExec, CAP.woView, CAP.woEdit, CAP.noticeRead, CAP.attendanceSelf, CAP.payrollSelf, CAP.contactsView,
      CAP.metersView, CAP.metersRead]
  },
  {
    id: 'wang-lei',
    name: '汪磊',
    post: '客服主管',
    roleName: '部门经理',
    roleId: 'R-SEC',
    team: 'T1',
    /* 2026-11-04：档案归到客服组，并作为该组正职（原数据把负责人写成了 P03 的宋杰，档案与关系表对不上） */
    orgId: 'O-P01-T1',
    orgName: '翡翠城 · 客服组',
    communityId: 'P01',
    empId: 'EM0018',
    empNo: 'J210018',
    lead: true,
    desc: '客服组组长 · 监督核验 + 客服主管节点审批 + 本部门整改',
    perms: [
      CAP.inspView,
      CAP.inspExec,
      CAP.templatesView,
      CAP.woView,
      CAP.woEdit,
      CAP.approve,
      CAP.rectify,
      CAP.building,
      CAP.ownersView,
      CAP.billsView,
      CAP.sensitive,
      CAP.noticeRead,
      CAP.attendanceSelf,
      CAP.payrollSelf,
      CAP.neighborItemView,
      CAP.neighborItemAudit,
      CAP.neighborReportView,
      CAP.neighborReportHandle,
      CAP.neighborActView,
      CAP.neighborActEnroll,
      CAP.listingView,
      CAP.listViewing,
      CAP.contactsView
    ]
  },
  {
    id: 'mo-rui',
    name: '莫瑞',
    post: '楼栋管家',
    roleName: '楼栋管家',
    roleId: 'R-STW',
    team: '',
    orgId: 'O-P01',
    orgName: '翡翠城 · 楼管',
    communityId: 'P01',
    empId: 'EM0027',
    empNo: 'J230027',
    lead: false,
    desc: '楼栋管家 · 4 栋 176 户的欠费与业主信息，就地在手机上处理',
    perms: [
      CAP.ownersView,
      CAP.ownersEdit,
      CAP.tenantsView,
      CAP.tenantsEdit,
      CAP.billsView,
      CAP.building,
      CAP.woView,
      CAP.woEdit,
      CAP.sensitive,
      CAP.noticeRead,
      CAP.attendanceSelf,
      CAP.payrollSelf,
      CAP.neighborItemView,
      CAP.neighborReportView,
      CAP.neighborActView,
      /* 租售是楼管的主场：审挂牌、回看房电话、维护自己的微信号 */
      CAP.listingView,
      CAP.listingAudit,
      CAP.listViewing,
      CAP.contactsView,
      /* 抄表：楼管与维修工现场录读数（2026-11-14） */
      CAP.metersView,
      CAP.metersRead
        ]
  },
  {
    id: 'xu-yue',
    name: '徐悦',
    post: '项目经理',
    roleName: '项目经理',
    roleId: 'R-PM',
    team: '',
    orgId: 'O-P01',
    orgName: '翡翠城 · 项目部',
    communityId: 'P01',
    empId: 'EM0008',
    empNo: 'J210008',
    lead: true,
    desc: '项目经理（O-P01 正职）· 项目经理节点审批、整改复核、指派工单、看费用',
    perms: [
      CAP.inspView,
      CAP.woView,
      CAP.woEdit,
      CAP.woDispatch,
      CAP.approve,
      CAP.rectify,
      CAP.recheck,
      CAP.ownersView,
      CAP.ownersEdit,
      CAP.billsView,
      CAP.sensitive,
      CAP.finance,
      CAP.noticeRead,
      CAP.attendanceSelf,
      CAP.payrollSelf,
      CAP.neighborItemView,
      CAP.neighborItemAudit,
      CAP.neighborReportView,
      CAP.neighborReportHandle,
      CAP.neighborActView,
      CAP.neighborActEnroll,
      CAP.listingView,
      CAP.listingAudit,
      CAP.listViewing,
      CAP.contactsView,
      /* 抄表：楼管与维修工现场录读数（2026-11-14） */
      CAP.metersView
        ]
  }
]

export const personaById = id => PERSONAS.find(p => p.id === id) || null

/** 身份徽标：不能只用 lead 二分成「班组长 / 一线」，楼管与项目经理都不是一线 */
export const roleBadge = p => {
  if (!p) return ''
  if (p.roleId === 'R-STW') return '楼栋管家'
  if (p.roleId === 'R-PM') return '项目经理'
  return p.lead ? '班组长' : '一线员工'
}

export const can = (persona, code) => !!persona && Array.isArray(persona.perms) && persona.perms.includes(code)
