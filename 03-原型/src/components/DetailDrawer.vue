<template>
  <!-- 通用详情抽屉：A 级交互的「详情弹窗」载体
       用法：<DetailDrawer v-model="visible" :loading="loading" title="…" subtitle="…">
              <template #default> 字段分组 / 关联子表 / 时间线 </template>
              <template #footer> 底部操作 </template>
  -->
  <el-drawer v-model="inner" :size="width" class="detail-drawer" :close-on-click-modal="true">
    <template #header>
      <div class="dd__hd">
        <div class="dd__t">
          <span class="dd__tt">{{ title || '详情' }}</span>
          <StatusTag v-if="status" :domain="statusDomain" :value="status" />
          <span v-if="tag" class="tag tag--muted">{{ tag }}</span>
        </div>
        <div v-if="subtitle" class="dd__s">{{ subtitle }}</div>
      </div>
    </template>

    <div v-loading="loading" class="dd__b">
      <slot />
    </div>

    <template v-if="$slots.footer" #footer>
      <div class="dd__f"><slot name="footer" /></div>
    </template>
  </el-drawer>
</template>

<script setup>
import { computed } from 'vue'
import StatusTag from '@/components/StatusTag.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  tag: { type: String, default: '' },
  status: { type: String, default: '' },
  statusDomain: { type: String, default: 'house' },
  loading: { type: Boolean, default: false },
  width: { type: String, default: '720px' }
})
const emit = defineEmits(['update:modelValue'])
const inner = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})
</script>

<style scoped>
.dd__hd { min-width: 0; }
.dd__t { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dd__tt { font-size: 18px; font-weight: 600; color: var(--biz-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd__s { font-size: 12.5px; color: var(--biz-text-3); margin-top: 6px; }
.dd__b { min-height: 120px; }
.dd__f { display: flex; justify-content: flex-end; gap: 8px; }
</style>

<style>
/* 抽屉头部/底部间距跟随规范：内距 20，底部操作右对齐 */
.detail-drawer .el-drawer__header { margin-bottom: 0; padding: 16px 20px; border-bottom: 1px solid var(--biz-border-light); }
.detail-drawer .el-drawer__body { padding: 20px; }
.detail-drawer .el-drawer__footer { padding: 12px 20px; border-top: 1px solid var(--biz-border-light); }
</style>
