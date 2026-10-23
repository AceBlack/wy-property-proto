<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>品质检查记录 · 以「一次检查」为行</b>：本页是<b>结果台账与整改闭环</b>，/f/quality 是<b>现场评分卡（执行载体）</b>——
        前者回答「查出什么、改没改完」，后者回答「这次怎么打分」，两者共用同一套评分档位但页面不合并。
        <b>{{ summary.overdue }} 条整改已超时</b>、<b>{{ summary.rectifying }} 条在整改中</b>进常用视图。
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

    <div class="ia" :class="{ 'is-collapsed': treeCollapsed }" style="margin-top:16px;">
      <div class="ia__tree">
        <SpaceTree
          title="检查范围" tree-title="项目 / 区域"
          :nodes="tree" :virtual="vnodes"
          placeholder="搜项目 / 区域"
          :active-id="activeId" :active-vn="activeVn"
          @pick="onPick" @collapse="treeCollapsed = true"
        />
      </div>

      <div class="ia__main">
        <el-button v-if="treeCollapsed" class="ia__handle" size="small" :icon="'Expand'" @click="treeCollapsed = false">
          展开检查树
        </el-button>

        <div class="panel">
          <div class="scopebar">
            <template v-if="scopePath.length">
              <span v-for="(p, i) in scopePath" :key="p">
                <span class="scopebar__i" :class="{ 'is-last': i === scopePath.length - 1 }" @click="onCrumb(i)">{{ p }}</span>
                <span v-if="i < scopePath.length - 1" class="scopebar__sep">/</span>
              </span>
            </template>
            <span v-else class="scopebar__i is-last">全部检查</span>
            <span v-if="activeVn" class="scopebar__vf">{{ vnLabel }}</span>
            <span class="spacer" />
            <span class="scopebar__hint">树定范围 · 筛选定属性</span>
            <el-button link type="primary" @click="clearScope">清除范围</el-button>
          </div>

          <el-form :model="query" class="filter-bar" label-width="48px" @submit.prevent>
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
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Plus'" @click="jump('/f/quality')">发起现场评分</el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 条记录</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 500px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column label="检查单" min-min-width="160">
              <template #default="{ row }">
                <div class="nowrap">{{ row.checkNo }}</div>
                <div class="ps-sub">{{ row.checkDate }}</div>
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
            <el-table-column label="整改" min-min-width="130">
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
  PAGE_SIZES, createWoFromQuality, getQualityCheckDetail, qualityGradeOpts, qualityStatusOpts,
  qualitySummary, qualityTree, qualityTypeOpts, qualityVirtualNodes, queryQualityChecks,
  scheduleQualityRecheck, startQualityRectify
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { pathOf, useFocusLanding } from '@/composables/useFocus'
import SpaceTree from '@/components/SpaceTree.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

const router = useRouter()
const route = useRoute()
const BLANK = { communityId: '', area: '', vf: '' }
const BLANK_ALL = { ...BLANK, type: '', grade: '', status: '', kw: '' }


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

const tree = qualityTree()
const vnodes = ref(qualityVirtualNodes())
const summary = ref(qualitySummary())
const typeOpts = qualityTypeOpts()
const gradeOpts = qualityGradeOpts()
const statusOpts = qualityStatusOpts()

const treeCollapsed = ref(false)
const activeId = ref('')
const activeChain = ref([])
const activeVn = ref('')
const scopePath = ref([])
const highlightId = ref('')

const vnLabel = computed(() => vnodes.value.find(v => v.key === activeVn.value)?.label || '')
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getQualityCheckDetail)

/* B 级补齐：发起整改（只改状态+整改开始时间）/ 安排复查（+7 天） */
function refreshQuality(id) {
  summary.value = qualitySummary()
  vnodes.value = qualityVirtualNodes()
  search()
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

const flatNode = new Map()
;(function flatten(list) {
  list.forEach(n => {
    flatNode.set(n.id, n)
    if (n.children?.length) flatten(n.children)
  })
})(tree)

function onPick(node) {
  Object.assign(query, BLANK_ALL)
  Object.assign(query, node.patch || {})
  if (node.kind === 'virtual') {
    activeId.value = ''
    activeChain.value = []
    activeVn.value = node.key
    scopePath.value = []
  } else {
    activeId.value = node.id
    activeChain.value = node.chain || [node.id]
    activeVn.value = ''
    scopePath.value = node.path || []
  }
  search()
}
function onCrumb(index) {
  if (index >= activeChain.value.length - 1) return
  const node = flatNode.get(activeChain.value[index])
  if (!node) return
  Object.assign(query, BLANK_ALL)
  Object.assign(query, node.patch)
  activeId.value = node.id
  activeChain.value = activeChain.value.slice(0, index + 1)
  scopePath.value = scopePath.value.slice(0, index + 1)
  activeVn.value = ''
  search()
}
function clearScope() {
  Object.assign(query, BLANK_ALL)
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  search()
}
function reset() { clearScope() }

function onRow(row) { openDetail(row.checkId) }
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
    // 汇总 / 左树 / 列表都读派生数据，统一刷新，避免「转了工单但数字不变」
    summary.value = qualitySummary()
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
    activeId.value = ''
    activeChain.value = []
    activeVn.value = vf
    scopePath.value = []
    await load()
    return
  }
  if (focus && location && focus.type === 'check') {
    Object.assign(query, { ...BLANK_ALL, communityId: location.communityId || '', area: location.area || '' })
    if (location.area) {
      activeId.value = `Q:${location.communityId}:${location.area}`
      activeChain.value = [`Q:${location.communityId}`, activeId.value]
      scopePath.value = pathOf(tree, activeId.value)
    } else if (location.communityId) {
      activeId.value = `Q:${location.communityId}`
      activeChain.value = [activeId.value]
      scopePath.value = pathOf(tree, activeId.value)
    } else {
      activeId.value = ''
      activeChain.value = []
      scopePath.value = []
    }
    activeVn.value = ''
    await load()
    highlightId.value = focus.id
    if (open) openDetail(focus.id)
    return
  }
  clearScope()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-sub.is-expire { color: var(--biz-danger); }
.is-expire { color: var(--biz-danger); }
.num { font-family: var(--biz-font-num); }
</style>
