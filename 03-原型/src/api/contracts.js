/**
 * 合同域适配层 · 契约见 openapi.yaml 的 `contracts` 域
 *
 * 两条口径：
 *  ① **合同变更是独立单据**：改金额 / 期限 / 提前终止都不直接改合同，而是生成一条变更单进审批，
 *     审批通过才回写。直接改合同的话，谁在什么时候把 30 万改成 50 万，永远查不出来。
 *  ② **即将到期是派生态**：由跑批按到期日刷新（样例阈值 90 天）。前端不要自己按天数重算，
 *     否则列表和 KPI 会差几条，且没人说得清谁对。
 */
import { IS_MOCK, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/** 页面筛选 → 契约参数（页面用 ctype / csub，契约用 type / subtype） */
function contractParams(filters = {}) {
  const { ctype, csub, ...rest } = filters || {}
  return {
    ...rest,
    ...(ctype ? { type: ctype } : {}),
    ...(csub ? { subtype: csub } : {})
  }
}

/* ---------- 查询 ---------- */
export const queryContracts = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryContracts({ pageNo, size, filters })
    : get('/contracts', { pageNo, size, ...contractParams(filters) })

/** 汇总与列表同源；前端不要自己再 reduce 一遍 */
export const contractSummary = () =>
  IS_MOCK ? mock.contractSummary() : get('/contracts/summary')

export const getContractDetail = contractId =>
  IS_MOCK ? mock.getContractDetail(contractId) : get(`/contracts/${contractId}`)

/* ---------- 写 ---------- */
export const createContract = payload =>
  IS_MOCK ? mock.createContract(payload) : post('/contracts', payload)

/**
 * 发起变更。**注意第二个参数结构**：`{ type, patch, reason }`（页面既有签名）。
 * 契约的字段名是 `changeType`，这里转一次——两边共用一个名字是最容易漏的坑。
 */
export const submitContractChange = (contractId, { type, patch = {}, reason = '' } = {}) =>
  IS_MOCK
    ? mock.submitContractChange(contractId, { type, patch, reason })
    : post(`/contracts/${contractId}/changes`, { changeType: type, patch, reason })

/* ---------- 字典 / 派生（不需要接口，纯前端算） ----------
 * nextContractNo 是"下一个单号"的**预览**：真单号由服务端生成（前端传了也会被忽略，
 * 否则两个人同时新建会拿到同一个号）。http 模式下这里给一句占位文案，不让表单显示错号。
 */
export const nextContractNo = y => (IS_MOCK ? mock.nextContractNo(y) : '（保存后由系统生成）')

export {
  CONTRACT_CHANGE_TYPES, contractAttachmentRows, contractChanges, contractPayCycleOpts,
  contractStatusOpts, contractSubtypeOpts, contractTypeOpts, contractVirtualNodes, pendingContractChanges
} from '@/utils/api'
