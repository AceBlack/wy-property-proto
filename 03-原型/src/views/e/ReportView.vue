<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>{{ cfg?.name || '报表' }}</b>：{{ cfg?.desc }}
        口径来自 <code>api.js</code>，与驾驶舱同源；<b>导出为全量异步任务</b>，在下载中心下载。
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="panel" style="margin-top:16px;">
      <div class="rfilter">
        <template v-for="f in (cfg?.filters || [])" :key="f.key">
          <el-select
            v-if="f.type === 'select'" v-model="query[f.key]" :placeholder="f.label"
            clearable :style="{ width: f.width + 'px' }"
          >
            <el-option v-for="o in f.opts()" :key="o.id ?? o" :label="o.name ?? o" :value="o.id ?? o" />
          </el-select>
          <el-input
            v-else v-model="query[f.key]" :placeholder="f.placeholder || f.label"
            clearable :style="{ width: f.width + 'px' }"
          />
        </template>
        <el-button :icon="'Search'" @click="search">查询</el-button>
        <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        <span class="spacer" />
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <el-button :icon="'Back'" @click="$router.push('/e/reports')">返回中心</el-button>
      </div>
    </div>

    <!-- 合计条：字段由报表配置决定，不同报表的口径不同，不写死四格 -->
    <div
      class="grid" style="margin-top:16px;"
      :style="{ gridTemplateColumns: 'repeat(' + sumFields.length + ',minmax(0,1fr))' }"
    >
      <div v-for="f in sumFields" :key="f.k" class="panel rsum">
        <div class="rsum__l">{{ f.l }}</div>
        <div class="rsum__v" :class="f.warn ? 'money--out' : ''">
          {{ f.money ? '¥ ' + money(sum[f.k]) : sum[f.k] }}
        </div>
      </div>
    </div>
    <div v-if="cfg?.note" class="rnote">口径：{{ cfg.note }}</div>

    <!-- 明细分表 -->
    <div class="panel" style="margin-top:16px;">
      <AsyncBlock
        :loading="loading" :error="error" :error-code="errorCode"
        :empty="!rows.length" empty-type="search"
        empty-desc="当前筛选条件下没有数据，换个条件试试"
        :skeleton-rows="6" @retry="load"
      >
        <el-table :data="rows" size="small" border stripe height="440">
          <el-table-column type="index" label="#" width="50" />
          <el-table-column
            v-for="c in (cfg?.columns || [])" :key="c.prop"
            :prop="c.prop" :label="c.label" :width="c.width" :min-width="c.minWidth"
            :align="c.align || 'left'" :show-overflow-tooltip="!!c.tip"
          >
            <template #default="{ row }">
              <StatusTag v-if="c.tag" :domain="c.tag" :value="row[c.prop]" />
              <span v-else-if="c.money" class="money" :class="c.strong && row[c.prop] > 0 ? 'money--out' : ''">
                ¥ {{ money(row[c.prop]) }}
              </span>
              <span v-else-if="c.unit">{{ row[c.prop] ?? '-' }} {{ c.unit }}</span>
              <span v-else>{{ row[c.prop] ?? '-' }}</span>
            </template>
          </el-table-column>
        </el-table>
        <div class="pager">
          <el-pagination
            v-model:current-page="pageNo" v-model:page-size="size" :page-sizes="PAGE_SIZES"
            :total="total" layout="total, sizes, prev, pager, next, jumper" background
          />
        </div>
      </AsyncBlock>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import AsyncBlock from '@/components/AsyncBlock.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useListQuery } from '@/composables/useQuery'
import {
  PAGE_SIZES, queryBills, queryBusiness, queryDeposits, queryInspectReport, queryPayments,
  queryRepairSummary, queryUnpaidHouses, reportSummary
} from '@/utils/api'
import { reportOf } from '@/utils/reports'
import { exportSubmitted, submitTableExport } from '@/utils/export'
import { money } from '@/utils/format'

const route = useRoute()
const code = computed(() => String(route.params.code || ''))
const cfg = computed(() => reportOf(code.value))

const FETCHER = {
  bills: queryBills, unpaidHouses: queryUnpaidHouses,
  payments: queryPayments, business: queryBusiness, repair: queryRepairSummary,
  deposits: queryDeposits, inspect: queryInspectReport
}
const fetcher = computed(() => p => {
  const base = FETCHER[cfg.value?.fetchCode] || queryBills
  return base({ ...p, filters: { ...cfg.value?.defaultFilters, ...p.filters } })
})

const { rows, total, loading, error, errorCode, query, pageNo, size, load, search, reset } =
  useListQuery(fetcher.value, { filters: { communityId: '', period: '', kw: '' }, size: 50 })

watch(cfg, () => { pageNo.value = 1; load() })

const sum = computed(() => reportSummary(code.value, { ...query }))
const sumFields = computed(() => cfg.value?.summaryFields || [{ k: 'count', l: '记录数' }])

/** 导出：提交全量异步任务（不导当前页、不在页面内生成文件） */
async function onExport() {
  const cols = cfg.value?.columns || []
  const name = cfg.value?.name || '报表'
  submitTableExport({
    name, type: '报表', source: `/e/reports/${code.value}`, columns: cols,
    filters: { ...cfg.value?.defaultFilters, ...query },
    // 传函数：任务真正开始生成时才全量取数，避免把整表数据常驻在提交时刻
    rows: async () => {
      const res = await fetcher.value({ pageNo: 1, size: 1e6, filters: { ...cfg.value?.defaultFilters, ...query } })
      return res?.rows || []
    }
  })
  ElMessage({ type: 'success', ...exportSubmitted(name) })
}
</script>

<style scoped>
.rfilter { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; height: 40px; }
.rfilter .spacer { flex: 1; }
.rsum { padding: 12px 16px; }
.rsum__l { font-size: 12px; color: var(--biz-text-3); }
.rsum__v { font-size: 20px; font-weight: 600; color: var(--biz-text-1); margin-top: 4px; }
.pager { display: flex; justify-content: flex-end; margin-top: 12px; }
.rnote { font-size: 12px; color: var(--biz-text-3); margin-top: 8px; }
</style>
