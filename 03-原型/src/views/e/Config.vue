<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>系统配置 · A 级交互</b>：字典管理 / 参数设置 / 操作日志三块。
        ①字典驱动全站状态标签配色，新增项后列表页标签立即变化（内存态）；
        ②参数改动即写即用；③操作日志按模块 / 结果 / 时间筛选，失败项给出原因，是排障与审计的入口。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel rsum"><div class="rsum__l">字典域</div><div class="rsum__v">{{ domains.length }}<span class="unit">个</span></div></div>
      <div class="panel rsum"><div class="rsum__l">字典项</div><div class="rsum__v">{{ domains.reduce((s, d) => s + d.count, 0) }}<span class="unit">条</span></div></div>
      <div class="panel rsum"><div class="rsum__l">系统参数</div><div class="rsum__v">{{ params.length }}<span class="unit">项</span></div></div>
      <div class="panel rsum"><div class="rsum__l">操作日志（失败）</div><div class="rsum__v money--out">{{ logSum.fail }}<span class="unit">/ {{ logSum.total }}</span></div></div>
    </div>

    <el-tabs v-model="tab" style="margin-top:16px;">
      <!-- 字典管理 -->
      <el-tab-pane label="字典管理" name="dict">
        <div class="panel" style="margin-top:12px;">
          <div class="toolbar">
            <el-select v-model="curDomain" filterable style="width:220px">
              <el-option v-for="d in domains" :key="d.domain" :label="`${d.domain}（${d.count}）`" :value="d.domain" />
            </el-select>
            <el-button type="primary" :icon="'Plus'" @click="addVisible = true">新增字典项</el-button>
            <span class="spacer" />
            <span class="muted" style="font-size:12.5px;">改动后全站状态标签配色立即变化（内存态，刷新还原）</span>
          </div>
          <el-table :data="curItems" style="width:100%" max-height="calc(100vh - 380px)">
            <el-table-column prop="value" label="状态值" width="180" />
            <el-table-column label="语义" width="120">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="tagType(row.type)">{{ row.type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="预览（StatusTag 实际渲染）" min-width="220">
              <template #default="{ row }">
                <StatusTag :domain="curDomain" :value="row.value" />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 参数设置 -->
      <el-tab-pane label="参数设置" name="param">
        <div class="panel" style="margin-top:12px;">
          <el-table :data="params" style="width:100%" max-height="calc(100vh - 340px)">
            <el-table-column prop="group" label="分组" width="90" />
            <el-table-column prop="name" label="参数名称" width="160" />
            <el-table-column prop="key" label="参数键" width="180">
              <template #default="{ row }"><code>{{ row.key }}</code></template>
            </el-table-column>
            <el-table-column label="参数值" width="180">
              <template #default="{ row }">
                <el-input v-model="row.value" size="small" style="width:120px" @change="v => onParam(row, v)">
                  <template #append>{{ row.unit }}</template>
                </el-input>
              </template>
            </el-table-column>
            <el-table-column prop="desc" label="说明" min-width="240" show-overflow-tooltip />
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 操作日志 -->
      <el-tab-pane label="操作日志" name="log">
        <div class="panel" style="margin-top:12px;">
          <el-form :model="lq" class="filter-bar" label-width="60px" @submit.prevent>
            <el-form-item label="模块">
              <el-select v-model="lq.module" placeholder="全部" clearable style="width:110px">
                <el-option v-for="m in ['A 资产', 'B 费用', 'C 办公', 'D 物联', 'E 底座', 'F 现场']" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
            <el-form-item label="结果">
              <el-select v-model="lq.result" placeholder="全部" clearable style="width:100px">
                <el-option label="成功" value="成功" /><el-option label="失败" value="失败" />
              </el-select>
            </el-form-item>
            <el-form-item label="时间">
              <el-select v-model="lq.days" style="width:110px">
                <el-option v-for="d in [1, 3, 7, 30]" :key="d" :label="`近 ${d} 天`" :value="d" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="lq.kw" placeholder="操作人 / 动作 / 对象 / IP" clearable style="width:180px" @keyup.enter="searchL" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="searchL">查询</el-button>
              <el-button :icon="'Download'" :disabled="!lRows.length" @click="onExportLog">导出</el-button>
            </el-form-item>
          </el-form>
        </div>
        <div class="panel" style="margin-top:16px;">
          <el-table v-loading="lLoading" :data="lRows" style="width:100%" max-height="calc(100vh - 400px)"
            :row-class-name="({ row }) => row.result === '失败' ? 'row--danger' : ''">
            <el-table-column prop="time" label="时间" width="160" />
            <el-table-column prop="operator" label="操作人" width="100" />
            <el-table-column prop="module" label="模块" width="90" />
            <el-table-column prop="action" label="动作" width="130" />
            <el-table-column prop="target" label="对象" width="120" />
            <el-table-column prop="ip" label="IP" width="120" />
            <el-table-column label="结果" width="80">
              <template #default="{ row }">
                <el-tag size="small" :type="row.result === '成功' ? 'success' : 'danger'" effect="plain">{{ row.result }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="detail" label="详情" min-width="200" show-overflow-tooltip />
          </el-table>
          <div class="pager">
            <el-pagination
              background layout="total, sizes, prev, pager, next"
              :total="lTotal" :current-page="lPageNo" :page-size="lSize" :page-sizes="PAGE_SIZES"
              @current-change="p => { lPageNo.value = p; loadL() }" @size-change="s => { lSize.value = s; loadL() }"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="addVisible" title="新增字典项" width="440">
      <el-form label-width="80px">
        <el-form-item label="字典域">
          <el-select v-model="curDomain" style="width:100%">
            <el-option v-for="d in domains" :key="d.domain" :label="d.domain" :value="d.domain" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态值">
          <el-input v-model="newItem.value" placeholder="如：已挂起" />
        </el-form-item>
        <el-form-item label="语义">
          <el-select v-model="newItem.type" style="width:100%">
            <el-option v-for="t in ['primary', 'success', 'warning', 'danger', 'info', 'muted']" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" @click="doAdd">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import { exportList } from '@/utils/export'
import {
  PAGE_SIZES, addDictItem, dictDomains, logSummary, paramRows, queryOperationLogs, saveParam
} from '@/utils/api'

const tab = ref('dict')
const domains = ref(dictDomains())
const curDomain = ref(domains.value[0]?.domain || 'bill')
const curItems = computed(() => domains.value.find(d => d.domain === curDomain.value)?.items || [])
function tagType(t) {
  return ({ primary: 'primary', success: 'success', warning: 'warning', danger: 'danger', info: 'info', muted: 'info' })[t] || 'info'
}

const addVisible = ref(false)
const newItem = ref({ value: '', type: 'info' })
function doAdd() {
  try {
    addDictItem(curDomain.value, newItem.value.value.trim(), newItem.value.type)
    domains.value = dictDomains()
    ElMessage.success(`已新增「${newItem.value.value}」，该域状态标签立即生效`)
    addVisible.value = false
    newItem.value = { value: '', type: 'info' }
  } catch (e) { ElMessage.error(e?.message || '新增失败') }
}

// —— 参数 ——
const params = ref(paramRows())
function onParam(row, v) {
  try {
    saveParam(row.key, v)
    ElMessage.success(`${row.name} 已更新为 ${v}${row.unit}`)
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
    params.value = paramRows()
  }
}

// —— 日志 ——
const logSum = logSummary()
const lq = ref({ module: '', result: '', kw: '', days: 7 })
const lRows = ref([]); const lTotal = ref(0); const lPageNo = ref(1); const lSize = ref(20); const lLoading = ref(false)
async function loadL() {
  lLoading.value = true
  try {
    const res = await queryOperationLogs({ pageNo: lPageNo.value, size: lSize.value, filters: { ...lq.value } })
    lRows.value = res.rows; lTotal.value = res.total
  } finally { lLoading.value = false }
}
function searchL() { lPageNo.value = 1; loadL() }
loadL()

const LOG_COLS = [
  { prop: 'time', label: '时间' }, { prop: 'operator', label: '操作人' },
  { prop: 'module', label: '模块' }, { prop: 'action', label: '动作' },
  { prop: 'target', label: '对象' }, { prop: 'ip', label: 'IP' },
  { prop: 'result', label: '结果' }, { prop: 'detail', label: '详情' }
]
function onExportLog() {
  exportList({ name: '操作日志', source: '/e/config', columns: LOG_COLS, rows: lRows.value, filters: { ...lq.value } })
}
</script>
