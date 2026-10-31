/**
 * 工资域适配层 · 契约见 openapi.yaml 的 `payroll` 域
 *
 * 这一层的重点是**状态机**，不是转发：草稿 →（核算锁定）已核算 →（提交发放）待发放审批
 * →（审批通过）已发放 →（冲正）已冲正。页面上每个按钮都对应一个真实状态迁移，
 * 不做"点完提示成功、刷新回原样"的假动作。
 *
 * 两处口径在 mock 侧也照做，否则联调时才发现的差异：
 *  ① 金额只由数据层算（grossPay / deductionTotal / netPay），页面不加总；
 *  ② 提交人不能审批自己的发放单——页面上会提示"请切换角色"，这是双人原则在演示层面可见的方式。
 */
import { IS_MOCK, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryPayrolls = ({ period = '', pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryPayrolls({ period, pageNo, size, filters })
    : get('/payrolls', { period, pageNo, size, ...(filters || {}) })

export const payrollSummary = period =>
  IS_MOCK ? Promise.resolve(mock.payrollSummaryOf(period)) : get('/payrolls/summary', { period })

/** 账期列表：统一成数组（契约 data.rows，mock 直接是数组） */
export const payrollPeriods = () =>
  IS_MOCK
    ? Promise.resolve(mock.payrollPeriods())
    : get('/payrolls/periods').then(r => r.rows || [])

export const getPayroll = payrollId =>
  IS_MOCK ? Promise.resolve(mock.payrollDetailOf(payrollId)) : get(`/payrolls/${payrollId}`)

/* ---------- 状态迁移 ---------- */
export const generatePayroll = ({ period, overwrite = false } = {}) =>
  IS_MOCK
    ? Promise.resolve(mock.generatePayroll({ period, overwrite }))
    : post('/payrolls/generate', { period, overwrite })

export const confirmPayroll = period =>
  IS_MOCK ? Promise.resolve(mock.confirmPayroll(period)) : post(`/payrolls/${period}/confirm`)

export const submitPayrollPay = (period, { payDate, remark = '' } = {}) =>
  IS_MOCK
    ? Promise.resolve(mock.submitPayrollPay(period, { payDate, remark }))
    : post(`/payrolls/${period}/pay`, { payDate, remark })

export const approvePayrollPay = (period, { decision = 'approve', reason = '' } = {}) =>
  IS_MOCK
    ? Promise.resolve(mock.approvePayrollPay(period, { decision, reason }))
    : post(`/payrolls/${period}/approve`, { decision, reason })

export const reversePayroll = (payrollId, reason) =>
  IS_MOCK
    ? Promise.resolve(mock.reversePayroll(payrollId, reason))
    : post(`/payrolls/${payrollId}/reverse`, { reason })

export const revealPayrollBankCard = (payrollId, reason) =>
  IS_MOCK
    ? Promise.resolve(mock.revealPayrollBankCard(payrollId, reason))
    : post(`/payrolls/${payrollId}/reveal`, { reason })

/* ---------- 字典 ---------- */
export const PAYROLL_STATUS = ['草稿', '已核算', '待发放审批', '已发放', '已冲正']
