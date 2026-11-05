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

export function back(fallback = '/pages/tasks/list') {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: fallback })
}
