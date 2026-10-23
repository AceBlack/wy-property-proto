<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>导入向导 · A 级交互</b>：三步完成批量导入 —— ①选类型并<b>下载模板</b>（模板走下载中心生成，页面不同步下载）；
        ②上传文件并预览解析结果；③查看校验回显，失败明细可导出、可在修正后重新上传。
        原型不真正写库：解析结果为模拟，但<b>校验规则与失败反馈的形态与正式实现一致</b>。
      </div>
    </div>

    <el-steps :active="step" finish-status="success" style="margin-top:18px;max-width:760px;">
      <el-step title="选择类型" description="下载标准模板" />
      <el-step title="上传与预览" description="解析并校验" />
      <el-step title="导入结果" description="成功 / 失败明细" />
    </el-steps>

    <!-- Step 1 -->
    <div v-if="step === 0" class="panel" style="margin-top:18px;">
      <div class="sec__hd"><h4>选择导入类型</h4><span class="desc">不同实体的模板字段不同，请先选类型再下载模板</span></div>
      <div class="imp-types">
        <div
          v-for="t in IMPORT_TYPES" :key="t.key" class="imp-card"
          :class="{ 'is-on': typeKey === t.key }" @click="typeKey = t.key"
        >
          <div class="imp-card__t">{{ t.name }}</div>
          <div class="imp-card__d">{{ t.desc }}</div>
          <div class="muted" style="font-size:12px;margin-top:6px;">必填：{{ t.required.join(' / ') }}</div>
        </div>
      </div>
      <div class="dl-foot" style="margin-top:14px;">
        <el-button :icon="'Download'" @click="downloadTpl">下载模板</el-button>
        <el-button type="primary" @click="step = 1">下一步：上传文件</el-button>
      </div>
    </div>

    <!-- Step 2 -->
    <div v-if="step === 1" class="panel" style="margin-top:18px;">
      <div class="sec__hd"><h4>上传文件</h4><span class="desc">支持 .csv / .xlsx，单次最多 5 万行</span></div>
      <div class="imp-up">
        <el-upload
          drag :auto-upload="false" :limit="1" accept=".csv,.xlsx,.xls"
          :on-change="onFile"
        >
          <el-icon class="imp-up__ico"><UploadFilled /></el-icon>
          <div class="imp-up__t">将文件拖到此处，或点击上传</div>
          <div class="muted">未上传也可直接「开始校验」，用演示数据走完整流程</div>
        </el-upload>
      </div>
      <el-form label-width="110px" style="margin-top:14px;">
        <el-form-item label="数据行数">
          <el-input-number v-model="rowCount" :min="10" :max="50000" :step="50" />
          <span class="muted" style="margin-left:10px;">用于模拟解析规模</span>
        </el-form-item>
      </el-form>
      <div class="dl-foot">
        <el-button @click="step = 0">上一步</el-button>
        <el-button type="primary" :loading="parsing" @click="doParse">开始校验</el-button>
      </div>
    </div>

    <!-- Step 3 -->
    <div v-if="step === 2 && result" class="panel" style="margin-top:18px;">
      <div class="sec__hd"><h4>导入结果</h4><span class="desc">批次 {{ result.batchNo }} · {{ result.type }}</span></div>
      <div class="grid" style="margin-top:12px;grid-template-columns:repeat(4,minmax(0,1fr));">
        <div class="panel rsum"><div class="rsum__l">总行数</div><div class="rsum__v">{{ result.total }}</div></div>
        <div class="panel rsum"><div class="rsum__l">可导入</div><div class="rsum__v" style="color:#12B98A;">{{ result.success }}</div></div>
        <div class="panel rsum"><div class="rsum__l">校验失败</div><div class="rsum__v money--out">{{ result.failed }}</div></div>
        <div class="panel rsum"><div class="rsum__l">通过率</div>
          <div class="rsum__v">{{ Math.round(result.success / result.total * 1000) / 10 }}<span class="unit">%</span></div>
        </div>
      </div>

      <div style="margin-top:14px;">
        <div class="sec__hd"><h4>失败明细</h4><span class="desc">修正后可重新上传；明细可导出后线下处理</span></div>
        <el-table :data="result.errors" style="width:100%;margin-top:10px;" max-height="300">
          <el-table-column prop="row" label="行号" width="80" />
          <el-table-column prop="field" label="字段" width="120" />
          <el-table-column prop="value" label="原始值" width="200" show-overflow-tooltip />
          <el-table-column prop="reason" label="失败原因" min-width="240" show-overflow-tooltip />
        </el-table>
      </div>

      <div class="dl-foot" style="margin-top:14px;">
        <el-button @click="step = 1">重新上传</el-button>
        <el-button :icon="'Download'" @click="onExportErrors">导出失败明细</el-button>
        <el-button type="primary" @click="doCommit">确认导入 {{ result.success }} 条</el-button>
      </div>
      <div v-if="committed" class="muted" style="margin-top:10px;font-size:12.5px;">
        ✅ 已提交导入任务（原型阶段不写库，刷新还原）。正式实现：导入为异步任务，可在<b>下载中心</b>查看处理结果。
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { exportList } from '@/utils/export'
import { IMPORT_TYPES, importTemplate, simulateImport } from '@/utils/api'
import { submitExport } from '@/utils/download'

const step = ref(0)
const typeKey = ref('owners')
const rowCount = ref(200)
const fileName = ref('')
const parsing = ref(false)
const result = ref(null)
const committed = ref(false)

function onFile(file) { fileName.value = file?.name || '' }

/** 模板下载：提交给下载中心，页面不生成文件 */
function downloadTpl() {
  const tpl = importTemplate(typeKey.value)
  submitExport({
    name: tpl.name,
    source: '/e/import',
    count: 1,
    format: 'csv',
    build: async () => tpl.header,
    filters: { type: typeKey.value, kind: 'template' }
  })
  ElMessage.success(`模板生成任务已提交：${tpl.name}，请在下载中心下载`)
}

async function doParse() {
  parsing.value = true
  try {
    await new Promise(r => setTimeout(r, 900))      // 模拟解析耗时
    result.value = simulateImport(typeKey.value, rowCount.value)
    step.value = 2
    committed.value = false
    ElMessage.success(`解析完成：${result.value.success} 条可导入 / ${result.value.failed} 条失败`)
  } finally { parsing.value = false }
}

function onExportErrors() {
  if (!result.value) return
  exportList({
    name: `${result.value.type}导入失败明细`, source: '/e/import',
    columns: [
      { prop: 'row', label: '行号' }, { prop: 'field', label: '字段' },
      { prop: 'value', label: '原始值' }, { prop: 'reason', label: '失败原因' }
    ],
    rows: result.value.errors,
    filters: { batchNo: result.value.batchNo }
  })
}
function doCommit() {
  committed.value = true
  ElMessage.success(`已提交导入 ${result.value.success} 条（原型阶段不写库）`)
}
</script>

<style scoped>
.imp-types { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.imp-card {
  border: 1px solid var(--biz-line, #e6e9f0); border-radius: 8px; padding: 12px 14px; cursor: pointer;
}
.imp-card.is-on { border-color: var(--biz-primary, #5B6CFF); background: rgba(91, 108, 255, .06); }
.imp-card__t { font-size: 14px; font-weight: 600; }
.imp-card__d { font-size: 12.5px; color: var(--biz-text-2, #6b7590); margin-top: 4px; }
.imp-up { margin-top: 12px; }
.imp-up__ico { font-size: 40px; color: #b3bad0; }
.imp-up__t { font-size: 13.5px; margin-top: 6px; }
.dl-foot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
