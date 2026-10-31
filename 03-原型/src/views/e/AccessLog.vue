<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>数据访问日志 · 审计入口</b>：业主 / 租户 / 员工的手机号、证件号属敏感字段，全站默认脱敏展示。
        每次在页面上「点眼睛看明文」都会留一条记录（谁 · 何时 · 看了谁的哪个字段 · 从哪个页面）；
        导出含敏感列的台账同样留痕 —— 无明文权限的角色只能导出<b>脱敏版</b>，超单次上限直接<b>拦截</b>。
        <b>日志只增不删</b>，任何人（含管理员）在本页都没有删除入口。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel rsum">
        <div class="rsum__l">查看明文</div>
        <div class="rsum__v">{{ sum.reveals }}<span class="unit">次</span></div>
        <div class="rsum__s">近 {{ query.days }} 天 · {{ sum.operators }} 人操作</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">涉及敏感对象</div>
        <div class="rsum__v">{{ sum.owners }}<span class="unit">个</span></div>
        <div class="rsum__s">被查看过明文的业主 / 租户</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">导出任务</div>
        <div class="rsum__v">{{ sum.exports }}<span class="unit">次</span></div>
        <div class="rsum__s">每次导出都留痕</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">脱敏导出 / 被拦截</div>
        <div class="rsum__v money--out">{{ sum.masked }}<span class="unit">{{ ' / ' + sum.blocked }}</span></div>
        <div class="rsum__s">无明文权限自动脱敏 · 超上限拦截</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar" style="margin-bottom:10px;">
        <el-radio-group v-model="tab" size="small" @change="onTab">
          <el-radio-button value="access">访问留痕</el-radio-button>
          <el-radio-button value="export">导出清单</el-radio-button>
        </el-radio-group>
        <span class="muted" style="font-size:12px;">
          {{ tab === 'access'
            ? '谁在什么时候看了谁的哪个字段（每次揭示一条）'
            : '导出是数据外流的主通道 · 被拦下的那些才最值得看' }}
        </span>
      </div>
      <el-form :model="query" class="filter-bar" label-width="60px" @submit.prevent>
        <el-form-item v-if="tab === 'access'" label="动作">
          <el-select v-model="query.action" placeholder="全部" clearable style="width:118px">
            <el-option v-for="a in actionOpts" :key="a" :label="a" :value="a" />
          </el-select>
        </el-form-item>
        <el-form-item label="结果">
          <el-select v-model="query.result" placeholder="全部" clearable style="width:100px">
            <el-option v-for="r in resultOpts" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="操作人">
          <el-select v-model="query.operator" placeholder="全部" clearable filterable style="width:120px">
            <el-option v-for="o in operatorOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间">
          <el-select v-model="query.days" style="width:104px">
            <el-option v-for="d in [1, 3, 7, 30]" :key="d" :label="`近 ${d} 天`" :value="d" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="对象 / 字段 / 来源 / 说明" clearable style="width:190px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button type="primary" :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'Refresh'" @click="resetQ">重置</el-button>
          <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        </el-form-item>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 条留痕</span>
      </el-form>
    </div>

    <div class="panel" style="margin-top:12px;">
      <el-table v-if="tab === 'access'" v-loading="loading" :data="rows" style="width:100%"
        max-height="calc(100vh - 470px)" :row-class-name="rowClass">
        <el-table-column prop="at" label="时间" width="148" />
        <el-table-column prop="operator" label="操作人" width="96" />
        <el-table-column prop="roleName" label="角色" width="104" />
        <el-table-column label="动作" width="104">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.action === '查看明文' ? 'primary' : 'info'">{{ row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="对象" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.action === '查看明文'">
              {{ row.entityType }} · {{ row.entityName }}
              <span class="muted" style="font-size:11.5px;">{{ row.entityId }}</span>
            </span>
            <span v-else>{{ row.entityName }}</span>
          </template>
        </el-table-column>
        <el-table-column label="字段" width="96">
          <template #default="{ row }">
            <span v-if="row.action === '查看明文'">{{ row.fieldLabel }}</span>
            <span v-else-if="row.field" class="muted">{{ row.field }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="source" label="来源页面" width="132">
          <template #default="{ row }"><code style="font-size:11.5px;">{{ row.source || '—' }}</code></template>
        </el-table-column>
        <el-table-column label="条数" width="72" align="right">
          <template #default="{ row }">
            <span v-if="row.action === '导出数据'" class="money">{{ row.rows }}</span>
            <span v-else class="muted">1</span>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="82">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="resultType(row.result)">{{ row.result }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="memo" label="说明" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span :class="row.result === '拦截' ? 'money money--out' : 'muted'" style="font-size:12px;">
              {{ row.memo || '—' }}
            </span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 导出清单：文件级，一个问题——谁把多少行数据导到机器外面去了 -->
      <el-table v-else v-loading="loading" :data="rows" style="width:100%"
        max-height="calc(100vh - 470px)" :row-class-name="rowClass">
        <el-table-column prop="at" label="时间" width="148" />
        <el-table-column prop="operator" label="导出人" width="96" />
        <el-table-column prop="roleName" label="角色" width="104" />
        <el-table-column label="文件名" min-width="210" show-overflow-tooltip>
          <template #default="{ row }"><span>{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column label="格式" width="70" align="center">
          <template #default="{ row }"><code style="font-size:11.5px;">{{ row.format || '—' }}</code></template>
        </el-table-column>
        <el-table-column label="行数" width="86" align="right">
          <template #default="{ row }"><span class="money">{{ row.rows }}</span></template>
        </el-table-column>
        <el-table-column label="数据范围" width="96">
          <template #default="{ row }"><span class="muted" style="font-size:12px;">{{ row.scopeMode || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="结果" width="82">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="resultType(row.result)">{{ row.result }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="memo" label="说明" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">
            <span :class="row.result === '拦截' ? 'money money--out' : 'muted'" style="font-size:12px;">
              {{ row.memo || '—' }}
            </span>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="search" desc="没有符合条件的导出记录" />
        </template>
      </el-table>
      <div class="pager">
        <el-pagination
          background layout="total, sizes, prev, pager, next"
          :total="total" :current-page="pageNo" :page-size="size" :page-sizes="PAGE_SIZES"
          @current-change="p => { pageNo = p; load() }" @size-change="s => { size = s; load() }"
        />
      </div>
    </div>

    <div class="sum-note" style="margin-top:12px;">
      口径：①「查看明文」= 页面上点开任一脱敏字段的眼睛，一次揭示记一条，批量导出不计入该项（见「访问留痕」）；
      ②「导出」逐次留痕，含敏感列且无 <code>a.sensitive.view</code> 时结果记<b>脱敏</b>，超过「系统配置 · 导出单次上限」记<b>拦截</b>且不生成下载任务；
      ③ 操作人取当前角色视角的代表员工，范围列（责任范围 / 本项目 / 全部项目）体现在说明里；
      ④ 日志为内存态，正式实现应落 `data_access_logs` 并做<b>不可篡改</b>（追加写 + 哈希链）。
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import {
  PAGE_SIZES, accessActionOpts, accessLogSummary, accessOperatorOpts, accessResultOpts,
  queryAccessLogs, queryExportLogs
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

const actionOpts = accessActionOpts()
const resultOpts = accessResultOpts()
const operatorOpts = ref(accessOperatorOpts())

/* 两个 Tab 是两种问题：访问留痕问"谁看了谁的证件"，导出清单问"谁把多少行数据带走了"。
   合成一张表时 48 条揭示会把 6 条导出淹掉，而导出才是外流主通道。 */
const tab = ref('access')
const BLANK = { action: '', result: '', operator: '', days: 7, kw: '' }
const query = reactive({ ...BLANK })
const rows = ref([])
const total = ref(0)
const pageNo = ref(1)
const size = ref(20)
const loading = ref(false)
/* KPI 由服务端算：日志分页，前端 reduce 只能算当前页，"揭示 20 次"其实是"本页 20 次" */
const sum = ref({ reveals: 0, owners: 0, operators: 0, exports: 0, masked: 0, blocked: 0, rows: 0 })

async function load() {
  loading.value = true
  try {
    /* KPI 由服务端算，两个 Tab 共用（都是"审计口径"的汇总，不随表格切换而变） */
    const [s, res] = await Promise.all([
      accessLogSummary({ days: query.days, result: query.result, operator: query.operator }),
      tab.value === 'export'
        ? queryExportLogs({
          pageNo: pageNo.value, size: size.value,
          filters: { result: query.result, operator: query.operator, days: query.days, kw: query.kw }
        })
        : queryAccessLogs({ pageNo: pageNo.value, size: size.value, filters: { ...query } })
    ])
    rows.value = res.rows
    total.value = res.total
    sum.value = s
    operatorOpts.value = accessOperatorOpts()
  } finally { loading.value = false }
}
function search() { pageNo.value = 1; load() }
/** 换 Tab 重置筛选：导出清单没有「动作」这个维度，留着上一条会让人以为筛了两次 */
function onTab() {
  pageNo.value = 1
  Object.assign(query, { ...BLANK })
  load()
}
function resetQ() {
  Object.assign(query, BLANK)
  pageNo.value = 1
  load()
}
onMounted(load)

function resultType(r) {
  return ({ 成功: 'success', 脱敏: 'warning', 拦截: 'danger' })[r] || 'info'
}
function rowClass({ row }) { return row.result === '拦截' ? 'row--danger' : '' }

const EXPORT_COLS = [
  { prop: 'at', label: '时间' }, { prop: 'operator', label: '操作人' }, { prop: 'roleName', label: '角色' },
  { prop: 'orgName', label: '组织' }, { prop: 'scopeMode', label: '数据范围' },
  { prop: 'action', label: '动作' }, { prop: 'entityType', label: '对象类型' },
  { prop: 'entityName', label: '对象' }, { prop: 'entityId', label: '对象编号' },
  { prop: 'fieldLabel', label: '敏感字段' }, { prop: 'source', label: '来源页面' },
  { prop: 'rows', label: '条数' }, { prop: 'result', label: '结果' }, { prop: 'memo', label: '说明' }
]
const EXPORT_LOG_COLS = [
  { prop: 'at', label: '时间' }, { prop: 'operator', label: '导出人' }, { prop: 'roleName', label: '角色' },
  { prop: 'orgName', label: '组织' }, { prop: 'scopeMode', label: '数据范围' },
  { prop: 'name', label: '文件名' }, { prop: 'format', label: '格式' }, { prop: 'rows', label: '行数' },
  { prop: 'result', label: '结果' }, { prop: 'memo', label: '说明' }
]
function onExport() {
  if (tab.value === 'export') {
    exportList({ name: '导出清单', source: '/e/access-log', columns: EXPORT_LOG_COLS, rows: rows.value, filters: { ...query } })
    return
  }
  exportList({ name: '数据访问日志', source: '/e/access-log', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}
</script>

<style scoped>
.rsum__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 6px; }
.spacer { flex: 1; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
.sum-note { font-size: 12px; color: var(--biz-text-3); line-height: 1.8; }
</style>
