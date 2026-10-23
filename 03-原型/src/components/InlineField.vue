<template>
  <!-- 详情抽屉内联编辑（X2）：点击值即改，回车 / 失焦保存，Esc 取消，写库失败自动回滚并提示。
       用法：<InlineField :model-value="row.phone" :save="v => updateOwnerField(id,'phone',v)" /> -->
  <span class="if" :class="{ 'is-editable': editable, 'is-editing': editing }">
    <template v-if="!editing">
      <span class="if__v" :title="editable ? '点击编辑' : ''" @click="begin">
        {{ display || emptyText }}
      </span>
      <el-icon v-if="editable" class="if__pen" @click.stop="begin"><EditPen /></el-icon>
    </template>

    <template v-else>
      <el-input
        v-if="type === 'text' || type === 'textarea'"
        ref="ctl"
        v-model="draft"
        :type="type === 'textarea' ? 'textarea' : 'text'"
        :autosize="type === 'textarea' ? { minRows: 2, maxRows: 5 } : false"
        :maxlength="maxlength || undefined"
        size="small"
        :placeholder="placeholder"
        @keydown.enter="onEnter"
        @keydown.esc="cancel"
        @blur="onBlur"
      />
      <el-input-number
        v-else-if="type === 'number'"
        ref="ctl"
        v-model="draft"
        size="small"
        :min="min" :max="max" :precision="precision" :step="step"
        :controls="false" style="width:140px"
        @keydown.enter="commit"
        @keydown.esc="cancel"
        @blur="commit"
      />
      <el-select
        v-else-if="type === 'select'"
        ref="ctl"
        v-model="draft"
        size="small" style="width:160px"
        @change="commit"
        @visible-change="v => { if (!v && !committed) cancel() }"
      >
        <el-option v-for="o in opts" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-date-picker
        v-else-if="type === 'date'"
        ref="ctl"
        v-model="draft"
        type="date" size="small" style="width:160px"
        value-format="YYYY-MM-DD" :placeholder="placeholder"
        @change="commit"
      />
      <el-icon v-if="saving" class="if__load"><Loading /></el-icon>
      <el-icon v-else class="if__ok" @click.stop="commit"><Select /></el-icon>
      <el-icon class="if__no" @click.stop="cancel"><Close /></el-icon>
    </template>
  </span>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { EditPen, Loading, Select, Close } from '@element-plus/icons-vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  type: { type: String, default: 'text' }, // text | textarea | number | select | date
  options: { type: Array, default: () => [] }, // ['A','B'] 或 [{label,value}]
  editable: { type: Boolean, default: true },
  save: { type: Function, required: true }, // async (v) => any，抛错即回滚
  emptyText: { type: String, default: '—' },
  placeholder: { type: String, default: '请输入' },
  maxlength: { type: [String, Number], default: '' },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 99999999 },
  precision: { type: Number, default: 2 },
  step: { type: Number, default: 1 }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const editing = ref(false)
const saving = ref(false)
const draft = ref(props.modelValue)
const committed = ref(false)
const ctl = ref(null)

/**
 * 组件自持「已提交值」：保存成功后立刻显示新值，不等父组件把 props 回填回来
 * （详情抽屉里父级数据常被整体替换，回填不一定触发本字段重渲染，实测会「保存成功但显示不变」）
 * 一旦外部 props 变化（换了一条记录 / 父级刷新），本地值即失效，仍以外部为准。
 */
const local = ref(null)
const base = () => (local.value !== null ? local.value : props.modelValue)
watch(() => props.modelValue, () => { local.value = null })

const opts = computed(() => props.options.map(o => (typeof o === 'string' ? { label: o, value: o } : o)))
const display = computed(() => {
  const v = base()
  return v === 0 ? '0' : (v ?? '')
})

function begin() {
  if (!props.editable || editing.value) return
  draft.value = base()
  committed.value = false
  editing.value = true
  nextTick(() => {
    const el = ctl.value
    if (el?.focus) el.focus()
    else if (el?.$el?.querySelector) el.$el.querySelector('input')?.focus()
  })
}
function cancel() {
  if (saving.value) return
  editing.value = false
  draft.value = base()
}
function onEnter(e) {
  // textarea 用 Cmd/Ctrl+Enter 提交，避免换行被吞
  if (props.type === 'textarea' && !(e.metaKey || e.ctrlKey)) return
  commit()
}
let blurTimer = null
function onBlur() {
  clearTimeout(blurTimer)
  blurTimer = setTimeout(() => { if (editing.value) commit() }, 120)
}
async function commit() {
  if (saving.value) return
  const v = draft.value
  const b = base()
  const same = String(v ?? '') === String(b ?? '')
  if (same) { editing.value = false; return }
  saving.value = true
  committed.value = true
  try {
    await props.save(v)
    local.value = v
    emit('update:modelValue', v)
    emit('saved', v)
    editing.value = false
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
    draft.value = b
  } finally {
    saving.value = false
    setTimeout(() => { committed.value = false }, 0)
  }
}
</script>

<style scoped>
.if { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; }
.if__v { min-width: 0; word-break: break-all; }
.if.is-editable .if__v { cursor: pointer; border-bottom: 1px dashed transparent; }
.if.is-editable:hover .if__v { border-bottom-color: var(--el-color-primary); color: var(--el-color-primary); }
.if__pen { color: var(--biz-text-3); cursor: pointer; font-size: 13px; opacity: 0; transition: opacity .15s; }
.if:hover .if__pen { opacity: 1; }
.if.is-editing { flex: 1; }
.if__ok, .if__no, .if__load { cursor: pointer; font-size: 15px; flex: 0 0 auto; }
.if__ok { color: var(--el-color-success); }
.if__no { color: var(--biz-text-3); }
.if__load { color: var(--el-color-primary); }
</style>
