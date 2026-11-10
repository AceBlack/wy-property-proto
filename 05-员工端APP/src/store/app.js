/**
 * 全局状态（不引 Pinia：就三个东西要跨页共享——登录人、网络、待同步队列）。
 * 写操作在原型里是内存态 + 本地缓存，刷新可还原（交接单 §八.6）。
 */
import { computed, reactive } from 'vue'
import { personaById } from '@/config/personas'
import { submitInspectResult } from '@/api/mobile'
import { demoNow } from '@/config/personas'
import { fullTimeText } from '@/utils/deadline'

const KEY = 'wy_emp_app_v1'

function readCache() {
  try {
    return uni.getStorageSync(KEY) || {}
  } catch (e) {
    return {}
  }
}

const cache = readCache()

export const app = reactive({
  personaId: cache.personaId || '',
  /** online | weak | offline（演示开关，不假装能探测真实信号） */
  net: 'online',
  netManual: false,
  /** 待同步提交：[{ id, taskId, planName, payload, at }] */
  pending: cache.pending || [],
  /** 离线草稿：{ [taskId]: { items, remark, at } } */
  drafts: cache.drafts || {},
  /** 打卡记录：{ [taskId]: { at, type, gps, manual } } */
  checkins: cache.checkins || {},
  /** 楼管催收跟进记录：[{ id, houseId, houseName, method, result, note, nextAt, at, by }] */
  collections: cache.collections || [],
  /** 巡检异常转出的工单：{ [`${taskId}|${itemLabel}`]: { woId, woNo } } */
  inspectWos: cache.inspectWos || {},
  /** 抢单记录：{ [woId]: { at, by } } —— 抢到手后 15 分钟到场靠它倒计时 */
  claims: cache.claims || {},
  /** 现场增项：{ [woId]: [{ code, name, qty, material, labor, total, at, by, confirmed }] } */
  addOns: cache.addOns || {},
  /** 移动端收款流水（只记「扫码支付」，现金不在此列）：[{ woId, no, amount, method, at, by }] */
  pays: cache.pays || [],
  /** 弃单统计：{ [name]: [{ woId, at }] } */
  abandons: cache.abandons || {},
  /** 已读公告 id：消息页靠它算「未读 N」。P0 没有已读回执接口，只能记在本地 */
  readNotices: cache.readNotices || [],
  /** 最近一次提交结果，提交页读取（不落盘，刷新即失效） */
  lastSubmit: null,
  syncing: false
})

export const persona = computed(() => personaById(app.personaId))
export const isLogin = computed(() => !!app.personaId)

export const isOffline = () => app.net === 'offline'
export const isWeak = () => app.net === 'weak'
/** 打卡/定位一类的精度动作，弱网与断网都按降级处理 */
export const isDegraded = () => app.net !== 'online'

export function persist() {
  try {
    uni.setStorageSync(KEY, {
      personaId: app.personaId,
      pending: app.pending,
      drafts: app.drafts,
      checkins: app.checkins,
      collections: app.collections,
      inspectWos: app.inspectWos,
      claims: app.claims,
      addOns: app.addOns,
      pays: app.pays,
      abandons: app.abandons,
      readNotices: app.readNotices
    })
  } catch (e) {
    /* 缓存写失败不阻断演示 */
  }
}

/** 标记一条公告已读。可重复调用（展开、切页签都会走），已读的就不再写盘 */
export function markNoticeRead(noticeId) {
  if (!noticeId || app.readNotices.includes(noticeId)) return
  app.readNotices.push(noticeId)
  persist()
}

export function isNoticeRead(noticeId) {
  return app.readNotices.includes(noticeId)
}

export function login(personaId) {
  app.personaId = personaId
  app.lastSubmit = null
  persist()
}

export function logout() {
  app.personaId = ''
  app.lastSubmit = null
  persist()
}

export function setNet(v) {
  app.net = v
  app.netManual = true
}

/* ---------- 草稿（断网时逐项判定的中间结果） ---------- */
export function saveDraft(taskId, draft) {
  app.drafts[taskId] = { ...draft, at: fullTimeText(demoNow()) }
  persist()
}

export function getDraft(taskId) {
  return app.drafts[taskId] || null
}

export function clearDraft(taskId) {
  delete app.drafts[taskId]
  persist()
}

/* ---------- 打卡 ---------- */
export function saveCheckin(taskId, rec) {
  app.checkins[taskId] = { ...rec, at: fullTimeText(demoNow()) }
  persist()
}

export function getCheckin(taskId) {
  return app.checkins[taskId] || null
}

/* ---------- 巡检转单 ---------- */
const woKey = (taskId, label) => `${taskId}|${label}`

export function linkInspectWo(taskId, label, wo) {
  app.inspectWos[woKey(taskId, label)] = { woId: wo.woId, woNo: wo.woNo }
  persist()
  return app.inspectWos[woKey(taskId, label)]
}

export const inspectWoOf = (taskId, label) => app.inspectWos[woKey(taskId, label)] || null

/* ---------- 抢单 / 增项 / 收款 ---------- */
export function saveClaim(woId, by) {
  app.claims[woId] = { at: fullTimeText(demoNow()), by }
  persist()
  return app.claims[woId]
}

export const claimOf = woId => app.claims[woId] || null

export function dropClaim(woId) {
  delete app.claims[woId]
  persist()
}

/** 弃单：抢了不到场才算，抢单前反悔不算 */
export function addAbandon(woId, by) {
  const list = app.abandons[by] || []
  app.abandons[by] = list.concat({ woId, at: fullTimeText(demoNow()) })
  persist()
  return app.abandons[by].length
}

export const abandonsOf = by => app.abandons[by] || []

export function addAddon(woId, rec) {
  const list = app.addOns[woId] || []
  app.addOns[woId] = list.concat(rec)
  persist()
  return app.addOns[woId]
}

export function addonsOf(woId) {
  return app.addOns[woId] || []
}

/** 业主确认增项（业主端未建，移动端用「当面确认」桥接，确认后合并到本单金额） */
export function confirmAddons(woId) {
  const list = app.addOns[woId] || []
  app.addOns[woId] = list.map(x => ({ ...x, confirmed: true, confirmedAt: fullTimeText(demoNow()) }))
  persist()
  return app.addOns[woId]
}

export function savePay(rec) {
  app.pays = [{ ...rec, at: fullTimeText(demoNow()) }, ...app.pays]
  persist()
  return app.pays[0]
}

export const paysOf = woId => app.pays.filter(p => p.woId === woId)

/* ---------- 催收跟进（楼管） ---------- */
export function addCollection(rec) {
  const item = {
    id: `C${Date.now().toString(36)}`,
    at: fullTimeText(demoNow()),
    ...rec
  }
  app.collections = [item, ...app.collections]
  persist()
  return item
}

export const collectionsOf = houseId => app.collections.filter(c => c.houseId === houseId)

export const lastCollectionOf = houseId => collectionsOf(houseId)[0] || null

/* ---------- 待同步队列 ---------- */
export function stageSubmission({ taskId, planName, payload }) {
  const item = {
    id: `P${Date.now().toString(36)}`,
    taskId,
    planName,
    payload,
    at: fullTimeText(demoNow())
  }
  app.pending = app.pending.filter(p => p.taskId !== taskId).concat(item)
  persist()
  return item
}

export const isPending = taskId => app.pending.some(p => p.taskId === taskId)

export function dropPending(taskId) {
  app.pending = app.pending.filter(p => p.taskId !== taskId)
  persist()
}

/**
 * 恢复网络后同步：逐条调用 PC 的 submitInspectResult（唯一入口）。
 * 任务若已被提交过，接口会抛「不能重复提交」——按已同步处理，不留在队列里死循环。
 */
export async function syncPending() {
  if (!app.pending.length || app.syncing) return { ok: 0, fail: 0, skipped: 0 }
  app.syncing = true
  let ok = 0
  let fail = 0
  let skipped = 0
  const rest = []
  for (const item of app.pending) {
    try {
      submitInspectResult(item.taskId, item.payload)
      ok++
    } catch (e) {
      const msg = String(e?.message || '')
      if (msg.includes('不能重复提交') || msg.includes('任务不存在')) {
        skipped++
      } else {
        fail++
        rest.push(item)
      }
    }
  }
  app.pending = rest
  app.syncing = false
  persist()
  return { ok, fail, skipped }
}
