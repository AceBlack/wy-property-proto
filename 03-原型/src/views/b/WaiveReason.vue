<!--
  B 域 · 减免原因字典（批 1 · 2026-11-12）
  ------------------------------------------------------------
  减免以前只记一句自由文本（"业主困难"），报表里没法归类，也无法回答
  "今年因为政策性减免让了多少钱"。这里把它做成受控字典，收银台减免时必选一条。

  三个字段为什么必须有：
    · 类型：政策性 / 个案 / 差错 —— 决定这笔让利是不是"该让的"；
    · 计入考核：差错纠正要计入（说明不是白让的），政策性与个案不计入；
    · 需凭证：政策性要文件、个案要证明，避免"口头同意"。
-->
<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>减免原因字典</b>：收银台做减免时必须选一条，报表按原因汇总。
        <br />
        <b>「计入考核」不是给个人打分</b>，而是区分「因差错让的钱」和「按规定让的钱」——
        前者是管理问题，后者是政策成本，混在一起看，减免率高的时候没人说清原因。
        <br />
        <b>停用不删</b>：已用过的原因停用后，历史账单与报表仍显示它；只是新减免选不到。
        至少要保留一条启用，否则减免提交不了。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">原因总数</div><div class="dstat__v">{{ list.length }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">启用中</div><div class="dstat__v">{{ list.filter(r => r.enabled).length }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">计入考核</div><div class="dstat__v">{{ list.filter(r => r.countInAssess).length }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">需凭证</div><div class="dstat__v">{{ list.filter(r => r.needProof).length }}<span class="unit">条</span></div></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="filters" style="margin-bottom:10px;">
        <el-input v-model="kw" clearable placeholder="名称 / 说明" :prefix-icon="'Search'" style="width:200px;" />
        <span class="spacer" />
        <el-button v-if="canEdit" type="primary" :icon="'Plus'" @click="openCreate">新增原因</el-button>
      </div>

      <el-table :data="filtered" size="small">
        <el-table-column prop="name" label="原因名称" min-width="140">
          <template #default="{ row }"><span :class="{ 'is-off': !row.enabled }">{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.type === '政策性' ? 'warning' : (row.type === '差错' ? 'danger' : 'info')" effect="plain">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="计入考核" width="90" align="center">
          <template #default="{ row }">{{ row.countInAssess ? '是' : '—' }}</template>
        </el-table-column>
        <el-table-column label="需凭证" width="90" align="center">
          <template #default="{ row }">{{ row.needProof ? '是' : '—' }}</template>
        </el-table-column>
        <el-table-column label="适用范围" width="120">
          <template #default="{ row }">
            {{ row.scope === '指定项目' ? '指定项目' : '全部项目' }}
            <div v-if="row.scope === '指定项目'" class="sub">{{ (row.communityIds || []).length }} 个</div>
          </template>
        </el-table-column>
        <el-table-column label="免审额度" width="100" align="right">
          <template #default="{ row }">
            {{ row.approveAbove ? '¥' + row.approveAbove : '不设上限' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" size="small" :disabled="!canEdit" @change="v => onToggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column prop="desc" label="说明" min-width="240" show-overflow-tooltip>
          <template #default="{ row }"><span class="muted">{{ row.desc }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canEdit" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dlg.visible" :title="dlg.form.reasonId ? '编辑减免原因' : '新增减免原因'" width="520px">
      <el-form :model="dlg.form" label-width="96px">
        <el-form-item label="名称" required>
          <el-input v-model="dlg.form.name" maxlength="12" show-word-limit placeholder="如：低保户减免" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="dlg.form.type">
            <el-radio label="政策性">政策性</el-radio>
            <el-radio label="个案">个案</el-radio>
            <el-radio label="差错">差错</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="计入考核">
          <el-switch v-model="dlg.form.countInAssess" />
          <span class="hint">差错纠正类应打开；政策性与个案不要打开</span>
        </el-form-item>
        <el-form-item label="需凭证">
          <el-switch v-model="dlg.form.needProof" />
          <span class="hint">打开后收银台减免必须填写依据（单号/纪要/证明）</span>
        </el-form-item>
        <el-form-item label="适用范围">
          <el-radio-group v-model="dlg.form.scope">
            <el-radio label="全部">全部项目</el-radio>
            <el-radio label="指定项目">指定项目</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="dlg.form.scope === '指定项目'" label="适用项目">
          <el-select v-model="dlg.form.communityIds" multiple collapse-tags placeholder="选择项目" style="width:100%;">
            <el-option v-for="c in communities" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="免审额度">
          <el-input-number v-model="dlg.form.approveAbove" :min="0" :max="1000000" :step="100" />
          <span class="hint">超过这个金额，收银台必须填写依据；0 = 不设上限</span>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="dlg.form.sort" :min="0" :max="999" :step="10" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="dlg.form.desc" type="textarea" :rows="2" maxlength="60" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="doSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { canEditFeeConfig, communityOpts, saveWaiveReason, toggleWaiveReason, waiveReasonRows } from '@/utils/api'

const list = ref([])
const kw = ref('')
const dlg = reactive({
  visible: false, saving: false,
  form: {
    reasonId: '', name: '', type: '个案', countInAssess: false, needProof: true,
    sort: 0, desc: '', scope: '全部', communityIds: [], approveAbove: 0
  }
})
const communities = communityOpts()
const canEdit = computed(() => canEditFeeConfig())
const filtered = computed(() => {
  const k = kw.value.trim()
  return k ? list.value.filter(r => `${r.name}${r.desc}`.includes(k)) : list.value
})

function load() { list.value = waiveReasonRows() }

function openCreate() {
  Object.assign(dlg, {
    visible: true, saving: false,
    form: {
      reasonId: '', name: '', type: '个案', countInAssess: false, needProof: true,
      sort: (list.value.length + 1) * 10, desc: '', scope: '全部', communityIds: [], approveAbove: 0
    }
  })
}
function openEdit(row) {
  Object.assign(dlg, {
    visible: true, saving: false,
    form: { ...row, communityIds: [...(row.communityIds || [])] }
  })
}

function doSave() {
  dlg.saving = true
  try {
    saveWaiveReason(dlg.form)
    ElMessage.success('已保存')
    dlg.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    dlg.saving = false
  }
}

function onToggle(row, v) {
  try {
    toggleWaiveReason(row.reasonId, v)
    ElMessage.success(v ? '已启用' : '已停用，历史减免仍显示该原因')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
    load()
  }
}

onMounted(load)
</script>

<style scoped>
.muted { color: var(--biz-text-3); }
.is-off { color: var(--biz-text-3); text-decoration: line-through; }
.hint { font-size: 11.5px; color: var(--biz-text-3); margin-left: 8px; }
.sub { font-size: 11px; color: var(--biz-text-3); }
.spacer { flex: 1; }
</style>
