<template>
  <!-- 表单页骨架（2026-11-18 改版）
       结构：页头（返回 + 标题 + ⓘ说明）→ 分区白卡（每区 ≤8 字段）→ 吸底操作栏
       说明文字不再用蓝底 note 条压在首屏，收进标题旁的 ⓘ 弹层。
       页面通过 shell.value.formRef 拿到 el-form 实例交给 useForm -->
  <div class="page fs-page">
    <div class="fs-head">
      <button class="fs-back" title="返回列表" @click="emit('cancel')">‹</button>
      <h2 v-if="title" class="fs-title">{{ title }}</h2>
      <el-popover v-if="title || subtitle" placement="bottom-start" :width="460" trigger="click" popper-class="bl-pop">
        <template #reference>
          <el-icon class="fs-info" title="这页怎么填"><InfoFilled /></el-icon>
        </template>
        <div class="fs-tip">
          <b>{{ title }}</b><template v-if="subtitle">：{{ subtitle }}</template>
          <slot name="note" />
        </div>
      </el-popover>
      <span class="spacer" />
      <span v-if="dirty" class="fs-dirty">有未保存的改动</span>
    </div>

    <el-form
      ref="formRef" v-loading="loading" :model="form" :rules="rules"
      :label-width="labelWidth" label-position="right" class="fs-form"
    >
      <slot />
    </el-form>

    <div class="fs-foot">
      <slot name="footLeft" />
      <span class="spacer" />
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button v-if="showDraft" :loading="saving" @click="emit('draft')">存为草稿</el-button>
      <el-button type="primary" :loading="saving" @click="emit('submit')">
        {{ submitText }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { InfoFilled } from '@element-plus/icons-vue'

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
.fs-page { display: flex; flex-direction: column; min-height: calc(100vh - 128px); padding-bottom: 8px; }

/* 页头：返回 + 标题 + 说明图标 */
.fs-head { display: flex; align-items: center; gap: 10px; height: 36px; margin-bottom: 14px; }
.fs-back {
  appearance: none; border: 1px solid var(--biz-border); background: #fff;
  width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
  color: var(--biz-text-2); font-size: 16px; line-height: 1; padding: 0;
  display: grid; place-items: center;
}
.fs-back:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.fs-title { font-size: 17px; font-weight: 500; letter-spacing: -.01em; margin: 0; color: var(--biz-text-1); }
.fs-info { font-size: 14px; color: var(--biz-text-4); cursor: pointer; }
.fs-info:hover { color: var(--el-color-primary); }
.fs-tip { font-size: 12.5px; line-height: 1.8; color: var(--biz-text-2); }
.fs-tip b { color: var(--biz-text-1); font-weight: 500; }
.fs-dirty { font-size: 12px; color: var(--biz-warning); }

/* 表单主体：每个 .sec 独立成白卡 */
.fs-form { flex: 1; padding-bottom: 4px; }
.fs-form :deep(.sec) {
  background: #fff; border-radius: 14px; padding: 18px 20px 4px; margin-bottom: 12px;
}
.fs-form :deep(.sec__hd) { display: flex; align-items: baseline; gap: 8px; margin-bottom: 16px; }
.fs-form :deep(.sec__hd h4) { font-size: 14px; font-weight: 500; color: var(--biz-text-1); margin: 0; }
.fs-form :deep(.sec__hd .desc) { font-size: 12px; color: var(--biz-text-4); }
.fs-form :deep(.el-form-item) { margin-bottom: 16px; }
.fs-form :deep(.el-form-item__label) { font-size: 13px; color: var(--biz-text-2); }

/* 吸底操作栏 */
.fs-foot {
  position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px;
  background: #fff; border-top: 1px solid #F0F2F6;
  padding: 12px 24px; margin: 0 -24px -24px;
  box-shadow: 0 -6px 18px rgba(31, 37, 64, .05);
}
.fs-foot .spacer { flex: 1; }
</style>
