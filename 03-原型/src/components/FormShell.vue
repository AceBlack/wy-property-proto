<template>
  <!-- 表单页骨架：说明条 → 分区表单（每区 ≤8 字段）→ 底部固定操作栏
       用法：<FormShell ref="shell" :form="form" :rules="rules" :dirty="dirty" :saving="saving"
                        back-path="/a/owners" @submit="submit" @cancel="onCancel" @draft="onDraft">
               <div class="sec">…</div>
             </FormShell>
       页面通过 shell.value.formRef 拿到 el-form 实例交给 useForm -->
  <div class="page">
    <div v-if="title" class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>{{ title }}</b>{{ subtitle ? '：' + subtitle : '' }}
        <slot name="note" />
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form
        ref="formRef" v-loading="loading" :model="form" :rules="rules"
        :label-width="labelWidth" label-position="right"
      >
        <slot />
      </el-form>
    </div>

    <div class="panel form-foot">
      <slot name="footLeft" />
      <span v-if="dirty" class="muted" style="font-size:12px;">有未保存的改动</span>
      <span class="spacer" />
      <el-button style="width:100px;" @click="emit('cancel')">取消</el-button>
      <el-button v-if="showDraft" style="width:100px;" :loading="saving" @click="emit('draft')">存为草稿</el-button>
      <el-button type="primary" style="width:100px;" :loading="saving" @click="emit('submit')">
        {{ submitText }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  form: { type: Object, required: true },
  rules: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  dirty: { type: Boolean, default: false },
  labelWidth: { type: String, default: '96px' },
  submitText: { type: String, default: '保存' },
  showDraft: { type: Boolean, default: false }
})
const emit = defineEmits(['submit', 'cancel', 'draft'])

const formRef = ref()
defineExpose({ formRef })
</script>

<style scoped>
/* 底部操作栏跟随 TplForm 既有实现：sticky 吸底、右侧操作、左侧放提示 */
.form-foot { display: flex; align-items: center; gap: 12px; margin-top: 16px; position: sticky; bottom: 0; }
.form-foot .spacer { flex: 1; }
</style>
