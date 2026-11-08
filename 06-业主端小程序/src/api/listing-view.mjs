/**
 * 租售信息的**字段白名单**与投影（纯函数）
 * ------------------------------------------------------------
 * 为什么单独一个文件：这是本模块唯一的"接口层约束"，必须能被自检直接调用。
 * 详情与列表**不是"前端不显示"，而是接口就不给**（交接单 §13.8）：
 * 一旦回传 `room` / 门牌 / 业主电话 / 楼管手机号，爬虫一次就抓全。
 *
 * 禁止出现在对外结果里的字段：
 *   room、unitName、houseShort、fullName、ownerId、ownerName、ownerPhone、
 *   stewardEmpId、stewardPhone、viewCount、leadCount
 */

/** 对外字段白名单（加字段必须过这里，并被 check:data 的守卫拦住） */
export const PUBLIC_FIELDS = [
  'listingId',
  'type',
  'communityId',
  'communityName',
  'buildingName',
  'houseType',
  'area',
  'orientation',
  'floor',
  'price',
  'deposit',
  'payTerm',
  'decorate',
  'facilities',
  'availableFrom',
  'desc',
  'images',
  'status',
  'steward',
  'canWechat'
]

/** 绝对不能出现在对外结果里的键（含楼管手机号字段名本身） */
export const FORBIDDEN_FIELDS = [
  'room',
  'unitName',
  'houseShort',
  'fullName',
  'ownerId',
  'ownerName',
  'ownerPhone',
  'stewardEmpId',
  'stewardPhone',
  'viewCount',
  'leadCount'
]

/**
 * 房屋派生（内部用）：面积 / 户型 / 朝向 / 楼层一律从房屋档案取，不落库。
 * 返回里带 room / unitName —— 只给「我的挂牌」「发布页」这类本人可见的场景。
 */
export function houseDerived(houseId, ctx) {
  const h = ctx.houses.get(houseId)
  if (!h) return null
  const b = ctx.buildings.get(h.buildingId)
  const u = ctx.units.get(h.unitId)
  const c = ctx.communities.get(h.communityId)
  return {
    houseId: h.houseId,
    communityId: h.communityId,
    communityName: c?.name || h.communityId,
    buildingId: h.buildingId,
    buildingName: b?.name || '',
    unitName: u?.name || '',
    room: h.room,
    fullName: h.fullName,
    houseType: h.houseType,
    area: h.area,
    orientation: h.orientation,
    floor: h.floor
  }
}

/** 责任楼管：只给姓名 / 微信 / 二维码。`phone` 在源数据里有，但**这一层不取** */
export function stewardOf(empId, ctx) {
  const e = ctx.employees.get(empId)
  if (!e) return null
  return {
    name: e.name,
    position: e.position,
    wechatId: e.wechatId || '',
    qrUrl: e.contactQrUrl || ''
  }
}

/**
 * 对外投影：只输出白名单里的字段。
 * 注意 `steward` 是嵌套对象，里面也不含手机号 —— 由 `stewardOf` 保证。
 */
export function publicProjection(listing, ctx) {
  const d = houseDerived(listing.houseId, ctx)
  if (!d) return null
  const s = stewardOf(listing.stewardEmpId, ctx)
  return {
    listingId: listing.listingId,
    type: listing.type || '出租',
    communityId: d.communityId,
    communityName: d.communityName,
    /* 只到楼栋：不带单元、不带房号 */
    buildingName: d.buildingName,
    houseType: d.houseType,
    area: d.area,
    orientation: d.orientation,
    floor: d.floor,
    price: Number(listing.price) || 0,
    deposit: Number(listing.deposit) || 0,
    payTerm: listing.payTerm || '',
    decorate: listing.decorate || '',
    facilities: [...(listing.facilities || [])],
    availableFrom: listing.availableFrom || '',
    desc: listing.desc || '',
    images: Number(listing.images) || 0,
    status: listing.status,
    steward: s,
    /* 微信与二维码都没填，就只留「我要看房」（§13.5） */
    canWechat: !!(s && (s.wechatId || s.qrUrl))
  }
}
