/**
 * 业主端全局状态（不引 Pinia）
 * ------------------------------------------------------------
 * 身份是**分层**的（2026-11-01 定稿），登录不等于业主认证：
 *
 *   L0 游客      session=null                → 公告 / 邻里 / 生活 可看
 *   L1 已登录    session.phone               → 可评论、报名、投票、收藏
 *   L2 已认证    auth.status='approved'      → 缴费、个人报修、房屋、门禁
 *                bindings[] 里带身份（业主/家属/租客），权限按身份再收一道
 *   L2' 审核中   auth.status='pending'       → 只多一个"待核验"的提示，业务功能仍然锁着
 *
 * 写回策略：与上一版一致 —— 内存 mock 就地改写 + localStorage 增量，刷新由 rehydrate() 重放。
 */
import { computed, reactive } from 'vue'
import { bills, workOrders } from '@pc/mock'
import { stamp } from '@/config/demo'

const KEY = 'wy_owner_mp_v2'

function readCache() {
  try {
    return uni.getStorageSync(KEY) || {}
  } catch (e) {
    return {}
  }
}

const cache = readCache()

export const app = reactive({
  /** 登录态 + 实名信息（实名只在认证流程里填，登录不强制） */
  session: cache.session || null,
  /** 认证状态：none | pending | approved | rejected */
  auth: cache.auth || { status: 'none', identity: '', reason: '', at: '', applicant: null },
  /** 已绑定房产（可多套，每套一个身份）[{ houseId, identity, ownerId, verifyStatus, at }] */
  bindings: cache.bindings || [],
  activeHouseId: cache.activeHouseId || '',

  /** 业主端新建的工单（来自 PC 的 createWorkOrder 返回值） */
  orders: cache.orders || [],
  patches: cache.patches || {},
  addons: cache.addons || {},
  payOrders: cache.payOrders || [],
  billPays: cache.billPays || {},
  paySeq: cache.paySeq || 0,

  /** 内容侧写回 */
  comments: cache.comments || [], // 业主评论
  postLikes: cache.postLikes || {}, // { postId: true }
  enrollments: cache.enrollments || [], // 活动报名
  votes: cache.votes || {}, // { surveyId: [optionKey] }
  wants: cache.wants || [], // 闲置想要
  secondhandComments: cache.secondhandComments || [],
  utilityPays: cache.utilityPays || [], // 水电燃气充值流水
  utilitySeq: cache.utilitySeq || 0,
  /** 报修撤销 / 催办 */
  repairs: cache.repairs || {}, // { woId: { cancelledAt, urgedAt, urgeCount } }
  /** 业主自助添加 / 解除的家庭成员 */
  membersAdded: cache.membersAdded || [],
  membersRemoved: cache.membersRemoved || []
})

/* ---------------- 派生：身份 ---------------- */
export const isLogged = computed(() => !!app.session?.phone)
export const isRealname = computed(() => !!(app.session?.name && app.session?.idCard4))
export const isApproved = computed(() => app.auth.status === 'approved' && app.bindings.length > 0)
export const isPending = computed(() => app.auth.status === 'pending')
export const identity = computed(() => app.bindings[0]?.identity || app.auth.identity || '')
export const activeBinding = computed(
  () => app.bindings.find(b => b.houseId === app.activeHouseId) || app.bindings[0] || null
)
export const activeHouseId = computed(() => activeBinding.value?.houseId || '')

/**
 * 权限矩阵：一个身份能干什么。
 * 租客不能看业主账单（只能看自己租约与水电）；家属不能改房屋归属、不能看租约金额。
 */
export const perm = computed(() => {
  const role = identity.value
  const ok = isApproved.value
  return {
    /* 账单缴费：业主 / 家属可缴；租客默认不缴业主账（现实里租客也可能代缴，这里按"不能"处理，避免越权） */
    bills: ok && (role === '业主' || role === '家属'),
    /* 个人入户报修：三种身份都能报（家属代报、租客报自己房） */
    repairPersonal: ok,
    /* 公共区域报修：登录即可（楼道卫生、电梯异响跟产权无关） */
    repairPublic: isLogged.value,
    /* 门禁开门：租客信息不全时禁用 */
    door: ok && activeBinding.value?.verifyStatus !== '信息不全',
    /* 家庭成员管理：只有业主能加人 */
    member: ok && role === '业主',
    /* 租约金额：业主可见，家属/租客不可见 */
    lease: ok && role === '业主',
    /* 修改房屋归属（解绑/过户）：只有业主 */
    houseEdit: ok && role === '业主'
  }
})

/* ---------------- 持久化 ---------------- */
export function persist() {
  try {
    uni.setStorageSync(KEY, {
      session: app.session,
      auth: app.auth,
      bindings: app.bindings,
      activeHouseId: app.activeHouseId,
      orders: app.orders,
      patches: app.patches,
      addons: app.addons,
      payOrders: app.payOrders,
      billPays: app.billPays,
      paySeq: app.paySeq,
      comments: app.comments,
      postLikes: app.postLikes,
      enrollments: app.enrollments,
      votes: app.votes,
      wants: app.wants,
      secondhandComments: app.secondhandComments,
      utilityPays: app.utilityPays,
      utilitySeq: app.utilitySeq,
      repairs: app.repairs,
      membersAdded: app.membersAdded,
      membersRemoved: app.membersRemoved
    })
  } catch (e) {
    /* 缓存写失败不阻断演示 */
  }
}

/* ---------------- mock 写回 ---------------- */
const woOf = woId => workOrders.find(w => w.woId === woId) || null

function pushOrder(order) {
  if (!order?.woId) return
  if (!workOrders.some(w => w.woId === order.woId)) workOrders.unshift(order)
}

export function applyPatch(woId, patch) {
  if (!woId) return
  app.patches[woId] = { ...(app.patches[woId] || {}), ...patch }
  const wo = woOf(woId)
  if (wo) Object.assign(wo, patch)
  persist()
}

export function writeAddons(woId, list) {
  app.addons[woId] = list
  const wo = woOf(woId)
  if (wo) wo.addons = list
  persist()
}

export const addonsOf = woId => app.addons[woId] || woOf(woId)?.addons || []

export function markBillPaid(billId, { payId, amount, at }) {
  app.billPays[billId] = { payId, amount, at }
  const b = bills.find(x => x.billId === billId)
  if (b) {
    b.status = '已缴'
    b.paidAmount = Number(b.payable ?? b.amount ?? amount ?? 0)
    b.unpaid = 0
    b.payTime = String(at).slice(0, 10)
    b.payMethod = '微信支付（模拟）'
    b.overdueDays = 0
  }
  persist()
}

export function rehydrate() {
  for (const o of app.orders) pushOrder(o)
  for (const [woId, patch] of Object.entries(app.patches)) {
    const wo = woOf(woId)
    if (wo) Object.assign(wo, patch)
  }
  for (const [woId, list] of Object.entries(app.addons)) {
    const wo = woOf(woId)
    if (wo) wo.addons = list
  }
  for (const [billId, p] of Object.entries(app.billPays)) {
    const b = bills.find(x => x.billId === billId)
    if (b) {
      b.status = '已缴'
      b.paidAmount = Number(b.payable ?? b.amount ?? p.amount ?? 0)
      b.unpaid = 0
      b.payTime = String(p.at).slice(0, 10)
      b.payMethod = '微信支付（模拟）'
      b.overdueDays = 0
    }
  }
}

/* ---------------- 登录（L1） ---------------- */
export function login({ phone, personaId = '' }) {
  app.session = { phone: String(phone || '').trim(), personaId, name: '', idCard4: '', at: stamp() }
  /* 换人登录：认证与绑定必须清空，否则会把上一个人的房产带过来 */
  app.auth = { status: 'none', identity: '', reason: '', at: '', applicant: null }
  app.bindings = []
  app.activeHouseId = ''
  persist()
}

export function setRealname({ name, idCard4 }) {
  if (!app.session) return
  app.session = { ...app.session, name: String(name || '').trim(), idCard4: String(idCard4 || '').trim() }
  persist()
}

/* ---------------- 认证（L2） ---------------- */
/** 自动匹配成功：直接生效，不经过人工 */
export function approveBinding({ houseId, identity: role, ownerId, verifyStatus = '' }) {
  if (!app.bindings.some(b => b.houseId === houseId)) {
    app.bindings.push({ houseId, identity: role, ownerId, verifyStatus, at: stamp(), auto: true })
  }
  app.auth = { status: 'approved', identity: role, reason: '', at: stamp(), applicant: null }
  app.activeHouseId = app.activeHouseId || houseId
  persist()
}

/** 匹配不上：提交人工审核（带上"哪一项对不上"，物业才知道查什么） */
export function submitReview({ houseId, identity: role, proof, reason }) {
  app.auth = {
    status: 'pending',
    identity: role,
    reason: '',
    at: stamp(),
    applicant: { houseId, identity: role, proof: proof || '', mismatch: reason || '', submitAt: stamp() }
  }
  persist()
}

/** 演示用：模拟物业审核通过（真实环境由物业后台操作，业主端只读状态） */
export function approveReview({ ownerId = '' } = {}) {
  const a = app.auth.applicant
  if (!a) return false
  app.bindings.push({
    houseId: a.houseId,
    identity: a.identity,
    ownerId,
    verifyStatus: '已核验',
    at: stamp(),
    auto: false
  })
  app.auth = { status: 'approved', identity: a.identity, reason: '', at: stamp(), applicant: null }
  app.activeHouseId = app.activeHouseId || a.houseId
  persist()
  return true
}

export function rejectReview(reason = '房产资料与物业登记不一致，请携带房产证到服务中心核验') {
  app.auth = { ...app.auth, status: 'rejected', reason }
  persist()
}

export function switchHouse(houseId) {
  if (!app.bindings.some(b => b.houseId === houseId)) return
  app.activeHouseId = houseId
  persist()
}

export function unbindHouse(houseId) {
  app.bindings = app.bindings.filter(b => b.houseId !== houseId)
  if (app.activeHouseId === houseId) app.activeHouseId = app.bindings[0]?.houseId || ''
  if (!app.bindings.length) app.auth = { status: 'none', identity: '', reason: '', at: '', applicant: null }
  persist()
}

/* ---------------- 内容侧 ---------------- */
export function addComment(c) {
  app.comments.unshift({ ...c, at: stamp(), status: '待审核' })
  persist()
}

export function toggleLike(postId) {
  if (app.postLikes[postId]) delete app.postLikes[postId]
  else app.postLikes[postId] = stamp()
  persist()
}

export function enroll(activityId, payload) {
  if (app.enrollments.some(e => e.activityId === activityId && e.status !== '已取消')) return false
  app.enrollments.unshift({ activityId, ...payload, at: stamp(), status: '已报名' })
  persist()
  return true
}

export function cancelEnroll(activityId) {
  app.enrollments = app.enrollments.map(e =>
    e.activityId === activityId ? { ...e, status: '已取消', cancelledAt: stamp() } : e
  )
  persist()
}

export function castVote(surveyId, keys) {
  app.votes[surveyId] = keys
  persist()
}

export function toggleWant(itemId) {
  const i = app.wants.indexOf(itemId)
  if (i >= 0) app.wants.splice(i, 1)
  else app.wants.push(itemId)
  persist()
}

export function urgeRepair(woId) {
  const r = app.repairs[woId] || {}
  app.repairs[woId] = { ...r, urgedAt: stamp(), urgeCount: (r.urgeCount || 0) + 1 }
  persist()
}

export function cancelRepair(woId, reason) {
  const r = app.repairs[woId] || {}
  app.repairs[woId] = { ...r, cancelledAt: stamp(), cancelReason: reason || '' }
  applyPatch(woId, { status: '已取消' })
  persist()
}

export function addUtilityPay(p) {
  app.utilitySeq = (app.utilitySeq || 0) + 1
  const rec = { ...p, payId: `UT${app.utilitySeq}`, at: stamp(), status: '已支付' }
  app.utilityPays.unshift(rec)
  persist()
  return rec
}

/* ---------------- 退出 / 重置 ---------------- */
export function logout() {
  app.session = null
  app.auth = { status: 'none', identity: '', reason: '', at: '', applicant: null }
  app.bindings = []
  app.activeHouseId = ''
  persist()
}

export function resetAll() {
  Object.assign(app, {
    session: null,
    auth: { status: 'none', identity: '', reason: '', at: '', applicant: null },
    bindings: [],
    activeHouseId: '',
    orders: [],
    patches: {},
    addons: {},
    payOrders: [],
    billPays: {},
    paySeq: 0,
    comments: [],
    postLikes: {},
    enrollments: [],
    votes: {},
    wants: [],
    secondhandComments: [],
    utilityPays: [],
    utilitySeq: 0,
    repairs: {},
    membersAdded: [],
    membersRemoved: []
  })
  try {
    uni.removeStorageSync(KEY)
  } catch (e) {
    /* ignore */
  }
}

/* ---------------- 家庭成员（业主自助登记） ---------------- */
/** 业主要求：登记即提交，状态「待核验」；核验由物业做，业主端只写不改 */
export function addMember(m) {
  app.membersAdded.unshift({ ...m, at: stamp(), memberId: `MBX${app.membersAdded.length + 1}` })
  persist()
}

export function removeMember(memberId) {
  app.membersRemoved.push(memberId)
  app.membersAdded = app.membersAdded.filter(m => m.memberId !== memberId)
  persist()
}
