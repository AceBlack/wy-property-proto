<template>
  <div class="app-shell">
    <AppSidebar :collapse="collapse" @toggle="collapse = !collapse" />
    <div class="app-main">
      <AppTopBar :collapse="collapse" @toggle="collapse = !collapse" />
      <div class="app-body">
        <div class="app-crumb">
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
</script>
