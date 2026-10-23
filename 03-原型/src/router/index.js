import { createRouter, createWebHashHistory } from 'vue-router'
import { PAGES, HOME, LEGACY } from './pages'
import { canVisit, currentRoleId, needPermOf } from '@/utils/auth'

// 只注册 status === 'done' 的页面；todo 页面在菜单中置灰并提示建设中
const children = PAGES.filter(p => p.status === 'done').map(p => ({
  path: p.path.replace(/^\//, ''),
  name: p.name,
  component: p.component,
  meta: { title: p.title, group: p.group, desc: p.desc }
}))

// 域拆分后旧地址跳转（见 pages.js 的 LEGACY）
// 用函数式 redirect 保留 query，旧链接上的 ?focus= / ?vf= 才能继续落地
LEGACY.forEach(({ from, to }) => {
  children.push({
    path: from.replace(/^\//, ''),
    redirect: route => ({ path: to, query: route.query })
  })
})

const routes = [
  {
    path: '/',
    component: () => import('@/layout/AppShell.vue'),
    redirect: HOME,
    children
  },
  { path: '/:pathMatch(.*)*', redirect: HOME }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

// 页面级权限守卫（见 utils/auth.js 顶部的行为口径）
// 无权限码覆盖的公共页（shell 模板页、错误页）放行；其余按角色权限码判定，
// 不通过则进 403 落地页，并把来源地址与所需权限码带过去，落地页才知道该申请什么。
router.beforeEach((to) => {
  if (to.path.startsWith('/error/')) return true
  if (canVisit(to.path)) return true
  return {
    path: '/error/403',
    query: { from: to.fullPath, need: needPermOf(to.path), role: currentRoleId.value }
  }
})

router.afterEach((to) => {
  const t = to.meta?.title
  document.title = t ? `${t} · 智慧物业 V2 原型` : '智慧物业 V2 原型'
})

export default router
