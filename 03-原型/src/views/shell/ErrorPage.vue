<template>
  <div class="page">
    <div class="err">
      <div class="err__code" :class="`err__code--${code}`">{{ code }}</div>
      <div class="err__t">{{ meta.title }}</div>
      <div class="err__d">{{ meta.desc }}</div>
      <div v-if="code === '403' && fromTitle" class="err__from">「{{ fromTitle }}」</div>
      <div class="err__act">
        <el-button type="primary" @click="$router.push(HOME)">返回首页</el-button>
        <el-button @click="$router.back()">返回上一页</el-button>
      </div>
      <div v-if="code === '403'" class="err__tip">
        <div class="err__row"><span>当前角色</span><b>{{ roleName }}</b></div>
        <div class="err__row"><span>访问页面</span><b>{{ fromPath || '—' }}</b></div>
        <div class="err__row"><span>所需权限</span><b>{{ needLabel || '该页面未配置权限码' }}</b></div>
        <div class="err__hint">
          联系系统管理员在「组织与权限 → 角色权限」中为你的角色勾选该权限位；
          原型阶段也可直接用右上角「以某角色查看」切换视角。
        </div>
        <div class="err__act2">
          <el-button size="small" type="primary" plain @click="gotoOrg">去配置权限</el-button>
          <el-button size="small" plain @click="switchToAdmin">以集团总经理查看</el-button>
        </div>
      </div>
      <div v-if="code === '500'" class="err__tip">
        已记录错误，如持续出现请联系技术支持并提供当前时间与操作步骤。
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { HOME, PAGES } from '@/router/pages'
import { permLabel, roleOpts } from '@/utils/api'
import { currentRoleId, setRole } from '@/utils/auth'

const route = useRoute()
const router = useRouter()
const code = computed(() => String(route.params.code || route.path.split('/').pop() || '404'))

/* ---- 403 的上下文：谁、想进哪、缺哪个权限 ---- */
const fromPath = computed(() => String(route.query.from || '').replace(/^\/#?/, '/'))
const needLabel = computed(() => {
  const need = String(route.query.need || '')
  return need ? `${permLabel(need)}（${need}）` : ''
})
const roleName = computed(() => {
  const rid = String(route.query.role || currentRoleId.value)
  return roleOpts().find(r => r.value === rid)?.label || rid
})
/** 来源地址对应的页面标题（有则显示，比裸路径好认） */
const fromTitle = computed(() => {
  const p = String(route.query.from || '').split('?')[0]
  return PAGES.find(x => x.path === p)?.title || ''
})
function gotoOrg() { router.push('/e/org') }
function switchToAdmin() {
  setRole('R-GM')
  router.push(fromPath.value || HOME)
}

const META = {
  403: { title: '暂无访问权限', desc: '你当前的角色没有访问该页面的权限，或该数据不在你的数据范围内。' },
  404: { title: '页面不存在', desc: '地址可能已被调整或输入有误，请从菜单重新进入。' },
  500: { title: '服务暂时不可用', desc: '服务处理请求时发生异常，请稍后重试。' }
}
const meta = computed(() => META[code.value] || META[404])
</script>

<style scoped>
.err { padding: 80px 0; text-align: center; }
.err__code { font-size: 72px; font-weight: 600; color: var(--biz-text-3); letter-spacing: 4px; }
.err__code--403 { color: var(--biz-warn, #ff9f40); }
.err__code--500 { color: var(--biz-danger, #ff6b6b); }
.err__t { font-size: 20px; font-weight: 600; color: var(--biz-text-1); margin-top: 8px; }
.err__d { font-size: 13px; color: var(--biz-text-3); margin-top: 8px; }
.err__act { margin-top: 24px; display: flex; gap: 12px; justify-content: center; }
.err__from { font-size: 13px; color: var(--biz-text-2); margin-top: 6px; }
.err__tip {
  margin: 24px auto 0; max-width: 560px; font-size: 12.5px; color: var(--biz-text-2);
  background: var(--biz-bg-2, #f7f8fb); border-radius: 8px; padding: 12px 16px; text-align: left;
}
.err__row { display: flex; gap: 12px; padding: 3px 0; }
.err__row span { width: 60px; flex: none; color: var(--biz-text-3); }
.err__row b { font-weight: 600; color: var(--biz-text-1); word-break: break-all; }
.err__hint { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--biz-border); color: var(--biz-text-3); }
.err__act2 { margin-top: 12px; display: flex; gap: 8px; justify-content: center; }
</style>
