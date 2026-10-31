/**
 * 品质记录域适配层（契约见《接口层契约.md》· quality）
 *
 * 口径提醒：
 *   - 本表是**结果台账**（查出什么、改没改完），现场评分卡与任务评价是另外两个入口；
 *   - `unqualified` 含**一票否决**：否决记录分数可能不低，只按 <70 判会漏；
 *   - 整改单不在这里建：`createWoFromQuality` / `startQualityRectify` 走整改域。
 */
import { IS_MOCK, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/** 汇总响应 → 页面口径（页面既有字段名保持不变，避免改模板） */
const toSummary = d => ({
  total: d.count || 0,
  avgScore: d.avgScore || 0,
  qualified: d.qualified || 0,
  unqualified: d.unqualified || 0,
  rectifying: d.rectifying || 0,
  overdue: d.overdue || 0,
  recheck: d.recheck || 0,
  veto: d.veto || 0
})

/* ---------- 查询 ---------- */
export const queryQualityChecks = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryQualityChecks({ pageNo, size, filters })
    : get('/quality-checks', { pageNo, size, ...filters })

export const getQualityCheckDetail = checkId =>
  IS_MOCK ? mock.getQualityCheckDetail(checkId) : get(`/quality-checks/${checkId}`)

/** 当前筛选范围的小计 */
export const qcScopeSummary = filters =>
  IS_MOCK ? mock.qcScopeSummary(filters) : get('/quality-checks/summary', filters)

/** 全局 KPI：同一接口 + 空筛选 */
export const qualitySummary = () =>
  IS_MOCK ? mock.qualitySummary() : get('/quality-checks/summary', {}).then(toSummary)

/* ---------- 联动动作（契约里属整改 / 工单域，这里只做转调） ---------- */
export const startQualityRectify = checkId =>
  IS_MOCK ? mock.startQualityRectify(checkId) : post(`/rectify-orders`, { checkId, sourceType: '现场抽查' })

export const scheduleQualityRecheck = (checkId, days = 7) =>
  IS_MOCK ? mock.scheduleQualityRecheck(checkId, days) : post(`/quality-checks/${checkId}/recheck-plan`, { days })

export const createWoFromQuality = (checkId, item = '') =>
  IS_MOCK ? mock.createWoFromQuality(checkId, item) : post('/work-orders', { from: 'quality', checkId, item })

/* ---------- 字典 ---------- */
export {
  QUALITY_SOURCES, qualityAreaOpts, qualityGradeOpts, qualityStatusOpts, qualityTypeOpts, qualityVirtualNodes
} from '@/utils/api'
