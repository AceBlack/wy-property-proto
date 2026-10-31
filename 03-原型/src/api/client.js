/**
 * API 客户端（2026-10-30）
 * ----------------------------------------------------------------
 * 原型阶段所有数据来自 `src/mock`，页面直接 import `@/utils/api`。
 * 对接真实后端时，页面不该重写——只需要把 import 从 `@/utils/api` 换成 `@/api`，
 * 行为由 `VITE_API_MODE` 决定：
 *
 *   VITE_API_MODE=mock（默认）  → 走 utils/api.js 的内存实现，零后端可跑
 *   VITE_API_MODE=http          → 走 VITE_API_BASE 下的 REST 接口（契约见《接口层契约.md》）
 *
 * 这样契约替换不是「重写页面」，而是「改一行 import + 开启环境变量」，
 * 也让后端可以在 mock 模式下对照接口签名开发。
 */

export const API_MODE = (import.meta.env.VITE_API_MODE || 'mock').toLowerCase()
export const IS_MOCK = API_MODE !== 'http'
export const API_BASE = import.meta.env.VITE_API_BASE || '/api'
export const APP_ENV = import.meta.env.VITE_APP_ENV || 'local'

/** 统一错误对象：页面只需要读 code / message，不必区分是 mock 抛的还是 fetch 抛的 */
export class ApiError extends Error {
  constructor(message, code = 500, payload = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.payload = payload
  }
}

function qs(params = {}) {
  const parts = []
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/* ------------------------------ 令牌 ------------------------------
 * http 模式下每个请求都要带 Authorization。令牌放 localStorage，
 * 401 时清掉并抛 ApiError（由页面引导重新登录），不做自动刷新——
 * 刷新令牌涉及并发与竞态，先留给真正的登录流程做，避免"看起来能用、实际会串号"。
 */
const TOKEN_KEY = 'wy_api_token'
export function getToken() {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(TOKEN_KEY)) || globalThis.__API_TOKEN__ || ''
  } catch { return globalThis.__API_TOKEN__ || '' }
}
export function setToken(token) {
  globalThis.__API_TOKEN__ = token || ''
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_KEY, token || '') } catch { /* 忽略隐私模式限制 */ }
}
export function clearToken() {
  globalThis.__API_TOKEN__ = ''
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY) } catch { /* 同上 */ }
}

/** 登录（mock 模式下由原型自己的角色切换代替，不走这里） */
export async function login(username, password) {
  const data = await request({ method: 'POST', url: '/auth/login', data: { username, password }, auth: false })
  if (data?.token) setToken(data.token)
  return data
}

/**
 * 发一个请求。返回体约定 `{ code, message, data }`；也兼容直接返回业务对象。
 * 401 / 403 / 409 不在这里跳转或弹窗——交给调用方（useListQuery 会统一提示），
 * 因为「无权限」和「并发冲突」在业务上是两种完全不同的处理。
 */
export async function request({ method = 'GET', url, params, data, timeout = 15000, headers, auth = true } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const token = auth ? getToken() : ''
    const res = await fetch(`${API_BASE}${url}${qs(params)}`, {
      method,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers || {})
      },
      body: data === undefined ? undefined : JSON.stringify(data)
    })
    const text = await res.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = { message: text } }
    if (!res.ok) {
      /* 401 清令牌：否则页面会一直拿过期令牌重试，看起来像"没数据" */
      if (res.status === 401) clearToken()
      throw new ApiError(body?.message || `请求失败（${res.status}）`, body?.code || res.status, body)
    }
    if (body && typeof body === 'object' && 'code' in body && body.code !== 0 && body.code !== 200) {
      throw new ApiError(body.message || '业务处理失败', body.code, body)
    }
    return body && typeof body === 'object' && 'data' in body ? body.data : body
  } catch (e) {
    if (e?.name === 'AbortError') throw new ApiError(`请求超时（${timeout}ms）`, 408)
    if (e instanceof ApiError) throw e
    throw new ApiError(e?.message || '网络异常，请稍后重试', 0)
  } finally {
    clearTimeout(timer)
  }
}

export const get = (url, params, opt) => request({ method: 'GET', url, params, ...opt })
export const post = (url, data, opt) => request({ method: 'POST', url, data, ...opt })
export const patch = (url, data, opt) => request({ method: 'PATCH', url, data, ...opt })
/* PUT 只用于「全量替换」语义（目前只有角色权限矩阵）：PATCH 是改几个字段，PUT 是"这份就是全部" */
export const put = (url, data, opt) => request({ method: 'PUT', url, data, ...opt })
export const del = (url, params, opt) => request({ method: 'DELETE', url, params, ...opt })
