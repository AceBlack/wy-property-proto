<template>
  <aside class="app-side" :class="{ 'is-collapse': collapse }">
    <div class="side-logo">
      <span class="mark">WY</span>
      <span class="name">智慧物业 V2</span>
      <span class="sub">原型</span>
    </div>

    <nav class="side-nav">
      <div v-for="g in GROUPS" :key="g.key" class="side-group">
        <div class="side-group__title">{{ g.name }}</div>
        <div
          v-for="p in pagesOf(g.key)"
          :key="p.path"
          class="side-item"
          :class="{
            'is-active': isActive(p),
            'is-todo': p.status === 'todo'
          }"
          :title="p.status === 'todo' ? `${p.title}（规划中）` : p.desc"
          @click="go(p)"
        >
          <el-icon><component :is="p.icon" /></el-icon>
          <span class="txt">{{ p.title }}</span>
          <span v-if="p.status === 'todo'" class="dot">规划</span>
        </div>
      </div>
    </nav>

    <div class="side-foot">
      <div class="btn" @click="emit('toggle')">
        <el-icon><component :is="collapse ? 'Expand' : 'Fold'" /></el-icon>
        <span v-if="!collapse">收起导航</span>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { GROUPS, PAGES } from '@/router/pages'
import { canVisit } from '@/utils/auth'

defineProps({ collapse: { type: Boolean, default: false } })
const emit = defineEmits(['toggle'])

const route = useRoute()
const router = useRouter()

// hidden:true 的页面（新增 / 编辑表单）不进菜单，但仍注册路由
// 权限守卫：当前角色无权限的页面直接隐藏（见 utils/auth.js 行为口径①）
const pagesOf = key => PAGES.filter(p => p.group === key && !p.hidden && canVisit(p.path))
// 子路径也高亮：停在 /a/owners/new 时，菜单仍高亮「业主档案」
const isActive = p => route.path === p.path || route.path.startsWith(p.path + '/')

function go(p) {
  if (p.status === 'todo') {
    ElMessage({
      message: `「${p.title}」正在建设中 · ${p.desc || ''}`,
      type: 'info',
      duration: 1800
    })
    return
  }
  router.push(p.path)
}
</script>
