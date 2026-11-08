/**
 * 业主端 HTTP 客户端（批 A 引入）
 * ------------------------------------------------------------
 * 为什么现在才有：前 38 屏全部直读 fixture，一个网络请求都没有。切接口是分批的，
 * 这一层是地基 —— 后面的房屋、账单、报修、支付都复用它，别在各页各写一遍。
 *
 * 三条约定：
 *   1. **两种模式并存**：`VITE_USE_API=true` 走接口，否则走原来的本地实现。
 *      逐批切的意义就在这里 —— 切过的走接口，没切的仍然能跑，随时可回退。
 *   2. **业主会话与员工会话是两条通道**：这里的 token 只认 `/mp/*`，
 *      拿它调 `/owners` 会 401（契约里写明了）。
 *   3. 401 不弹 toast：页面自己会跳登录，弹窗只会连弹两遍。
 */

export const IS_API = import.meta.env.VITE_USE_API === 'true'
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:4010'

let token = ''

export const setToken = t => { token = String(t || '') }
export const getToken = () => token

const qs = (q = {}) => {
  const pairs = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  return pairs.length ? `?${pairs.join('&')}` : ''
}

/**
 * 统一请求。成功返回 `data`（已剥掉 envelope），失败抛 Error（带 status / code）。
 * 用 `uni.request` 而不是 fetch：H5 下等价，将来编译到小程序不用重写。
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
