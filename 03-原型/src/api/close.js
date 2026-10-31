/**
 * 期间关账（月结）适配层 · 契约见 openapi.yaml 的 `close` 域
 *
 * 四条口径（写在这里，免得以后有人"顺手"放宽）：
 *   ① 谁有权结：`b.monthClose.edit`（财务）。项目经理没有——封账是财务动作，
 *      让项目经理封自己项目的账，等于让他自己掩盖欠费；
 *   ② 能不能反结：能，但要 `e.monthReopen.edit`（更高一级，刻意放 e 域而不是 b 域——
 *      财务对 b 域是通配，反结不该被"管收费"自动授予）+ 必填 ≥10 字原因。
 *      不允许反结的结果是有人去数据库改数，那才是真正的失控；
 *   ③ 结完能改什么：该期间流水 / 退款一律 409 / 40903，必须「反结 → 改 → 重结」；
 *   ④ **按项目结**（`communityId`）：一个项目账清了就能单独封，但**全公司结账要求
 *      有业务的项目先结**——汇总前明细不清，等于用总数掩盖某个项目的问题。
 *      反结会级联：全公司反结时，该期项目级结账一并置为已反结。
 */
import { IS_MOCK, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryMonthCloses = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK ? pagedLocal(pageNo, size, filters) : get('/month-closes', { pageNo, size, ...filters })

/* mock 侧没有分页版本（记录最多几十条），在这里就地分页，别为它改数据层 */
function pagedLocal(pageNo, size, filters) {
  const all = mock.monthCloseHistory(filters)
  const start = (pageNo - 1) * size
  return Promise.resolve({ rows: all.slice(start, start + size), total: all.length, pageNo, size })
}

/** 预览：与提交同源（同一段计算），否则会出现「预览 1002 笔、记录写 998 笔」 */
export const previewMonthClose = (period, communityId = '') =>
  IS_MOCK ? mock.monthClosePreview(period, communityId) : get('/month-closes/preview', { period, communityId })

/* mock 侧没有单条查询（记录几十条，列表就够），这里就地筛；
   注意包 Promise：http 的分支返回 Promise，两边形态必须一致，否则页面写同步调用在 mock 下没事、
   一开 http 就变成 undefined（这类坑踩过一次：批次列表） */
export const getMonthClose = closeId =>
  IS_MOCK
    ? Promise.resolve(mock.monthCloseHistory().find(c => c.closeId === closeId) || null)
    : get(`/month-closes/${closeId}`)

/* ---------- 写 ---------- */
export const submitMonthClose = ({ period, memo = '', operator, communityId = '' } = {}) =>
  IS_MOCK
    ? mock.submitMonthClose({ period, memo, operator, communityId })
    : post('/month-closes', { period, memo, operator, communityId })

export const reopenMonthClose = ({ closeId, reason = '', operator } = {}) =>
  IS_MOCK
    ? mock.reopenMonthClose({ closeId, reason, operator })
    : post(`/month-closes/${closeId}/reopen`, { reason, operator })

/* ---------- 字典 ---------- */
/** 期次下拉：「已结 / 待结」按当前结账范围判断（项目结过 ≠ 全公司结过） */
export const monthClosePeriodOpts = (communityId = '') => mock.monthClosePeriodOpts(communityId)
export const monthCloseRows = (period, communityId = '') => mock.monthCloseRows(period, communityId)
