/**
 * 服务端快照（批 B 引入）
 * ------------------------------------------------------------
 * 为什么不是"把页面改成 async"：
 *
 *   38 个页面里的数据都是 `computed(() => myBills())` 这种**同步选择器**。
 *   把它们逐个改成 onLoad 里 await，等于重写 38 个页面的生命周期，
 *   而且每加一个页面就要记着"这里也要 await"。
 *
 *   所以走**缓存水合**：登录/启动时把这一批需要的服务端数据一次性拉下来
 *   放进 `app.remote`，选择器优先读它、读不到再回落本地档案。
 *   页面代码一行不改，切接口与否只影响"数据从哪来"。
 *
 * 三条约定：
 *   1. **只拉已绑房产**：`/mp/bills`、`/mp/houses/*` 都要 L2 + 绑定，没绑就没有快照；
 *   2. **失败不抛**：拉不到就打条 warn 留在本地模式 —— 演示现场网络抖一下不该白屏；
 *   3. **60 秒内不重复拉**：`onShow` 会频繁触发，每次都打四个请求没必要；
 *      需要立刻刷新时传 `force=true`（缴费成功、绑定成功后）。
 */
import { IS_API, get } from './client'
import { app, persist } from '@/store/app'

const TTL = 60 * 1000

/** 快照是否可用（接口模式 + 已拉到过） */
export const remoteReady = () => !!IS_API && !!app.remote?.fetched

export const remoteHouseOf = houseId => app.remote?.houses?.find(h => h.houseId === houseId) || null
/** 批 C：我的报修（一次拉全，页面按 scope 自己筛） */
/** 批 D：我的邻里内容（已读 / 签收 / 投票 / 报名 / 闲置 / 想要） */
export const remoteNeighbor = () => app.remote?.neighbor || null

/** 写操作之后重拉一次"我的"。比在本地猜差量可靠 —— 写操作不频繁，多一个请求换"不会算错"值得 */
export async function refreshNeighbor() {
  if (!IS_API || !app.session?.token) return null
  try {
    const nb = await get('/mp/neighbor/mine')
    app.remote.neighbor = nb
    persist()
    return nb
  } catch (e) {
    console.warn('[remote] 邻里内容刷新失败：', e?.message || e)
    return null
  }
}

export const remoteOrders = () => app.remote?.orders?.rows || null
export const remoteOrderOf = woId => (app.remote?.orders?.rows || []).find(w => w.woId === woId) || null
export const remotePayOf = payId => (app.remote?.payOrders || []).find(p => p.payId === payId) || null
export const remoteResidentsOf = houseId => app.remote?.residents?.[houseId] || null
export const remoteBillRows = () => app.remote?.bills?.rows || null
export const remotePricing = () => app.remote?.pricing || null

let inflight = null

/**
 * 拉一次快照：me → 每套房的住户 → 账单 → 价目。
 * 住户是按房循环的，但房最多三五套，并发发完就算了，不值得为它做批量接口。
 */
export function hydrate({ force = false } = {}) {
  if (!IS_API) return Promise.resolve(null)
  if (!app.session?.token) return Promise.resolve(null)
  if (inflight) return inflight
  if (!force && app.remote?.fetched && Date.now() - (app.remote.at || 0) < TTL) {
    return Promise.resolve(app.remote)
  }

  inflight = (async () => {
    try {
      const me = await get('/mp/me')
      const houses = me.houses || []
      const pairs = await Promise.all(
        houses.map(async h => [h.houseId, await get(`/mp/houses/${h.houseId}/residents`)])
      )
      const cid = houses[0]?.communityId || ''
      /* 账单 / 价目 / 工单三件事互不依赖，并发发出去；价目缺 communityId 时不请求（服务端也认） */
      const [bills, pricing, orders, neighbor] = await Promise.all([
        get('/mp/bills'),
        cid ? get('/mp/pricing', { communityId: cid }) : Promise.resolve(null),
        get('/mp/orders'),
        get('/mp/neighbor/mine')
      ])
      app.remote = {
        fetched: true,
        at: Date.now(),
        me,
        houses,
        residents: Object.fromEntries(pairs),
        bills,
        pricing,
        orders,
        neighbor,
        /* 待付款单不进快照：服务端只记内存（重启即空），且它天然短命。
           写操作时由接口返回单条，见 upsertPay */
        payOrders: app.remote?.payOrders || []
      }
      persist()
      return app.remote
    } catch (e) {
      /* 不抛：调用方是 onLaunch / onShow，抛出去只会变成一个没人接的 unhandled rejection */
      console.warn('[remote] 服务端快照失败，继续用本地数据：', e?.message || e)
      return null
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** 写回单条工单（下单 / 确认增项 / 支付 / 评价 之后都调它），页面不用重新拉列表 */
export function upsertOrder(order) {
  if (!order || !app.remote?.orders) return
  const rows = app.remote.orders.rows || []
  const i = rows.findIndex(w => w.woId === order.woId)
  if (i >= 0) rows.splice(i, 1, order)
  else rows.unshift(order)
  app.remote.orders.rows = rows
  persist()
}

export function upsertPay(pay) {
  if (!pay) return
  const list = app.remote.payOrders || []
  const i = list.findIndex(p => p.payId === pay.payId)
  if (i >= 0) list.splice(i, 1, pay)
  else list.unshift(pay)
  app.remote.payOrders = list
  persist()
}

/** 缴费成功后把冲账结果写回账单快照：不回写的话返回账单页还是旧欠费，用户以为没付上 */
export function replaceBills(rows) {
  if (!Array.isArray(rows) || !app.remote?.bills) return
  const list = app.remote.bills.rows || []
  for (const x of rows) {
    const i = list.findIndex(b => b.billId === x.billId)
    if (i >= 0) list.splice(i, 1, x)
  }
  app.remote.bills.rows = list
  const debt = list.filter(b => ['未缴', '部分缴', '逾期'].includes(b.status) && (b.unpaid || 0) > 0)
  app.remote.bills.summary = {
    count: list.length,
    payable: Math.round(list.reduce((s, b) => s + (b.payable || 0), 0) * 100) / 100,
    unpaid: Math.round(debt.reduce((s, b) => s + (b.unpaid || 0), 0) * 100) / 100,
    debtCount: debt.length,
    overdueCount: debt.filter(b => (b.overdueDays || 0) > 0).length
  }
  persist()
}

/** 登出 / 重置时清掉：不清的话换个身份登录会先看到上一个人的账单 */
export function clearRemote() {
  app.remote = { fetched: false, at: 0, me: null, houses: [], residents: {}, bills: null, pricing: null, orders: null, payOrders: [], neighbor: null }
}
