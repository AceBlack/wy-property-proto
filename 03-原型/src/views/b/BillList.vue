<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>账单查询 · 以「一张账单」为行</b>：树走<b>项目 → 楼栋 → 单元</b>，与房屋台账、缴费流水同源。
        车位账单上溯不到楼栋，单独挂在项目的「车位账单」分支下；<b>{{ summary.debtCount }} 张有欠费</b>、
        <b>{{ summary.overdueCount }} 张已逾期</b>进树即可见——催缴的第一诉求是「按楼栋找出谁没交」。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">账单总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">张</span></div></div>
        <div class="dstat"><div class="dstat__k">应收合计</div><div class="dstat__v">¥ {{ wan(summary.payable) }}</div></div>
        <div class="dstat"><div class="dstat__k">欠费合计</div><div class="dstat__v is-warn">¥ {{ wan(summary.unpaid) }}</div></div>
        <div class="dstat"><div class="dstat__k">有欠费账单</div><div class="dstat__v" :class="summary.debtCount > 0 ? 'is-warn' : ''">{{ summary.debtCount }}<span class="unit">张</span></div></div>
      </div>
      <div class="sum-note">
        口径：欠费 = 未缴 / 部分缴 / 逾期 三类账单的未收金额之和，已减免与已作废不计入；与费用驾驶舱同源。
      </div>
    </div>

    <div class="ia" :class="{ 'is-collapsed': treeCollapsed }" style="margin-top:16px;">
      <div class="ia__tree">
        <SpaceTree
          title="账单范围" tree-title="项目 / 楼栋 / 单元"
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
            <span v-else class="scopebar__i is-last">全部账单</span>
            <span v-if="activeVn" class="scopebar__vf">{{ vnLabel }}</span>
            <span v-if="query.kw" class="scopebar__vf">账单 {{ query.kw }}</span>
            <span class="spacer" />
            <span class="scopebar__hint">树定范围 · 筛选定属性</span>
            <el-button link type="primary" @click="clearScope">清除范围</el-button>
          </div>

          <el-form :model="query" class="filter-bar" label-width="40px" @submit.prevent>
            <el-form-item label="科目">
              <el-select v-model="query.itemId" placeholder="全部" clearable style="width:104px">
                <el-option v-for="i in feeItems" :key="i.itemId" :label="i.name" :value="i.itemId" />
              </el-select>
            </el-form-item>
            <el-form-item label="账期">
              <el-select v-model="query.period" placeholder="全部" clearable style="width:80px">
                <el-option v-for="p in periodOpts" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width:80px">
                <el-option v-for="s in statusOpts" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="业主 / 账单号" clearable style="width:120px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="onResetAll">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Money'" @click="goCashier">去收银台</el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">
              共 {{ total }} 张 · 本页 {{ rows.length }} 张应收 ¥{{ money(pageSum.payable) }}
            </span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 470px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column prop="period" label="账期" min-width="76" />
            <el-table-column prop="itemName" label="科目" min-min-width="120" show-overflow-tooltip />
            <el-table-column label="房屋 / 车位" min-min-width="150" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="nowrap">{{ shortSubject(row) }}</div>
                <div class="ps-sub">{{ row.communityName }}</div>
              </template>
            </el-table-column>
            <el-table-column label="业主" min-width="78" show-overflow-tooltip>
              <template #default="{ row }">{{ row.ownerName || ownerName(row.ownerId) }}</template>
            </el-table-column>
            <el-table-column prop="payable" label="应收" min-width="92" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.payable) }}</span></template>
            </el-table-column>
            <el-table-column prop="unpaid" label="欠费" min-width="92" align="right">
              <template #default="{ row }">
                <span class="money" :class="{ 'money--out': row.unpaid > 0 }">{{ money(row.unpaid) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="overdueDays" label="逾期" min-width="70" align="right">
              <template #default="{ row }">{{ row.overdueDays ? `${row.overdueDays} 天` : '-' }}</template>
            </el-table-column>
            <el-table-column prop="status" label="状态" min-width="84">
              <template #default="{ row }"><StatusTag domain="bill" :value="row.status" /></template>
            </el-table-column>
            <el-table-column label="操作" width="66" fixed="right">
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
      v-model="detailVisible" :loading="detailLoading" title="账单详情"
      :subtitle="detailData ? `${detailData.bill.period} · ${detailData.bill.itemName}` : ''"
      :status="detailData?.bill?.status" status-domain="bill"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">应收</div><div class="dstat__v">¥ {{ money(detailData.bill.payable) }}</div></div>
          <div class="dstat"><div class="dstat__k">已收</div><div class="dstat__v">¥ {{ money(detailData.bill.paidAmount) }}</div></div>
          <div class="dstat"><div class="dstat__k">欠费</div><div class="dstat__v" :class="detailData.bill.unpaid > 0 ? 'is-warn' : ''">¥ {{ money(detailData.bill.unpaid) }}</div></div>
          <div class="dstat"><div class="dstat__k">逾期</div><div class="dstat__v" :class="detailData.bill.overdueDays > 0 ? 'is-warn' : ''">{{ detailData.bill.overdueDays || 0 }}<span class="unit">天</span></div></div>
        </div>

        <div class="dl" style="margin-top:18px;">
          <div class="dl__i"><span class="dl__k">账单号</span><span class="dl__v">{{ detailData.bill.billId }}</span></div>
          <div class="dl__i"><span class="dl__k">账期</span><span class="dl__v">{{ detailData.bill.period }}</span></div>
          <div class="dl__i"><span class="dl__k">房屋 / 车位</span><span class="dl__v">{{ subjectLabel(detailData.bill.houseId, detailData.bill.parkId) }}</span></div>
          <div class="dl__i"><span class="dl__k">空间归属</span><span class="dl__v">{{ spaceText(detailData.bill) }}</span></div>
          <div class="dl__i"><span class="dl__k">业主</span><span class="dl__v">{{ detailData.owner?.name || '-' }}</span></div>
          <div class="dl__i"><span class="dl__k">用量</span><span class="dl__v">{{ detailData.bill.quantity }} {{ detailData.bill.unit }}</span></div>
          <div class="dl__i"><span class="dl__k">单价</span><span class="dl__v">{{ money(detailData.bill.price) }} 元</span></div>
          <div class="dl__i"><span class="dl__k">到期日</span><span class="dl__v">{{ detailData.bill.dueDate }}</span></div>
          <div class="dl__i"><span class="dl__k">创建时间</span><span class="dl__v">{{ detailData.bill.createTime }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>缴费流水</h4><span class="desc">{{ detailData.payments.length }} 笔</span></div>
        <el-table :data="detailData.payments" size="small">
          <el-table-column prop="payTime" label="缴费时间" width="150" />
          <el-table-column prop="amount" label="金额" width="110" align="right">
            <template #default="{ row }"><span class="money">{{ money(row.amount) }}</span></template>
          </el-table-column>
          <el-table-column prop="method" label="方式" width="100" />
          <el-table-column prop="operator" label="操作人" width="100" />
          <el-table-column prop="transNo" label="交易号" min-width="150" show-overflow-tooltip />
        </el-table>
        <div v-if="!detailData.payments.length" style="padding:8px 0;">
          <EmptyState type="empty" desc="该账单暂无缴费记录" />
        </div>

        <div class="rel">
          <span class="rel__note">账单与流水共用同一套空间派生口径，两页树上的数字可以直接对账</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="detailData?.bill?.houseId" @click="jump('/a/houses', 'house:' + detailData.bill.houseId)">房屋台账</el-button>
        <el-button @click="jump('/b/payments', 'bill:' + detailData?.bill?.billId)">缴费流水</el-button>
        <el-button type="primary" @click="goCashier">去收银台缴费</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, billQuerySummary, billTree, billVirtualNodes, feeItems, getBillDetail,
  ownerName, queryBills, subjectLabel
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { pathOf, useFocusLanding } from '@/composables/useFocus'
import SpaceTree from '@/components/SpaceTree.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money, wan } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()
const BLANK = { communityId: '', buildingId: '', unitId: '', vf: '', period: '', itemId: '', status: '', kw: '' }

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryBills, { immediate: false, filters: { ...BLANK } }
)

const tree = billTree()
const vnodes = billVirtualNodes()
const summary = billQuerySummary()
const periodOpts = ['2026-10', '2026-09', '2026-08', '2026-07', '2026-06']
const statusOpts = ['已缴', '未缴', '部分缴', '逾期', '已减免']
const pageSum = computed(() =>
  rows.value.reduce((s, b) => ({ payable: s.payable + (b.payable || 0), unpaid: s.unpaid + (b.unpaid || 0) }), { payable: 0, unpaid: 0 })
)

/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'billId', label: '账单号' }, { prop: 'period', label: '账期' },
  { prop: 'itemName', label: '科目' }, { prop: 'houseName', label: '房屋 / 车位' },
  { prop: 'ownerName', label: '业主' }, { prop: 'payable', label: '应收' },
  { prop: 'paidAmount', label: '已收' }, { prop: 'unpaid', label: '欠费' },
  { prop: 'overdueDays', label: '逾期天数' }, { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '账单查询', source: '/b/bills', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const treeCollapsed = ref(false)
const activeId = ref('')
const activeChain = ref([])
const activeVn = ref('')
const scopePath = ref([])
const highlightId = ref('')

const vnLabel = computed(() => vnodes.find(v => v.key === activeVn.value)?.label || '')
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getBillDetail)

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

function onRow(row) { openDetail(row.billId) }
function rowClass({ row }) { return row.billId === highlightId.value ? 'row--focus' : '' }
/** 房屋全名带项目前缀（翡翠城 1栋1单元0101），项目已在副行与左树给出，主行只留房号 */
function shortSubject(b) {
  const s = subjectLabel(b.houseId, b.parkId)
  const i = s.indexOf(' ')
  return b.houseId && i > 0 ? s.slice(i + 1) : s
}
function spaceText(b) {
  if (b.subjectType === 'park') return `${b.communityName} · 车位账单（无楼栋）`
  return [b.communityName, b.buildingName, b.unitName].filter(Boolean).join(' / ') || b.communityName
}
function goCashier() { router.push('/b/cashier') }
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }
function jump(path, focus) { router.push(`${path}?focus=${focus}&open=1`) }

/* 落地：房屋台账 / 业主档案跳过来带 house:房号 或 bill:账单号 */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  if ((focus?.type === 'bill' || focus?.type === 'house') && location) {
    Object.assign(query, BLANK)
    Object.assign(query, {
      communityId: location.communityId || '', buildingId: location.buildingId || '', unitId: location.unitId || ''
    })
    activeId.value = location.unitId || location.buildingId || location.communityId || ''
    activeChain.value = [location.communityId, location.buildingId, location.unitId].filter(Boolean)
    activeVn.value = ''
    scopePath.value = pathOf(tree, activeId.value)
    // 账单按账期倒序，单号未必落在第一页；带单号进来时用关键字锁到该张，否则高亮不可见
    if (focus.type === 'bill') query.kw = focus.id
    await load()
    if (focus.type === 'bill') {
      highlightId.value = location.billId || ''
      if (open && location.billId) openDetail(location.billId)
    }
    return
  }
  clearScope()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.is-warn { color: var(--biz-danger); }
</style>
