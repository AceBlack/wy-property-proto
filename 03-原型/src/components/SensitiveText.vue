<template>
  <!-- 敏感字段（手机号 / 证件号 / 银行账号）统一展示：
       默认脱敏；点眼睛临时揭示，并写一条「查看明文」访问日志（/e/access-log 可查）。
       无权限的角色只看到脱敏值，眼睛点了会提示去开通 —— 不做静默降级。 -->
  <span class="sst" :class="{ 'is-open': shown }">
    <span class="sst__v">{{ shown ? (plainText || '—') : masked }}</span>
    <el-tooltip :content="tip" placement="top" :show-after="260">
      <el-icon class="sst__i" @click.stop="toggle">
        <Hide v-if="shown" />
        <View v-else />
      </el-icon>
    </el-tooltip>
  </span>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Hide, View } from '@element-plus/icons-vue'
import { canViewSensitive, maskSensitive, revealSensitive } from '@/utils/api'

const props = defineProps({
  value: { type: String, default: '' },
  /** phone | idCard | bankAccount | emergencyPhone */
  field: { type: String, default: 'phone' },
  entityType: { type: String, default: '' },   // 业主 / 租户 / 员工 / 合同联系人
  entityId: { type: String, default: '' },
  entityName: { type: String, default: '' },
  source: { type: String, default: '' },       // 来源页面，写进留痕便于回溯
  /** 只展示掩码、不提供揭示入口（如列表批量展示时用） */
  readonly: { type: Boolean, default: false }
})

const shown = ref(false)
/* 列表接口只返回掩码，明文由揭示接口回源取；这里存接口返回的真值，不拿掩码当明文 */
const plainText = ref('')
const allowed = computed(() => canViewSensitive())
const masked = computed(() => maskSensitive(props.field, props.value))
const tip = computed(() => {
  if (!allowed.value) return '无「敏感字段明文」权限，仅显示脱敏值'
  if (props.readonly) return '脱敏展示'
  return shown.value ? '收起' : '查看明文（会记录查看留痕）'
})

function toggle() {
  if (props.readonly) return
  if (!allowed.value) {
    ElMessage.warning('无「敏感字段明文」权限，如需查看请联系项目经理开通')
    return
  }
  if (shown.value) { shown.value = false; return }
  try {
    const v = revealSensitive({
      entityType: props.entityType, entityId: props.entityId, entityName: props.entityName,
      field: props.field, value: props.value, source: props.source
    })
    plainText.value = v || props.value
    shown.value = true
  } catch (e) {
    ElMessage.error(e?.message || '无权查看明文')
  }
}
</script>

<style scoped>
.sst { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.sst__v { font-variant-numeric: tabular-nums; }
.sst__i {
  font-size: 13px; color: var(--biz-text-3); cursor: pointer; flex: 0 0 auto;
  opacity: .55; transition: opacity .15s, color .15s;
}
.sst:hover .sst__i { opacity: 1; }
.sst__i:hover { color: var(--el-color-primary); }
.sst.is-open .sst__i { opacity: 1; color: var(--el-color-primary); }
</style>
