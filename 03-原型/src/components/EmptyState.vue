<template>
  <div class="empty">
    <div class="empty__ico" :style="{ background: bg }">
      <el-icon><component :is="icon" /></el-icon>
    </div>
    <div class="empty__t">{{ title }}</div>
    <div v-if="desc" class="empty__d">{{ desc }}</div>
    <div v-if="$slots.action" class="empty__act">
      <slot name="action" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// 三型缺省：empty 无数据 / search 无搜索结果 / denied 无权限
const props = defineProps({
  type: { type: String, default: 'empty' },
  title: { type: String, default: '' },
  desc: { type: String, default: '' }
})

const META = {
  empty: { icon: 'FolderOpened', color: '#8a94b0', title: '暂无数据' },
  search: { icon: 'Search', color: '#5b6cff', title: '没有找到匹配的结果' },
  denied: { icon: 'Lock', color: '#ff6b6b', title: '暂无查看权限' },
  error: { icon: 'WarningFilled', color: '#ff9f40', title: '数据加载失败' }
}
const meta = computed(() => META[props.type] || META.empty)
const icon = computed(() => meta.value.icon)
const bg = computed(() => meta.value.color)
const title = computed(() => props.title || meta.value.title)
</script>

<style scoped>
.empty {
  padding: 48px 0; text-align: center; color: var(--biz-text-3);
}
.empty__ico {
  width: 64px; height: 64px; margin: 0 auto 14px; border-radius: 50%;
  display: grid; place-items: center; font-size: var(--biz-icon-empty); color: #fff; opacity: .9;
}
.empty__t { font-size: 14px; color: var(--biz-text-2); }
.empty__d { font-size: 12.5px; margin-top: 6px; }
/* 主动作：规范要求「插画 + 说明 + 一个主动作」，只放一个按钮 */
.empty__act { margin-top: 16px; }
</style>
