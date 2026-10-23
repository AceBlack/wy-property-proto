<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>通行记录 · 以「一次抬杆」为行</b>：车行流水是车位与收费的对账依据。树只到<b>项目 → 车库区域</b>两级——
        道闸跨项目复用（同一个「南门」在三个项目都有），进树会产生同名重复叶子，改走筛选；
        <b>{{ summary.manualCount }} 条人工放行</b>进树即可见，人工抬杆是对账舞弊点，必须可抽查。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">通行总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">次</span></div></div>
        <div class="dstat"><div class="dstat__k">入场 / 出场</div><div class="dstat__v" style="font-size:15px;">{{ summary.inCount }} / {{ summary.outCount }}</div></div>
        <div class="dstat"><div class="dstat__k">人工放行</div><div class="dstat__v" :class="summary.manualCount > 0 ? 'is-warn' : ''">{{ summary.manualCount }}<span class="unit">次</span></div></div>
        <div class="dstat"><div class="dstat__k">临停收费</div><div class="dstat__v">¥ {{ money(summary.feeTotal) }}</div></div>
      </div>
      <div class="sum-note">
        口径：进出严格成对（各 {{ summary.inCount }} / {{ summary.outCount }} 次）；临停收费只统计出场时计费的 {{ PASS_FEE_N }} 条，月卡与业主车辆免费放行不计。
      </div>
    </div>

    <div class="ia" :class="{ 'is-collapsed': treeCollapsed }" style="margin-top:16px;">
      <div class="ia__tree">
        <SpaceTree
          title="通行范围" tree-title="项目 / 车库区域"
          :nodes="tree" :virtual="vnodes"
          placeholder="搜项目 / 车库"
          :active-id="activeId" :active-vn="activeVn"
          @pick="onPick" @collapse="treeCollapsed = true"
        />
      </div>

      <div class="ia__main">
        <el-button v-if="treeCollapsed" class="ia__handle" size="small" :icon="'Expand'" @click="treeCollapsed = false">
          展开车库树
        </el-button>

        <div class="panel">
          <div class="scopebar">
            <template v-if="scopePath.length">
              <span v-for="(p, i) in scopePath" :key="p">
                <span class="scopebar__i" :class="{ 'is-last': i === scopePath.length - 1 }" @click="onCrumb(i)">{{ p }}</span>
                <span v-if="i < scopePath.length - 1" class="scopebar__sep">/</span>
              </span>
            </template>
            <span v-else class="scopebar__i is-last">全部车库</span>
            <span v-if="activeVn" class="scopebar__vf">{{ vnLabel }}</span>
            <span v-if="query.kw" class="scopebar__vf">车牌 {{ query.kw }}</span>
            <span class="spacer" />
            <span class="scopebar__hint">树定范围 · 筛选定属性</span>
            <el-button link type="primary" @click="clearScope">清除范围</el-button>
          </div>

          <el-form :model="query" class="filter-bar" label-width="40px" @submit.prevent>
            <el-form-item label="方向">
              <el-select v-model="query.direction" placeholder="全部" clearable style="width:76px">
                <el-option v-for="o in dirOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="道闸">
              <el-select v-model="query.gate" placeholder="全部" clearable style="width:96px">
                <el-option v-for="o in gateOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="识别">
              <el-select v-model="query.channel" placeholder="全部" clearable style="width:84px">
                <el-option v-for="o in channelOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="车牌 / 车位 / 业主" clearable style="width:120px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="onResetAll">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-date-picker v-model="query.range" type="daterange" unlink-panels
              start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" style="width:220px" />
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <el-button :icon="'Aim'" @click="quick('入场')">只看入场</el-button>
            <el-button :icon="'Aim'" @click="quick('出场')">只看出场</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 条</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 470px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column label="记录号" min-width="100">
              <template #default="{ row }">
                <div class="nowrap">{{ row.passId }}</div>
                <div class="ps-sub">{{ row.communityName }}</div>
              </template>
            </el-table-column>
            <el-table-column label="通行时间" min-min-width="130">
              <template #default="{ row }">
                <div class="nowrap">{{ row.passTime }}</div>
                <div class="ps-sub">
                  <el-tag size="small" :type="row.direction === '入场' ? 'success' : 'warning'" effect="plain">
                    {{ row.direction }}
                  </el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="plateNo" label="车牌号" min-min-width="120" />
            <el-table-column prop="parkNo" label="车位" min-width="74" />
            <el-table-column prop="ownerName" label="业主" min-width="84" show-overflow-tooltip />
            <el-table-column prop="gate" label="道闸" min-width="96" show-overflow-tooltip />
            <el-table-column prop="channel" label="识别" min-width="88">
              <template #default="{ row }">
                <span :class="{ 'is-warn-text': row.channel === '人工' }">{{ row.channel }}</span>
              </template>
            </el-table-column>
            <el-table-column label="停留 / 费用" min-width="100" align="right">
              <template #default="{ row }">
                <div class="nowrap">{{ row.stayMinutes || 0 }} 分钟</div>
                <div class="ps-sub">{{ row.fee > 0 ? '¥ ' + money(row.fee) : '免费放行' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="68" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <EmptyState type="search" desc="换个筛选条件，或清除范围重新查看">
                <template #action><el-button @click="onResetAll">清除筛选条件</el-button></template>
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
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.record?.plateNo"
      :subtitle="detailData ? `${detailData.record.passId} · ${detailData.record.direction} · ${detailData.record.passTime}` : ''"
      :tag="detailData?.record?.channel"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">通行方向</div><div class="dstat__v" style="font-size:15px;">{{ detailData.record.direction }}</div></div>
          <div class="dstat"><div class="dstat__k">停留时长</div><div class="dstat__v">{{ detailData.record.stayMinutes || 0 }}<span class="unit">分钟</span></div></div>
          <div class="dstat"><div class="dstat__k">收费</div><div class="dstat__v">¥ {{ money(detailData.record.fee) }}</div></div>
          <div class="dstat"><div class="dstat__k">车位</div><div class="dstat__v" style="font-size:15px;">{{ detailData.record.parkNo }}</div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>通行信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">记录号</span><span class="dl__v">{{ detailData.record.passId }}</span></div>
          <div class="dl__i"><span class="dl__k">通行时间</span><span class="dl__v">{{ detailData.record.passTime }}</span></div>
          <div class="dl__i"><span class="dl__k">所属项目</span><span class="dl__v">{{ detailData.record.communityName }}</span></div>
          <div class="dl__i"><span class="dl__k">车库区域</span><span class="dl__v">{{ detailData.record.zoneLabel }}</span></div>
          <div class="dl__i"><span class="dl__k">道闸</span><span class="dl__v">{{ detailData.record.gate }}</span></div>
          <div class="dl__i"><span class="dl__k">识别方式</span>
            <span class="dl__v" :class="{ 'is-expire': detailData.record.channel === '人工' }">{{ detailData.record.channel }}</span>
          </div>
          <div class="dl__i"><span class="dl__k">车辆类型</span><span class="dl__v">{{ detailData.record.vehicleType || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">操作人</span><span class="dl__v">{{ detailData.record.operator }}</span></div>
          <div class="dl__i"><span class="dl__k">业主</span><span class="dl__v">{{ detailData.owner?.name || detailData.record.ownerName || '—' }}</span></div>
        </div>

        <template v-if="detailData.vehicle">
          <div class="sec__hd" style="margin-top:18px;"><h4>车辆信息</h4><span class="desc">{{ detailData.vehicle.vehicleId }}</span></div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">车牌</span><span class="dl__v">{{ detailData.vehicle.plateNo }}</span></div>
            <div class="dl__i"><span class="dl__k">品牌</span><span class="dl__v">{{ detailData.vehicle.brand }} · {{ detailData.vehicle.color }}</span></div>
            <div class="dl__i"><span class="dl__k">进出类型</span><span class="dl__v">{{ detailData.vehicle.inOutType }}</span></div>
            <div class="dl__i"><span class="dl__k">授权状态</span><span class="dl__v"><StatusTag domain="vehicle" :value="detailData.vehicle.authStatus" /></span></div>
          </div>
        </template>

        <div v-if="detailData.siblings.length" style="margin-top:18px;">
          <div class="sec__hd"><h4>同车牌其他记录</h4><span class="desc">{{ detailData.siblings.length }} 条</span></div>
          <el-table :data="detailData.siblings" size="small">
            <el-table-column prop="passTime" label="时间" width="130" />
            <el-table-column prop="direction" label="方向" width="80" />
            <el-table-column prop="gate" label="道闸" min-width="120" show-overflow-tooltip />
            <el-table-column label="停留" width="90" align="right">
              <template #default="{ row }">{{ row.stayMinutes || 0 }} 分钟</template>
            </el-table-column>
            <el-table-column label="费用" width="90" align="right">
              <template #default="{ row }"><span class="money">¥ {{ money(row.fee) }}</span></template>
            </el-table-column>
          </el-table>
        </div>

        <div class="rel">
          <span class="rel__note">车行流水按 parkId 反查车位才知道车库归属，本页与车位台账共用同一套车库区域口径</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="detailData?.record?.parkId" @click="jump('/a/vehicles', 'park:' + detailData.record.parkId)">车位与车辆</el-button>
        <el-button v-if="detailData?.record?.ownerId" @click="jump('/a/owners', 'owner:' + detailData.record.ownerId)">业主档案</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, getPassRecordDetail, passChannelOpts, passDirectionOpts, passGateOpts,
  passSummary, passTree, passVirtualNodes, queryPassRecords
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { pathOf, useFocusLanding } from '@/composables/useFocus'
import SpaceTree from '@/components/SpaceTree.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()
const BLANK = { communityId: '', zone: '', vf: '', direction: '', gate: '', channel: '', kw: '' }

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryPassRecords, { immediate: false, filters: { ...BLANK, range: null } }
)

const tree = passTree()
const vnodes = passVirtualNodes()
const summary = passSummary()
const PASS_FEE_N = vnodes.find(v => v.key === 'paid')?.n || 0
const dirOpts = passDirectionOpts()
const gateOpts = passGateOpts()
const channelOpts = passChannelOpts()

/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'passId', label: '记录号' }, { prop: 'passTime', label: '通行时间' },
  { prop: 'plateNo', label: '车牌号' }, { prop: 'parkNo', label: '车位' },
  { prop: 'ownerName', label: '业主' }, { prop: 'gate', label: '道闸' },
  { prop: 'direction', label: '方向' }, { prop: 'channel', label: '识别方式' },
  { prop: 'fee', label: '费用' }
]
function onExport() {
  exportList({ name: '通行记录', source: '/d/pass-records', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const treeCollapsed = ref(false)
const activeId = ref('')
const activeChain = ref([])
const activeVn = ref('')
const scopePath = ref([])
const highlightId = ref('')

const vnLabel = computed(() => vnodes.find(v => v.key === activeVn.value)?.label || '')
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getPassRecordDetail)

const flatNode = new Map()
;(function flatten(list) {
  list.forEach(n => {
    flatNode.set(n.id, n)
    if (n.children?.length) flatten(n.children)
  })
})(tree)

function onPick(node) {
  Object.assign(query, BLANK)
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
  Object.assign(query, BLANK)
  Object.assign(query, node.patch)
  activeId.value = node.id
  activeChain.value = activeChain.value.slice(0, index + 1)
  scopePath.value = scopePath.value.slice(0, index + 1)
  activeVn.value = ''
  search()
}
function clearScope() {
  Object.assign(query, BLANK)
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  search()
}
function onResetAll() {
  reset()
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
}

function onRow(row) { openDetail(row.passId) }
function rowClass({ row }) { return row.passId === highlightId.value ? 'row--focus' : '' }
function quick(direction) { query.direction = direction; search() }
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }
function jump(path, focus) { router.push(`${path}?focus=${focus}&open=1`) }

/* 落地：车位页跳过来带 plate:车牌（走关键字）；带 pass:记录号 则落到对应车库 */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  if (focus?.type === 'plate') { clearScope(); query.kw = focus.id; await load(); return }
  if (focus?.type === 'pass' && location) {
    Object.assign(query, BLANK)
    Object.assign(query, { communityId: location.communityId || '', zone: location.zone || '' })
    activeId.value = [location.communityId, location.zone].filter(Boolean).join(':')
    activeChain.value = [location.communityId, activeId.value].filter(Boolean)
    activeVn.value = ''
    scopePath.value = pathOf(tree, activeId.value)
    await load()
    highlightId.value = location.passId || ''
    if (open && location.passId) openDetail(location.passId)
    return
  }
  clearScope()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-sub :deep(.el-tag) { transform: scale(0.9); transform-origin: left center; }
.is-warn-text { color: var(--biz-warning); }
.is-expire { color: var(--biz-warning); }
</style>
