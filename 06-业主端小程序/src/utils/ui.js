export function toast(title, { icon = 'none', duration = 1800 } = {}) {
  uni.showToast({ title, icon, duration, mask: false })
}

export const toastOk = title => toast(title, { icon: 'success' })
export const toastErr = title => toast(title, { duration: 2400 })

export function confirm({ title = '确认', content = '', okText = '确定', cancelText = '取消' } = {}) {
  return new Promise(resolve => {
    uni.showModal({
      title,
      content,
      confirmText: okText,
      cancelText,
      confirmColor: '#5b6cff',
      success: res => resolve(!!res.confirm),
      fail: () => resolve(false)
    })
  })
}

/** 返回：栈里有上一页就退，没有就回首页（业主端没有 tabBar，用 reLaunch 兜底） */
export function back(fallback = '/pages/home/index') {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: fallback })
}

/** 页面跳转的薄封装：统一用 navigateTo，避免各页自己拼 url 拼错 */
export const go = (url, params) => {
  const qs = params
    ? '?' +
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')
    : ''
  uni.navigateTo({ url: url + qs })
}

/** 读 query（uni 各端 onLoad 都给 options，这里只做兜底解码） */
export function queryOf(options = {}) {
  const out = {}
  for (const [k, v] of Object.entries(options)) {
    try {
      out[k] = decodeURIComponent(v)
    } catch (e) {
      out[k] = v
    }
  }
  return out
}
