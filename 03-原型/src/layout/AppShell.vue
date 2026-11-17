<template>
  <!-- 独立页（收银台）不套外壳：多一个侧栏就少一块操作区，且收银时不该看到别的菜单 -->
  <router-view v-if="standalone" />
  <div v-else class="app-shell">
    <AppSidebar :collapse="collapse" @toggle="collapse = !collapse" />
    <div class="app-main">
      <AppTopBar :collapse="collapse" @toggle="collapse = !collapse" />
      <div class="app-body" :class="{ 'is-bleed': bleed }">
        <div v-if="!bleed" class="app-crumb">
          <span>{{ groupName }}</span>
          <span class="sep">/</span>
          <span class="cur">{{ pageName }}</span>
          <span v-if="pageDesc" class="sep">/</span>
          <span v-if="pageDesc" class="muted">{{ pageDesc }}</span>
        </div>
        <router-view v-slot="{ Component }">
          <component :is="Component" :key="route.path + '|' + roleViewKey" />
        </router-view>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from './AppSidebar.vue'
import AppTopBar from './AppTopBar.vue'
import { groupOf, pageOf } from '@/router/pages'
import { roleViewKey } from '@/utils/auth'

const collapse = ref(false)
const route = useRoute()

const page = computed(() => pageOf(route.path))
const groupName = computed(() => groupOf(page.value?.group)?.name || '原型')
const pageName = computed(() => page.value?.title || route.meta?.title || '')
const pageDesc = computed(() => page.value?.desc || '')
const standalone = computed(() => !!route.meta?.standalone)
const bleed = computed(() => route.meta?.chrome === 'bleed')
</script>
