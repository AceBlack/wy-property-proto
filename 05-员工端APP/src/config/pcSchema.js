/**
 * `@pc` 字段契约自检
 *
 * 为什么需要它：员工端通过 `@pc` 只读引用 PC 的数据与函数，PC 改字段时**不会编译报错**，
 * 只会在运行时变成 `undefined`（本轮就吃到两次：审批从 87 涨到 96、工单类型「入户维修」改名「商业服务」）。
 * 这里把"员工端到底依赖哪些字段"写死成清单，启动时对一遍，缺了直接报出来。
 *
 * 设计取舍：
 *   - 校验函数**不 import @pc**，数据由调用方传进来 —— 这样 node 脚本（CI）也能跑同一套规则；
 *   - 启动时只 `console.error` + 全局标记，不 throw：原型还要能用，但不能"静默"；
 *   - `npm run check:schema` 在 CI/构建前跑，缺字段退出码 1。
 */

/** 每条规则：表、字段、为什么员工端离不开它 */
export const REQUIRED_FIELDS = [
  { table: 'workOrders', field: 'woId', why: '页面跳转与写操作的唯一键' },
  { table: 'workOrders', field: 'type', why: '工单类型分流：商业服务=收费可抢单，公共区域维修=免费' },
  { table: 'workOrders', field: 'feeType', why: '费用/提成块是否显示' },
  { table: 'workOrders', field: 'priceCode', why: '价目快照：详情页读它显示服务项目（不反查字典）' },
  { table: 'workOrders', field: 'serviceName', why: '价目快照：列表与详情显示"换的是什么服务"' },
  { table: 'workOrders', field: 'serviceCost', why: '价目快照：成本价（后台核算用，移动端只透传）' },
  { table: 'workOrders', field: 'totalFee', why: '收款与提成展示的实收金额' },
  { table: 'workOrders', field: 'laborFee', why: '提成基数（只按人工费计提）' },
  { table: 'workOrders', field: 'dispatchMode', why: '抢单池 / 派单方式的判断' },
  { table: 'approvals', field: 'currentNode', why: '审批"该谁办"的唯一依据' },
  { table: 'approvals', field: 'flow', why: '时间线与会签名单' },
  { table: 'approvals', field: 'applicant', why: '不能审自己那一单' },
  { table: 'employees', field: 'empId', why: '考勤 / 工资条按 empId 取本人数据' },
  { table: 'employees', field: 'orgId', why: '派单候选人、班组归属' },
  { table: 'employees', field: 'position', why: '抢单资格与派单资格' },
  { table: 'orgs', field: 'leaderEmpId', why: '审批人关系表的种子（正职）' },
  { table: 'repairPrices', field: 'items', why: '商业服务价目：下单与加项取价' },
  { table: 'repairPrices', field: 'projects', why: '项目参数：提成比例 / 到场时限 / 弃单上限' },
  { table: 'repairPrices', field: 'serviceCategories', why: '商业服务分类（下单页分组）' },
  { table: 'repairPrices', field: 'publicCategories', why: '公共区域维修部位（转单页分类）' },
  { table: 'ownerTags', field: 'tagId', why: '业主标签：打/去标签的字典键' },
  { table: 'ownerTags', field: 'enabled', why: '停用的标签不能再打，选择弹层要过滤' },
  { table: 'owners', field: 'tagIds', why: '业主身上挂了哪些标签（房屋页展示）' },
  { table: 'tenants', field: 'tenantId', why: '租户档案跳转与核验/搬离的唯一键' },
  { table: 'tenants', field: 'verifyStatus', why: '核验门槛与状态徽标' },
  { table: 'tenants', field: 'status', why: '在住 / 已搬离（默认只列在住）' },
  { table: 'tenants', field: 'tenantType', why: '个人 / 公司：两套核验门槛' }
]

/** 会签节点的形状：有 approvers 就必须有 signMode，否则进度算不出来 */
const SIGN_FIELD = { table: 'approvals.flow[].approvers', field: 'signMode', why: '会签进度与名单（PC 53 批）' }

/**
 * 跑一遍校验。
 * @param {object} data { workOrders, approvals, employees, orgs, repairPrices }
 * @returns {Array<{table,field,why,detail}>} 缺失项（空数组=全部通过）
 */
export function checkPcSchema(data = {}) {
  const bad = []
  for (const rule of REQUIRED_FIELDS) {
    const rows = data[rule.table]
    /* 表分两种：数组表（工单/审批/员工）看行上的字段；对象配置（价目表）看键 */
    if (Array.isArray(rows)) {
      if (!rows.length) {
        bad.push({ ...rule, detail: `表为空（${rule.table}）` })
        continue
      }
      /* 只抽首行与末行：字段是整表统一的，逐行检查徒增耗时 */
      const samples = [rows[0], rows[rows.length - 1]]
      if (samples.some(r => !(rule.field in r))) bad.push({ ...rule, detail: '字段不存在' })
    } else if (rows && typeof rows === 'object') {
      if (!(rule.field in rows)) bad.push({ ...rule, detail: '配置项不存在' })
    } else {
      bad.push({ ...rule, detail: `表缺失（${rule.table}）` })
    }
  }

  const approvals = Array.isArray(data.approvals) ? data.approvals : []
  const signNode = approvals.flatMap(a => a.flow || []).find(n => Array.isArray(n.approvers) && n.approvers.length)
  if (signNode && !('signMode' in signNode)) bad.push({ ...SIGN_FIELD, detail: '会签节点缺少 signMode' })

  return bad
}

/** 打一行可读的错误（启动时 console，CI 时 print） */
export function formatSchemaErrors(list = []) {
  if (!list.length) return ''
  const lines = list.map((x, i) => `  ${i + 1}) ${x.table}.${x.field} —— ${x.why}${x.detail ? '（' + x.detail + '）' : ''}`)
  return [`[pc-schema] 员工端依赖的 ${list.length} 个字段在 @pc 数据里不存在：`, ...lines,
    '  处理：PC 改了字段名/结构时，同步改员工端读取处，或在本文件里更新依赖清单。'].join('\n')
}
