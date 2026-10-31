<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>巡检模板 · 公司级标准</b>：执行模板（告诉一线「做什么、什么算合格」）与监督模板
        （告诉部门经理「查下属哪些方面」）<b>统一由品质督导维护</b>，其他角色只读；
        模板不带项目维度，各项目的计划引用同一套标准，品质评价才能横向比较。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">模板总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">个</span></div></div>
        <div class="dstat"><div class="dstat__k">执行 / 监督</div><div class="dstat__v">{{ summary.exec }}<span class="unit">/ {{ summary.sup }}</span></div></div>
        <div class="dstat"><div class="dstat__k">检查项合计</div><div class="dstat__v">{{ summary.fields }}<span class="unit">项</span></div></div>
        <div class="dstat"><div class="dstat__k">未被引用</div><div class="dstat__v" :class="summary.unused > 0 ? 'is-warn' : ''">{{ summary.unused }}<span class="unit">个</span></div></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-tabs v-model="activeType" @tab-change="load">
        <el-tab-pane label="执行模板（一线作业）" name="执行" />
        <el-tab-pane label="监督模板（组长核验）" name="监督" />
      </el-tabs>

      <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
        <el-form-item :label="activeType === '监督' ? '被检岗位' : '适用岗位'">
          <el-select v-model="query.post" placeholder="全部" clearable style="width:120px">
            <el-option v-for="o in postOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width:110px">
            <el-option label="启用" value="启用" /><el-option label="停用" value="停用" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="模板号 / 名称 / 版本" clearable style="width:190px" @keyup.enter="load" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="load">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Plus'" :disabled="!canEdit" @click="openCreate">
          新建{{ activeType === '监督' ? '监督' : '执行' }}模板
        </el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span v-if="!canEdit" class="muted" style="font-size:12.5px;margin-left:8px;">
          模板由品质督导统一维护，当前角色只读
        </span>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
        <span class="muted" style="font-size:12.5px;">共 {{ rows.length }} 个模板</span>
      </div>

      <el-table :data="rows" style="width:100%" max-height="calc(100vh - 440px)" @row-click="onRow">
        <el-table-column prop="templateId" label="模板号" width="105" />
        <el-table-column prop="name" label="模板名称" min-width="180" show-overflow-tooltip />
        <el-table-column :label="activeType === '监督' ? '被检岗位' : '适用岗位'" width="100">
          <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.applyPost || '—' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="80" />
        <el-table-column label="检查项" width="85" align="right">
          <template #default="{ row }">
            <span class="money">{{ row.fieldCount }}</span>
            <span class="muted"> / 必 {{ row.requiredCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="引用计划" width="95" align="right">
          <template #default="{ row }">
            <span class="money" :class="row.planCount === 0 ? 'money--out' : ''">{{ row.planCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="累计任务" width="95" align="right">
          <template #default="{ row }">{{ row.taskCount }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="85">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === '启用' ? 'success' : 'info'" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
            <el-button link type="primary" :disabled="!canEdit" @click.stop="openEdit(row)">配置</el-button>
            <el-button
              link :type="row.status === '启用' ? 'warning' : 'success'" :disabled="!canEdit"
              @click.stop="toggleStatus(row)"
            >{{ row.status === '启用' ? '停用' : '启用' }}</el-button>
            <el-button link type="danger" :disabled="!canEdit" @click.stop="doDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="search" desc="当前筛选下没有模板，换个条件或新建一个">
            <template #action><el-button :disabled="!canEdit" @click="openCreate">新建模板</el-button></template>
          </EmptyState>
        </template>
      </el-table>
    </div>

    <!-- 模板详情 -->
    <DetailDrawer
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.template?.name"
      :subtitle="detailData ? `${detailData.template.templateId} · ${detailData.template.type}模板 · ${detailData.template.version}` : ''"
      :status="detailData?.template?.status"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">检查项</div><div class="dstat__v">{{ detailData.template.fields?.length || 0 }}<span class="unit">项</span></div></div>
          <div class="dstat"><div class="dstat__k">必填项</div><div class="dstat__v">{{ (detailData.template.fields || []).filter(f => f.required).length }}<span class="unit">项</span></div></div>
          <div class="dstat"><div class="dstat__k">引用计划</div><div class="dstat__v">{{ detailData.plans.length }}<span class="unit">个</span></div></div>
          <div class="dstat"><div class="dstat__k">版本</div><div class="dstat__v" style="font-size:16px;">{{ detailData.template.version }}</div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>基本信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">模板号</span><span class="dl__v">{{ detailData.template.templateId }}</span></div>
          <div class="dl__i"><span class="dl__k">类型</span><span class="dl__v">{{ detailData.template.type }}模板</span></div>
          <div class="dl__i"><span class="dl__k">{{ detailData.template.type === '监督' ? '被检岗位' : '适用岗位' }}</span><span class="dl__v">{{ detailData.template.applyPost || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">状态</span><span class="dl__v">{{ detailData.template.status }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>检查项</h4><span class="desc">按顺序逐项判定，异常才展开拍照与描述</span>
        </div>
        <el-table :data="detailData.template.fields || []" size="small" max-height="300">
          <el-table-column type="index" label="#" width="46" />
          <el-table-column prop="label" label="检查项" min-width="150" show-overflow-tooltip />
          <el-table-column prop="type" label="采集方式" width="90" />
          <el-table-column label="必填" width="66">
            <template #default="{ row }">
              <el-tag size="small" :type="row.required ? 'danger' : 'info'" effect="plain">{{ row.required ? '必填' : '选填' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="合格标准 / 选项" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.standard || (row.options || []).join(' / ') || '—' }}
            </template>
          </el-table-column>
        </el-table>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>引用该模板的计划</h4><span class="desc">{{ detailData.plans.length }} 个</span>
        </div>
        <el-table v-if="detailData.plans.length" :data="detailData.plans" size="small" max-height="240">
          <el-table-column prop="planId" label="编号" width="76" />
          <el-table-column prop="name" label="计划名称" min-width="140" show-overflow-tooltip />
          <el-table-column prop="communityName" label="项目" width="110" />
          <el-table-column prop="executor" label="执行人" width="90" />
          <el-table-column prop="status" label="状态" width="76" />
        </el-table>
        <div v-else class="muted" style="font-size:12.5px;margin-top:8px;">尚未被任何计划引用（可用于新建计划）</div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!canEdit" @click="editFromDetail">配置模板</el-button>
      </template>
    </DetailDrawer>

    <!-- 模板配置 -->
    <el-dialog v-model="editVisible" :title="isCreate ? '新建模板' : '配置模板'" width="880" top="6vh">
      <el-form label-width="92px">
        <div class="grid g2">
          <el-form-item label="模板名称" required>
            <el-input v-model="form.name" maxlength="30" placeholder="如：保洁责任区日检表" />
          </el-form-item>
          <el-form-item label="模板类型">
            <el-input :model-value="form.typeLabel" disabled />
          </el-form-item>
          <el-form-item :label="form.type === '监督' ? '被检岗位' : '适用岗位'" required>
            <el-select v-model="form.applyPost" placeholder="请选择" style="width:100%">
              <el-option v-for="o in applyPostOpts" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isCreate" label="版本">
            <el-input v-model="form.version" placeholder="v1.0" style="width:120px" />
          </el-form-item>
          <el-form-item v-else label="版本">
            <span class="money" style="font-size:14px;">{{ liveVersion }}</span>
            <span class="muted" style="font-size:12px;margin-left:8px;">改动检查项会自动 +0.1</span>
          </el-form-item>
        </div>
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px;"
          :title="form.type === '监督'
            ? '监督模板的检查项 = 该岗位的「达标标准」，不是作业步骤；组长据此核验下属责任区实际状态。'
            : '执行模板的检查项 = 一线员工的作业项与合格标准，员工按此逐项留证。'" />
        <el-form-item label="说明">
          <span class="muted" style="font-size:12px;">模板类型创建后不可修改（已有计划与任务的统计口径依赖它）；需要另一类请新建模板。</span>
        </el-form-item>
      </el-form>

      <div class="sec__hd">
        <h4>检查项</h4>
        <span class="desc">共 {{ formFields.length }} 项 · 增删改会自动把版本号 +0.1</span>
      </div>
      <!-- W3 规范：内嵌表最多 10 行 + 滚动，用固定 max-height -->
      <el-table :data="formFields" size="small" max-height="280">
        <el-table-column type="index" label="#" width="46" />
        <el-table-column prop="label" label="检查项" min-width="150" show-overflow-tooltip />
        <el-table-column prop="type" label="采集方式" width="88" />
        <el-table-column label="必填" width="62">
          <template #default="{ row }">
            <el-tag size="small" :type="row.required ? 'danger' : 'info'" effect="plain">{{ row.required ? '必填' : '选填' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="合格标准 / 选项" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.standard || (row.options || []).join(' / ') || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ $index }">
            <el-button link type="primary" :disabled="$index === 0" @click="moveField($index, 'up')">上移</el-button>
            <el-button link type="primary" :disabled="$index === formFields.length - 1" @click="moveField($index, 'down')">下移</el-button>
            <el-button link type="danger" @click="removeField($index)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div style="margin-top:10px;">
        <el-button :icon="'Plus'" size="small" @click="openField(null)">添加检查项</el-button>
      </div>

      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button v-if="!isCreate" @click="saveBasic">只保存基本信息</el-button>
        <el-button type="primary" @click="saveAll">{{ isCreate ? '创建模板' : '保存并关闭' }}</el-button>
      </template>
    </el-dialog>

    <!-- 检查项编辑 -->
    <el-dialog v-model="fieldVisible" :title="fieldIndex === null ? '添加检查项' : '编辑检查项'" width="520" append-to-body>
      <el-form label-width="88px">
        <el-form-item label="检查项" required>
          <el-input v-model="fieldForm.label" maxlength="24" placeholder="如：大堂地面" />
        </el-form-item>
        <el-form-item label="采集方式" required>
          <el-select v-model="fieldForm.type" style="width:150px">
            <el-option v-for="o in TPL_FIELD_TYPES" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="是否必填">
          <el-switch v-model="fieldForm.required" />
        </el-form-item>
        <el-form-item v-if="fieldForm.type === '单选'" label="可选项" required>
          <el-input v-model="fieldForm.optionsText" placeholder="用 / 分隔，如：正常 / 损坏 / 失灵" />
        </el-form-item>
        <el-form-item v-else-if="fieldForm.type === '拍照'" label="合格标准" required>
          <el-input v-model="fieldForm.standard" placeholder="如：无积尘、无水渍" />
        </el-form-item>
        <el-form-item v-else-if="fieldForm.type === '评分'" label="分值范围">
          <el-input v-model="fieldForm.scoreText" placeholder="1-5" style="width:120px" />
        </el-form-item>
        <el-form-item v-else label="标准 / 说明">
          <el-input v-model="fieldForm.standard" placeholder="可留空" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fieldVisible = false">取消</el-button>
        <el-button type="primary" @click="saveField">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  TPL_FIELD_TYPES, TPL_TYPES, addTemplateField, createInspectTemplate, deleteInspectTemplate,
  getInspectTemplateDetail, inspectTemplateRows, inspectTemplateSummary, moveTemplateField,
  removeTemplateField, setTemplateStatus, tplPostOpts, updateInspectTemplate, updateTemplateField
} from '@/utils/api'
import { currentRoleId } from '@/utils/auth'
import { permCodesOfRole } from '@/utils/rbac'
import { useDetail } from '@/composables/useQuery'
import DetailDrawer from '@/components/DetailDrawer.vue'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

/* 模板是公司级标准：只有握有 f.inspectTemplates.edit 的角色能改（品质督导），其余只读 */
const canEdit = computed(() => permCodesOfRole(currentRoleId.value).has('f.inspectTemplates.edit'))

/** 写操作后靠它强制重算（模板对象是原地修改的） */
const ver = ref(0)
const activeType = ref('执行')
const query = reactive({ post: '', status: '', kw: '' })

const rows = computed(() => {
  void ver.value
  return inspectTemplateRows({ type: activeType.value, post: query.post, status: query.status, kw: query.kw })
})
const summary = computed(() => {
  void ver.value
  return inspectTemplateSummary()
})
const postOpts = computed(() => {
  void ver.value
  return tplPostOpts(activeType.value)
})
const APPLY_POSTS = ['保洁', '环境', '保安', '安保', '工程', '客服']
const applyPostOpts = APPLY_POSTS

function load() { ver.value++ }
function reset() { query.post = ''; query.status = ''; query.kw = ''; ver.value++ }

const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(
  id => Promise.resolve(getInspectTemplateDetail(id))
)
function onRow(row) { openDetail(row.templateId) }

/* ---------- 新建 / 配置 ----------
 * 新建时检查项先在本地草稿里编好，点「创建」一次性落库；
 * 编辑时直接改真身（api 内部原地修改 inspectTemplates），ver 负责触发重算。
 */
const editVisible = ref(false)
const isCreate = ref(false)
const editId = ref('')
const draftFields = ref([])
const form = reactive({ name: '', type: '执行', typeLabel: '执行模板', applyPost: '', version: 'v1.0' })

const formFields = computed(() => {
  void ver.value
  if (isCreate.value) return draftFields.value
  const t = inspectTemplateRows().find(x => x.templateId === editId.value)
  return t?.fields || []
})
/** 编辑态的版本号要读真身：检查项增删会自动 +0.1，不能拿表单里的旧值 */
const liveVersion = computed(() => {
  void ver.value
  if (!editId.value) return 'v1.0'
  return inspectTemplateRows().find(x => x.templateId === editId.value)?.version || 'v1.0'
})

function openCreate() {
  if (!canEdit.value) { ElMessage.warning('模板由品质督导统一维护'); return }
  isCreate.value = true
  editId.value = ''
  draftFields.value = []
  Object.assign(form, {
    name: '', type: activeType.value,
    typeLabel: activeType.value === '监督' ? '监督（组长核验）' : '执行（一线作业）',
    applyPost: '', version: 'v1.0'
  })
  editVisible.value = true
}
function openEdit(row) {
  if (!canEdit.value) { ElMessage.warning('模板由品质督导统一维护'); return }
  isCreate.value = false
  editId.value = row.templateId
  draftFields.value = []
  Object.assign(form, {
    name: row.name, type: row.type,
    typeLabel: row.type === '监督' ? '监督（组长核验）' : '执行（一线作业）',
    applyPost: row.applyPost, version: row.version
  })
  editVisible.value = true
}
function editFromDetail() {
  const t = detailData.value?.template
  if (!t) return
  detailVisible.value = false
  openEdit(t)
}

/** 编辑模式只保存基本信息；新建模式走 saveAll 一次性创建 */
function saveBasic() {
  if (isCreate.value) { saveAll(); return }
  try {
    /* 版本号不随表单提交：检查项增删已自动 +0.1，回传旧值会把它覆盖回去 */
    updateInspectTemplate(editId.value, { name: form.name, applyPost: form.applyPost })
    ElMessage.success('基本信息已保存')
    ver.value++
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}

function saveAll() {
  try {
    if (isCreate.value) {
      if (!draftFields.value.length) throw new Error('至少添加一个检查项')
      const t = createInspectTemplate({ ...form, fields: draftFields.value })
      ElMessage.success(`模板「${t.name}」已创建（${draftFields.value.length} 个检查项）`)
    } else {
      updateInspectTemplate(editId.value, { name: form.name, applyPost: form.applyPost })
      ElMessage.success('模板已保存')
    }
    editVisible.value = false
    load()
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}

/* ---------- 检查项 ---------- */
const fieldVisible = ref(false)
const fieldIndex = ref(null)
const fieldForm = reactive({ label: '', type: '拍照', required: true, standard: '', optionsText: '', scoreText: '1-5' })

function openField(idx) {
  fieldIndex.value = idx
  const f = idx === null ? null : formFields.value[idx]
  Object.assign(fieldForm, {
    label: f?.label || '',
    type: f?.type || '拍照',
    required: f ? !!f.required : true,
    standard: f?.standard || '',
    optionsText: (f?.options || []).join(' / '),
    scoreText: f && f.min ? `${f.min}-${f.max}` : '1-5'
  })
  fieldVisible.value = true
}

function buildField() {
  const label = fieldForm.label.trim()
  if (!label) throw new Error('请填写检查项名称')
  const f = { label, type: fieldForm.type, required: !!fieldForm.required }
  if (fieldForm.type === '单选') {
    const opts = fieldForm.optionsText.split('/').map(s => s.trim()).filter(Boolean)
    if (!opts.length) throw new Error('「单选」需要至少一个选项')
    f.options = opts
  } else if (fieldForm.type === '拍照') {
    const std = fieldForm.standard.trim()
    if (!std) throw new Error('「拍照」需要填写合格标准')
    f.standard = std
  } else if (fieldForm.type === '评分') {
    const [a, b] = String(fieldForm.scoreText || '1-5').split('-').map(Number)
    f.min = a || 1; f.max = b || 5
  } else if (fieldForm.standard.trim()) f.standard = fieldForm.standard.trim()
  return f
}

function saveField() {
  try {
    const f = buildField()
    if (isCreate.value) {
      /* 新建：改本地草稿 */
      if (fieldIndex.value === null) {
        if (draftFields.value.some(x => x.label === f.label)) throw new Error(`检查项「${f.label}」已存在`)
        draftFields.value = [...draftFields.value, f]
      } else {
        const next = [...draftFields.value]
        next.splice(fieldIndex.value, 1, f)
        draftFields.value = next
      }
    } else if (fieldIndex.value === null) {
      addTemplateField(editId.value, f)
    } else {
      updateTemplateField(editId.value, fieldIndex.value, f)
    }
    ElMessage.success(`检查项「${f.label}」已保存`)
    fieldVisible.value = false
    ver.value++
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}
function removeField(idx) {
  try {
    if (isCreate.value) {
      if (draftFields.value.length <= 1) throw new Error('模板至少保留一个检查项')
      draftFields.value = draftFields.value.filter((_, i) => i !== idx)
    } else {
      removeTemplateField(editId.value, idx)
    }
    ElMessage.success('已删除检查项')
    ver.value++
  } catch (e) { ElMessage.error(e?.message || '删除失败') }
}
function moveField(idx, dir) {
  try {
    if (isCreate.value) {
      const to = idx + (dir === 'up' ? -1 : 1)
      if (to < 0 || to >= draftFields.value.length) return
      const next = [...draftFields.value]
      const [f] = next.splice(idx, 1)
      next.splice(to, 0, f)
      draftFields.value = next
    } else {
      moveTemplateField(editId.value, idx, dir)
    }
    ver.value++
  } catch (e) { ElMessage.error(e?.message || '移动失败') }
}

/* ---------- 启停 / 删除 ---------- */
function toggleStatus(row) {
  const next = row.status === '启用' ? '停用' : '启用'
  try {
    setTemplateStatus(row.templateId, next)
    ElMessage.success(`模板「${row.name}」已${next}`)
    load()
  } catch (e) { ElMessage.error(e?.message || '操作失败') }
}
async function doDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除模板「${row.name}」？删除后不可恢复（原型为内存态，刷新即还原）。`,
      '删除模板', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch { return }
  try {
    deleteInspectTemplate(row.templateId)
    ElMessage.success('模板已删除')
    load()
  } catch (e) { ElMessage.error(e?.message || '删除失败') }
}

/* ---------- 导出 ---------- */
const EXPORT_COLS = [
  { prop: 'templateId', label: '模板号' }, { prop: 'name', label: '模板名称' },
  { prop: 'type', label: '类型' }, { prop: 'applyPost', label: '适用 / 被检岗位' },
  { prop: 'version', label: '版本' }, { prop: 'fieldCount', label: '检查项' },
  { prop: 'requiredCount', label: '必填项' }, { prop: 'planCount', label: '引用计划' },
  { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '巡检模板', source: '/f/inspect-templates', columns: EXPORT_COLS, rows: rows.value, filters: { type: activeType.value, ...query } })
}
</script>
