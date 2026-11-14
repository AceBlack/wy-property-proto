/**
 * 报表域适配层（契约见《接口层契约.md》· reports）
 *
 * 口径提醒（2026-10-30 拍板）：这三张表是**跑批产物**，不是实时算：
 *   - 读接口一律带 `statDate`，缺省取最新成功批次；没跑过的日期是 404/40402，不是空表；
 *   - 响应带 `meta`（批次/生成时间/公式版本）+ `summary`（合计），页面不要自己再算一遍；
 *   - 重算是异步：`POST /reports/recalc` → 202 + taskId → 轮询 `GET /reports/recalc/{id}`。
 *
 * 报表代码：`arrears` 欠费账龄 / `collection-rate` 收缴率 / `dept-target` 部门达标率
 */
import { IS_MOCK, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 批次 ---------- */
export const reportSnapshotList = (code = '', periodType = 'day') => {
  const raw = mock.periodRawOf(periodType)
  return IS_MOCK
    ? mock.reportSnapshotList(code, raw)
    : get('/reports/snapshots', { reportCode: code, periodType: mock.periodLabelOf(raw), limit: 100 })
}

/* ---------- 取数（响应含 meta / summary） ---------- */
export const queryReportRows = (code, { pageNo = 1, size = 50, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryReportRows(code, { pageNo, size, filters })
    : get(`/reports/${code}`, { pageNo, size, ...filters })

/* ---------- 重算（异步 + 幂等） ---------- */
/**
 * 触发重算。期次按粒度传：
 *   日 → { code, periodType:'day', period:'2026-10-21' }（也可继续用 statDate）
 *   月 → { code, periodType:'month', period:'2026-10' }
 *   年 → { code, periodType:'year', period:'2026' }
 */
export const recalcReport = ({ code, periodType = 'day', period, statDate, note = '' } = {}) => {
  const raw = mock.periodRawOf(periodType)
  return IS_MOCK
    ? mock.recalcReport({ code, periodType: raw, period: period || statDate, note })
    : post('/reports/recalc', { reportCode: code, periodType: mock.periodLabelOf(raw), period: period || statDate, note })
}

export const reportRecalcTask = taskId =>
  IS_MOCK ? mock.reportRecalcTask(taskId) : get(`/reports/recalc/${encodeURIComponent(taskId)}`)

/* ---------- 口径 / 字典（前端共用同一份） ---------- */
export {
  REPORT_FORMULA, REPORT_NAMES, AGING_BUCKETS,
  PERIOD_TYPES, REPORT_PERIOD_MONTHS, REPORT_PERIOD_YEARS, REPORT_CLOSED_THROUGH,
  periodLabelOf, periodRawOf, latestSnapshot, snapshotOf, mapReportSummary, reportSummaryMapped
} from '@/utils/api'

/* ---------- 批 6（2026-11-13）：三率 / 收支分项 ----------
 * 两个都是**区间立即算**（不是跑批产物），因为前台要能换任意区间看趋势；
 * 恒等式自检随结果一起返回，页面不需要再算一遍。
 */
export { threeRateReport, incomeExpenseReport } from '@/utils/api'

/* ---------- 报表批（2026-11-14）：减免分析 / 欠费账龄 / 押金在账 ----------
 * 三张都是**实时算**，与上面两张报表同一条链路（不进跑批）。
 * 欠费账龄在这里是实时口径，报表中心那张读快照 —— 两处口径说明写在 api.js 里。
 */
export { waiveAnalysis, agingReport, depositReport, budgetVsActual } from '@/utils/api'

/* 客户三张表批（2026-11-14）：经营日报 —— 科目 × 日 + 收款点 + 日结差额 */
export { dailyRevenueReport, PAY_POINTS } from '@/utils/api'

/* 公司级多项目并排（2026-11-15）：客户月报表 1 的形状 */
export { companyReport } from '@/utils/api'
