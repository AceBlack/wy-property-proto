<template>
  <!-- B 型列表骨架 · 快捷视图（带计数的单选 chips）
       替代原左侧树的「虚拟视图」节点：视图只表达状态，不再携带/清空空间范围，
       因此可以与下方 ScopeFilter 叠加（如「已逾期 + 翡翠城 1栋」）。
       用法：<QuickViews v-model="query.vf" :items="quickViews" hint="…" @change="search" /> -->
  <div class="qv">
    <el-radio-group :model-value="modelValue" size="small" @update:model-value="onPick">
      <el-radio-button v-for="v in items" :key="v.key" :value="v.key">
        {{ v.label }}<span v-if="v.n !== undefined && v.n !== null" class="qv__n">{{ v.n }}</span>
      </el-radio-button>
    </el-radio-group>
    <slot name="after" />
    <span class="spacer" />
    <slot name="hint">
      <span v-if="hint" class="muted qv__hint">{{ hint }}</span>
    </slot>
  </div>
</template>

<script setup>
const props = defineProps({
  /** 选中项 key（与查询条件里的 vf 对应；空串 = 全部） */
  modelValue: { type: String, default: '' },
  /** [{ key, label, n }]，key 为空串的那项即「全部」 */
  items: { type: Array, default: () => [] },
  hint: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'change'])

function onPick(v) {
  emit('update:modelValue', v || '')
  emit('change', v || '')
}
</script>

<style scoped>
.qv { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.qv__n {
  display: inline-block; margin-left: 5px; padding: 0 5px; border-radius: 8px;
  background: rgba(0, 0, 0, .06); font-size: 11px; line-height: 15px;
  font-variant-numeric: tabular-nums; color: var(--biz-text-3);
}
.qv__hint { font-size: 12px; }
.spacer { flex: 1; }
</style>
