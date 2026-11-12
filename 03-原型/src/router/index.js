import { createRouter, createWebHashHistory } from 'vue-router'
import { PAGES, HOME, LEGACY } from './pages'
import { canVisit, currentRoleId, needPermOf } from '@/utils/auth'

// 只注册 status === 'done' 的页面；todo 页面在菜单中置灰并提示建设中
const children = PAGES.filter(p => p.status === 'done').map(p => ({
  path: p.path.replace(/^\//, ''),
  name: p.name,
  component: p.component,
  meta: { title: p.title, group: p.group, desc: p.desc, standalone: !!p.standalone, hidden: !!p.hidden }
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
  /* 扫码落地页：**不在 AppShell 下**，所以没有侧边栏 / 顶栏，也不需要登录。
     用 hash 路由是为了同一个静态包既能后台用、又能被手机扫码打开
     （`…/#/scan/{token}`）。真上线时这一页应当是独立轻 H5，
     但原型阶段放在一起最省事，且能直接复用 mock 与 token 样式。 */
  {
    path: '/scan/:token',
    name: 'AssetScan',
    component: () => import('@/views/public/AssetScan.vue'),
    meta: { title: '资产信息', public: true }
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
  /* 扫码页免登录：别人的手机上没有这个系统的角色，要求登录等于把功能做废。
     它的信息边界由数据层保证（assetPublicView 只返回白名单字段），不靠登录态。 */
  if (to.meta?.public || to.path.startsWith('/scan/')) return true
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
