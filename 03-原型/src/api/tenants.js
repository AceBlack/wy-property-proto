/**
 * 租户域适配层（契约见《接口层契约.md》· tenants）
 *
 * 口径提醒（后端实现时别丢）：
 *   - 列表只回掩码手机号/证件号，详情才回明文；
 *   - 核验门槛 **5 项**（姓名/手机/证件/与业主关系/居住人数），实名与人脸是核验结果不是门槛；
 *   - 搬离要释放房屋的在住关系（house.tenantId = null），否则那套房永远显示有人住。
 */
import { IS_MOCK, get, post } from '@/api/client'
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

export const batchVerifyTenants = (tenantIds, payload = {}) =>
  IS_MOCK
    ? mock.batchVerifyTenants(tenantIds, payload)
    : post('/tenants/batch-verify', { tenantIds, ...payload })

/* ---------- 字典 / 统计（纯前端口径，不走接口） ---------- */
export {
  tenantQuickViews, tenantSourceOpts, tenantSummary, tenantVerifyStatusOpts
} from '@/utils/api'
