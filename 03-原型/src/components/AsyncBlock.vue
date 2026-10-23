<template>
  <!-- 异步区块三态包装：加载中 / 失败 / 空 / 正常
       用法：<AsyncBlock :loading="loading" :error="error" :empty="!rows.length" @retry="load">
                <表格 / 图表 / 描述列表>
             </AsyncBlock>
       失败与「无数据」必须分开：失败给重试，无数据给主动作 -->
  <div class="async">
    <div v-if="loading" class="async__loading">
      <el-skeleton :rows="skeletonRows" animated />
    </div>

    <!-- 403 走「无权限」形态（不显示重试，重试没有意义）；其余走「加载失败 + 重试」 -->
    <div v-else-if="error" class="async__err">
      <EmptyState :type="errKind" :title="errTitle" :desc="error">
        <template #action>
          <el-button v-if="errKind === 'error'" type="primary" :icon="'RefreshRight'" @click="emit('retry')">重试</el-button>
          <el-button v-if="backPath" @click="$router.push(backPath)">返回列表</el-button>
        </template>
      </EmptyState>
    </div>

    <slot v-else-if="!empty" />

    <div v-else class="async__empty">
      <slot name="empty">
        <EmptyState :type="emptyType" :title="emptyTitle" :desc="emptyDesc">
          <template v-if="$slots.emptyAction" #action><slot name="emptyAction" /></template>
        </EmptyState>
      </slot>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import EmptyState from '@/components/EmptyState.vue'

const props = defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  errorCode: { type: Number, default: 0 },
  empty: { type: Boolean, default: false },
  errorTitle: { type: String, default: '' },
  emptyType: { type: String, default: 'empty' },   // empty | search | denied
  emptyTitle: { type: String, default: '' },
  emptyDesc: { type: String, default: '' },
  skeletonRows: { type: Number, default: 4 },
  backPath: { type: String, default: '' }
})
const emit = defineEmits(['retry'])

/** 状态码 → 形态与标题：403 是「无权限」不是「加载失败」，二者动作不同 */
const ERR_TITLE = { 403: '暂无查看权限', 401: '登录已过期', 504: '请求超时', 500: '服务暂时不可用' }
const errKind = computed(() => (props.errorCode === 403 ? 'denied' : 'error'))
const errTitle = computed(() => props.errorTitle || ERR_TITLE[props.errorCode] || '数据加载失败')
</script>

<style scoped>
.async { min-height: 60px; }
.async__loading { padding: 12px 0; }
.async__err, .async__empty { padding: 8px 0; }
</style>
