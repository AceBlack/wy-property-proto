/**
 * 员工域适配层 · 契约见 openapi.yaml 的 `employees` 域
 *
 * 这一层不是"转发"，是**把两种模式拉成同一个形状**：
 *  ① **剥掉薪资**：原型的员工行里带 baseSalary / monthlySalary / bankCard，契约明确不返回。
 *     不剥的话，页面在 mock 下能显示工资、切到 http 就变空白——更糟的是
 *     「员工列表能看工资」这件事被固化进页面，谁都不会再去想它该不该被看到。
 *  ② **org-tree 改字段名**：响应式树用 `id/label/n`，契约用 `orgId/name/headcount`。
 *     `selfHeadcount` 由「本节点人数 − 子节点人数之和」推出来（树的 n 含子树）。
 *  ③ **离职即收权**：离职员工 roleId 为空。这条在两层都实现，页面不需要自己判断。
 */
import { IS_MOCK, get, patch, post } from '@/api/client'
import * as mock from '@/utils/api'

const PAY_FIELDS = ['baseSalary', 'monthlySalary', 'bankCard', 'salary']
/** 员工域对外一律不带薪资字段。前端拿到就会显示，显示过一次就再也回不去了 */
const stripPay = e => {
  const o = { ...e }
  for (const k of PAY_FIELDS) delete o[k]
  return o
}

/* ---------- 查询 ---------- */
export const queryEmployees = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryEmployees({ pageNo, size, filters }).then(p => ({ ...p, rows: p.rows.map(stripPay) }))
    : get('/employees', { pageNo, size, ...(filters || {}) })

export const employeeSummary = async (filters = {}) => {
  if (!IS_MOCK) return get('/employees/summary', filters)
  const s = mock.orgSummary()
  return {
    total: s.total, onjob: s.onjob, probation: s.probation, left: s.left,
    noRole: s.noRole, contractExpiring: s.contractExpiring,
    contractExpired: s.contractExpired, orgCount: s.orgCount, teamCount: s.teamCount,
    roleCount: s.roleCount, permCount: s.permCount,
    selfOnly: s.selfOnly, deptOnly: s.deptOnly, groupAll: s.groupAll
  }
}

export const employeeOrgTree = async () => {
  if (!IS_MOCK) return get('/employees/org-tree')
  const mapNode = n => {
    const kids = (n.children || []).map(mapNode)
    const sum = kids.reduce((s, k) => s + k.headcount, 0)
    return {
      orgId: n.id, name: n.label, type: n.type, leader: n.leader || '',
      headcount: n.n, selfHeadcount: Math.max(0, n.n - sum),
      ...(kids.length ? { children: kids } : {})
    }
  }
  return { roots: mock.orgTree().map(mapNode) }
}

export const employeeOptions = ({ teamId = '', kw = '', size = 50 } = {}) =>
  IS_MOCK
    ? Promise.resolve({ rows: mock.employeeOptionRows({ teamId, kw, size }) })
    : get('/employees/options', { teamId, kw, size })

/* ---------- 详情 ---------- */
export const getEmployee = async empId => {
  if (!IS_MOCK) return get(`/employees/${empId}`)
  const d = mock.employeeDetailOf(empId)
  if (!d) throw new Error('员工不存在')
  /* 详情里的 employee 同样要剥薪资：详情页的"薪酬"块走工资域，不走这里 */
  return { ...d, employee: stripPay(d.employee) }
}

/* ---------- 写 ---------- */
/** 新增成员：工号服务端生成，角色由岗位反推（不是建档案时手填） */
export const createEmployee = payload =>
  IS_MOCK
    ? Promise.resolve(stripPay(mock.createEmployee(payload)))
    : post('/employees', payload)

export const updateEmployee = (empId, { patch = {}, ver, reason = '' } = {}) =>
  IS_MOCK
    ? Promise.resolve(stripPay(mock.updateEmployeeProfile(empId, { patch, ver, reason })))
    : patch(`/employees/${empId}`, { patch, ver, reason })

/** 调整角色：写覆盖，不改岗位。返回 from / to / affected（前端据此刷新角色树） */
export const updateEmployeeRole = async (empId, roleId, reason = '') => {
  if (!IS_MOCK) return patch(`/employees/${empId}/role`, { roleId, reason })
  const detail = mock.employeeDetailOf(empId)
  if (!detail) throw new Error('员工不存在')
  /* 离职员工不能调角色：人已经走了，调角色要么是给错人提权，要么是把权限挂在离职账号上没回收 */
  if (detail.employee.status === '离职') throw new Error('该员工已离职，不能调整角色；先恢复在职')
  const r = mock.updateEmployeeRole(empId, roleId)
  const affected = mock.roleRows()
    .filter(x => [r.fromRoleId, r.roleId].includes(x.roleId))
    .map(x => ({ roleId: x.roleId, roleName: x.name, userCount: x.userCount }))
  return {
    employee: stripPay(mock.employeeDetailOf(empId).employee),
    from: { roleId: r.fromRoleId, roleName: r.from },
    to: { roleId: r.roleId, roleName: r.roleName, permCount: r.permCount, dataScope: r.dataScope },
    affected
  }
}

/**
 * 揭示手机 / 证件明文。契约侧是**双权限**（c.employees.view + a.sensitive.view），
 * 只校验 a.sensitive.view 的话，楼管为了联系业主本来就有该权限，顺带就能导出员工身份证。
 */
export const revealEmployeeSensitive = (empId, { fields = ['phone'], reason = '' } = {}) =>
  IS_MOCK
    ? Promise.resolve(mock.revealEmployeeSensitive(empId, fields, reason))
    : post(`/employees/${empId}/reveal`, { fields, reason })

/* ---------- 字典（orgOptions 已由 api/shared.js 转出，这里不重复导出，否则 export * 会互相遮蔽） ---------- */
export {
  empStatusOpts, empTypeOpts, empPositionOpts, roleOpts, dataScopeOpts
} from '@/utils/api'
export const dataScopeLabels = () => ['全部项目', '指定项目', '本项目', '本部门', '责任范围', '仅本人']
