/**
 * 租户域适配层（契约见《接口层契约.md》· tenants）
 *
 * 口径提醒（后端实现时别丢）：
 *   - 列表只回掩码手机号/证件号，详情才回明文；
 *   - 核验门槛 **5 项**（姓名/手机/证件/与业主关系/居住人数），实名与人脸是核验结果不是门槛；
 *   - 公司另有核验前置：营业执照影像件 ≥1 张（42203），影像是门槛不是第 9 项完整度；
 *   - 搬离要释放房屋的在住关系（house.tenantId = null），否则那套房永远显示有人住；
 *   - 换承租主体（个人↔公司）走 change-type：撤销人脸 + 复位核验 + 清另一套字段，一次事务。
 */
import { IS_MOCK, del, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryTenants = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK ? mock.queryTenants({ pageNo, size, filters }) : get('/tenants', { pageNo, size, ...filters })

export const getTenantDetail = tenantId =>
  IS_MOCK ? mock.getTenantDetail(tenantId) : get(`/tenants/${tenantId}`)

/* ---------- 写 ---------- */
export const verifyTenant = (tenantId, payload = {}) =>
  IS_MOCK ? mock.verifyTenant(tenantId, payload) : post(`/tenants/${tenantId}/verify`, payload)

export const registerTenantFace = (tenantId, payload = {}) =>
  IS_MOCK ? mock.registerTenantFace(tenantId, payload) : post(`/tenants/${tenantId}/face`, payload)

export const moveOutTenant = (tenantId, payload = {}) =>
  IS_MOCK ? mock.moveOutTenant(tenantId, payload) : post(`/tenants/${tenantId}/move-out`, payload)

export const addTenantLicenseFile = (tenantId, payload = {}) =>
  IS_MOCK ? mock.addTenantLicenseFile(tenantId, payload, payload.operator) : post(`/tenants/${tenantId}/license-files`, payload)

export const removeTenantLicenseFile = (tenantId, fileId, payload = {}) =>
  IS_MOCK
    ? mock.removeTenantLicenseFile(tenantId, fileId, payload.operator)
    : del(`/tenants/${tenantId}/license-files/${fileId}`, payload)

export const changeTenantType = (tenantId, payload = {}) =>
  IS_MOCK ? mock.changeTenantType(tenantId, payload) : post(`/tenants/${tenantId}/change-type`, payload)

export const batchVerifyTenants = (tenantIds, payload = {}) =>
  IS_MOCK
    ? mock.batchVerifyTenants(tenantIds, payload)
    : post('/tenants/batch-verify', { tenantIds, ...payload })

/* ---------- 字典 / 统计（纯前端口径，不走接口） ---------- */
export {
  CHANGE_TYPE_REASONS, TENANT_FILE_RULES, checkTenantFile, licenseSummary,
  tenantQuickViews, tenantSourceOpts, tenantSummary, tenantVerifyStatusOpts
} from '@/utils/api'
