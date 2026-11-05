/** 留言只存本机：演示环境没有客服工单系统，别假造一个"已受理"的接口 */
const KEY = 'wy_owner_feedback'

export function useFeedback(type, text) {
  let list = []
  try {
    list = uni.getStorageSync(KEY) || []
  } catch (e) {
    list = []
  }
  list.unshift({ type, text, at: new Date().toISOString().slice(0, 16).replace('T', ' ') })
  try {
    uni.setStorageSync(KEY, list.slice(0, 50))
  } catch (e) {
    /* ignore */
  }
  return list
}
