/**
 * OA 审批适配层 · 契约见 openapi.yaml 的 `oa` 域（2026-11-03）
 *
 * 与合同审批的区别：OA 单据没有业务实体，表单内容存在审批单的 `formData`。
 * 所以发起就是「建一张审批单」，没有第二步。
 *
 * 本期边界：**批准即结束，不落业务结果**。费用报销批了不生成付款单，
 * 请假批了不进考勤 —— 每个"落结果"都要动别的域的状态机，单独排批。
 */
import { IS_MOCK, get, post, put } from '@/api/client'
import * as mock from '@/utils/api'

export const createOaRequest = payload =>
  IS_MOCK ? mock.createOaRequest(payload) : post('/oa/requests', payload)

export const queryOaRequests = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK ? mock.queryOaRequests({ ...filters, pageNo, size }) : get('/oa/requests', { pageNo, size, ...filters })

export const withdrawOaRequest = (approvalId, reason = '') =>
  IS_MOCK ? mock.withdrawOaRequest(approvalId, reason) : post(`/oa/requests/${approvalId}/withdraw`, { reason })

/* 详情复用审批单读取：OA 单据没有独立实体，视图就是审批单本身 */
export { getApproval } from '@/utils/api'

export const oaSummary = () => mock.oaSummary()
export const oaNodesFor = (bizType, amount) => mock.oaNodesFor(bizType, amount)
export const oaPreviewFlow = (bizType, amount) => mock.oaPreviewFlow(bizType, amount)
export const oaFormCheck = (bizType, formData) => mock.oaFormCheck(bizType, formData)
export const oaFieldRows = approval => mock.oaFieldRows(approval)
export const currentOperator = () => mock.currentOperator()

/* 流程配置：读走本地配置（mock 模式），写走接口 */
export const oaFlows = () => mock.oaFlows()
export const updateOaFlow = (bizType, patch) =>
  IS_MOCK ? mock.updateOaFlow(bizType, patch) : put(`/oa/flows/${bizType}`, patch)

export { canEditOaFlow, canViewOaFlow } from '@/utils/api'
export { OA_BIZ_TYPES, OA_FORM_DEFS, OA_FLOW_DEFS, ASSIGNEE_TYPES, SIGN_MODES, ROLE_CODES } from '@/utils/oa'
