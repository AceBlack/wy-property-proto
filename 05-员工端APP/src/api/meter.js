/**
 * 抄表（移动端）
 *
 * 口径一句话：**照抄后台的 `saveReading()`，一条规则都不重写。**
 *   ① 本期读数不得小于上期（硬约束）
 *   ② 不得超过表类型量程
 *   ③ 用量超阈值（电 330 / 水 24）只标异常，**不拦提交**
 *
 * 第 ③ 条是有意的：拦住提交的后果是师傅改数字凑合规 —— 数字好看了，漏水的问题被埋了。
 * 异常单进「待复核」，由后台判断。
 *
 * 与 PC 唯一的差别是**范围**：后台是管理员视角（全项目），端上只抄自己管的楼栋。
 */
import { IS_API, get, loginAs, post } from './client'
import { saveReading as pcSaveReading } from '@pc/utils/api'
import { houses as pcHouses, meterReadings as pcReadings } from '@pc/mock'

/* 一次页面生命周期内只拉一遍，和房屋详情同样的做法 */
let CACHE = null

export const meterLoaded = () => !!CACHE
export const lastMeters = () => CACHE

const sortRows = rows =>
  rows.sort((a, b) =>
    String(a.buildingName).localeCompare(String(b.buildingName), 'zh') ||
    String(a.houseName).localeCompare(String(b.houseName), 'zh') ||
    String(a.type).localeCompare(String(b.type), 'zh'))

const summaryOf = rows => ({
  period: (rows[0] || {}).period || '',
  pending: rows.filter(r => r.status === '待录入').length,
  done: rows.filter(r => r.status === '待复核').length,
  abnormal: rows.filter(r => r.status === '待复核' && r.abnormal).length,
  total: rows.filter(r => r.status !== '已计费').length
})

/** 楼管名下的房屋集合（mock 模式要自己收敛，HTTP 模式服务端已经收敛过了） */
function myHouseIds(p) {
  const empId = p?.empId
  if (!empId) return new Set()
  return new Set(pcHouses.filter(h => h.stewardEmpId === empId).map(h => h.houseId))
}

/**
 * 待抄清单。
 *
 * `status` 为空时返回这个人的全部（待录入 + 待复核），清单页两种都要显示。
 */
export async function loadMeters(p, { status = '', buildingId = '' } = {}) {
  if (IS_API) {
    if (p?.id) await loginAs(p.id)
    const qs = [
      status ? `status=${encodeURIComponent(status)}` : '',
      buildingId ? `buildingId=${encodeURIComponent(buildingId)}` : ''
    ].filter(Boolean).join('&')
    CACHE = await get(`/mobile/meters${qs ? `?${qs}` : ''}`)
    return CACHE
  }

  const mine = myHouseIds(p)
  const buildingOf = houseId => {
    const h = pcHouses.find(x => x.houseId === houseId)
    return h ? h.buildingId : ''
  }
  /* 已计费的还没推单，端上不展示 —— 推单是后台动作，端上只关心"还要不要抄" */
  const base = pcReadings
    .filter(r => mine.has(r.houseId))
    .filter(r => r.status !== '已计费')

  const rows = base
    .filter(r => !status || r.status === status)
    .filter(r => !buildingId || buildingOf(r.houseId) === buildingId)
    .map(r => ({
      readingId: r.readingId,
      meterNo: r.meterNo,
      type: r.type,
      unit: r.unit,
      period: r.period,
      communityId: r.communityId,
      houseId: r.houseId,
      houseName: r.houseName,
      buildingId: buildingOf(r.houseId),
      buildingName: '',
      ownerName: r.ownerName,
      lastReading: r.lastReading,
      currentReading: r.status === '待录入' ? null : r.currentReading,
      usage: r.status === '待录入' ? null : r.usage,
      readDate: r.readDate,
      reader: r.reader,
      status: r.status,
      abnormal: r.abnormal
    }))

  CACHE = { rows: sortRows(rows), summary: summaryOf(base) }
  return CACHE
}

/**
 * 录一户读数。
 *
 * mock 模式直接调 PC 的 `saveReading()` —— 同一个函数，口径不可能分叉。
 */
export async function submitReading(p, readingId, currentReading) {
  if (IS_API) {
    if (p?.id) await loginAs(p.id)
    return post(`/mobile/meters/${readingId}/reading`, { currentReading })
  }

  const r = pcReadings.find(x => x.readingId === readingId)
  if (!r) throw new Error('抄表记录不存在')
  if (r.status !== '待录入') throw new Error(`这条记录当前是「${r.status}」，不能再录入`)
  const saved = pcSaveReading(readingId, currentReading)
  return {
    readingId: saved.readingId,
    usage: saved.usage,
    abnormal: saved.abnormal,
    status: saved.status,
    reader: saved.reader,
    readDate: saved.readDate,
    abnormalLimit: saved.abnormal ? (saved.type === '电表' ? 330 : 24) : 0
  }
}

/** 用量阈值（端上只用于"预提示"，是否放行由服务端说） */
export const abnormalLimitOf = type => (type === '电表' ? 330 : 24)
