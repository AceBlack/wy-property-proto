/**
 * 租售信息（业主端对外 + 业主自助）
 * ------------------------------------------------------------
 * 口径来源：`交接单-业主端小程序.md` §13 / `租售信息模块.md`（PC 已完成，业主端 5 屏待接）。
 *
 * 四条不能破的线：
 *  1. **只做信息发布**，不撮合、不成交、不收佣金 —— 出现"经纪人 / 带看 / 佣金 / 成交价"
 *     性质就变成房地产经纪，要《房地产经纪机构备案表》。所以界面用「我要看房」「楼管会联系你」。
 *  2. **楼管手机号永不出现**。对外只给姓名、微信号、二维码。
 *     访客要联系就留自己的号码，楼管回拨 —— 方向反过来，保护的是访客。
 *  3. **房号 / 单元不给**（连登录也不给）。详情页少一个字段，爬虫就少一半价值。
 *     字段白名单写在 `publicView()` 里：**加字段必须过这里**，不是"前端不显示"。
 *  4. **面积 / 户型 / 朝向 / 楼层从房屋档案派生**，不落库也不让业主填 ——
 *     从设计上消灭"虚标面积"，审核员也不用核对。
 *
 * 数据：`04-契约/fixtures/listings.json`（14 条）+ `listings-viewings.json`（10 条），
 * 与后台审核的是同一批；业主新发的存在 `app.listings`（本地）。
 */
import rawListings from '@contract/listings.json'
import rawViewings from '@contract/listings-viewings.json'
import rawEmployees from '@contract/employees.json'
import { buildings, communities, houses, units } from '@pc/mock'
import { houseDerived, publicProjection } from './listing-view.mjs'
import { app, identity, persist } from '@/store/app'
import { DEMO, stamp } from '@/config/demo'
import { IS_API, post, request } from './client'
import { hydratePublic, refreshMyListings, remoteMyListings, remotePublicListings } from './remote'

const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const HOUSE_OF = new Map(houses.map(h => [h.houseId, h]))
const BUILDING_OF = new Map(buildings.map(b => [b.buildingId, b]))
const UNIT_OF = new Map(units.map(u => [u.unitId, u]))
const COMMUNITY_OF = new Map(communities.map(c => [c.communityId, c]))
const EMP_OF = new Map(rawEmployees.map(e => [e.empId, e]))

export const LISTING_TABS = [
  { key: 'all', label: '全部' },
  { key: 'mine', label: '我的挂牌' }
]

export const PRICE_BANDS = [
  { key: 'all', label: '不限', min: 0, max: Infinity },
  { key: 'lt2000', label: '2000 以下', min: 0, max: 2000 },
  { key: '2000-3000', label: '2000-3000', min: 2000, max: 3000 },
  { key: '3000-4000', label: '3000-4000', min: 3000, max: 4000 },
  { key: 'gt4000', label: '4000 以上', min: 4000, max: Infinity }
]

export const LISTING_SORTS = [
  { key: 'new', label: '最新' },
  { key: 'priceAsc', label: '租金从低到高' },
  { key: 'priceDesc', label: '租金从高到低' }
]

const DAY = 86400000
const plusDays = (day, n) => {
  const d = new Date(`${day}T00:00:00`)
  return `${new Date(d.getTime() + n * DAY).toISOString().slice(0, 10)}`
}

/** 本地发布的优先（同一 listingId 以本地为准）：契约 fixture 是只读的 */
const allRaw = () => {
  const localIds = new Set(app.listings.map(l => l.listingId))
  return [...app.listings, ...rawListings.filter(l => !localIds.has(l.listingId))]
}

/** 看房请求数：契约里已有 10 条 + 本机新增的（只给业主自己看，对外不给） */
export const viewingsOf = listingId =>
  rawViewings.filter(v => v.listingId === listingId).length +
  app.viewings.filter(v => v.listingId === listingId).length

const CTX = {
  houses: HOUSE_OF,
  buildings: BUILDING_OF,
  units: UNIT_OF,
  communities: COMMUNITY_OF,
  employees: EMP_OF
}

/** 对外投影：字段白名单在 listing-view.mjs（自检会直接调它验形状） */
const publicView = l => publicProjection(l, CTX)

/**
 * 服务端返回的对外字段是**扁平的**（stewardName / stewardWechat / stewardQrUrl），
 * 页面用的是嵌套 `steward` 与 `canWechat`。在这里对齐一次，别让 5 个页面各写一套兼容。
 * 注意服务端**本来就没有** room / unitName / 楼管手机号 —— 这一层不是"藏起来"，是没有。
 */
const publicRemoteView = r => ({
  ...r,
  steward: {
    name: r.stewardName || '',
    position: '',
    wechatId: r.stewardWechat || '',
    qrUrl: r.stewardQrUrl || ''
  },
  canWechat: !!(r.stewardWechat || r.stewardQrUrl)
})

/** 状态 → 颜色。两边都用同一份，别一边紫一边灰 */
const statusTone = st => (st === '已发布' ? 'var(--biz-accent-dark)'
  : st === '待审核' ? 'var(--biz-warning)'
    : st === '已驳回' ? 'var(--biz-danger)' : 'var(--biz-text-3)')

/** 公开列表：只有「已发布」。待审核 / 已驳回 / 已下架 / 已过期 / 已成交 都不在列表里 */
export function listingList({ communityId = '', houseType = '', priceBand = 'all', sort = 'new' } = {}) {
  const band = PRICE_BANDS.find(b => b.key === priceBand) || PRICE_BANDS[0]
  const remote = remotePublicListings()
  if (remote) {
    /* 服务端只回「已发布」，且只到楼栋。筛选与排序在客户端做：
       一次拉全（样例 14 条），切价格档不打请求 */
    return remote
      .map(publicRemoteView)
      .filter(l => !communityId || l.communityId === communityId)
      .filter(l => !houseType || l.houseType === houseType)
      .filter(l => l.price >= band.min && l.price < band.max)
      .sort((a, b) => {
        if (sort === 'priceAsc') return a.price - b.price
        if (sort === 'priceDesc') return b.price - a.price
        return String(b.availableFrom).localeCompare(String(a.availableFrom))
      })
  }
  return allRaw()
    .filter(l => l.status === '已发布')
    .map(publicView)
    .filter(Boolean)
    .filter(l => !communityId || l.communityId === communityId)
    .filter(l => !houseType || l.houseType === houseType)
    .filter(l => l.price >= band.min && l.price < band.max)
    .sort((a, b) => {
      if (sort === 'priceAsc') return a.price - b.price
      if (sort === 'priceDesc') return b.price - a.price
      return String(b.availableFrom).localeCompare(String(a.availableFrom))
    })
}

/** 降级开关：类目被要求补备案时，把「公开」改为「认证可见」即可（§8 Plan B，不写死） */
export const VISIBILITY = '公开'

export function listingDetail(listingId) {
  const remote = remotePublicListings()
  if (remote) {
    const hit = remote.find(x => x.listingId === listingId)
    /* 下架 / 待审 不在公开列表里 —— 与服务端同一个结论：当它不存在 */
    return hit ? publicRemoteView(hit) : null
  }
  const l = allRaw().find(x => x.listingId === listingId)
  if (!l) return null
  /* 下架 / 待审一律 404：不是"提示无权限"，是当它不存在 */
  if (l.status !== '已发布') return null
  return publicView(l)
}

/* ---------------- 我要看房（游客，不建账号） ---------------- */

export const PREFERRED_TIMES = ['工作日白天', '工作日晚上', '周末', '都可以']

/**
 * 提交看房请求。
 * 校验：手机号格式 + **同一手机号同一房源 24h 内只能提交一次**（§13.5）。
 * 不校验短信、不留 userId、不进客户池 —— 这不是注册，只是"这一次联系"的凭据。
 */
export async function submitViewing({ listingId, name, phone, preferredTime, note = '' }) {
  if (IS_API) {
    /* 24 小时去重、手机号格式都在服务端判 —— 客户端再判一遍是两套规则。
       这里只做"提交前先拦明显空的"，省一次往返 */
    if (!String(name || '').trim()) throw new Error('请填写称呼')
    if (!/^1\d{10}$/.test(String(phone || '').trim())) throw new Error('手机号格式不正确')
    return post(`/public/listings/${listingId}/viewing`, {
      name: String(name).trim(),
      phone: String(phone).trim(),
      preferredTime: preferredTime || '都可以',
      note: String(note || '').trim()
    })
  }
  const l = allRaw().find(x => x.listingId === listingId)
  if (!l || l.status !== '已发布') throw new Error('房源不存在或已下架')
  const nm = String(name || '').trim()
  const ph = String(phone || '').trim()
  if (!nm || nm.length > 12) throw new Error('请填写称呼（不超过 12 个字）')
  if (!/^1\d{10}$/.test(ph)) throw new Error('手机号格式不正确')
  if (String(note || '').length > 100) throw new Error('留言最多 100 字')

  const now = new Date(`${DEMO.today}T${DEMO.nowTime}:00`).getTime()
  const dup = app.viewings.find(v => v.listingId === listingId && v.phone === ph && now - new Date(v.createdMs).getTime() < DAY)
  if (dup) throw new Error('这个号码 24 小时内已约过这套房，楼管会联系你，不用重复提交')

  const row = {
    viewingId: `VW${String(9000 + app.viewings.length + 1)}`,
    listingId,
    name: nm,
    phone: ph,
    preferredTime: preferredTime || '都可以',
    note: String(note || '').trim(),
    status: '待联系',
    createdAt: stamp(),
    createdMs: new Date(`${DEMO.today}T${DEMO.nowTime}:00`).toISOString(),
    /* 90 天后自动清理（合规要求）；演示只种字段，不跑定时任务 */
    expireAt: plusDays(DEMO.today, 90)
  }
  app.viewings.unshift(row)
  persist()
  return row
}

/* ---------------- 业主自助：发布 / 我的挂牌 ---------------- */

const myOwnerIds = () => [...new Set(app.bindings.map(b => b.ownerId).filter(Boolean))]

/** 我能发布的房：已绑定、且**身份是业主**（家属/租客都不能发，§13.3） */
export function publishableHouses() {
  if (identity.value !== '业主') return []
  return app.bindings
    .filter(b => b.identity === '业主')
    .map(b => {
      const d = houseDerived(b.houseId, CTX)
      if (!d) return null
      const active = allRaw().find(l => l.houseId === b.houseId && ['待审核', '已发布'].includes(l.status))
      return { ...d, blocked: !!active, blockedReason: active ? `该房已有${active.status}的挂牌` : '' }
    })
    .filter(Boolean)
}

/** 我的挂牌：fixture 里属于我的 + 本地发布的 */
export function myListings() {
  const remote = remoteMyListings()
  if (remote) {
    /* 房号在"我的视图"里是给的（自己的房）；能力位（canOffline / canRenew / canDeal）
       由服务端算，前端不再按状态自己推 —— 推出来的按钮灰了却说不清为什么 */
    return remote
      .map(l => ({
        listingId: l.listingId,
        houseId: l.houseId,
        houseName: [l.communityName, `${l.buildingName || ''}${l.unitName || ''}${l.room || ''}`]
          .filter(Boolean).join(' '),
        price: Number(l.price) || 0,
        deposit: Number(l.deposit) || 0,
        payTerm: l.payTerm || '',
        status: l.status,
        statusTone: statusTone(l.status),
        rejectReason: l.rejectReason || '',
        offlineReason: l.offlineReason || '',
        expireAt: l.expireAt || '',
        availableFrom: l.availableFrom || '',
        viewCount: Number(l.viewCount) || 0,
        leadCount: Number(l.leadCount) || 0,
        contentVersion: l.contentVersion || 1,
        auditedVersion: l.auditedVersion || 0,
        canOffline: !!l.canOffline,
        canRenew: !!l.canRenew,
        canDeal: !!l.canDeal
      }))
      .sort((a, b) => String(b.listingId).localeCompare(String(a.listingId)))
  }
  const mine = myOwnerIds()
  return allRaw()
    .filter(l => mine.includes(l.ownerId))
    .map(l => {
      const d = houseDerived(l.houseId, CTX)
      return {
        listingId: l.listingId,
        houseId: l.houseId,
        houseName: d ? `${d.communityName} ${d.buildingName}${d.unitName}${d.room}` : l.houseId,
        price: Number(l.price) || 0,
        deposit: Number(l.deposit) || 0,
        payTerm: l.payTerm || '',
        status: l.status,
        statusTone: statusTone(l.status),
        rejectReason: l.rejectReason || '',
        offlineReason: l.offlineReason || '',
        expireAt: l.expireAt || '',
        availableFrom: l.availableFrom || '',
        /** 浏览 / 看房数只给业主自己看（对外不给，§13.4） */
        viewCount: Number(l.viewCount) || 0,
        leadCount: viewingsOf(l.listingId),
        contentVersion: l.contentVersion || 1,
        auditedVersion: l.auditedVersion || 0,
        canOffline: ['已发布', '待审核'].includes(l.status),
        canRenew: ['已驳回', '已下架', '已过期'].includes(l.status),
        canDeal: l.status === '已发布',
        isLocal: app.listings.some(x => x.listingId === l.listingId)
      }
    })
    .sort((a, b) => String(b.listingId).localeCompare(String(a.listingId)))
}

function upsertLocal(row) {
  const i = app.listings.findIndex(x => x.listingId === row.listingId)
  if (i >= 0) app.listings.splice(i, 1, row)
  else app.listings.push(row)
  persist()
}

/**
 * 发布挂牌。
 * 产权校验在**进入页面时**做一次、提交时再做一次 —— 不能等到审核才拦：
 * 审核员看到「张**」判断不了他是房主还是租客（§13.3）。
 */
export async function publishListing(p = {}) {
  if (IS_API) {
    /* 产权、车位不能挂、同房唯一在架 —— 全在服务端判。
       前端只留一句"只有业主能发"：家属点进来就该看到这句，不用等一次 403 */
    if (identity.value !== '业主') throw new Error('只有业主可以发布（家属与租客需业主本人操作）')
    const row = await post('/mp/listings', {
      houseId: p.houseId,
      type: '出租',
      price: Number(p.price),
      deposit: Number(p.deposit) || Number(p.price),
      payTerm: p.payTerm || '押一付三',
      decorate: p.decorate || '简装',
      facilities: Array.isArray(p.facilities) ? p.facilities.slice(0, 6) : [],
      availableFrom: p.availableFrom || DEMO.today,
      desc: String(p.desc || '').trim(),
      images: Number(p.images) || 0
    })
    /* 新发的是「待审核」，进不了公开列表；"我的挂牌"要立刻能看到 */
    await refreshMyListings()
    return row
  }
  if (identity.value !== '业主') throw new Error('只有业主可以发布（家属与租客需业主本人操作）')
  const houseId = p.houseId
  const binding = app.bindings.find(b => b.houseId === houseId && b.identity === '业主')
  if (!binding) throw new Error('这套房不在您的名下，无法发布')
  const h = HOUSE_OF.get(houseId)
  if (!h) throw new Error('房屋不存在')
  if (h.ownerId !== binding.ownerId) throw new Error('产权信息与档案不一致，请到服务中心核对')

  const price = Number(p.price)
  if (!Number.isFinite(price) || price < 500) throw new Error('租金请填 500 元以上（明显异常的定价也会被驳回）')
  if (price > 100000) throw new Error('租金超出合理范围')
  const deposit = Number(p.deposit) || price
  const desc = String(p.desc || '').trim()
  if (desc.length > 300) throw new Error('描述最多 300 字')
  const images = Number(p.images) || 0
  if (images < 1) throw new Error('至少上传 1 张照片（只拍室内，不拍门牌与楼道）')
  if (images > 9) throw new Error('图片最多 9 张')
  const dup = allRaw().find(l => l.houseId === houseId && ['待审核', '已发布'].includes(l.status))
  if (dup) throw new Error('这套房已经有一条在架挂牌，下架后再发')

  const listingId = `LS${String(90000 + app.listings.length + 1)}`
  const row = {
    listingId,
    houseId,
    ownerId: binding.ownerId,
    publisherUserId: binding.ownerId,
    stewardEmpId: h.stewardEmpId || '',
    type: '出租',
    price: r2(price),
    deposit: r2(deposit),
    payTerm: p.payTerm || '押一付三',
    decorate: p.decorate || '简装',
    facilities: Array.isArray(p.facilities) ? p.facilities.slice(0, 6) : [],
    availableFrom: p.availableFrom || DEMO.today,
    desc,
    images,
    status: '待审核',
    contentVersion: 1,
    auditedVersion: 0,
    createdAt: stamp(),
    expireAt: plusDays(DEMO.today, 60),
    dealAt: '',
    auditBy: '',
    auditAt: '',
    rejectReason: '',
    offlineBy: '',
    offlineAt: '',
    offlineReason: '',
    viewCount: 0
  }
  upsertLocal(row)
  return row
}

export async function offlineListing(listingId) {
  if (IS_API) {
    await post(`/mp/listings/${listingId}/offline`)
    await refreshMyListings()
    /* 下架要从公开列表消失：不刷的话别人还能点进详情 */
    await hydratePublic({ force: true })
    return
  }
  const l = allRaw().find(x => x.listingId === listingId)
  if (!l) throw new Error('挂牌不存在')
  if (!['已发布', '待审核'].includes(l.status)) throw new Error(`「${l.status}」的挂牌不能下架`)
  if (!myListings().some(x => x.listingId === listingId)) throw new Error('只能下架自己的挂牌')
  upsertLocal({ ...l, status: '已下架', offlineBy: '业主', offlineAt: stamp(), offlineReason: '业主自行下架' })
}

/**
 * 续挂 / 重新上架。
 * **内容没改就免审**：`contentVersion === auditedVersion` 直接回「已发布」；
 * 改过内容（价格/描述/图/装修配套）才重新进「待审核」——
 * 否则每 60 天全量重审一遍，楼管会被这种重复劳动逼疯。
 */
export async function renewListing(listingId) {
  if (IS_API) {
    const row = await post(`/mp/listings/${listingId}/renew`)
    await refreshMyListings()
    await hydratePublic({ force: true })
    /* 免不免审由**版本**决定，不看状态：内容改过（contentVersion != auditedVersion）
       才需要重新审。服务端按同一口径改的状态，这里只是把结论翻译成提示语 */
    return { reAudit: Number(row.contentVersion || 1) !== Number(row.auditedVersion || 0) }
  }
  const l = allRaw().find(x => x.listingId === listingId)
  if (!l) throw new Error('挂牌不存在')
  if (!['已驳回', '已下架', '已过期'].includes(l.status)) throw new Error(`「${l.status}」的挂牌不用续挂`)
  if (!myListings().some(x => x.listingId === listingId)) throw new Error('只能续挂自己的挂牌')
  const same = Number(l.contentVersion || 1) === Number(l.auditedVersion || 0)
  upsertLocal({
    ...l,
    status: same ? '已发布' : '待审核',
    expireAt: plusDays(DEMO.today, 60),
    rejectReason: '',
    offlineReason: '',
    offlineAt: '',
    renewAt: stamp()
  })
  return { reAudit: !same }
}

export async function markDeal(listingId) {
  if (IS_API) {
    await post(`/mp/listings/${listingId}/deal`)
    await refreshMyListings()
    await hydratePublic({ force: true })
    return
  }
  const l = allRaw().find(x => x.listingId === listingId)
  if (!l) throw new Error('挂牌不存在')
  if (l.status !== '已发布') throw new Error('只有已发布的挂牌能置成交')
  upsertLocal({ ...l, status: '已成交', dealAt: stamp() })
}

/** 我的挂牌里编辑（改价/改描述）→ contentVersion +1，需要重新审核 */
export async function updateListing(listingId, patch = {}) {
  if (IS_API) {
    /* 改内容 → 版本 +1 → 回「待审核」。服务端按 contentVersion 判，前端不传版本 */
    const row = await request('PATCH', `/mp/listings/${listingId}`, {
      data: {
        price: Number(patch.price) > 0 ? Number(patch.price) : undefined,
        desc: patch.desc === undefined ? undefined : String(patch.desc).slice(0, 300)
      }
    })
    await refreshMyListings()
    return row
  }
  const l = allRaw().find(x => x.listingId === listingId)
  if (!l) throw new Error('挂牌不存在')
  if (!['已发布', '待审核', '已驳回'].includes(l.status)) throw new Error('当前状态不能修改，请先续挂')
  const next = {
    ...l,
    price: Number(patch.price) > 0 ? r2(patch.price) : l.price,
    desc: String(patch.desc ?? l.desc).slice(0, 300),
    status: '待审核',
    contentVersion: Number(l.contentVersion || 1) + 1,
    rejectReason: ''
  }
  upsertLocal(next)
  return next
}
