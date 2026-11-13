/**
 * OA 单据与审批流配置（2026-11-03）
 *
 * 这一层只放**静态定义**，不放业务逻辑（业务在 utils/api.js）：
 *   · OA_FORM_DEFS   单据类型 + 表单字段（字段描述驱动渲染，不硬编码成列）
 *   · OA_FLOW_DEFS   每种单据的默认审批流（节点 + 审批人来源 + 金额条件分支）
 *
 * 两条设计纪律：
 *   ① **字段用描述而不是固定列**：加第七种单据只加一条定义，不改表结构、不改页面；
 *   ② **审批人来源用规则不用人名**：写死"张经理"之后，人一调岗审批就断。
 */

/* 字段类型：
 *   text / textarea / number / date / datetime / select / money / file
 * `role: 'amount'` 的字段参与金额条件分支（≥threshold 走更长的流程）
 * `role: 'period'` 的字段用于算天数/时长（请假、加班）
 */
export const OA_FORM_DEFS = [
  {
    bizType: '用车申请',
    code: 'CAR',
    icon: 'Van',
    desc: '公务用车：市内办事、接送、外出采购',
    urgentDefault: '普通',
    fields: [
      { key: 'useAt', label: '用车时间', type: 'datetime', required: true },
      { key: 'backAt', label: '预计返回', type: 'datetime' },
      { key: 'destination', label: '目的地', type: 'text', required: true, maxlength: 40 },
      { key: 'passengers', label: '随行人数', type: 'number', min: 1, max: 15, default: 1 },
      { key: 'withDriver', label: '是否需司机', type: 'select', options: ['需司机', '自驾'], default: '需司机' },
      { key: 'reason', label: '用车事由', type: 'textarea', required: true, maxlength: 200 }
    ],
    /* 摘要里显示哪几个字段（列表/待办不该把 8 个字段全列出来） */
    summaryKeys: ['destination', 'useAt', 'passengers']
  },
  {
    bizType: '费用报销',
    code: 'EXP',
    icon: 'Money',
    desc: '日常费用报销：办公、差旅、招待、维修材料',
    urgentDefault: '普通',
    fields: [
      { key: 'expenseType', label: '费用类型', type: 'select', required: true,
        options: ['办公费', '差旅费', '招待费', '维修材料', '其他'] },
      /* 明细表（2026-11-13）：采购类报销要能逐项列，只填一个总额事后核不了账。
         字段类型 `items` 由渲染层按 columns 画表格，后台与员工端共用这一份定义。 */
      { key: 'items', label: '采购明细', type: 'items', required: true,
        columns: [
          { key: 'name', label: '物品名称', type: 'text', required: true, width: 130 },
          { key: 'spec', label: '型号规格', type: 'text', width: 120 },
          { key: 'unit', label: '单位', type: 'text', width: 60 },
          { key: 'needQty', label: '需求数量', type: 'number', width: 84 },
          { key: 'stockQty', label: '库存数量', type: 'number', width: 84 },
          { key: 'buyQty', label: '本次采购', type: 'number', required: true, width: 88 },
          { key: 'price', label: '单价', type: 'money', required: true, width: 90 },
          { key: 'total', label: '总价', type: 'computed', width: 96 },
          { key: 'note', label: '备注', type: 'text', width: 120 }
        ],
        hint: '总价 = 单价 × 本次采购数量；本次采购数量不得超过「需求数量 − 库存数量」，超了请在备注里说明'
      },
      /* 金额改为明细合计，只读：明细 3 行合计 800、报销填 1000，审批人没法判断该信哪个 */
      { key: 'amount', label: '报销金额', type: 'money', required: true, role: 'amount', min: 1, max: 200000,
        derived: 'items' },
      { key: 'happenDate', label: '发生日期', type: 'date', required: true },
      { key: 'communityId', label: '所属项目', type: 'select', required: true, opts: 'community' },
      { key: 'invoiceCount', label: '发票张数', type: 'number', min: 0, max: 50, default: 1 },
      { key: 'reason', label: '费用说明', type: 'textarea', required: true, maxlength: 200 },
      { key: 'files', label: '票据附件', type: 'file', hint: '拍照或扫描件，最多 5 个' }
    ],
    summaryKeys: ['expenseType', 'amount', 'happenDate']
  },
  {
    bizType: '请假申请',
    code: 'LEAVE',
    icon: 'Calendar',
    desc: '事假 / 病假 / 年假 / 调休 / 婚假 / 产假',
    urgentDefault: '普通',
    fields: [
      { key: 'leaveType', label: '假别', type: 'select', required: true,
        options: ['事假', '病假', '年假', '调休', '婚假', '产假', '陪产假'] },
      { key: 'startAt', label: '开始时间', type: 'datetime', required: true },
      { key: 'endAt', label: '结束时间', type: 'datetime', required: true, role: 'periodEnd', after: 'startAt' },
      { key: 'hours', label: '请假时长', type: 'number', unit: '小时', required: true, min: 0.5, max: 400 },
      { key: 'handover', label: '工作交接人', type: 'text', maxlength: 20 },
      { key: 'reason', label: '请假事由', type: 'textarea', required: true, maxlength: 200 },
      { key: 'files', label: '证明材料', type: 'file', hint: '病假需附诊断证明；事假可不传' }
    ],
    summaryKeys: ['leaveType', 'startAt', 'hours']
  },
  {
    bizType: '加班申请',
    code: 'OT',
    icon: 'Clock',
    desc: '工作日延时 / 周末与节假日加班，用于调休与加班费核算',
    urgentDefault: '普通',
    fields: [
      { key: 'otDate', label: '加班日期', type: 'date', required: true },
      { key: 'startAt', label: '开始时间', type: 'datetime', required: true },
      { key: 'endAt', label: '结束时间', type: 'datetime', required: true, role: 'periodEnd', after: 'startAt' },
      { key: 'hours', label: '加班时长', type: 'number', unit: '小时', required: true, min: 0.5, max: 24 },
      { key: 'otType', label: '加班类型', type: 'select', options: ['工作日延时', '休息日', '法定节假日'], required: true },
      { key: 'compensate', label: '补偿方式', type: 'select', options: ['调休', '加班费'], default: '调休' },
      { key: 'reason', label: '加班事由', type: 'textarea', required: true, maxlength: 200 }
    ],
    summaryKeys: ['otDate', 'hours', 'compensate']
  },
  {
    bizType: '用印申请',
    code: 'SEAL',
    icon: 'Stamp',
    desc: '公章 / 合同章 / 财务章 / 法人章用印',
    urgentDefault: '普通',
    fields: [
      { key: 'sealType', label: '用印类型', type: 'select', required: true,
        options: ['公章', '合同章', '财务章', '法人章'] },
      { key: 'docName', label: '用印文件', type: 'text', required: true, maxlength: 60 },
      { key: 'copies', label: '用印份数', type: 'number', required: true, min: 1, max: 50, default: 1 },
      { key: 'takeOut', label: '是否外带', type: 'select', options: ['不外带', '外带'], default: '不外带' },
      { key: 'reason', label: '用印事由', type: 'textarea', required: true, maxlength: 200 },
      { key: 'files', label: '文件附件', type: 'file', hint: '盖章前的定稿，便于核对' }
    ],
    summaryKeys: ['sealType', 'docName', 'copies']
  },
  {
    bizType: '采购申请',
    code: 'BUY',
    icon: 'ShoppingCart',
    desc: '非合同类小额采购：办公用品、维修材料、临时设备',
    urgentDefault: '普通',
    fields: [
      /* 采购一次常买多样东西（2026-11-13）：原来只能填一个物品 + 一个预算金额，
         审批人看不到"买了什么、单价多少"，也无法和历史价格对比。
         字段结构与费用报销一致，只是单价叫「预估单价」（采购时还没发票）。 */
      { key: 'items', label: '采购明细', type: 'items', required: true,
        columns: [
          { key: 'name', label: '物品名称', type: 'text', required: true, width: 130 },
          { key: 'spec', label: '型号规格', type: 'text', width: 120 },
          { key: 'unit', label: '单位', type: 'text', width: 60 },
          { key: 'needQty', label: '需求数量', type: 'number', width: 84 },
          { key: 'stockQty', label: '库存数量', type: 'number', width: 84 },
          { key: 'buyQty', label: '本次采购', type: 'number', required: true, width: 88 },
          { key: 'price', label: '预估单价', type: 'money', required: true, width: 96 },
          { key: 'total', label: '预估总价', type: 'computed', width: 100 },
          { key: 'note', label: '说明', type: 'text', width: 120 }
        ],
        hint: '预估总价 = 预估单价 × 本次采购数量；本次采购不得超过「需求数量 − 库存数量」，超了请在说明里写明原因'
      },
      /* 预算金额取明细合计，只读：明细 3 行合计 800、预算填 1000，审批人没法判断该信哪个 */
      { key: 'amount', label: '预算金额', type: 'money', required: true, role: 'amount', min: 1, max: 500000,
        derived: 'items' },
      { key: 'needDate', label: '需求日期', type: 'date' },
      { key: 'communityId', label: '所属项目', type: 'select', required: true, opts: 'community' },
      { key: 'supplier', label: '推荐供应商', type: 'text', maxlength: 40 },
      { key: 'reason', label: '采购事由', type: 'textarea', required: true, maxlength: 200 }
    ],
    summaryKeys: ['amount', 'needDate']
  }
]

/**
 * 默认审批流：7 种（6 类 OA + 合同审批）。
 *
 * `assigneeType` 是**规则**不是人名：
 *   orgLeader        提报人所在部门负责人
 *   projectManager   项目负责人（不挂项目则为集团总经理）
 *   deptHead         指定部门负责人（如运营管理部、法务）
 *   role             指定岗位（如财务复核）
 *   directSuperior   直属上级
 *   fixed            指定人员（仅演示用，真实系统应避免）
 *
 * `amountThreshold` 用在有金额的单据上：≤ 阈值走 baseNodes，> 阈值走 overNodes。
 * 合同审批的「≥30 万三级」也收在这里（以前硬编码在 api.js）。
 */
export const OA_FLOW_DEFS = [
  {
    bizType: '用车申请',
    amountThreshold: 0,
    baseNodes: [
      { key: 'n1', name: '部门负责人审批', assigneeType: 'orgLeader', limitHours: 12, allowReject: true },
      { key: 'n2', name: '行政复核', assigneeType: 'role', roleCode: 'admin', limitHours: 8, allowReject: true }
    ],
    overNodes: [],
    note: '用车不涉及金额，两级固定'
  },
  {
    bizType: '费用报销',
    amountThreshold: 5000,
    baseNodes: [
      { key: 'n1', name: '部门负责人审批', assigneeType: 'orgLeader', limitHours: 24, allowReject: true },
      { key: 'n2', name: '财务复核', assigneeType: 'role', roleCode: 'finance', limitHours: 24, allowReject: true }
    ],
    overNodes: [
      { key: 'n1', name: '部门负责人审批', assigneeType: 'orgLeader', limitHours: 24, allowReject: true },
      { key: 'n2', name: '财务复核', assigneeType: 'role', roleCode: 'finance', limitHours: 24, allowReject: true },
      { key: 'n3', name: '项目经理审批', assigneeType: 'projectManager', limitHours: 24, allowReject: true }
    ],
    note: '5000 元以上加一级项目经理：小额走快，大额要项目负责人知情'
  },
  {
    bizType: '请假申请',
    amountThreshold: 0,
    baseNodes: [
      { key: 'n1', name: '直属上级审批', assigneeType: 'directSuperior', limitHours: 8, allowReject: true },
      { key: 'n2', name: '部门负责人复核', assigneeType: 'orgLeader', limitHours: 8, allowReject: true }
    ],
    overNodes: [],
    note: '请假先过直属上级，再过部门负责人 —— 顺序不能反，反了就是越级'
  },
  {
    bizType: '加班申请',
    amountThreshold: 0,
    baseNodes: [
      { key: 'n1', name: '直属上级审批', assigneeType: 'directSuperior', limitHours: 12, allowReject: true },
      { key: 'n2', name: '部门负责人审批', assigneeType: 'orgLeader', limitHours: 12, allowReject: true }
    ],
    overNodes: [],
    note: '加班涉及调休与加班费，需部门负责人确认'
  },
  {
    bizType: '用印申请',
    amountThreshold: 0,
    baseNodes: [
      { key: 'n1', name: '部门负责人审批', assigneeType: 'orgLeader', limitHours: 12, allowReject: true },
      { key: 'n2', name: '行政用印核验', assigneeType: 'role', roleCode: 'admin', limitHours: 8, allowReject: true }
    ],
    overNodes: [],
    note: '外带用印需在核验时确认是否登记'
  },
  {
    bizType: '采购申请',
    amountThreshold: 10000,
    baseNodes: [
      /* 采购默认会签：部门里正职 + 副职全部同意才过。金额敏感的事项
         一个人拍不了板，副职分管的那块（比如设备、耗材）也要有人确认 */
      { key: 'n1', name: '部门负责人审批', assigneeType: 'orgLeader', signMode: 'all', limitHours: 24, allowReject: true },
      { key: 'n2', name: '项目经理审批', assigneeType: 'projectManager', limitHours: 24, allowReject: true }
    ],
    overNodes: [
      { key: 'n1', name: '部门负责人审批', assigneeType: 'orgLeader', limitHours: 24, allowReject: true },
      { key: 'n2', name: '项目经理审批', assigneeType: 'projectManager', limitHours: 24, allowReject: true },
      { key: 'n3', name: '财务预算复核', assigneeType: 'role', roleCode: 'finance', limitHours: 24, allowReject: true }
    ],
    note: '1 万元以上加财务预算复核'
  },
  /* 合同审批：以前是 api.js 里的 `amount >= 300000 ? 三级 : 两级`，收进配置后可以改 */
  {
    bizType: '合同审批',
    amountThreshold: 300000,
    baseNodes: [
      { key: 'n1', name: '合同初审', assigneeType: 'role', roleCode: 'contract', limitHours: 24, allowReject: true },
      { key: 'n2', name: '部门负责人审批', assigneeType: 'orgLeader', limitHours: 24, allowReject: true }
    ],
    overNodes: [
      { key: 'n1', name: '合同初审', assigneeType: 'role', roleCode: 'contract', limitHours: 24, allowReject: true },
      { key: 'n2', name: '法务复核', assigneeType: 'role', roleCode: 'legal', limitHours: 48, allowReject: true },
      { key: 'n3', name: '总经理审批', assigneeType: 'role', roleCode: 'gm', limitHours: 48, allowReject: true }
    ],
    note: '30 万元以上加密法务与总经理；合同审批从合同页发起，此页只管节点配置',
    /* 合同审批自带业务实体，不走动态表单 */
    noForm: true
  },
  /* 计划审批：同样自带业务实体（任务明细在 deptPlans 里），审批单只做流程载体。
   * 与合同审批的差别在于**组织上下文是提报部门而不是人事归属** ——
   * 一人管多个部门时，同一个人提报 A 部门与 B 部门的计划，上级不是同一个项目经理。 */
  {
    bizType: '计划审批',
    amountThreshold: 0,
    baseNodes: [
      { key: 'n1', name: '项目经理审批', assigneeType: 'projectManager', limitHours: 48, allowReject: true },
      { key: 'n2', name: '运营管理部复核', assigneeType: 'deptHead', orgId: 'O-QS', limitHours: 48, allowReject: true }
    ],
    overNodes: [],
    note: '部门月度计划两级：项目层由所属项目经理审，运营口径由运营管理部复核。'
      + '总部职能部门的计划第一节点回落到集团总经理；班组计划沿组织树向上找所属项目。',
    noForm: true
  }
]

/**
 * 签署方式。只对「部门负责人」这一种审批人来源生效 ——
 * 会签的对象是**这个部门的所有在期负责人**（正职 + 副职 + 代理，排除申请人本人），
 * 其他来源（项目经理 / 指定岗位 / 直属上级）天然只有一个对象，配了也等价于单人。
 */
export const SIGN_MODES = [
  { value: 'single', label: '单人', hint: '一个负责人签完即过（默认）' },
  { value: 'all', label: '会签', hint: '本部门正职 + 副职全部同意才通过' },
  { value: 'any', label: '或签', hint: '任一负责人同意即通过（抢办）' }
]

/** 审批人来源的展示文案（配置页下拉用） */
export const ASSIGNEE_TYPES = [
  { value: 'orgLeader', label: '部门负责人', hint: '提报人所在部门/班组的负责人' },
  { value: 'projectManager', label: '项目经理', hint: '按所属项目取负责人；集团级走总经理' },
  { value: 'directSuperior', label: '直属上级', hint: '按员工档案的上级关系' },
  { value: 'role', label: '指定岗位', hint: '如财务复核、法务、合同初审' },
  { value: 'deptHead', label: '指定部门负责人', hint: '如运营管理部负责人' }
]

/** 岗位代码 → 展示名（配置页与审批单都用） */
export const ROLE_CODES = {
  admin: '行政',
  finance: '财务',
  contract: '合同管理员',
  legal: '法务',
  gm: '总经理'
}

export const OA_BIZ_TYPES = OA_FORM_DEFS.map(f => f.bizType)

/** 某个单据定义（含合同审批 —— 它 noForm，只在配置页出现） */
export const oaFormOf = bizType =>
  OA_FORM_DEFS.find(f => f.bizType === bizType)
  || OA_FLOW_DEFS.find(f => f.bizType === bizType) && { ...OA_FLOW_DEFS.find(f => f.bizType === bizType), noForm: true, fields: [] }
  || null
