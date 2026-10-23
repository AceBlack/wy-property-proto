<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>待办中心 · A 级交互</b>：六类待办统一聚合（审批 / 工单 / 告警 / 品质 / 欠费 / 押金），按紧急度排序。
        ①点击上方类型卡可筛选；②「处理」跳转对应业务页并自动定位记录；③审批类进入<b>审批处理页</b>，可同意 / 驳回 / 转办 / 加签。
        口径来自 <code>api.todoRows</code>，与工单、告警、账单同源。
      </div>
    </div>

    <!-- 概览 -->
    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel rsum">
        <div class="rsum__l">待办总数</div><div class="rsum__v">{{ sum.total }}</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">紧急待办</div><div class="rsum__v money--out">{{ sum.urgent }}</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">待我审批</div><div class="rsum__v">{{ sum.byType.approval || 0 }}</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">超时工单 / 告警</div>
        <div class="rsum__v">{{ (sum.byType.workorder || 0) + (sum.byType.alarm || 0) }}</div>
      </div>
    </div>

    <!-- 类型卡 -->
    <div class="panel" style="margin-top:16px;">
      <div class="toolbar" style="margin-bottom:0;">
        <span class="muted" style="font-size:12.5px;">按类型筛选：</span>
        <el-button
          v-for="t in TODO_TYPES" :key="t.key" size="small"
          :type="typeKey === t.key ? 'primary' : 'default'"
          @click="pickType(t.key)"
        >{{ t.label }} {{ sum.byType[t.key] || 0 }}</el-button>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="reload" />
      </div>
    </div>

    <el-tabs v-model="tab" style="margin-top:12px;">
      <el-tab-pane label="待办清单" name="todo">
        <div class="panel" style="margin-top:12px;">
          <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
            <el-form-item label="项目">
              <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px">
                <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="typeKey" placeholder="全部" clearable style="width:130px">
                <el-option v-for="t in TODO_TYPES" :key="t.key" :label="t.label" :value="t.key" />
              </el-select>
            </el-form-item>
            <el-form-item label="紧急度">
              <el-select v-model="query.level" placeholder="全部" clearable style="width:100px">
                <el-option v-for="l in ['紧急', '重要', '一般']" :key="l" :label="l" :value="l" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="标题 / 房号 / 项目" clearable style="width:160px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 条待办</span>
            <span class="spacer" />
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
          </div>
          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 420px)">
            <el-table-column prop="title" label="待办事项" min-width="260" show-overflow-tooltip />
            <el-table-column label="类型" width="110">
              <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.typeLabel }}</el-tag></template>
            </el-table-column>
            <el-table-column label="紧急度" width="90" align="center">
              <template #default="{ row }"><StatusTag domain="todoLevel" :value="row.level" /></template>
            </el-table-column>
            <el-table-column prop="desc" label="说明" min-width="240" show-overflow-tooltip />
            <el-table-column prop="communityName" label="项目" width="110" />
            <el-table-column prop="due" label="产生时间 / 截止" width="150" />
            <el-table-column prop="extra" label="状态" width="110" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="$router.push(row.route)">处理</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination
              background layout="total, sizes, prev, pager, next"
              :total="total" :current-page="pageNo" :page-size="size" :page-sizes="PAGE_SIZES"
              @current-change="p => { pageNo.value = p; load() }" @size-change="s => { size.value = s; load() }"
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="审批单" name="approval">
        <div class="panel" style="margin-top:16px;">
          <el-form :model="aq" class="filter-bar" label-width="72px" @submit.prevent>
            <el-form-item label="业务类型">
              <el-select v-model="aq.bizType" placeholder="全部" clearable style="width:130px">
                <el-option v-for="t in bizTypeOpts" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="aq.status" placeholder="全部" clearable style="width:120px">
                <el-option v-for="s in APPROVAL_STATUS" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="aq.kw" placeholder="单号 / 标题 / 申请人" clearable style="width:160px" @keyup.enter="searchA" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="searchA">查询</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <el-table v-loading="aLoading" :data="aRows" style="width:100%" max-height="calc(100vh - 380px)">
            <el-table-column prop="approvalNo" label="审批单号" width="140" />
            <el-table-column prop="bizType" label="业务类型" width="110" />
            <el-table-column prop="title" label="事项" min-width="240" show-overflow-tooltip />
            <el-table-column label="金额" width="120" align="right">
              <template #default="{ row }">
                <span v-if="row.amount" class="money">¥ {{ money(row.amount) }}</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="applicant" label="申请人" width="100" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }"><StatusTag domain="approval" :value="row.status" /></template>
            </el-table-column>
            <el-table-column prop="currentNode" label="当前节点" width="160" show-overflow-tooltip />
            <el-table-column prop="applyTime" label="提交时间" width="140" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="$router.push(`/c/approval/${row.approvalId}`)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination
              background layout="total, sizes, prev, pager, next"
              :total="aTotal" :current-page="aPageNo" :page-size="aSize" :page-sizes="PAGE_SIZES"
              @current-change="p => { aPageNo.value = p; loadA() }" @size-change="s => { aSize.value = s; loadA() }"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import StatusTag from '@/components/StatusTag.vue'
import { useListQuery } from '@/composables/useQuery'
import { exportList } from '@/utils/export'
import { money } from '@/utils/format'
import {
  APPROVAL_STATUS, PAGE_SIZES, TODO_TYPES, approvalBizTypeOpts, communityOpts, queryApprovals, queryTodos, todoSummary
} from '@/utils/api'

const bizTypeOpts = ref(approvalBizTypeOpts())

const tab = ref('todo')
const typeKey = ref('')

// —— 待办清单 ——
// types 由上方类型卡控制，不属于筛选表单，因此在 fetcher 层合并进 filters
const todoFetcher = p => queryTodos({
  ...p, filters: { ...p.filters, types: typeKey.value ? [typeKey.value] : [] }
})
const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(todoFetcher, {
  filters: { communityId: '', level: '', kw: '' }, size: 20
})
// 类型卡 / 项目变化时重新取数（types 不在 query 里，需单独监听）
watch([typeKey, () => query.communityId], () => { pageNo.value = 1; load() })
const sum = ref(todoSummary())
function reload() {
  sum.value = todoSummary()
  load()
  loadA()
}
function pickType(key) { typeKey.value = typeKey.value === key ? '' : key }

const EXPORT_COLS = [
  { prop: 'title', label: '待办事项' }, { prop: 'typeLabel', label: '类型' },
  { prop: 'level', label: '紧急度' }, { prop: 'desc', label: '说明' },
  { prop: 'communityName', label: '项目' }, { prop: 'due', label: '时间' },
  { prop: 'extra', label: '状态' }
]
function onExport() {
  exportList({
    name: '待办清单', source: '/c/todo', columns: EXPORT_COLS,
    rows: rows.value, filters: { ...query, type: typeKey.value }
  })
}

// —— 审批单 ——
const aq = ref({ bizType: '', status: '', kw: '' })
const aRows = ref([]); const aTotal = ref(0); const aPageNo = ref(1); const aSize = ref(20); const aLoading = ref(false)
async function loadA() {
  aLoading.value = true
  try {
    bizTypeOpts.value = approvalBizTypeOpts()
    const res = await queryApprovals({ pageNo: aPageNo.value, size: aSize.value, filters: { ...aq.value } })
    aRows.value = res.rows; aTotal.value = res.total
  } finally { aLoading.value = false }
}
function searchA() { aPageNo.value = 1; loadA() }
loadA()
</script>
