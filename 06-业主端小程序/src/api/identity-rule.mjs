/**
 * 身份与房产匹配规则（**纯函数，无任何依赖**）
 * ------------------------------------------------------------
 * 三条口径（2026-11-01 与业主方确认）：
 *   1. 手机号 + 姓名 + 证件后四位全中，且**房确实是这个人的** → 秒过（不问、不审）
 *   2. 全中也对不上房 → 不通过，说清哪一项对不上（交人工审核时就靠它给物业定位）
 *   3. 人工审核只兜"信息与系统录入不一致"这一种情况，不是默认路径
 *
 * 三类人都能被自动识别，身份决定权限：
 *   owners  → 业主（全部）
 *   members → 家属（缴费/报修/开门；不能改房屋归属、不能看租约金额）
 *   tenants → 租客（报修/开门/看自己租约；不能看业主账单）
 *
 * 用 .mjs 是为了让 `scripts/check-data.mjs`（纯 node）能直接 import 做单测，
 * 规则抄第二遍就等于埋一个"两端判定不一致"的雷。
 */

const digits = s => String(s || '').replace(/\D/g, '')

export const ROLE = { OWNER: '业主', MEMBER: '家属', TENANT: '租客' }

/**
 * @param {{phone:string, name:string, idCard4:string}} input
 * @param {{owners:object[], members:object[], tenants:object[]}} db
 * @param {string} houseId 用户选中的房号（可以为空：只做实名不做房校验）
 * @returns {{ok:boolean, role:string, ownerId:string, houseIds:string[],
 *            reason:string, mismatch:{phone:boolean,name:boolean,cert:boolean,house:boolean},
 *            verifyStatus:string, needReview:boolean}}
 */
export function matchIdentity({ phone, name, idCard4 } = {}, db = {}, houseId = '') {
  const { owners = [], members = [], tenants = [] } = db
  const p = digits(phone)
  const n = String(name || '').trim()
  const c = digits(idCard4)
  const mismatch = { phone: false, name: false, cert: false, house: false }
  const out = extra => ({
    ok: false,
    role: '',
    ownerId: '',
    houseIds: [],
    reason: '',
    mismatch,
    verifyStatus: '',
    needReview: false,
    ...extra
  })

  /* ---------- 1. 格式 ---------- */
  if (p.length !== 11) {
    mismatch.phone = true
    return out({ reason: '手机号格式不对（需 11 位）' })
  }
  if (!n) {
    mismatch.name = true
    return out({ reason: '请填写姓名' })
  }
  if (c.length !== 4) {
    mismatch.cert = true
    return out({ reason: '请填写证件号后四位' })
  }

  /* ---------- 2. 按手机号找人（三类人一起找） ---------- */
  const ownerHit = owners.find(o => digits(o.phone) === p)
  const memberHit = members.find(m => digits(m.phone) === p)
  const tenantHit = tenants.find(t => digits(t.phone) === p)

  if (!ownerHit && !memberHit && !tenantHit) {
    mismatch.phone = true
    return out({ reason: '该手机号在物业档案里没有登记记录', needReview: true })
  }

  /* ---------- 3. 姓名 ---------- */
  const pool = [ownerHit, memberHit, tenantHit].filter(Boolean)
  if (!pool.some(x => x.name === n)) {
    mismatch.name = true
    return out({ reason: `手机号登记的姓名不是「${n}」`, needReview: true })
  }

  /* ---------- 4. 证件后四位 ---------- */
  const certPool = pool.filter(x => x.name === n && digits(x.idCard).slice(-4) === c)
  if (!certPool.length) {
    mismatch.cert = true
    return out({ reason: '证件号后四位与档案不一致', needReview: true })
  }

  /* ---------- 5. 房归属（业主 / 家属 / 租客 三条路） ----------
     注意：三类人**都有 ownerId**（家属挂在业主上、租客也记着业主），
     所以不能靠 ownerId 区分身份，必须看各自的专属字段：
       业主 = houseIds[]、家属 = memberId、租客 = tenantId + houseId。 */
  const pickHouse = list => (houseId ? list.filter(h => h === houseId) : list)
  const isOwnerRec = x => Array.isArray(x.houseIds)
  const isMemberRec = x => !!x.memberId
  const isTenantRec = x => !!x.tenantId

  if (certPool.some(isOwnerRec)) {
    const o = certPool.find(isOwnerRec)
    const ids = pickHouse(o.houseIds || [])
    if (!ids.length) {
      mismatch.house = true
      return out({
        reason: `档案姓名与手机号一致，但「${houseId ? '所选房屋' : '名下'}」不在其名下`,
        ownerId: o.ownerId,
        needReview: true
      })
    }
    return {
      ok: true,
      role: ROLE.OWNER,
      ownerId: o.ownerId,
      houseIds: ids,
      reason: '',
      mismatch,
      verifyStatus: '',
      needReview: false
    }
  }

  /* 家属：挂在 ownerId 上，房要在该业主名下 */
  const m = certPool.find(isMemberRec)
  if (m) {
    const owner = owners.find(o => o.ownerId === m.ownerId)
    const ids = pickHouse(owner?.houseIds || [])
    if (!ids.length) {
      mismatch.house = true
      return out({ reason: '该住户未被登记在所选的房屋下', ownerId: m.ownerId, needReview: true })
    }
    return {
      ok: true,
      role: ROLE.MEMBER,
      ownerId: m.ownerId,
      houseIds: ids,
      reason: '',
      mismatch,
      verifyStatus: '',
      needReview: false
    }
  }

  /* 租客：直接挂房；信息不全/待核验也能进，但标出来（门禁类功能降级） */
  const t = certPool.find(isTenantRec)
  if (t) {
    const ids = houseId ? (t.houseId === houseId ? [t.houseId] : []) : [t.houseId]
    if (!ids.length) {
      mismatch.house = true
      return out({ reason: '租约登记的房屋与所选房屋不一致', ownerId: t.ownerId, needReview: true })
    }
    return {
      ok: true,
      role: ROLE.TENANT,
      ownerId: t.ownerId,
      houseIds: ids,
      reason: '',
      mismatch,
      verifyStatus: t.verifyStatus || '待核验',
      needReview: false
    }
  }

  mismatch.house = true
  return out({ reason: '未能确定身份与房屋的对应关系', needReview: true })
}
