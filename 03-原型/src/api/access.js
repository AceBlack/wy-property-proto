/**
 * 组织与权限域适配层 · 契约见 openapi.yaml 的 `access` 域
 *
 * 三条口径在这一层要做对齐，否则页面看到的和后台做的不是一件事：
 *  ① **保存矩阵返回 202 不等于成功**：`applied=false` 时权限还没生效，页面不能提示"已保存"，
 *     要说"已提交审批"——否则用户以为加上了，第二天发现菜单还是灰的。
 *  ② **日志分页**：页面原来一次拿全量（变更记录本来就没几条），契约是分页的，这里统一成分页对象，
 *     但把 `logId` 同时映射成 `changeId`，页面模板不必跟着改字段名。
 *  ③ **统计口径**：KPI 由服务端算（日志是分页的，前端 reduce 只能算当前页）。
 */
import { IS_MOCK, get, patch, post, put } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 角色 ---------- */
export const queryRoles = async ({ scope = '', dataScope = '', kw = '', vf = '' } = {}) => {
  if (!IS_MOCK) return get('/roles', { scope, dataScope, kw, vf })
  let rows = mock.roleRows()
  if (scope) rows = rows.filter(r => r.scope === scope)
  if (dataScope) rows = rows.filter(r => r.dataScope === dataScope)
  const VF = {
    crossDomain: r => (r.domains || []).length >= 3,
    bigPerm: r => r.permCount >= 20,
    readonly: r => r.permCount > 0 && (r.perms || []).every(c => c.endsWith('.view')),
    wideScope: r => ['全部项目', '指定项目'].includes(r.dataScope)
  }
  if (VF[vf]) rows = rows.filter(VF[vf])
  if (kw) rows = rows.filter(r => [r.name, r.roleId, ...(r.positions || [])].join(' ').includes(kw))
  return {
    rows: rows.map(r => ({
      roleId: r.roleId, name: r.name, scope: r.scope, dataScope: r.dataScope,
      communities: r.communities || [], positions: r.positions || [],
      builtin: !!r.builtin, userCount: r.userCount, permCount: r.permCount,
      coverage: r.coverage, domains: r.domains || []
    }))
  }
}

export const getRole = async roleId => {
  if (!IS_MOCK) return get(`/roles/${roleId}`)
  const d = mock.getRoleDetail(roleId)
  if (!d) throw new Error('角色不存在')
  const row = mock.roleRows().find(r => r.roleId === roleId) || {}
  const perms = row.perms || []
  return {
    ...d,
    /* 治理视图：这个角色手里有哪些"拿到就能自己扩权或掩盖问题"的权限 */
    posture: {
      sensitive: perms.filter(c => mock.SENSITIVE_PERM_RULES.some(x => x.code === c)),
      wideScope: ['全部项目', '指定项目'].includes(row.dataScope)
    }
  }
}

/** 新增角色：权限默认为空，默认数据范围「仅本人」（最小可见） */
export const createRole = payload =>
  IS_MOCK ? Promise.resolve(mock.createRole(payload)) : post('/roles', payload)

/** 保存矩阵：服务端算 diff。返回 applied=false 表示已提交审批、**权限尚未生效** */
export const saveRolePerms = (roleId, perms, reason = '') =>
  IS_MOCK
    ? Promise.resolve(mock.saveRolePermsFlow({ roleId, perms, reason }))
    : put(`/roles/${roleId}/perms`, { perms, reason })

/* ---------- 组织 ---------- */
/**
 * 组织扁平列表。建树是前端的事——服务端给「节点 + 上级 + 人数」，
 * 前端想按什么层级展示都行；返回树的话，"按部门下所有班组筛人"还得先摊平一次。
 */
export const queryOrgs = ({ type = '', parentId = '', kw = '' } = {}) =>
  IS_MOCK
    ? Promise.resolve({ rows: mock.orgRows({ type, parentId, kw }) })
    : get('/orgs', { type, parentId, kw })

/**
 * 新增组织：只能建 部门 / 班组，`orgId` 服务端生成。
 * 集团与项目要伴随立项/设立一整套动作（合同、人员、账套），不是一个接口能建出来的。
 */
export const createOrg = payload =>
  IS_MOCK ? Promise.resolve(mock.createOrg(payload)) : post('/orgs', payload)

/**
 * 修改组织：改名 / 负责人 / 排序 / 上级。
 * 改类型要被拒（班组改部门，下面的人从"走排班"变"走职能"），上级不能成环。
 */
export const updateOrg = (orgId, patchBody) =>
  IS_MOCK ? Promise.resolve(mock.updateOrg(orgId, patchBody)) : patch(`/orgs/${orgId}`, patchBody)

/* ---------- 权限变更申请 ---------- */
export const queryPermRequests = async ({ status = '', roleId = '' } = {}) => {
  if (!IS_MOCK) return get('/perm-requests', { status, roleId })
  return { rows: mock.permRequestRows({ status, roleId }) }
}

export const createPermRequest = ({ roleId, added = [], removed = [], reason = '' }) =>
  IS_MOCK
    ? Promise.resolve().then(() => {
      /* 当前生效权限从角色派生行取（含矩阵保存后的覆盖），不另开一个接口去查 */
      const before = [...(mock.roleRows().find(r => r.roleId === roleId)?.perms || [])]
      const after = [...new Set([...before, ...added])].filter(c => !removed.includes(c))
      return mock.submitPermRequest({ roleId, before, after, reason })
    })
    : post('/perm-requests', { roleId, added, removed, reason })

export const approvePermRequest = async (reqId, note = '') => {
  if (!IS_MOCK) return post(`/perm-requests/${reqId}/approve`, { note })
  const { req } = mock.approvePermRequest({ reqId, note })
  return req
}

export const rejectPermRequest = async (reqId, reason = '') => {
  if (!IS_MOCK) return post(`/perm-requests/${reqId}/reject`, { reason })
  const { req } = mock.rejectPermRequest({ reqId, note: reason })
  return req
}

export const withdrawPermRequest = async reqId => {
  if (!IS_MOCK) return post(`/perm-requests/${reqId}/withdraw`)
  const { req } = mock.withdrawPermRequest({ reqId })
  return req
}

export const permRequestStats = async () =>
  IS_MOCK ? mock.permRequestStats() : { pending: (await queryPermRequests({ status: '待审批' })).rows.length }

/* ---------- 日志 ---------- */
export const queryPermLogs = async ({ roleId = '', operator = '', kw = '', action = '', pageNo = 1, size = 20 } = {}) => {
  if (!IS_MOCK) {
    const r = await get('/perm-logs', { roleId, action, pageNo, size })
    /* 页面模板用的是 changeId（原型的字段名），契约叫 logId：这里对齐，避免改模板 */
    return { ...r, rows: (r.rows || []).map(x => ({ ...x, changeId: x.logId })) }
  }
  const all = mock.permChangeRows({ roleId, operator, kw }).filter(r => !action || r.action === action)
  const start = (pageNo - 1) * size
  return {
    rows: all.slice(start, start + size).map(r => ({ ...r, logId: r.changeId })),
    total: all.length, pageNo, size
  }
}

/** 变更统计：契约没单开接口（变更记录本身条数不多），HTTP 模式按前 100 条派生 */
export const permChangeStats = async (filters = {}) => {
  if (IS_MOCK) return mock.permChangeStats(filters)
  const r = await queryPermLogs({ roleId: filters.roleId, operator: filters.operator, kw: filters.kw, pageNo: 1, size: 100 })
  const rows = r.rows || []
  return {
    changes: r.total,
    granted: rows.reduce((s, x) => s + (x.added?.length || 0), 0),
    revoked: rows.reduce((s, x) => s + (x.removed?.length || 0), 0),
    operators: new Set(rows.map(x => x.operator).filter(Boolean)).size,
    lastAt: rows[0]?.at || ''
  }
}

export const queryAccessLogs = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryAccessLogs({ pageNo, size, filters })
    : get('/access-logs', { pageNo, size, ...(filters || {}) })

export const accessLogSummary = async (filters = {}) => {
  if (!IS_MOCK) return get('/access-logs/summary', filters)
  return mock.accessLogSummary(filters)
}

/* 导出日志（文件级）：`GET /export-logs`。
   与访问留痕分开取——一个问"谁看了谁的身份证"，一个问"谁把多少行数据导到机器外面去了"；
   合成一张表时，48 条揭示会把 6 条导出淹掉，而后者才是数据外流的主通道。 */
export const queryExportLogs = ({ pageNo = 1, size = 20, filters = {} } = {}) => {
  if (!IS_MOCK) return get('/export-logs', { pageNo, size, ...(filters || {}) })
  const all = mock.exportLogRows(filters)
  const start = (pageNo - 1) * size
  return Promise.resolve({ rows: all.slice(start, start + size), total: all.length, pageNo, size })
}

/* ---------- 数据范围 ---------- */
export const listDataScopes = async () => {
  if (!IS_MOCK) return get('/data-scopes')
  const ALL = ['全部项目', '指定项目', '本项目', '本部门', '责任范围', '仅本人']
  const rows = mock.roleRows()
  return {
    rows: ALL.map(ds => {
      const list = rows.filter(r => r.dataScope === ds)
      return {
        dataScope: ds,
        roleCount: list.length,
        userCount: list.reduce((s, r) => s + r.userCount, 0),
        roles: list.map(r => ({ roleId: r.roleId, name: r.name, userCount: r.userCount }))
      }
    })
  }
}

/* ---------- 字典 / 前端判定（纯展示，不含接口语义） ---------- */
export {
  PAGE_SIZES, SENSITIVE_PERM_RULES, accessActionOpts, accessOperatorOpts, accessResultOpts,
  canApprovePerm, canApproveRequest, permChangeOperatorOpts, permChangeRoleOpts,
  permLabelOf, permCodeOfPath
} from '@/utils/api'
