/**
 * 页守卫与门禁（**动作级**，不是页面级）
 * ------------------------------------------------------------
 * 上一版的教训：启动就 `guardBound()` → 没绑房的人直接被踢去绑定页，等于"没认证不能用"。
 * 现在分两层：
 *   · 页面级：只有「我的账单 / 个人报修 / 房屋」这类页在 onLoad 里调 `gateOwner()`
 *   · 动作级：评论、报名、投票只要 `gateLogin()`；缴费、开门要 `gateOwner()`
 * 都是"拦一下 + 引导 + 可返回"，不再 reLaunch 整站。
 */
import { app, identity, isApproved, isLogged, isPending, perm } from '@/store/app'

export const LOGIN = '/pages/login/index'
export const AUTH = '/pages/auth/community'
export const HOME = '/pages/home/index'
export const PENDING = '/pages/auth/pending'

/** 登录门禁：没登录就回登录页（登录后才回得来） */
export function gateLogin() {
  if (isLogged.value) return true
  uni.navigateTo({ url: LOGIN })
  return false
}

/**
 * 业主认证门禁。
 * 已认证 → true；审核中 → 提示"审核中"；没认证 → 引导去认证（可取消）。
 * @returns {boolean} 是否放行
 */
export function gateOwner(feature = '这项服务') {
  if (!gateLogin()) return false
  if (isApproved.value) return true
  if (isPending.value) {
    uni.showModal({
      title: '认证审核中',
      content: '房产资料已提交，物业会在 1-3 个工作日内完成核验。通过后即可使用。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#5b6cff'
    })
    return false
  }
  uni.showModal({
    title: `需要业主认证`,
    content: `${feature}需要先确认「这套房是您的」。认证只需姓名 + 证件后四位，与物业档案对上就立即生效。`,
    confirmText: '去认证',
    cancelText: '先逛逛',
    confirmColor: '#5b6cff',
    success: res => {
      if (res.confirm) uni.navigateTo({ url: AUTH })
    }
  })
  return false
}

/**
 * 身份权限门禁：先过认证，再看这个身份能不能做这件事。
 * 租客不能看业主账单、家属不能看租约金额 —— 这些差异必须在一处判，别让每个页面各写一遍。
 */
export function gatePerm(key, label = '该功能') {
  if (!gateOwner(label)) return false
  if (perm.value[key]) return true
  const role = identity.value || '当前身份'
  uni.showModal({
    title: '当前身份无权限',
    content: `您是「${role}」，${label}仅业主与家属可用。如需处理请联系业主或楼栋管家。`,
    showCancel: false,
    confirmText: '知道了',
    confirmColor: '#5b6cff'
  })
  return false
}

/**
 * 投票门禁：征询的是**产权人**意见，租户不计入参与率，所以不让租户投。
 * 只拦"提交"，看题目与结果不拦 —— 拦太早会让人连内容都看不见。
 */
export function gateVoter(label = '投票') {
  if (!gateOwner(label)) return false
  if (identity.value === '租客') {
    uni.showModal({
      title: '租户暂不参与',
      content: '投票征询的是产权人意见（参与率按户计算，租户不计入）。可以查看题目与结果，也可以把意见转告业主。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#5b6cff'
    })
    return false
  }
  return true
}

/** 权限快捷判断（页面里直接用，不要各写一套） */
export const can = perm

export const roleOf = () => app.bindings[0]?.identity || ''
export const statusOf = () => app.auth.status
