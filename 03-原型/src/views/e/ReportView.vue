<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>{{ cfg?.name || '报表' }}</b>：{{ cfg?.desc }}
        <template v-if="snapCode">
          <br />
          <b>统计报表不做实时查询</b>：数字由夜间跑批算好落库，页面读的是<b>统计批次快照</b>。
          改账单/改制单不会影响已生成的批次，要新数字请点右下角「重算」。
        </template>
        <template v-else>
          口径来自 <code>api.js</code>，与驾驶舱同源；<b>导出为全量异步任务</b>，在下载中心下载。
        </template>
      </div>
    </div>

    <!-- 快照条：统计报表专有，必须让人一眼看出「这是什么期次、哪个批次的数」 -->
    <div v-if="snapCode" class="panel snapbar">
      <span class="snapbar__badge">跑批</span>
      <el-radio-group v-model="periodType" size="small" @change="onPickPeriodType">
        <el-radio-button v-for="t in PERIOD_TYPES" :key="t" :value="t">{{ t }}报</el-radio-button>
      </el-radio-group>
      <el-select v-model="period" size="small" style="width: 220px" @change="onPickSnapshot">
        <el-option
          v-for="o in snapOptions" :key="o.period"
          :label="`${o.period}（${o.batchNo}${o.provisional ? ' · 试算' : ''}）`" :value="o.period"
        />
      </el-select>
      <span class="snapbar__meta">
        数据截止 {{ meta.dataCutoff || '-' }} · 生成于 {{ meta.calcAt || '-' }} ·
        公式 {{ meta.formulaVersion || '-' }} · {{ meta.rowCount ?? 0 }} 行
      </span>
      <el-tag v-if="meta.provisional" type="warning" size="small" effect="plain">试算（未月结）</el-tag>
      <el-tag v-if="meta.stale" type="warning" size="small" effect="plain">落后最新批次</el-tag>
      <el-tag v-if="meta.partial" type="danger" size="small" effect="plain">部分成功</el-tag>
      <el-tag v-if="meta.voided" type="danger" size="small" effect="plain">已作废（被反结）</el-tag>
      <span class="spacer" />
      <el-button size="small" :loading="recalcing" :icon="'Refresh'" @click="onRecalc">重算</el-button>
    </div>

    <!-- 期次说明 + 环比/同比：年报两种口径必须写清楚，否则「余额」和「发生额」会被混着比 -->
    <div v-if="snapCode" class="periodhint">
      <span>{{ periodHint }}</span>
      <template v-if="cmp">
        <el-divider direction="vertical" />
        <span>
          环比 <b>{{ cmp.prevPeriod || '—' }}</b>：
          <b :class="deltaCls(cmp.prevValue)">{{ deltaText(cmp.prevValue) }}</b>
        </span>
        <template v-if="cmp.yoyPeriod">
          <el-divider direction="vertical" />
          <span>同比 <b>{{ cmp.yoyPeriod }}</b>：<b :class="deltaCls(cmp.yoyValue)">{{ deltaText(cmp.yoyValue) }}</b></span>
        </template>
      </template>
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
              <span v-else-if="c.bool">{{ row[c.prop] ? c.bool[0] : c.bool[1] }}</span>
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
  queryRepairSummary, querySupFindingReport, queryUnpaidHouses, queryWoBuildingReport, reportSummary
} from '@/utils/api'
/* 统计报表走适配层（mock/http 同一签名，见 src/api/reports.js） */
import {
  queryReportRows, reportSnapshotList, recalcReport, reportRecalcTask, mapReportSummary,
  PERIOD_TYPES, periodRawOf
} from '@/api'
import { reportOf } from '@/utils/reports'
import { exportList } from '@/utils/export'
import { money } from '@/utils/format'

const route = useRoute()
const code = computed(() => String(route.params.code || ''))
const cfg = computed(() => reportOf(code.value))

/* ---------------- 实时报表：直接查业务表 ---------------- */
const FETCHER = {
  bills: queryBills, unpaidHouses: queryUnpaidHouses,
  payments: queryPayments, business: queryBusiness, repair: queryRepairSummary,
  deposits: queryDeposits, inspect: queryInspectReport,
  supFinding: querySupFindingReport, woBuilding: queryWoBuildingReport
}

/* ---------------- 统计报表：读快照 ---------------- */
const snapCode = computed(() => cfg.value?.snapshot || '')
const snapInfo = ref({ rows: [], latest: null })
/* 期次：日 / 月 / 年。日报=当天快照；月报/年报对时点型是「期末余额」，对期间型是「整期重算」 */
const periodType = ref('day')
const period = ref('')
const recalcing = ref(false)
/* meta / summary 由取数响应带回（契约同形）：页面算合计会和接口算的对不上，等于两套口径 */
const respMeta = ref({})
const respSummary = ref({})

/** 批次下拉：同一天多次重算只留最新批次（选日期即可，不必让用户挑 -01/-02） */
const snapRows = computed(() => snapInfo.value?.rows || [])
/** 期次下拉：同期次可能重算过多次，只留最新批次（选期次即可，不必让人挑 -01/-02） */
const snapOptions = computed(() => {
  const seen = new Set()
  return snapRows.value
    .filter(s => s.status === '成功')
    .filter(s => (seen.has(s.period) ? false : seen.add(s.period)))
})
const meta = computed(() =>
  (respMeta.value && Object.keys(respMeta.value).length ? respMeta.value : null)
  || snapOptions.value.find(s => s.period === period.value)
  || snapInfo.value?.latest || {}
)
const cmp = computed(() => meta.value?.compare || null)

/** 年报两种口径要说清：时点型看余额，期间型看发生额 */
const periodHint = computed(() => {
  const point = cfg.value?.snapshotType === 'point'
  const raw = periodRawOf(periodType.value)
  if (raw === 'year') {
    return point
      ? '年报（余额）：年末那一天 24:00 的余额，不做整期汇总；当年未结束则算到今天。'
      : '年报（发生额）：整年重算。不能把 12 个月的达标率/收缴率取平均——任务量不同，权重不同。'
  }
  if (raw === 'month') {
    return point
      ? '月报（余额）：月末那一天 24:00 的余额；当月未月结时算到今天，数字标注「试算」。'
      : '月报（发生额）：整月重算；当月未月结时标「试算」，月结后才算定稿。'
  }
  return '日报：当天快照，与「统计日」绑定。'
})

/** 环比/同比的差值展示（基数为 0 或 null 时不显示百分比） */
const deltaText = v => {
  const raw = periodRawOf(periodType.value)
  const base = raw === 'month' || raw === 'year' ? v : null
  if (base === null || base === undefined || !cmp.value) return '—'
  const now = Number(meta.value?.periodValue)
  if (!Number.isFinite(now)) return `${base}`
  const d = Math.round((now - base) * 100) / 100
  return `${base} → ${now}（${d >= 0 ? '+' : ''}${d}pp）`
}
const deltaCls = v => {
  if (v === null || v === undefined) return ''
  const now = Number(meta.value?.periodValue)
  if (!Number.isFinite(now)) return ''
  return now >= v ? 'up' : 'down'
}

/**
 * 拉批次列表。
 * **必须 await**：mock 模式是同步返回，http 模式是 Promise——
 * 同步写法在 mock 下没事，一开 http 就 `rows of undefined`（踩过一次，整页空）。
 */
async function loadSnapshots() {
  if (!snapCode.value) return
  try {
    snapInfo.value = (await reportSnapshotList(snapCode.value, periodRawOf(periodType.value))) || { rows: [], latest: null }
  } catch (e) {
    /* 批次列表拉不到时页头会空，但列表还能按缺省期次出数——把原因留在控制台，别静默 */
    console.warn('[报表] 批次列表加载失败：', e?.message || e)
    snapInfo.value = { rows: [], latest: null }
  }
  if (!period.value) period.value = snapInfo.value?.latest?.period || ''
}

/** 切粒度：默认落到该粒度最新一期 */
async function onPickPeriodType() {
  period.value = ''
  await loadSnapshots()
  query.periodType = periodRawOf(periodType.value)
  query.period = period.value
  pageNo.value = 1
  load()
}

const fetcher = computed(() => p => {
  if (snapCode.value) return queryReportRows(snapCode.value, p)
  const base = FETCHER[cfg.value?.fetchCode] || queryBills
  return base({ ...p, filters: { ...cfg.value?.defaultFilters, ...p.filters } })
})

const { rows, total, loading, error, errorCode, query, pageNo, size, load, search, reset } =
  useListQuery(fetcher.value, {
    filters: { communityId: '', period: '', kw: '' },
    size: 50,
    immediate: false,          /* 首次查询由 boot() 统一发起，先把期次拿到手 */
    onResponse: res => {
      respMeta.value = res?.meta || {}
      respSummary.value = res?.summary || {}
    }
  })

/* 统计报表把统计日塞进筛选（接口参数，不是表格列） */


/** 首次进入 / 切报表：先取期次列表，再发查询——期次是接口参数，不能等查询回来再补 */
async function boot() {
  snapInfo.value = { rows: [], latest: null }
  periodType.value = 'day'
  period.value = ''
  await loadSnapshots()
  query.periodType = snapCode.value ? periodRawOf(periodType.value) : ''
  query.period = snapCode.value ? period.value : ''
  pageNo.value = 1
  load()
}
watch(cfg, boot)

const sum = computed(() => {
  if (snapCode.value) return mapReportSummary(snapCode.value, respSummary.value, total.value)
  return reportSummary(code.value, { ...query })
})
const sumFields = computed(() => cfg.value?.summaryFields || [{ k: 'count', l: '记录数' }])

/** 切批次：同一个筛选条件换个时点看 */
function onPickSnapshot() {
  query.periodType = periodRawOf(periodType.value)
  query.period = period.value
  pageNo.value = 1
  load()
}

/** 重算：提交异步任务 → 轮询 → 跳到新批次（不自动冲掉用户当前的选择） */
async function onRecalc() {
  if (recalcing.value) return
  recalcing.value = true
  try {
    const task = await recalcReport({ code: snapCode.value, periodType: periodType.value, period: period.value || undefined })
    const done = await new Promise((resolve, reject) => {
      let n = 0
      const timer = setInterval(async () => {
        n++
        try {
          const t = await reportRecalcTask(task.taskId)
          if (t.status === '成功') { clearInterval(timer); resolve(t) }
          else if (n >= 10) { clearInterval(timer); reject(new Error('重算超时，请稍后在批次列表查看')) }
        } catch (e) { clearInterval(timer); reject(e) }
      }, 600)
    })
    await loadSnapshots()
    period.value = done.period || period.value
    query.periodType = periodRawOf(periodType.value)
    query.period = period.value
    await load()
    ElMessage.success(`重算完成：${done.batchNo}（${done.rowCount} 行）`)
  } catch (e) {
    ElMessage.error(e?.message || '重算失败')
  } finally {
    recalcing.value = false
  }
}

boot()

/** 导出：提交全量异步任务（不导当前页、不在页面内生成文件） */
function onExport() {
  const cols = cfg.value?.columns || []
  const name = cfg.value?.name || '报表'
  // 走 exportList：内含导出合规校验（超上限拦截 / 无明文权限自动脱敏 / 每次留痕）
  exportList({
    name, source: `/e/reports/${code.value}`, columns: cols,
    filters: { ...cfg.value?.defaultFilters, ...query },
    // 传函数：任务真正开始生成时才全量取数，避免把整表数据常驻在提交时刻
    rows: async () => {
      const res = await fetcher.value({ pageNo: 1, size: 1e6, filters: { ...cfg.value?.defaultFilters, ...query } })
      return res?.rows || []
    }
  })
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
.snapbar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; margin-top: 16px;
}
.snapbar .spacer { flex: 1; }
.snapbar__badge {
  font-size: 11px; padding: 1px 6px; border-radius: 4px;
  background: var(--biz-brand, #5b6cff); color: #fff;
}
.snapbar__l { font-size: 12px; color: var(--biz-text-3); }
.snapbar__meta { font-size: 12px; color: var(--biz-text-3); }
.periodhint {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 8px; font-size: 12px; color: var(--biz-text-3);
}
.periodhint .up { color: #c45656; }
.periodhint .down { color: #4a9d5f; }
</style>
