/**
 * 员工端 HTTP 客户端。
 *
 * 为什么要有这一层
 * ------------------------------------------------------------
 * 员工端 34 屏此前全部直读 `@pc/mock`（同一个进程内的 JS 对象），
 * 所以"接口对不对"从未被验证过：契约里写的形状能不能支撑真实使用，
 * 只有真的发一次请求才知道。这一层是接假服务（`04-契约`）的入口。
 *
 * 三条约定
 *   1. **两种模式并存**：`VITE_USE_API=true` 走接口，否则走原来的本地实现。
 *      逐域切换的意义在于切过的走接口、没切的仍能跑，随时可回退。
 *   2. **员工会话只认 `/` 下的后台接口与 `/mobile/*`**，不能拿它调 `/mp/*`
 *      （那是业主通道，token 里没有角色与数据范围，混用会 401）。
 *   3. **401 不在这里跳登录**：页面自己在 onLoad 里判断。集中跳转会在
 *      一次刷新里连跳三次，且把"没登录"和"登录过期"两件事混成一件。
 *
 * 与业主端（06）那份的区别
 * ------------------------------------------------------------
 * 06 的 38 屏用同步选择器取数，所以它需要一层"缓存水合"把接口数据先灌进
 * 本地 store 再同步读。05 的列表本来就在 `onLoad` 里取数，加那层只会多一份
 * 状态要同步 —— 直接 `await` 就好。
 */

export const IS_API = import.meta.env.VITE_USE_API === 'true'
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:4010'

const TOKEN_KEY = 'wy_emp_token_v1'

/* token 落盘：员工端刷新页面要保持登录态（演示时来回切身份也不该重新登） */
let token = ''
try {
  token = uni.getStorageSync(TOKEN_KEY) || ''
} catch (e) {
  token = ''
}

export const getToken = () => token

export function setToken(t) {
  token = String(t || '')
  try {
    if (token) uni.setStorageSync(TOKEN_KEY, token)
    else uni.removeStorageSync(TOKEN_KEY)
  } catch (e) {
    /* 存储不可用就只留内存态，不影响本次会话 */
  }
}

export const hasToken = () => !!token

const qs = (q = {}) => {
  const pairs = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  return pairs.length ? `?${pairs.join('&')}` : ''
}

/**
 * 统一请求：成功剥掉 envelope 直接给 `data`；失败抛 Error（带 status / code）。
 * 用 `uni.request` 而不是 fetch —— H5 下等价，将来编译到真机不用重写。
 */
export function request(method, path, { data, query } = {}) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: API_BASE + path + qs(query),
      method,
      data,
      timeout: 15000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      success: res => {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
          resolve(body.data)
          return
        }
        /* 401 就地清掉令牌：留着一个确定无效的 token，后续每个请求都会失败，
           页面会表现成"到处空白"，比直接要求重登难查得多 */
        if (res.statusCode === 401) setToken('')
        const err = new Error(body.message || `请求失败（${res.statusCode}）`)
        err.status = res.statusCode
        err.code = body.code
        reject(err)
      },
      fail: e => reject(new Error(e?.errMsg || '网络异常，请稍后重试'))
    })
  })
}

export const get = (path, query) => request('GET', path, { query })
export const post = (path, data) => request('POST', path, { data })
export const patch = (path, data) => request('PATCH', path, { data })
export const put = (path, data) => request('PUT', path, { data })
export const del = (path, data) => request('DELETE', path, { data })

/* ------------------------------ 登录 ------------------------------ */

/**
 * 演示身份 → 假服务账号。
 * 现在两边同名，映射仍然写出来：将来账号名一旦要区分（比如加环境前缀），
 * 只需要改这一处，不用去 4 个页面里找。
 */
const ACCOUNT_OF = {
  'zhou-ming': 'zhou-ming',
  'wang-lei': 'wang-lei',
  'mo-rui': 'mo-rui',
  'xu-yue': 'xu-yue'
}

/** 演示用固定密码（假服务四个账号都是 123456） */
const DEMO_PASSWORD = '123456'

/** 当前已登录的账号名（用于判断"换身份了吗"）。与 token 一起落盘 ——
    只放内存的话，刷新后 token 还在而账号名丢了，会白登一次并把旧的 token 顶掉。 */
const ACCOUNT_KEY = 'wy_emp_account_v1'
let currentAccount = ''
try {
  currentAccount = uni.getStorageSync(ACCOUNT_KEY) || ''
} catch (e) {
  currentAccount = ''
}

export const accountOf = personaId => ACCOUNT_OF[personaId] || ''

/**
 * 按演示身份登录。已经用同一个账号登录过就直接复用 token ——
 * 每次进页面都重登会让 token 表无限增长（假服务是按内存记的）。
 */
export async function loginAs(personaId) {
  const username = accountOf(personaId)
  if (!username) throw new Error(`没有为「${personaId}」配置假服务账号`)

  if (token && currentAccount === username) return token

  const d = await request('POST', '/auth/login', {
    data: { username, password: DEMO_PASSWORD }
  })
  setToken(d.token)
  currentAccount = username
  try {
    uni.setStorageSync(ACCOUNT_KEY, username)
  } catch (e) { /* 忽略：本次会话内仍可用 */ }
  return d.token
}

/** 退出：清 token 与账号缓存 */
export function logout() {
  currentAccount = ''
  setToken('')
  try {
    uni.removeStorageSync(ACCOUNT_KEY)
  } catch (e) { /* 忽略 */ }
}
