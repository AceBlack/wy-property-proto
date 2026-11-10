/**
 * 人脸 / 刷脸通行（批次 80）
 * ------------------------------------------------------------
 * 替代原来的「手机开门」占位二维码：小区没有二维码闸机，实际是人脸通行。
 * 所以这一层不做"远程开门"，只做**人脸信息与状态**——门是刷开的，不是点开的。
 *
 * 谁能录：
 *   - 业主：本人 + 本房**已核验**成员（老人孩子的主要场景）；
 *   - 家属（扫码绑定进来的）：只能录**本人**。用 me 语义，不下发也不需要 memberId；
 *   - 租客：只读，人脸由物业在员工端录（`POST /tenants/{id}/face` 已有）。
 *
 * 数据：状态存 `app.faces`（key 形如 `self:<手机号>` / `member:<memberId>`）。
 * 初始状态从 `@pc/mock` 的 faceRegistered 派生 —— 本地演示需要"已生效 / 待核验"两种样子，
 * 否则整页都是"未采集"，截图看不出流程。接口化在批次 83，届时换 `faceStatus` 字段。
 */
import { members as rawMembers, owners, tenants } from '@pc/mock'
import { activeBinding, app, identity, persist } from '@/store/app'
import { DEMO, demoNow, stamp } from '@/config/demo'
import { IS_API } from './client'
import { fetchAccessFaces, postFaceSubmit, postMemberFaceSubmit, postFaceWithdraw } from './remote'
import { canEnrollMember, canSubmit, statusMeta, STATUS_AFTER_SUBMIT } from './access-rule.mjs'

const DAY = 86400000

export const selfKey = () => `self:${app.session?.phone || ''}`
export const memberKey = memberId => `member:${memberId}`

/* ============================ 接口模式的内存态 ============================ */

/**
 * 人脸状态**不缓存到 localStorage**：它随时会因为物业核验而变，
 * 存下来就会出现"后台已经通过、业主端还显示待核验"这种最难解释的错。
 * 每次进页面拉一次就够（一个业主三五个成员）。
 *
 * `data === null` 表示还没拉过，页面用 `faceLoaded()` 区分"还没回来"与"真的没有"。
 */
const remote = { data: null }

export const faceLoaded = () => !IS_API || remote.data !== null

export async function loadFaces() {
  if (!IS_API) return
  remote.data = await fetchAccessFaces()
}

/** 服务端视图 → 页面视图。文案与色调还是走 statusMeta，前端不另写一套 */
const mapSelf = s => ({
  key: selfKey(),
  faceId: s.faceId || '',
  status: s.status,
  at: s.updatedAt || s.submittedAt || '',
  note: s.note || '',
  guardian: s.guardian || '',
  name: s.name,
  role: s.role,
  readOnly: !!s.readOnly,
  readOnlyWhy: s.readOnlyWhy || '',
  remain: s.remain24h ?? 0,
  canSubmitRemote: s.canSubmit !== false,
  why: s.why || '',
  ...statusMeta(s.status)
})

const mapMember = m => ({
  key: memberKey(m.memberId),
  faceId: m.faceId || '',
  memberId: m.memberId,
  name: m.name,
  relation: m.relation || '其他',
  certified: !!m.certified,
  status: m.status,
  at: m.updatedAt || m.submittedAt || '',
  note: m.note || '',
  guardian: m.guardian || '',
  remain: m.remain24h ?? 0,
  canEnroll: !!m.canEnroll,
  why: m.why || '',
  ...statusMeta(m.status)
})

/** 本地种子：从物业档案的 faceRegistered 推初始状态（接口化后由服务端给） */
function seedOf(key) {
  if (key.startsWith('self:')) {
    const phone = key.slice(5)
    const o = owners.find(x => String(x.phone) === phone)
    if (o) return o.faceRegistered ? '已生效' : '未采集'
    const m = rawMembers.find(x => String(x.phone) === phone)
    if (m) return m.faceRegistered ? '已生效' : '未采集'
    const t = tenants.find(x => String(x.phone) === phone)
    if (t) return t.faceRegistered ? '已生效' : '未采集'
    return '未采集'
  }
  const id = key.replace('member:', '')
  const m = rawMembers.find(x => x.memberId === id)
  return m?.faceRegistered ? '已生效' : '未采集'
}

/** 某主体的当前人脸记录 */
export function faceOf(key) {
  const rec = app.faces[key]
  const status = rec?.status || seedOf(key)
  return {
    key,
    status,
    at: rec?.at || '',
    note: rec?.note || '',
    guardian: rec?.guardian || '',
    ...statusMeta(status)
  }
}

/** 24 小时内提交次数（演示时钟固定，按"当天"折算） */
export function submitsIn24h(key) {
  const since = demoNow().getTime() - DAY
  return (app.faceSubmits || []).filter(x => x.key === key && new Date(`${x.at.replace(' ', 'T')}:00`).getTime() >= since).length
}

/**
 * 本人这一条。
 *
 * 租客 `readOnly`：人脸在租约核验时由物业录，业主端不给入口 ——
 * 不是权限不够，是"谁对他负责"的问题：租客的门禁是物业发的。
 */
export function selfFace() {
  if (IS_API) return mapSelf(remote.data?.self || { status: '未采集', name: '', role: identity.value || '业主', readOnly: false })
  const key = selfKey()
  const rec = faceOf(key)
  const role = identity.value || '业主'
  return {
    ...rec,
    name: app.session?.name || '本人',
    role,
    readOnly: role === '租客',
    readOnlyWhy: role === '租客' ? '租客的人脸由物业在核验租约时录入，业主端只读' : '',
    remain: Math.max(0, 3 - submitsIn24h(key))
  }
}

/**
 * 本房成员（只有业主看得到）。
 * 家属登录时不展示：家属是被协助的一方，不该看到别人（含自己以外）的人脸状态。
 */
export function familyFaces() {
  if (IS_API) return (remote.data?.members || []).map(mapMember)
  if (identity.value !== '业主') return []
  const oid = activeBinding.value?.ownerId || ''
  if (!oid) return []
  return rawMembers
    .filter(m => m.ownerId === oid && !app.membersRemoved.includes(m.memberId))
    .map(m => {
      const rec = faceOf(memberKey(m.memberId))
      const gate = canEnrollMember({ certified: !!m.certified })
      return {
        ...rec,
        memberId: m.memberId,
        name: m.name,
        relation: m.relation || '其他',
        certified: !!m.certified,
        canEnroll: gate.ok,
        why: gate.why
      }
    })
}

/** 提交采集：只写"待核验"，生效由物业核验动作决定（后台 H4） */
export async function submitFace(key, { guardian = false } = {}) {
  if (IS_API) {
    const memberId = key.startsWith('member:') ? key.slice(7) : ''
    /* 本人提交不需要（也不该带）监护人同意；成员提交必须带，服务端会再判一次 */
    const r = memberId
      ? await postMemberFaceSubmit(memberId, { guardian })
      : await postFaceSubmit({ consent: true })
    if (memberId) {
      const list = remote.data?.members || []
      remote.data = { ...remote.data, members: list.map(m => (m.memberId === memberId ? r : m)) }
      return mapMember(r)
    }
    remote.data = { ...remote.data, self: r }
    return mapSelf(r)
  }
  const cur = faceOf(key)
  const gate = canSubmit({ status: cur.status, submits24h: submitsIn24h(key) })
  if (!gate.ok) throw new Error(gate.why)
  if (key.startsWith('member:') && !guardian) {
    throw new Error('代家人录入需勾选监护人同意')
  }

  app.faces[key] = {
    status: STATUS_AFTER_SUBMIT,
    at: stamp(),
    /* 重新采集时旧人脸继续有效，这句话必须留在记录里 —— 否则业主以为"现在刷不了门了" */
    note: cur.status === '已生效' ? '新照片核验期间，原人脸继续有效' : '',
    guardian: guardian ? `${app.session?.name || ''}（监护人）` : ''
  }
  app.faceSubmits = [...(app.faceSubmits || []), { key, at: stamp() }]
  persist()
  return faceOf(key)
}

/** 撤回：停用并等物业删除影像件（原型只改状态） */
export async function withdrawFace(key) {
  if (IS_API) {
    const memberId = key.startsWith('member:') ? key.slice(7) : ''
    const list = remote.data?.members || []
    const faceId = memberId ? list.find(m => m.memberId === memberId)?.faceId : remote.data?.self?.faceId
    if (!faceId) throw new Error('还没有录入人脸')
    const r = await postFaceWithdraw(faceId)
    /* 撤回返回的是公共字段（没有 readOnly / canEnroll），合并时保留原条目的其它键 */
    if (memberId) {
      const prev = list.find(m => m.memberId === memberId) || {}
      const merged = { ...prev, ...r }
      remote.data = { ...remote.data, members: list.map(m => (m.memberId === memberId ? merged : m)) }
      return mapMember(merged)
    }
    const merged = { ...(remote.data?.self || {}), ...r }
    remote.data = { ...remote.data, self: merged }
    return mapSelf(merged)
  }
  const cur = faceOf(key)
  if (cur.status === '未采集') throw new Error('还没有录入人脸')
  app.faces[key] = { status: '未采集', at: stamp(), note: `已撤回，原状态「${cur.status}」`, guardian: '' }
  persist()
  return faceOf(key)
}

/** 页面顶部一句话：这个人现在能不能刷脸 */
export function accessSummary(f) {
  if (f.readOnly) return { ok: false, text: '租客刷脸信息由物业维护' }
  if (f.status === '已生效') return { ok: true, text: '已开通刷脸通行' }
  if (f.status === '待核验') return { ok: false, text: '资料已提交，等物业核验' }
  if (f.status === '已驳回') return { ok: false, text: '照片未通过，按原因重拍' }
  if (f.status === '已冻结') return { ok: false, text: '已停用，需要重新采集' }
  return { ok: false, text: '还没有录入人脸' }
}

/** 冻结（租约结束 / 成员移除时由服务端做；业主端只读展示这个状态） */
export const FACE_TODAY = DEMO.today
