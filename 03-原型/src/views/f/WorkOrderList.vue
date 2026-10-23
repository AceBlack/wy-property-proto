<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>工单列表 · 以「一张工单」为行</b>：树走<b>项目 → 楼栋 → 单元</b>，与房屋台账同源。
        只有入户维修类带房屋（约两成），公共区域 / 投诉 / 咨询类没有房屋归属，统一挂在项目的
        <b>「公共 / 非入户工单」</b>分支下——不挂的话这部分工单在树视图里会凭空消失。
        <b>{{ summary.overdue }} 单已超时</b>、<b>{{ summary.pending }} 单待派单</b>进树即可见。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">工单总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">单</span></div></div>
        <div class="dstat"><div class="dstat__k">未闭环</div><div class="dstat__v" :class="summary.open > 0 ? 'is-warn' : ''">{{ summary.open }}<span class="unit">单</span></div></div>
        <div class="dstat"><div class="dstat__k">已超时</div><div class="dstat__v" :class="summary.overdue > 0 ? 'is-warn' : ''">{{ summary.overdue }}<span class="unit">单</span></div></div>
        <div class="dstat"><div class="dstat__k">待派单</div><div class="dstat__v" :class="summary.pending > 0 ? 'is-warn' : ''">{{ summary.pending }}<span class="unit">单</span></div></div>
      </div>
      <div class="sum-note">
        口径：未闭环 = 待派单 / 已派单 / 处理中 / 待确认四态；已超时按 SLA 截止时间判定，与工单驾驶舱同源。
      </div>
    </div>

    <div class="ia" :class="{ 'is-collapsed': treeCollapsed }" style="margin-top:16px;">
      <div class="ia__tree">
        <SpaceTree
          title="工单范围" tree-title="项目 / 楼栋 / 单元"
          :nodes="tree" :virtual="vnodes"
          placeholder="搜项目 / 楼栋"
          :active-id="activeId" :active-vn="activeVn"
          @pick="onPick" @collapse="treeCollapsed = true"
        />
      </div>

      <div class="ia__main">
        <el-button v-if="treeCollapsed" class="ia__handle" size="small" :icon="'Expand'" @click="treeCollapsed = false">
          展开楼栋树
        </el-button>

        <div class="panel">
          <div class="scopebar">
            <template v-if="scopePath.length">
              <span v-for="(p, i) in scopePath" :key="p">
                <span class="scopebar__i" :class="{ 'is-last': i === scopePath.length - 1 }" @click="onCrumb(i)">{{ p }}</span>
                <span v-if="i < scopePath.length - 1" class="scopebar__sep">/</span>
              </span>
            </template>
            <span v-else class="scopebar__i is-last">全部工单</span>
            <span v-if="activeVn" class="scopebar__vf">{{ vnLabel }}</span>
            <span class="spacer" />
            <span class="scopebar__hint">树定范围 · 筛选定属性</span>
            <el-button link type="primary" @click="clearScope">清除范围</el-button>
          </div>

          <el-form :model="query" class="filter-bar" label-width="40px" @submit.prevent>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width:80px">
                <el-option v-for="s in statusOpts" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="query.type" placeholder="全部" clearable style="width:96px">
                <el-option v-for="t in typeOpts" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
            <el-form-item label="优先级">
              <el-select v-model="query.priority" placeholder="全部" clearable style="width:76px">
                <el-option v-for="p in priorityOpts" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="工单号 / 标题 / 师傅" clearable style="width:120px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="onResetAll">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Plus'" @click="$router.push('/f/workorders/new')">发起工单</el-button>
            <el-button :icon="'MagicStick'" :disabled="!picked.length" @click="openBatch">
              批量操作{{ picked.length ? `（${picked.length}）` : '' }}
            </el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <span v-if="picked.length" class="muted" style="font-size:12.5px;">已选 {{ picked.length }} 单</span>
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 单</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 470px)"
            :row-class-name="rowClass" @row-click="onRow" @selection-change="l => picked = l">
            <el-table-column type="selection" width="46" />
            <el-table-column label="工单号" min-width="104">
              <template #default="{ row }">
                <div class="nowrap">{{ row.woNo }}</div>
                <div class="ps-sub">{{ row.communityName }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="标题" min-min-width="200" show-overflow-tooltip />
            <el-table-column prop="type" label="类型" min-width="96" show-overflow-tooltip />
            <el-table-column label="房屋" min-min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.houseId">{{ houseShort(row.houseName || houseName(row.houseId)) }}</span>
                <span v-else class="ps-sub">公共 / 非入户</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" min-width="86">
              <template #default="{ row }"><StatusTag domain="workOrder" :value="row.status" /></template>
            </el-table-column>
            <el-table-column prop="priority" label="优先级" min-width="72">
              <template #default="{ row }">
                <span :class="{ 'is-warn-text': row.priority === '特急' || row.priority === '紧急' }">{{ row.priority }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="assignee" label="处理人" min-width="82" show-overflow-tooltip>
              <template #default="{ row }">{{ row.assignee || '待派单' }}</template>
            </el-table-column>
            <el-table-column label="超时" min-width="66" align="right">
              <template #default="{ row }">
                <span v-if="row.isOverdue" class="money money--out">已超时</span>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="66" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="goDetail(row)">详情</el-button>
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
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.title"
      :subtitle="detailData ? `${detailData.woNo} · ${detailData.type}` : ''"
      :status="detailData?.status" status-domain="workOrder"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">优先级</div><div class="dstat__v" style="font-size:15px;">{{ detailData.priority }}</div></div>
          <div class="dstat"><div class="dstat__k">SLA</div><div class="dstat__v">{{ detailData.slaHours }}<span class="unit">小时</span></div></div>
          <div class="dstat"><div class="dstat__k">处理人</div><div class="dstat__v" style="font-size:15px;">{{ detailData.assignee || '待派单' }}</div></div>
          <div class="dstat"><div class="dstat__k">是否超时</div><div class="dstat__v" :class="detailData.isOverdue ? 'is-warn' : ''">{{ detailData.isOverdue ? '已超时' : '正常' }}</div></div>
        </div>

        <div class="dl" style="margin-top:18px;">
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
  PAGE_SIZES, WO_PRIORITY_OPTS, batchUpdateWorkOrders, getWorkOrder, houseName,
  queryWorkOrders, updateWorkOrderField, woQuerySummary, woTree, woVirtualNodes
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { pathOf, useFocusLanding } from '@/composables/useFocus'
import SpaceTree from '@/components/SpaceTree.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import InlineField from '@/components/InlineField.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'

const router = useRouter()
const BLANK = { communityId: '', buildingId: '', unitId: '', vf: '', status: '', type: '', priority: '', kw: '' }

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryWorkOrders, { immediate: false, filters: { ...BLANK } }
)

const tree = woTree()
const vnodes = woVirtualNodes()
const summary = woQuerySummary()
const statusOpts = ['待派单', '已派单', '处理中', '待确认', '已完工', '已评价', '已关闭', '已取消']
const typeOpts = ['入户维修', '公共区域维修', '投诉建议', '咨询', '报事', '其他']
const priorityOpts = ['特急', '紧急', '普通']

/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'woId', label: '工单号' }, { prop: 'title', label: '标题' },
  { prop: 'type', label: '类型' }, { prop: 'houseName', label: '房屋' },
  { prop: 'status', label: '状态' }, { prop: 'priority', label: '优先级' },
  { prop: 'assignee', label: '处理人' }, { prop: 'isOverdueText', label: '超时' },
  { prop: 'createTime', label: '创建时间' }
]
function onExport() {
  exportList({ name: '工单列表', source: '/f/workorders', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const treeCollapsed = ref(false)
const activeId = ref('')
const activeChain = ref([])
const activeVn = ref('')
const scopePath = ref([])
const highlightId = ref('')

const vnLabel = computed(() => vnodes.find(v => v.key === activeVn.value)?.label || '')
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getWorkOrder)

/* X3 批量操作：勾选后批量改优先级 / 指派处理人 */
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

function onRow(row) { openDetail(row.woId) }
function rowClass({ row }) { return row.woId === highlightId.value ? 'row--focus' : '' }
/** 房屋全名带项目前缀（翡翠城 1栋1单元0501），项目已在副行与左树给出，主行只留房号 */
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
    activeId.value = location.unitId || location.buildingId || location.communityId || ''
    activeChain.value = [location.communityId, location.buildingId, location.unitId].filter(Boolean)
    scopePath.value = pathOf(tree, activeId.value)
    await load()
    return
  }
  if (focus?.type === 'wo' && location) {
    Object.assign(query, BLANK)
    Object.assign(query, {
      communityId: location.communityId || '', buildingId: location.buildingId || '', unitId: location.unitId || ''
    })
    activeId.value = location.unitId || location.buildingId || location.communityId || ''
    activeChain.value = [location.communityId, location.buildingId, location.unitId].filter(Boolean)
    activeVn.value = ''
    scopePath.value = pathOf(tree, activeId.value)
    await load()
    highlightId.value = location.woId || ''
    if (open && location.woId) openDetail(location.woId)
    return
  }
  clearScope()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.is-warn-text { color: var(--biz-warning); }
.is-warn { color: var(--biz-danger); }
</style>
