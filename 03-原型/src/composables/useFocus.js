// 跨页锚点（focus 协议）：?focus=<type>:<id>&open=1
// 落地顺序：URL focus > 树选中 > 筛选条件，保证从驾驶舱/其它页跳进来不会被默认状态覆盖

import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { focusExtra, focusLocation } from '@/utils/api'

/** 锚点解析：老实体走 focusLocation，补充批次（租户/合同/公告/品质记录）走 focusExtra */
function resolve(type, id) {
  if (!type || !id) return null
  return focusLocation(type, id) || focusExtra(type, id)
}

export function parseFocus(q) {
  const [type, id] = String(q || '').split(':')
  return type && id ? { type, id } : null
}

/** 在树里找到节点路径，用于范围条（面包屑） */
export function pathOf(nodes, id) {
  const walk = (list, trail) => {
    for (const n of list) {
      const next = [...trail, n.label]
      if (n.id === id) return next
      if (n.children?.length) {
        const r = walk(n.children, next)
        if (r) return r
      }
    }
    return null
  }
  return walk(nodes, []) || []
}

/** 取当前 URL 上的锚点位置（可能为空） */
export function useFocus() {
  const route = useRoute()
  const focus = parseFocus(route.query.focus)
  return {
    focus,
    open: route.query.open === '1',
    location: focus ? resolve(focus.type, focus.id) : null
  }
}

/**
 * 锚点落地：挂载时执行一次，之后 URL 上的 focus 变化也执行
 * —— 同一路由内换 focus（例如已经在车辆页又点了一次跳转）onMounted 不会重跑，必须靠 watch
 */
export function useFocusLanding(cb) {
  const route = useRoute()
  const read = () => {
    const focus = parseFocus(route.query.focus)
    return {
      focus,
      open: route.query.open === '1',
      location: focus ? resolve(focus.type, focus.id) : null
    }
  }
  onMounted(() => cb(read()))
  watch(() => `${route.query.focus || ''}|${route.query.open || ''}`, () => cb(read()))
}
