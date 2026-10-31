<template>
  <!-- B 型列表骨架 · 范围筛选（项目 / 楼栋 / 单元级联）
       替代原来的左侧空间树：范围与「快捷视图」可叠加，不再互斥。
       用法（放在页面的 <el-form class="filter-bar"> 内）：
         <ScopeFilter :model="query" @patch="p => Object.assign(query, p)" @change="search" /> -->
  <el-form-item label="项目">
    <el-select :model-value="model.communityId || ''" placeholder="全部" clearable filterable style="width:126px"
      @change="setCommunity">
      <el-option v-for="c in communityOpts" :key="c.value" :label="c.label" :value="c.value" />
    </el-select>
  </el-form-item>

  <template v-if="levels.includes('building')">
    <el-form-item label="楼栋">
      <el-select :model-value="model.buildingId || ''" placeholder="全部" clearable filterable style="width:148px"
        @change="setBuilding">
        <el-option v-for="b in buildingOpts" :key="b.value" :label="b.label" :value="b.value" />
      </el-select>
    </el-form-item>
  </template>

  <template v-if="levels.includes('unit')">
    <el-form-item label="单元">
      <el-select :model-value="model.unitId || ''" placeholder="全部" clearable :disabled="!model.buildingId"
        style="width:96px" @change="setUnit">
        <el-option v-for="u in unitOpts" :key="u.value" :label="u.label" :value="u.value" />
      </el-select>
    </el-form-item>
  </template>
</template>

<script setup>
import { computed } from 'vue'
import { cashierBuildingOpts, cashierUnitOpts, communities } from '@/utils/api'

const props = defineProps({
  /** 页面上的 query 对象（只读使用，修改一律走 patch 事件，避免直接改 prop） */
  model: { type: Object, required: true },
  /** 展示哪几级：community / building / unit */
  levels: { type: Array, default: () => ['community', 'building', 'unit'] }
})
const emit = defineEmits(['patch', 'change'])

const communityOpts = computed(() => communities.map(c => ({ value: c.communityId, label: c.name })))
const buildingOpts = computed(() => cashierBuildingOpts(props.model.communityId || ''))
const unitOpts = computed(() => cashierUnitOpts(props.model.buildingId || ''))

/* 改上级清下级：否则会出现「翡翠城 + 星光天地的楼栋」这种跨项目组合 */
function setCommunity(v) {
  emit('patch', { communityId: v || '', buildingId: '', unitId: '' })
  emit('change')
}
function setBuilding(v) {
  emit('patch', { buildingId: v || '', unitId: '' })
  emit('change')
}
function setUnit(v) {
  emit('patch', { unitId: v || '' })
  emit('change')
}
</script>
