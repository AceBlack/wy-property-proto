<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>品质检查记录 · 以「一次检查」为行</b>：本页是<b>结果台账与整改闭环</b>，/f/quality 是<b>现场评分卡（执行载体）</b>——
        前者回答「查出什么、改没改完」，后者回答「这次怎么打分」，两者共用同一套评分档位但页面不合并。
        顶部<b>快捷视图定状态</b>（整改中 / 已超时 / 待复核 / 不合格），下方<b>项目 + 区域</b>定范围，两者可叠加；
        区域是业务条线（保洁 / 安保 / 工程 / 客服），不是空间层级，所以不再用树表达。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">检查记录</div><div class="dstat__v">{{ summary.total }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">平均分</div><div class="dstat__v">{{ summary.avgScore }}<span class="unit">分</span></div></div>
        <div class="dstat"><div class="dstat__k">整改中</div><div class="dstat__v">{{ summary.rectifying }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">已超时 / 待复核</div><div class="dstat__v" :class="summary.overdue > 0 ? 'is-warn' : ''">{{ summary.overdue }} / {{ summary.recheck }}<span class="unit">条</span></div></div>
      </div>
      <div class="sum-note">
        口径：合格及以上 {{ summary.qualified }} 条；一票否决 {{ summary.veto }} 条（不论得分一律不合格，必须整改闭环后复查）。
      </div>
    </div>

    <div class="ia is-flat" style="margin-top:16px;">
      <div class="ia__main">
        <div class="panel">
          <div class="qvwrap">
            <QuickViews v-model="query.vf" :items="quickViews" hint="快捷视图与下方范围可叠加" @change="run" />
          </div>

          <el-form :model="query" class="filter-bar" label-width="48px" @submit.prevent>
            <ScopeFilter :model="query" :levels="['community']" @patch="p2 => Object.assign(query, p2)" @change="run" />
            <el-form-item label="区域">
              <el-select v-model="query.area" placeholder="全部" clearable style="width:88px">
                <el-option v-for="o in areaOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="来源">
              <el-select v-model="query.sourceType" placeholder="全部" clearable style="width:96px">
                <el-option v-for="o in QUALITY_SOURCES" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="query.type" placeholder="全部" clearable style="width:72px">
                <el-option v-for="o in typeOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="等级">
              <el-select v-model="query.grade" placeholder="全部" clearable style="width:72px">
                <el-option v-for="o in gradeOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width:80px">
                <el-option v-for="o in statusOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="单号 / 检查人 / 区域" clearable style="width:132px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="run">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="scopebar">
            <span class="scopebar__i is-last">{{ scopeText }}</span>
            <span v-if="vnLabel" class="scopebar__vf">{{ vnLabel }}</span>
            <span v-if="query.kw" class="scopebar__vf">关键字 {{ query.kw }}</span>
            <span class="spacer" />
            <span class="scopebar__sum">
              本范围 <b>{{ scopeSum.count }}</b> 条 · 平均 <b>{{ scopeSum.avgScore }}</b> 分 ·
              不合格 <b class="is-warn">{{ scopeSum.unqualified }}</b> · 整改中 <b>{{ scopeSum.rectifying }}</b>
            </span>
            <el-button link type="primary" :disabled="!hasScope" @click="clearScope">清除范围</el-button>
          </div>

          <div class="toolbar" style="margin-top:10px;">
            <el-button type="primary" :icon="'Plus'" @click="jump('/f/quality')">发起现场评分</el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 条记录</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 500px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column label="检查单" min-width="160">
              <template #default="{ row }">
                <div class="nowrap">{{ row.checkNo }}</div>
                <div class="ps-sub">{{ row.checkDate }}</div>
              </template>
            </el-table-column>
            <el-table-column label="来源" width="94">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="row.sourceType === '任务评价' ? 'warning' : 'info'">
                  {{ row.sourceType || '现场抽查' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="communityName" label="项目" min-width="92" show-overflow-tooltip />
            <el-table-column prop="area" label="区域" min-width="92" show-overflow-tooltip />
            <el-table-column prop="type" label="类型" min-width="72" />
            <el-table-column prop="checker" label="检查人" min-width="76" />
            <el-table-column label="评分" min-width="92">
              <template #default="{ row }">
                <div class="nowrap"><span class="num">{{ row.score }}</span> 分</div>
                <div class="ps-sub"><StatusTag domain="grade" :value="row.grade" /></div>
              </template>
            </el-table-column>
            <el-table-column label="整改" min-width="130">
              <template #default="{ row }">
                <div class="nowrap">{{ row.rectifyDone }} / {{ row.rectifyCount }} 项</div>
                <div class="ps-sub" :class="{ 'is-expire': row.status === '已超时' }">截止 {{ row.dueDate.slice(5) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="92">
              <template #default="{ row }"><StatusTag domain="quality" :value="row.status" /></template>
            </el-table-column>
            <el-table-column label="操作" width="96" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <EmptyState type="search" desc="换个筛选条件，或清除范围重新查看">
                <template #action><el-button @click="reset">清除筛选条件</el-button></template>
              </EmptyState>
            </template>
          </el-table>

          <div class="table-foot">
            <el-pagination v-model:current-page="pageNo" v-model:page-size="size"
              :page-sizes="PAGE_SIZES" :total="total" layout="total, sizes, prev, pager, next, jumper" />
          </div>
        </div>
      </div>
    </div>

    <DetailDrawer
      v-model="detailVisible" :loading="detailLoading"
      :title="detailData ? `${detailData.check.checkNo} · ${detailData.check.area}` : ''"
      :subtitle="detailData ? `${detailData.check.communityName} · ${detailData.check.type}检查 · ${detailData.check.checker} · ${detailData.check.checkDate}` : ''"
      :status="detailData?.check?.status" status-domain="quality"
      :tag="detailData?.check?.veto ? '一票否决' : ''"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">得分</div><div class="dstat__v">{{ detailData.check.score }}<span class="unit">分</span></div></div>
          <div class="dstat"><div class="dstat__k">等级</div><div class="dstat__v"><StatusTag domain="grade" :value="detailData.check.grade" /></div></div>
          <div class="dstat"><div class="dstat__k">扣分项</div><div class="dstat__v">{{ detailData.check.deductCount }}<span class="unit">项</span></div></div>
          <div class="dstat">
            <div class="dstat__k">整改闭环</div>
            <div class="dstat__v" :class="detailData.check.status === '已超时' ? 'is-warn' : ''">
              {{ detailData.check.rectifyDone }} / {{ detailData.check.rectifyCount }}<span class="unit">项</span>
            </div>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>检查信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">检查单号</span><span class="dl__v">{{ detailData.check.checkNo }}</span></div>
          <div class="dl__i"><span class="dl__k">检查项目</span><span class="dl__v">{{ detailData.check.communityName }}</span></div>
          <div class="dl__i"><span class="dl__k">检查区域</span><span class="dl__v">{{ detailData.check.area }}</span></div>
          <div class="dl__i"><span class="dl__k">检查类型</span><span class="dl__v">{{ detailData.check.type }}</span></div>
          <div class="dl__i"><span class="dl__k">检查人</span><span class="dl__v">{{ detailData.check.checker }}</span></div>
          <div class="dl__i"><span class="dl__k">检查日期</span><span class="dl__v">{{ detailData.check.checkDate }}</span></div>
          <div class="dl__i"><span class="dl__k">整改期限</span><span class="dl__v" :class="{ 'is-expire': detailData.check.status === '已超时' }">{{ detailData.check.dueDate }}</span></div>
          <div class="dl__i"><span class="dl__k">现场照片</span><span class="dl__v">{{ detailData.check.attachments }} 张</span></div>
          <div class="dl__i"><span class="dl__k">下轮复查</span><span class="dl__v">{{ detailData.check.recheck ? '已安排' : '未安排' }}</span></div>
          <div class="dl__i is-full"><span class="dl__k">检查备注</span><span class="dl__v">{{ detailData.check.remark || '—' }}</span></div>
        </div>

        <template v-if="detailData.check.sourceType === '任务评价' && detailData.check.metrics">
          <div class="sec__hd" style="margin-top:18px;">
            <h4>评价依据</h4><span class="desc">来自巡检执行数据 · 周期 {{ detailData.check.period }}</span>
          </div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">完成率</span><span class="dl__v">{{ (detailData.check.metrics.doneRate * 100).toFixed(1) }}%</span></div>
            <div class="dl__i"><span class="dl__k">合格率</span><span class="dl__v">{{ (detailData.check.metrics.passRate * 100).toFixed(1) }}%</span></div>
            <div class="dl__i"><span class="dl__k">加权达标率</span><span class="dl__v">{{ (detailData.check.metrics.weighted * 100).toFixed(1) }}%</span></div>
            <div class="dl__i"><span class="dl__k">权重</span><span class="dl__v">合格 {{ Math.round((detailData.check.metrics.weight?.pass || 0) * 100) }}% + 完成 {{ Math.round((detailData.check.metrics.weight?.done || 0) * 100) }}%</span></div>
            <div class="dl__i"><span class="dl__k">自查问题</span><span class="dl__v">{{ detailData.check.metrics.selfIssues }} 项（扣 {{ detailData.check.metrics.selfDeduct }}）</span></div>
            <div class="dl__i"><span class="dl__k">抽查问题</span><span class="dl__v">{{ detailData.check.metrics.crossIssues }} 项（扣 {{ detailData.check.metrics.crossDeduct }}）</span></div>
            <div class="dl__i"><span class="dl__k">申报冲突</span><span class="dl__v">{{ detailData.check.metrics.conflicts }} 次</span></div>
            <div class="dl__i"><span class="dl__k">涉及任务</span><span class="dl__v">{{ (detailData.check.taskIds || []).length }} 条</span></div>
          </div>
        </template>

        <div v-if="detailData.items.length" style="margin-top:18px;">
          <div class="sec__hd"><h4>整改项</h4><span class="desc">{{ detailData.items.filter(i => i.done).length }} / {{ detailData.items.length }} 已闭环</span></div>
          <el-table :data="detailData.items" size="small" max-height="220">
            <el-table-column prop="group" label="检查组" width="96" />
            <el-table-column label="问题" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.item }} · {{ row.reason }}</template>
            </el-table-column>
            <el-table-column prop="level" label="严重度" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.level === '一票否决' || row.level === '严重' ? 'danger' : row.level === '一般' ? 'warning' : 'info'" effect="plain">
                  {{ row.level }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="80">
              <template #default="{ row }">
                <el-tag size="small" :type="row.done ? 'success' : 'warning'" effect="plain">{{ row.done ? '已闭环' : '待整改' }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>闭环进度</h4><span class="desc">检查 → 评分 → 整改 → 复查</span></div>
        <div class="tl">
          <div v-for="(l, i) in detailData.timeline" :key="i" class="tl__i" :class="{ 'is-done': l.done }">
            <div class="tl__t">{{ l.title }}</div>
            <div class="tl__m">{{ l.memo }}</div>
          </div>
        </div>

        <div class="rel">
          <el-button size="small" @click="jump('/f/quality')">发起现场评分</el-button>
          <el-button size="small" @click="toRectifyWo">转整改工单</el-button>
          <span class="rel__note">整改项落工单实体（{{ detailData?.check?.rectifyWoIds?.length || 0 }} 条已转），可在工单列表按「品质整改」筛选追溯</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="detailData?.check?.rectifyCount" @click="toRectifyOrders">整改闭环</el-button>
        <el-button v-if="detailData && !detailData.check.recheck" @click="doScheduleRecheck">安排复查</el-button>
        <el-button type="primary" @click="doStartRectify">发起整改</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, QUALITY_SOURCES, communities, createWoFromQuality, getQualityCheckDetail, qcScopeSummary,
  qualityAreaOpts, qualityGradeOpts, qualityStatusOpts, qualitySummary, qualityTypeOpts, qualityVirtualNodes,
  queryQualityChecks, scheduleQualityRecheck, startQualityRectify
} from '@/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { useFocusLanding } from '@/composables/useFocus'
import QuickViews from '@/components/QuickViews.vue'
import ScopeFilter from '@/components/ScopeFilter.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

const router = useRouter()
const route = useRoute()
const BLANK = { communityId: '', area: '', vf: '' }
const BLANK_ALL = { ...BLANK, sourceType: '', type: '', grade: '', status: '', kw: '' }


/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'checkId', label: '记录编号' },
  { prop: 'communityName', label: '项目' },
  { prop: 'area', label: '区域' },
  { prop: 'type', label: '类型' },
  { prop: 'checker', label: '检查人' },
  { prop: 'checkDate', label: '检查日期' },
  { prop: 'score', label: '得分' },
  { prop: 'level', label: '严重度' },
  { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '品质检查记录', source: '/f/quality-records', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const { rows, total, pageNo, size, loading, query, load, search } = useListQuery(
  queryQualityChecks, { immediate: false, filters: { ...BLANK_ALL } }
)

const vnodes = ref(qualityVirtualNodes())
/* KPI 汇总：mock 同步、http 异步，统一 await；失败保留上一次的数 */
const summary = ref({ total: 0, avgScore: 0, qualified: 0, unqualified: 0, rectifying: 0, overdue: 0, recheck: 0, veto: 0 })
async function syncSummary() {
  try { summary.value = await qualitySummary() } catch { /* 保持旧值 */ }
}
syncSummary()
/* 快捷视图：原左树的虚拟视图节点搬到这里 */
const quickViews = computed(() => [{ key: '', label: '全部', n: summary.value.total }, ...vnodes.value])
const areaOpts = qualityAreaOpts()
const typeOpts = qualityTypeOpts()
const gradeOpts = qualityGradeOpts()
const statusOpts = qualityStatusOpts()

const highlightId = ref('')
const vnLabel = computed(() => (query.vf ? (quickViews.value.find(v => v.key === query.vf)?.label || '') : ''))

/* 当前范围小计 */
const scopeSum = ref({ count: 0, avgScore: 0, unqualified: 0, rectifying: 0, overdue: 0 })
/* 小计与列表同源：越权/异常时不能让页面抛未捕获异常——列表已把 403 提示出来，这里静默归零 */
async function syncScopeSum() {
  try { scopeSum.value = await qcScopeSummary({ ...query }) }
  catch { scopeSum.value = Object.fromEntries(Object.keys(scopeSum.value).map(k => [k, 0])) }
}
function run() { search(); syncScopeSum() }

const hasScope = computed(() => !!(query.communityId || query.area || query.vf ||
  query.sourceType || query.type || query.grade || query.status || query.kw))
const scopeText = computed(() => {
  const c = communities.find(x => x.communityId === query.communityId)?.name || '全部项目'
  return query.area ? `${c} · ${query.area}` : c
})
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getQualityCheckDetail)

/* B 级补齐：发起整改（只改状态+整改开始时间）/ 安排复查（+7 天） */
function refreshQuality(id) {
  syncSummary()
  vnodes.value = qualityVirtualNodes()
  search()
  syncScopeSum()
  openDetail(id)
}
function doStartRectify() {
  const c = detailData.value?.check
  if (!c) return
  try {
    const r = startQualityRectify(c.checkId)
    ElMessage.success(`已发起整改：${r.count} 项待闭环（截止 ${c.dueDate}）`)
    refreshQuality(c.checkId)
  } catch (e) { ElMessage.error(e?.message || '发起失败') }
}
function doScheduleRecheck() {
  const c = detailData.value?.check
  if (!c) return
  try {
    const r = scheduleQualityRecheck(c.checkId, 7)
    ElMessage.success(`已安排 ${r.recheckDate} 复查（7 天后复查本轮问题）`)
    refreshQuality(c.checkId)
  } catch (e) { ElMessage.error(e?.message || '安排失败') }
}

function clearScope() {
  Object.assign(query, BLANK_ALL)
  run()
}
function reset() { clearScope() }

function onRow(row) { openDetail(row.checkId) }
/** P3：跳到整改工作台，按检查单号定位（整改单是独立台账，不在品质记录里就地展开） */
function toRectifyOrders() {
  const no = detailData.value?.check?.checkNo
  if (!no) return
  detailVisible.value = false
  router.push({ path: '/f/rectify', query: { check: no } })
}
function rowClass({ row }) { return row.checkId === highlightId.value ? 'row--focus' : '' }
function jump(path, focus) { router.push(focus ? `${path}?focus=${focus}` : path) }
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }

/** F2 品质整改转工单：整改项落到工单表，便于闭环追溯（内存态，刷新还原） */
async function toRectifyWo() {
  const c = detailData.value?.check || detailData.value?.quality || detailData.value?.record
  const id = c?.checkId || detailData.value?.checkId
  if (!id) { ElMessage.warning('请先选择检查记录'); return }
  try {
    const wo = createWoFromQuality(id, c?.area || '')
    ElMessage.success(`已生成整改工单 ${wo.woNo}，状态已转「整改中」`)
    // 汇总 / 快捷视图 / 列表都读派生数据，统一刷新，避免「转了工单但数字不变」
    syncSummary()
    vnodes.value = qualityVirtualNodes()
    search()
    openDetail(id)
  } catch (e) {
    ElMessage.error(e?.message || '转工单失败')
  }
}

/* ---------- 落地：focus 锚点 + vf 虚拟节点 ---------- */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  const vf = String(route.query.vf || '')
  if (vf && vnodes.value.some(v => v.key === vf)) {
    Object.assign(query, { ...BLANK_ALL, vf })
    await load()
    await syncScopeSum()
    return
  }
  if (focus && location && focus.type === 'check') {
    Object.assign(query, { ...BLANK_ALL, communityId: location.communityId || '', area: location.area || '' })
    await load()
    await syncScopeSum()
    highlightId.value = focus.id
    if (open) openDetail(focus.id)
    return
  }
  clearScope()
  await load()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-sub.is-expire { color: var(--biz-danger); }
.is-expire { color: var(--biz-danger); }
.num { font-family: var(--biz-font-num); }
</style>
