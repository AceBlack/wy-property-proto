/**
 * 临时收费适配层 —— 契约见 openapi.yaml 的 `/temp-charges` 段（第 63 批）
 *
 * 口径提醒（后端实现时别丢）：
 *   - **独立成表**：不写 bills、不生成应收。所以它**不进收缴率** ——
 *     收缴率的定义是「应收 vs 实收」，临时收费没有应收，进了分母只会让收缴率凭空下降；
 *   - **但要计入收入**：收款后按 `itemName` 汇总进营业收入（`tempChargeIncome`），
 *     `companyRevenue` 与营业报表都从这一个口子取，不收第二遍；
 *   - 收款写一条 `payments`：`billId` 为空、`tempChargeId` 指回单据，
 *     `channel='临时收费'` —— 日结按方式汇总时能看到，开票池也能开票；
 *   - **只有「待收款」能改、能作废**：收了钱再改金额，流水与单据就对不上，
 *     而流水已经进了日结。要改先作废重开；
 *   - 付款方三选一（业主 / 租户 / 外部）：前两者能挂房屋，外部只记名称与电话；
 *   - **项目必填**：收入要按项目入账，没有项目的收入只能进「集团」，事后查不出来源。
 */
import * as mock from '@/utils/api'
import { get, post, patch } from './client'

const IS_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

/* ---------- 读 ---------- */
export const queryTempCharges = (opt = {}) =>
  (IS_MOCK ? mock.queryTempCharges(opt) : get('/temp-charges', opt))

export const getTempCharge = chargeId =>
  (IS_MOCK ? mock.getTempCharge(chargeId) : get(`/temp-charges/${chargeId}`))

export const tempChargeStats = () =>
  (IS_MOCK ? mock.tempChargeStats() : get('/temp-charges/stats'))

/** 收入口径：只算已收款，且**不影响收缴率** */
export const tempChargeIncome = (filters = {}) =>
  (IS_MOCK ? mock.tempChargeIncome(filters) : get('/temp-charges/income', filters))

export const tempChargeReasonOpts = () =>
  (IS_MOCK ? mock.tempChargeReasonOpts() : get('/temp-charges/reason-options'))

/* ---------- 写 ---------- */
export const saveTempCharge = (body = {}, chargeId = '') =>
  (IS_MOCK
    ? mock.saveTempCharge(body, chargeId)
    : (chargeId ? patch(`/temp-charges/${chargeId}`, body) : post('/temp-charges', body)))

export const payTempCharge = (chargeId, body = {}) =>
  (IS_MOCK ? mock.payTempCharge(chargeId, body) : post(`/temp-charges/${chargeId}/pay`, body))

export const voidTempCharge = (chargeId, reason = '') =>
  (IS_MOCK ? mock.voidTempCharge(chargeId, reason) : post(`/temp-charges/${chargeId}/void`, { reason }))

export {
  TEMP_CHARGE_PARTY, TEMP_CHARGE_REASONS, TEMP_CHARGE_STATUS,
  canEditTempCharges, canViewTempCharges
} from '@/utils/api'
