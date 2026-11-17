<template>
  <div class="page bl-page">
    <div class="bl-main">
      <!-- 单行工具条 -->
      <div class="bl-bar">
        <el-input v-model="query.kw" class="bl-search" placeholder="工单号 / 标题 / 师傅"
          clearable @keyup.enter="run" @clear="run">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>

        <div class="bl-chips">
          <button v-for="v in quickViews" :key="v.key" class="bl-chip" :class="{ 'is-on': query.vf === v.key }"
            @click="pickView(v)">
            {{ v.label }}<span class="bl-chip-n">{{ v.n }}</span>
          </button>
        </div>

        <button class="bl-more" :class="{ 'is-on': moreOpen || extraCount > 0 }" @click="moreOpen = !moreOpen">
          更多筛选<template v-if="extraCount"> · {{ extraCount }}</template>
          <span class="bl-caret">{{ moreOpen ? '▴' : '▾' }}</span>
        </button>

        <span class="spacer" />
        <el-button v-if="picked.length" text @click="openBatch">批量操作 {{ picked.length }}</el-button>
        <el-button text :disabled="!rows.length" @click="onExport">导出</el-button>
        <el-popover placement="bottom-end" :width="440" trigger="click" popper-class="bl-pop">
          <template #reference><button class="bl-ibtn" title="这页怎么用">ⓘ</button></template>
          <div class="bl-tip">
            <b>以「一张工单」为行。</b>顶部<b>快捷视图</b>定状态（待派单 / 已超时 / 紧急及以上 / 未闭环），
            「更多筛选」可叠加楼栋、单元、类型、优先级。只有入户维修类带房屋（约两成），
            公共区域 / 投诉 / 咨询类没有房屋归属，用「只看无房屋工单」承接。
            看「哪栋报修集中」用报表中心的<b>工单按楼栋分布</b>。
          </div>
        </el-popover>
        <el-button type="primary" @click="$router.push('/f/workorders/new')">发起工单</el-button>
      </div>

      <!-- 更多筛选：就地展开 -->
      <transition name="bl-exp">
        <div v-if="moreOpen" class="bl-morepanel">
          <el-form :model="query" :inline="true" class="bl-moreform" @submit.prevent>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width:112px" @change="run">
                <el-option v-for="s in statusOpts" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="query.type" placeholder="全部" clearable style="width:132px" @change="run">
                <el-option v-for="t in typeOpts" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
            <el-form-item label="优先级">
              <el-select v-model="query.priority" placeholder="全部" clearable style="width:104px" @change="run">
                <el-option v-for="p in priorityOpts" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
            <ScopeFilter :model="query" :levels="['building', 'unit']"
              @patch="p => Object.assign(query, p)" @change="run" />
            <el-form-item label="范围">
              <el-checkbox v-model="onlyNoHouse" @change="onNoHouse">只看无房屋工单</el-checkbox>
            </el-form-item>
            <el-form-item>
              <el-button text @click="onResetAll">清除全部条件</el-button>
            </el-form-item>
          </el-form>
        </div>
      </transition>

      <!-- KPI 瓦片 -->
      <div class="bl-kpis">
        <div class="bl-kpi">
          <div class="bl-kpi-ic"><el-icon><Tickets /></el-icon></div>
          <div class="bl-kpi-v">{{ summary.total }}<span class="bl-kpi-u">单</span></div>
          <div class="bl-kpi-l">工单总数</div>
        </div>
        <div class="bl-kpi">
          <div class="bl-kpi-ic"><el-icon><Clock /></el-icon></div>
          <div class="bl-kpi-v" :class="{ 'is-dan': summary.open > 0 }">{{ summary.open }}<span class="bl-kpi-u">单</span></div>
          <div class="bl-kpi-l">未闭环</div>
        </div>
        <div class="bl-kpi">
          <div class="bl-kpi-ic is-dan"><el-icon><Warning /></el-icon></div>
          <div class="bl-kpi-v is-dan">{{ summary.overdue }}<span class="bl-kpi-u">单</span></div>
          <div class="bl-kpi-l">已超时</div>
        </div>
        <div class="bl-kpi">
          <div class="bl-kpi-ic"><el-icon><Bell /></el-icon></div>
          <div class="bl-kpi-v">{{ summary.pending }}<span class="bl-kpi-u">单</span></div>
          <div class="bl-kpi-l">
            待派单
            <el-popover placement="top" :width="380" trigger="click" popper-class="bl-pop">
              <template #reference><el-icon class="bl-info is-sm"><InfoFilled /></el-icon></template>
              <div class="bl-tip">
                未闭环 = 待派单 / 已派单 / 处理中 / 待确认四态；已超时按 SLA 截止时间判定，与工单驾驶舱同源。<br><br>
                满意度 <b>{{ sat.avg || '—' }}</b> 分（{{ sat.ratedCount }} 单已评，参评率 {{ sat.evalRate }}%），
                完工未评价 <b>{{ sat.unratedCount }}</b> 单，可用快捷视图「完工未评价」拉出来催评。
              </div>
            </el-popover>
          </div>
        </div>
      </div>

      <!-- 当前范围小计 -->
      <div class="bl-scope">
        <span class="bl-scope-t">{{ scopeText }}</span>
        <span class="bl-scope-d">
          本范围 <b>{{ scopeSum.count }}</b> 单 · 未闭环 <b>{{ scopeSum.open }}</b> ·
          超时 <b class="is-warn">{{ scopeSum.overdue }}</b> · 待派单 <b>{{ scopeSum.pending }}</b>
        </span>
        <span v-if="query.nohouse" class="bl-scope-tag">无房屋工单</span>
        <span v-if="vnLabel" class="bl-scope-tag">{{ vnLabel }}</span>
        <span class="spacer" />
        <span class="bl-scope-page">共 {{ total }} 单</span>
      </div>

      <!-- 表格：无卡片 -->
      <div class="bl-table">
        <div class="bl-tblwrap">
          <el-table v-loading="loading" :data="rows" class="bl-tbl" style="width:100%"
            height="100%" :row-class-name="rowClass" @row-click="onRow" @selection-change="l => picked = l">
            <el-table-column type="selection" width="42" />
            <el-table-column label="工单号" min-width="112">
              <template #default="{ row }">
                <div class="nowrap bl-id">{{ row.woNo }}</div>
                <div class="ps-sub">{{ row.communityName }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="标题" min-width="190" show-overflow-tooltip>
              <template #default="{ row }"><span class="bl-addr">{{ row.title }}</span></template>
            </el-table-column>
            <el-table-column prop="type" label="类型" min-width="100" show-overflow-tooltip>
              <template #default="{ row }"><span class="bl-subj">{{ row.type }}</span></template>
            </el-table-column>
            <el-table-column label="房屋" min-width="128" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.houseId">{{ houseShort(row.houseName || houseName(row.houseId)) }}</span>
                <span v-else class="bl-subj">公共 / 非入户</span>
              </template>
            </el-table-column>
            <el-table-column label="服务项目 / 费用" min-width="150">
              <template #default="{ row }">
                <template v-if="row.type === '商业服务'">
                  <div>{{ row.serviceName || row.category }}</div>
                  <div class="ps-sub">
                    <span class="money">¥ {{ money(row.totalFee) }}</span>
                    <span :class="row.payStatus === '未支付' ? 'is-warn' : ''"> · {{ row.payStatus }}</span>
                  </div>
                </template>
                <span v-else-if="row.type === '公共区域维修'" class="bl-subj">免费 · {{ row.category }}</span>
                <span v-else class="bl-subj">{{ row.category || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="96">
              <template #default="{ row }"><span class="bl-st"><StatusTag domain="workOrder" :value="row.status" /></span></template>
            </el-table-column>
            <el-table-column label="业主评分" width="104">
              <template #default="{ row }">
                <span v-if="row.score" class="wos" :class="{ 'is-low': row.score <= 2 }">
                  <i class="wos__stars">{{ '★'.repeat(row.score) }}<span class="wos__off">{{ '★'.repeat(5 - row.score) }}</span></i>
                  <b>{{ row.score }}</b>
                </span>
                <span v-else-if="row.status === '已完工'" class="is-warn-text">未评价</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="priority" label="优先级" width="80">
              <template #default="{ row }">
                <span :class="{ 'is-warn-text': row.priority === '特急' || row.priority === '紧急' }">{{ row.priority }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="assignee" label="处理人" min-width="86" show-overflow-tooltip>
              <template #default="{ row }">{{ row.assignee || '待派单' }}</template>
            </el-table-column>
            <el-table-column label="SLA 剩余" min-width="92" align="right">
              <template #default="{ row }">
                <span v-if="slaOf(row).finished" class="muted">已结单</span>
                <span v-else-if="slaOf(row).paused" class="muted">停表中</span>
                <span v-else-if="slaOf(row).breached" class="money money--out">超 {{ slaOf(row).overdueHours }}h</span>
                <span v-else :class="slaOf(row).pct >= 80 ? 'is-warn-text' : ''">剩 {{ slaOf(row).leftHours }}h</span>
              </template>
            </el-table-column>
            <template #empty>
              <EmptyState type="search" desc="换个筛选条件，或清除范围重新查看">
                <template #action><el-button @click="onResetAll">清除筛选条件</el-button></template>
              </EmptyState>
            </template>
          </el-table>
        </div>
        <div class="bl-foot">
          <el-pagination v-model:current-page="pageNo" v-model:page-size="size"
            :page-sizes="PAGE_SIZES" :total="total" layout="total, sizes, prev, pager, next, jumper" />
        </div>
      </div>
    </div>

    <DetailDrawer
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.title"
      :subtitle="detailData ? `${detailData.woNo} · ${detailData.type}` : ''"
      :status="detailData?.status" status-domain="workOrder"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">优先级</div><div class="dstat__v" style="font-size:15px;">{{ detailData.priority }}</div></div>
          <div class="dstat"><div class="dstat__k">SLA 承诺</div><div class="dstat__v">{{ detailData.slaHours }}<span class="unit">小时</span></div></div>
          <div class="dstat"><div class="dstat__k">处理人</div><div class="dstat__v" style="font-size:15px;">{{ detailData.assignee || '待派单' }}</div></div>
          <div class="dstat">
            <div class="dstat__k">{{ slaOf(detailData).breached ? '已超时' : '剩余' }}</div>
            <div class="dstat__v" :class="slaOf(detailData).breached ? 'is-warn' : ''">
              {{ slaOf(detailData).breached ? slaOf(detailData).overdueHours : slaOf(detailData).leftHours }}<span class="unit">小时</span>
            </div>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>SLA 计时</h4>
          <span class="desc">工作日 09:00–18:00 · 周末与节假日不计时 · 「待业主确认」停表</span>
        </div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">到期时间</span><span class="dl__v">{{ slaOf(detailData).dueAt }}</span></div>
          <div class="dl__i"><span class="dl__k">已耗工时</span><span class="dl__v">{{ slaOf(detailData).usedHours }} 小时（{{ slaOf(detailData).pct }}%）</span></div>
          <div class="dl__i"><span class="dl__k">状态</span><span class="dl__v">
            <el-tag v-if="slaOf(detailData).finished" size="small" type="info" effect="plain">已结单</el-tag>
            <el-tag v-else-if="slaOf(detailData).paused" size="small" type="warning" effect="plain">停表中</el-tag>
            <el-tag v-else-if="slaOf(detailData).breached" size="small" type="danger" effect="plain">已超时 {{ slaOf(detailData).overdueHours }}h</el-tag>
            <el-tag v-else size="small" type="success" effect="plain">计时中</el-tag>
          </span></div>
        </div>

        <div class="dl" style="margin-top:12px;">
          <div class="dl__i"><span class="dl__k">优先级</span><span class="dl__v">
            <InlineField :model-value="detailData.priority" type="select" :options="WO_PRIORITY_OPTS"
              :save="v => saveWoField('priority', v)" @update:model-value="v => detailData.priority = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">处理人</span><span class="dl__v">
            <InlineField :model-value="detailData.assignee" placeholder="请输入处理人"
              :save="v => saveWoField('assignee', v)" @update:model-value="v => detailData.assignee = v" />
          </span></div>
          <div class="dl__i is-full"><span class="dl__k">处理备注</span><span class="dl__v">
            <InlineField :model-value="detailData.remark" type="textarea" placeholder="记录处理过程 / 协调事项"
              :save="v => saveWoField('remark', v)" @update:model-value="v => detailData.remark = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">工单号</span><span class="dl__v">{{ detailData.woNo }}</span></div>
          <div class="dl__i"><span class="dl__k">类型</span><span class="dl__v">{{ detailData.type }} / {{ detailData.category }}</span></div>
          <div class="dl__i"><span class="dl__k">来源</span><span class="dl__v">{{ detailData.source }}</span></div>
          <div class="dl__i"><span class="dl__k">空间归属</span><span class="dl__v">{{ spaceText(detailData) }}</span></div>
          <div class="dl__i"><span class="dl__k">房屋</span><span class="dl__v">{{ detailData.houseName || houseName(detailData.houseId) || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">报修人</span><span class="dl__v">{{ detailData.ownerName }} {{ detailData.ownerPhone }}</span></div>
          <div class="dl__i"><span class="dl__k">派单方式</span><span class="dl__v">{{ detailData.dispatchMode || '-' }}</span></div>
          <div class="dl__i"><span class="dl__k">创建时间</span><span class="dl__v">{{ detailData.createTime }}</span></div>
          <div class="dl__i is-full"><span class="dl__k">描述</span><span class="dl__v">{{ detailData.description }}</span></div>
          <div class="dl__i"><span class="dl__k">费用</span><span class="dl__v">{{ detailData.feeType }} · ¥{{ money(detailData.totalFee || 0) }}</span></div>
          <div class="dl__i"><span class="dl__k">评价</span><span class="dl__v">{{ detailData.score ? `${detailData.score} 分` : '未评价' }}</span></div>
        </div>

        <div class="rel">
          <span class="rel__note">派单、接单、到场、完工的五段流程在 13 页「工单详情与派单」里操作，本页只做筛选与定位</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="detailData?.houseId" @click="jump('/a/houses', 'house:' + detailData.houseId)">房屋台账</el-button>
        <el-button type="primary" @click="goDetail(detailData)">打开工单详情</el-button>
      </template>
    </DetailDrawer>

    <!-- X3 批量操作：改优先级 / 指派处理人，逐条收口并给回执 -->
    <el-dialog v-model="batchVisible" title="批量操作工单" width="520">
      <div class="muted" style="font-size:12.5px;margin-bottom:10px;">
        已选 {{ picked.length }} 单。已关闭 / 已取消的工单不参与批量修改（状态流转必须走流程节点），会被单独列出。
      </div>
      <el-form label-width="96px">
        <el-form-item label="优先级">
          <el-select v-model="batchForm.priority" clearable placeholder="不修改" style="width:200px">
            <el-option v-for="p in WO_PRIORITY_OPTS" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="指派处理人">
          <el-input v-model="batchForm.assignee" clearable placeholder="不修改" style="width:200px" />
        </el-form-item>
      </el-form>
      <!-- W3 规范：内嵌表最多 10 行 + 滚动，用固定 max-height，不用 calc(100vh - Npx) -->
      <el-table :data="picked" size="small" max-height="200">
        <el-table-column prop="woNo" label="工单号" width="130" />
        <el-table-column prop="status" label="状态" width="86">
          <template #default="{ row }"><StatusTag domain="workOrder" :value="row.status" /></template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="72" />
        <el-table-column prop="assignee" label="处理人" min-width="100" />
      </el-table>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!batchDirty" @click="doBatch">执行（{{ picked.length }}）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PAGE_SIZES, WO_PRIORITY_OPTS, batchUpdateWorkOrders, cashierBuildingOpts, cashierUnitOpts, communities,
  getWorkOrder, houseName, queryWorkOrders, updateWorkOrderField, woQuerySummary, woSatisfaction, woScopeSummary,
  woSlaState, woVirtualNodes
} from '@/api'
import { woTypeOpts } from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { useFocusLanding } from '@/composables/useFocus'
import QuickViews from '@/components/QuickViews.vue'
import ScopeFilter from '@/components/ScopeFilter.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import InlineField from '@/components/InlineField.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'

const router = useRouter()
const BLANK = { communityId: '', buildingId: '', unitId: '', vf: '', status: '', type: '', priority: '', nohouse: false, kw: '' }

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryWorkOrders, { immediate: false, filters: { ...BLANK } }
)

const summary = woQuerySummary()
const sat = woSatisfaction()
/* 快捷视图：原左树的虚拟视图节点搬到这里 */
const quickViews = [{ key: '', label: '全部', n: summary.total }, ...woVirtualNodes()]
const statusOpts = ['待派单', '已派单', '处理中', '待确认', '已完工', '已评价', '已关闭', '已取消']
const typeOpts = woTypeOpts()
const priorityOpts = ['特急', '紧急', '普通']

/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'woId', label: '工单号' }, { prop: 'title', label: '标题' },
  { prop: 'type', label: '类型' }, { prop: 'serviceName', label: '服务项目' },
  { prop: 'totalFee', label: '服务费' }, { prop: 'payStatus', label: '收款' }, { prop: 'houseName', label: '房屋' },
  { prop: 'status', label: '状态' }, { prop: 'priority', label: '优先级' },
  { prop: 'assignee', label: '处理人' }, { prop: 'isOverdueText', label: '超时' },
  { prop: 'createTime', label: '创建时间' }
]
function onExport() {
  exportList({ name: '工单列表', source: '/f/workorders', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

/* SLA 按工作日历算，列表 20 行每行算一次代价不小 → 按 createTime+状态 缓存 */
const slaCache = new Map()
function slaOf(wo) {
  if (!wo) return { leftHours: 0, overdueHours: 0, pct: 0, breached: false, paused: false, finished: false, dueAt: '', usedHours: 0 }
  const key = `${wo.woId}|${wo.status}|${wo.finishTime || ''}`
  if (!slaCache.has(key)) slaCache.set(key, woSlaState(wo))
  return slaCache.get(key)
}

const highlightId = ref('')
const vnLabel = computed(() => (query.vf ? (quickViews.find(v => v.key === query.vf)?.label || '') : ''))

/* 当前范围小计 */
const scopeSum = ref({ count: 0, open: 0, overdue: 0, pending: 0, nohouse: 0 })
/* 小计与列表同源：越权/异常时不能让页面抛未捕获异常——列表已把 403 提示出来，这里静默归零 */
async function syncScopeSum() {
  try { scopeSum.value = await woScopeSummary({ ...query }) }
  catch { scopeSum.value = Object.fromEntries(Object.keys(scopeSum.value).map(k => [k, 0])) }
}
function run() { search(); syncScopeSum() }

const onlyNoHouse = ref(false)
function onNoHouse(v) { query.nohouse = !!v; run() }

const hasScope = computed(() => !!(query.communityId || query.buildingId || query.unitId || query.vf ||
  query.status || query.type || query.priority || query.nohouse || query.kw))
const scopeText = computed(() => {
  const b = cashierBuildingOpts(query.communityId).find(x => x.value === query.buildingId)?.label
  const u = cashierUnitOpts(query.buildingId).find(x => x.value === query.unitId)?.label
  if (b) return [b, u].filter(Boolean).join(' · ')
  return communities.find(x => x.communityId === query.communityId)?.name || '全部工单'
})
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getWorkOrder)

/* X3 批量操作：勾选后批量改优先级 / 指派处理人 */
const moreOpen = ref(false)
/* 快捷视图：点已选中的再点一次取消 */
function pickView(v) {
  query.vf = query.vf === v.key ? '' : v.key
  run()
}
/* 「更多筛选」角标：只数为折叠起来的条件 */
const extraCount = computed(() =>
  (query.status ? 1 : 0) + (query.type ? 1 : 0) + (query.priority ? 1 : 0) + (onlyNoHouse.value ? 1 : 0))

const picked = ref([])
const batchVisible = ref(false)
const batchForm = ref({ priority: '', assignee: '' })
const batchDirty = computed(() => !!(batchForm.value.priority || String(batchForm.value.assignee || '').trim()))
function openBatch() {
  if (!picked.value.length) return
  batchForm.value = { priority: '', assignee: '' }
  batchVisible.value = true
}
async function doBatch() {
  try {
    const r = batchUpdateWorkOrders(picked.value.map(w => w.woId), {
      priority: batchForm.value.priority,
      assignee: String(batchForm.value.assignee || '').trim()
    })
    await ElMessageBox.alert(
      `${r.message}。${r.failed.length ? '被拦截：' + r.failed.map(f => `${f.woNo}（${f.reason}）`).join('、') : ''}`,
      '批量操作结果', { type: r.failed.length ? 'warning' : 'success' }
    )
    batchVisible.value = false
    picked.value = []
    search()
  } catch (e) { if (e?.message && e !== 'cancel') ElMessage.error(e.message) }
}

/* X2 内联编辑：优先级 / 处理人 / 处理备注；状态流转仍走详情页流程按钮，不在此放开 */
async function saveWoField(field, v) {
  const r = await updateWorkOrderField(detailData.value.woId, field, v)
  Object.assign(detailData.value, r)
  search()
  ElMessage.success(`已更新${field === 'priority' ? '优先级' : field === 'assignee' ? '处理人' : '处理备注'}`)
}

function clearScope() {
  Object.assign(query, BLANK)
  onlyNoHouse.value = false
  run()
}
function onResetAll() {
  Object.assign(query, BLANK)
  onlyNoHouse.value = false
  reset()
  syncScopeSum()
}

function onRow(row) { openDetail(row.woId) }
function rowClass({ row }) { return row.woId === highlightId.value ? 'row--focus' : '' }
/** 房屋全名带项目前缀（翡翠城 1栋1单元0501），项目已在副行给出，主行只留房号 */
function houseShort(name) {
  const s = String(name || '')
  const i = s.indexOf(' ')
  return i > 0 ? s.slice(i + 1) : s
}
function spaceText(w) {
  if (!w.houseId) return `${w.communityName} · 公共 / 非入户`
  return [w.communityName, w.buildingName, w.unitName].filter(Boolean).join(' / ') || w.communityName
}
function goDetail(row) {
  router.push(row ? { path: '/f/wo-detail', query: { id: row.woId } } : '/f/wo-detail')
}
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }
function jump(path, focus) { router.push(`${path}?focus=${focus}&open=1`) }

/* 落地：房屋台账跳过来带 house:房号；带 wo:工单号 则落到对应楼栋并开抽屉 */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  if (focus?.type === 'house' && location) {
    Object.assign(query, BLANK)
    Object.assign(query, {
      communityId: location.communityId || '', buildingId: location.buildingId || '', unitId: location.unitId || ''
    })
    await load()
    await syncScopeSum()
    return
  }
  if (focus?.type === 'wo' && location) {
    Object.assign(query, BLANK)
    Object.assign(query, {
      communityId: location.communityId || '', buildingId: location.buildingId || '', unitId: location.unitId || ''
    })
    await load()
    await syncScopeSum()
    highlightId.value = location.woId || ''
    if (open && location.woId) openDetail(location.woId)
    return
  }
  Object.assign(query, BLANK)
  onlyNoHouse.value = false
  await load()
  await syncScopeSum()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.is-warn-text { color: var(--biz-warning); }
.is-warn { color: var(--biz-danger); }
.wos { display: inline-flex; align-items: baseline; gap: 6px; font-size: 12px; color: #d98c1b; }
.wos__stars { font-style: normal; letter-spacing: .5px; }
.wos__off { color: var(--biz-border); }
.wos b { font-family: var(--biz-font-num); color: var(--biz-text-2); font-weight: 600; }
.wos.is-low, .wos.is-low b { color: #a33; }

/* ===== 与账单页一致的骨架样式 ===== */
.bl-page { height: 100%; display: flex; flex-direction: column; }
.bl-main { flex: 1; min-height: 0; display: flex; flex-direction: column; min-width: 0; padding: 12px 24px 0; }
.bl-bar { display: flex; align-items: center; gap: 8px; height: 40px; margin-bottom: 4px; }
.bl-search { flex: 0 0 268px; }
.bl-chips { display: flex; align-items: center; gap: 2px; }
.bl-chip {
  appearance: none; border: 0; background: transparent; height: 32px; padding: 0 11px;
  border-radius: 999px; font-size: 12.5px; color: var(--biz-text-2); cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
}
.bl-chip:hover { background: #F4F5F9; }
.bl-chip.is-on { background: #fff; color: var(--biz-text-1); font-weight: 500; box-shadow: 0 1px 2px rgba(16,24,40,.08); }
.bl-chip-n { font-size: 11px; color: var(--biz-text-4); font-variant-numeric: tabular-nums; }
.bl-chip.is-on .bl-chip-n { color: var(--el-color-primary); }
.bl-more {
  appearance: none; border: 0; background: transparent; height: 32px; padding: 0 10px;
  border-radius: 8px; font-size: 12.5px; color: var(--el-color-primary); cursor: pointer; font-family: inherit; white-space: nowrap;
}
.bl-more:hover, .bl-more.is-on { background: #EEF0FF; }
.bl-caret { margin-left: 4px; font-size: 10px; }
.bl-ibtn {
  appearance: none; border: 0; background: transparent; width: 28px; height: 28px;
  border-radius: 8px; color: var(--biz-text-4); font-size: 15px; cursor: pointer; font-family: inherit;
}
.bl-ibtn:hover { background: #F1F2F6; color: var(--el-color-primary); }
.bl-morepanel { background: #fff; border: 1px solid #F0F2F6; border-radius: 12px; padding: 14px 18px 2px; margin-bottom: 12px; }
.bl-moreform :deep(.el-form-item) { margin-bottom: 12px; margin-right: 26px; }
.bl-exp-enter-active, .bl-exp-leave-active { transition: opacity .16s ease, transform .16s ease; }
.bl-exp-enter-from, .bl-exp-leave-to { opacity: 0; transform: translateY(-4px); }
.bl-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
.bl-kpi { background: #fff; border-radius: 14px; padding: 13px 16px 11px; }
.bl-kpi-ic { width: 28px; height: 28px; border-radius: 9px; background: #F4F5F9; display: grid; place-items: center; font-size: 14px; color: #616A7D; }
.bl-kpi-ic.is-dan { background: #FDECEF; color: var(--biz-danger); }
.bl-kpi-v { font-size: 26px; font-weight: 600; letter-spacing: -.02em; margin-top: 6px; color: var(--biz-text-1); font-variant-numeric: tabular-nums; }
.bl-kpi-v.is-dan { color: var(--biz-danger); }
.bl-kpi-u { font-size: 12px; font-weight: 400; color: var(--biz-text-3); margin-left: 3px; }
.bl-kpi-l { font-size: 12px; color: var(--biz-text-3); margin-top: 4px; display: flex; align-items: center; gap: 6px; }
.bl-info { font-size: 14px; color: var(--biz-text-4); cursor: pointer; }
.bl-info.is-sm { font-size: 12px; }
.bl-tip { font-size: 12.5px; line-height: 1.8; color: var(--biz-text-2); }
.bl-tip b { color: var(--biz-text-1); font-weight: 500; }
.bl-scope { display: flex; align-items: center; gap: 10px; height: 30px; margin-bottom: 4px; }
.bl-scope-t { font-size: 12.5px; color: var(--biz-text-1); font-weight: 500; }
.bl-scope-d { font-size: 12px; color: var(--biz-text-3); font-variant-numeric: tabular-nums; }
.bl-scope-d b { color: var(--biz-text-1); font-weight: 500; }
.bl-scope-tag { font-size: 11.5px; color: var(--el-color-primary); background: #EEF0FF; border-radius: 999px; padding: 1px 8px; }
.bl-scope-page { font-size: 11.5px; color: var(--biz-text-4); font-variant-numeric: tabular-nums; }
.bl-table { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.bl-tblwrap { flex: 1; min-height: 0; overflow: hidden; }
.bl-tbl { --el-table-bg-color: transparent; --el-table-tr-bg-color: transparent; --el-table-header-bg-color: transparent; background: transparent; }
.bl-tbl :deep(.el-table__inner-wrapper), .bl-tbl :deep(.el-table__body-wrapper), .bl-tbl :deep(.el-table__header-wrapper) { background: transparent; }
.bl-tbl :deep(.el-table__header th) {
  background: transparent; font-weight: 400; font-size: 12px; color: var(--biz-text-3);
  border-bottom: 1px solid #F0F2F6; height: 38px; padding: 0;
}
.bl-tbl :deep(.el-table__row td) { height: 46px; padding: 0; border-bottom: 1px solid #F6F7FA; font-size: 13px; }
.bl-tbl :deep(.el-table__row:hover > td) { background: #F2F4FF; }
.bl-tbl :deep(.el-table__inner-wrapper::before) { display: none; }
.bl-id { font-size: 12px; color: var(--biz-text-3); font-variant-numeric: tabular-nums; }
.bl-addr { color: var(--biz-text-1); }
.bl-subj { color: var(--biz-text-3); font-size: 12.5px; }
.bl-st :deep(.el-tag) { background: transparent !important; border: 0 !important; padding: 0 !important; height: auto !important; font-size: 12.5px; }
.bl-st :deep(.el-tag)::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; margin-right: 6px; vertical-align: 1px; }
.bl-foot { display: flex; justify-content: flex-end; padding: 10px 0 0; }
</style>
