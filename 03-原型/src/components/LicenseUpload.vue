<template>
  <div class="lf">
    <div class="lf__grid">
      <div v-for="f in files" :key="f.fileId" class="lf__card" :class="{ 'is-pdf': !isImg(f) }">
        <img v-if="isImg(f) && urlOf(f)" :src="urlOf(f)" class="lf__img" :alt="f.name" @click="openPreview(f)" />
        <div v-else class="lf__ph" :class="{ 'is-clickable': isImg(f) }" @click="openPreview(f)">
          <el-icon><Document /></el-icon>
          <span>{{ isImg(f) ? '预览' : 'PDF' }}</span>
        </div>
        <div class="lf__name" :title="f.name">{{ f.name }}</div>
        <div class="lf__meta">{{ mb(f.size) }}<template v-if="f.uploadedBy"> · {{ f.uploadedBy }}</template></div>
        <el-button v-if="!disabled" class="lf__del" link type="danger" :icon="'Delete'" title="删除" @click="onRemove(f)" />
      </div>

      <label v-if="!disabled && files.length < rules.maxCount" class="lf__add">
        <input type="file" :accept="rules.accept" multiple hidden @change="onPick" />
        <el-icon><Plus /></el-icon>
        <span>上传执照</span>
      </label>
    </div>

    <div class="lf__hint">
      已传 {{ files.length }} / {{ rules.maxCount }} 张 ·
      {{ rules.typeText }}，单张 ≤ {{ rules.maxSizeMB }} MB。
      <template v-if="local">所选执照随租户一起保存。</template>
      <template v-else-if="!tenantId">保存租户后才能上传影像件。</template>
      <template v-else>原型只登记文件信息，刷新后不保留文件本身（校验与留痕按真接口做）。</template>
    </div>

    <el-dialog v-model="previewVisible" :title="previewFile?.name" width="640px" append-to-body>
      <img v-if="previewUrl" :src="previewUrl" style="width:100%;border-radius:8px;" alt="执照预览" />
      <div v-else class="lf__nofile">
        这是样例数据里的影像件，原型没有存真实文件。<br />
        重新上传一张即可看到预览效果。
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  TENANT_FILE_RULES, addTenantLicenseFile, buildLicenseFile, checkTenantFile, removeTenantLicenseFile
} from '@/utils/api'

const props = defineProps({
  tenantId: { type: String, default: '' },
  files: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  operator: { type: String, default: '物业前台' },
  /* 新建租户时 tenantId 还不存在：文件先挂在表单上（local），保存时随主体一次写入 */
  local: { type: Boolean, default: false }
})
const emit = defineEmits(['changed'])

const rules = TENANT_FILE_RULES
/* blob URL 只挂在本次会话里：原型没有对象存储，用本地文件生成的预览地址刷新即失效 */
const localUrls = ref({})
const previewVisible = ref(false)
const previewFile = ref(null)

const isImg = f => String(f.type || '').startsWith('image/')
const urlOf = f => localUrls.value[f.fileId] || ''
const mb = n => `${((Number(n) || 0) / 1024 / 1024).toFixed(2)} MB`
const previewUrl = computed(() => (previewFile.value ? urlOf(previewFile.value) : ''))

function openPreview (f) {
  previewFile.value = f
  previewVisible.value = true
}

async function onPick (e) {
  const picked = [...(e.target.files || [])]
  e.target.value = ''            /* 同一个文件连选两次也要能触发 change */
  if (!props.tenantId && !props.local) { ElMessage.warning('请先保存租户，再上传营业执照'); return }
  let ok = 0
  let latest = props.files
  for (const file of picked) {
    const meta = { name: file.name, size: file.size, type: file.type }
    try {
      if (props.local) {
        const bad = checkTenantFile(meta, latest)
        if (bad) throw new Error(bad)
        const rec = buildLicenseFile(meta, props.operator, latest.length + 1)
        latest = [...latest, rec]
        if (file.type.startsWith('image/')) localUrls.value = { ...localUrls.value, [rec.fileId]: URL.createObjectURL(file) }
      } else {
        const r = addTenantLicenseFile(props.tenantId, meta, props.operator)
        if (file.type.startsWith('image/')) localUrls.value = { ...localUrls.value, [r.file.fileId]: URL.createObjectURL(file) }
        latest = r.files
      }
      ok += 1
    } catch (err) {
      ElMessage.warning(`${file.name}：${err.message}`)
    }
  }
  if (ok) {
    ElMessage.success(props.local
      ? `已选择 ${ok} 张，保存租户时一并提交`
      : `已上传 ${ok} 张营业执照影像件，核验依据已补齐`)
    emit('changed', latest)
  }
}

async function onRemove (f) {
  try {
    await ElMessageBox.confirm(
      `删除后不可恢复${props.files.length === 1 ? '，且这是最后一张——公司核验将无法提交' : ''}。`,
      `删除 ${f.name}`, { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch { return }
  try {
    const files = props.local
      ? props.files.filter(x => x.fileId !== f.fileId)
      : removeTenantLicenseFile(props.tenantId, f.fileId, props.operator).files
    if (localUrls.value[f.fileId]) URL.revokeObjectURL(localUrls.value[f.fileId])
    ElMessage.success(props.local ? '已移除' : '已删除')
    emit('changed', files)
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}
</script>

<style scoped>
.lf { margin-top: 2px; }
.lf__grid { display: flex; flex-wrap: wrap; gap: 10px; }
.lf__card {
  position: relative; width: 118px; padding: 6px; border: 1px solid var(--biz-border, #e4e7eff0);
  border-radius: 8px; background: var(--biz-surface, #fff); text-align: center;
}
.lf__img { width: 100%; height: 72px; object-fit: cover; border-radius: 5px; cursor: zoom-in; display: block; }
.lf__ph {
  height: 72px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; border-radius: 5px; background: rgba(91, 108, 255, .07); color: var(--biz-primary, #5b6cff);
  font-size: 11px;
}
.lf__ph.is-clickable { cursor: zoom-in; }
.lf__name {
  margin-top: 4px; font-size: 11px; color: var(--biz-text-2, #5c6272);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.lf__meta { font-size: 10.5px; color: var(--biz-text-3, #8a90a2); }
.lf__del { position: absolute; top: 0; right: 0; padding: 0 4px; }
.lf__add {
  width: 118px; height: 108px; border: 1px dashed var(--biz-border, #d4d8e3); border-radius: 8px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  cursor: pointer; color: var(--biz-text-3, #8a90a2); font-size: 12px;
}
.lf__add:hover { border-color: var(--biz-primary, #5b6cff); color: var(--biz-primary, #5b6cff); }
.lf__hint { margin-top: 6px; font-size: 11.5px; line-height: 1.6; color: var(--biz-text-3, #8a90a2); }
.lf__nofile { padding: 24px; text-align: center; color: var(--biz-text-3, #8a90a2); font-size: 13px; line-height: 1.8; }
</style>
