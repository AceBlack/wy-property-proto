<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>账单查询 · 以「一张账单」为行</b>：顶部<b>快捷视图定状态</b>（有欠费 / 已逾期 / 未缴 / 部分缴），
        下方<b>范围筛选定空间</b>（项目 → 楼栋 → 单元），两者<b>可叠加</b>——「1 栋的已逾期账单」一次就能筛出来。
        当前范围的小计（张数 / 应收 / 未收）在表格上方实时给出；按楼扫楼的催缴作业在「催缴工作台」，
        那里按户归集、带责任楼管与催缴记录。
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
        KPI 为全量口径，不随筛选变化。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="qvwrap">
        <QuickViews v-model="query.vf" :items="quickViews" hint="快捷视图与下方范围可叠加" @change="run">
          <template #after>
            <!-- 车位账单原来是左树的独立分支；去树后收敛成一个可叠加的开关，不占一整列筛选位 -->
            <el-checkbox v-model="onlyPark" size="small" @change="onOnlyPark">只看车位账单</el-checkbox>
          </template>
        </QuickViews>
      </div>

      <el-form :model="query" class="filter-bar" label-width="56px" @submit.prevent>
        <ScopeFilter :model="query" @patch="p => Object.assign(query, p)" @change="run" />
        <el-form-item label="科目">
          <el-select v-model="query.itemId" placeholder="全部" clearable style="width:108px">
            <el-option v-for="i in feeItems" :key="i.itemId" :label="i.name" :value="i.itemId" />
          </el-select>
        </el-form-item>
        <el-form-item label="账期">
          <el-select v-model="query.period" placeholder="全部" clearable style="width:86px">
            <el-option v-for="p in periodOpts" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width:86px">
            <el-option v-for="s in statusOpts" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="业主 / 账单号 / 房号" clearable style="width:150px" @keyup.enter="run" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="run">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="onResetAll">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="scopebar">
        <span class="scopebar__i is-last">{{ scopeText }}</span>
        <span v-if="query.subjectType" class="scopebar__vf">{{ query.subjectType === 'park' ? '车位账单' : '房屋账单' }}</span>
        <span v-if="vnLabel" class="scopebar__vf">{{ vnLabel }}</span>
        <span v-if="query.kw" class="scopebar__vf">关键字 {{ query.kw }}</span>
        <span class="spacer" />
        <span class="scopebar__sum">
          本范围 <b>{{ scopeSum.count }}</b> 张 · 应收 <b>¥{{ money(scopeSum.payable) }}</b> ·
          未收 <b class="is-warn">¥{{ money(scopeSum.unpaid) }}</b>（{{ scopeSum.debtCount }} 张有欠费）
        </span>
        <el-button link type="primary" :disabled="!hasScope" @click="clearScope">清除范围</el-button>
      </div>

      <div class="toolbar" style="margin-top:10px;">
        <el-button type="primary" :icon="'Money'" @click="goCashier">去收银台</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <el-button :icon="'Bell'" :disabled="!picked.length" @click="doRemind">
          批量催缴{{ picked.length ? `（${picked.length}）` : '' }}
        </el-button>
        <el-button :icon="'Discount'" :disabled="!picked.length" @click="doReduce">
          批量减免{{ picked.length ? `（${picked.length}）` : '' }}
        </el-button>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="run" />
        <span class="muted" style="font-size:12.5px;">
          共 {{ total }} 张 · 本页 {{ rows.length }} 张应收 ¥{{ money(pageSum.payable) }}
        </span>
      </div>

      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 500px)"
        :row-class-name="rowClass" @row-click="onRow" @selection-change="onSel">
        <el-table-column type="selection" width="46" />
        <el-table-column prop="period" label="账期" min-width="76" />
        <el-table-column prop="itemName" label="科目" min-width="120" show-overflow-tooltip />
        <el-table-column label="房屋 / 车位" min-width="150" show-overflow-tooltip>
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
          <span class="rel__note">账单与流水共用同一套空间派生口径，两页的「本范围小计」可以直接对账</span>
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
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PAGE_SIZES, batchReduceBills, batchRemindBills, billQuerySummary, billScopeSummary, billVirtualNodes,
  cashierBuildingOpts, cashierUnitOpts,
  communities, feeItems, getBillDetail, ownerName, queryBills, subjectLabel
} from '@/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { useFocusLanding } from '@/composables/useFocus'
import QuickViews from '@/components/QuickViews.vue'
import ScopeFilter from '@/components/ScopeFilter.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money, wan } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()
const BLANK = { communityId: '', buildingId: '', unitId: '', vf: '', subjectType: '', period: '', itemId: '', status: '', kw: '' }

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryBills, { immediate: false, filters: { ...BLANK } }
)

const summary = billQuerySummary()
const periodOpts = ['2026-10', '2026-09', '2026-08', '2026-07', '2026-06']
const statusOpts = ['已缴', '未缴', '部分缴', '逾期', '已减免']

/* 快捷视图：原左树的「虚拟视图」节点搬到这里，全部 + 4 个状态视图，均带计数 */
const quickViews = [{ key: '', label: '全部', n: summary.total }, ...billVirtualNodes()]
const vnLabel = computed(() => (query.vf ? (quickViews.find(v => v.key === query.vf)?.label || '') : ''))

/* 当前范围小计：替代原树节点上挂的「应收 / 欠费」，并支持任意筛选组合后重新算 */
const scopeSum = ref({ count: 0, payable: 0, unpaid: 0, debtCount: 0, overdueCount: 0 })
/* 小计与列表同源：越权/异常时不能让页面抛未捕获异常——列表已把 403 提示出来，这里静默归零 */
async function syncScopeSum() {
  try { scopeSum.value = await billScopeSummary({ ...query }) }
  catch { scopeSum.value = Object.fromEntries(Object.keys(scopeSum.value).map(k => [k, 0])) }
}
function run() { search(); syncScopeSum() }

const hasScope = computed(() => !!(query.communityId || query.buildingId || query.unitId || query.vf ||
  query.subjectType || query.period || query.itemId || query.status || query.kw))
const scopeText = computed(() => {
  // 楼栋的 label 已带项目前缀（「翡翠城 1栋」），有楼栋时不再重复拼项目名
  const b = cashierBuildingOpts(query.communityId).find(x => x.value === query.buildingId)?.label
  const u = cashierUnitOpts(query.buildingId).find(x => x.value === query.unitId)?.label
  if (b) return [b, u].filter(Boolean).join(' · ')
  return communities.find(x => x.communityId === query.communityId)?.name || '全部账单'
})

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

const onlyPark = ref(false)
function onOnlyPark(v) {
  query.subjectType = v ? 'park' : ''
  run()
}

const picked = ref([])
function onSel(list) { picked.value = list }

/** 批量催缴：只在有欠费的账单上生效，失败原因逐条回显（不做整批失败） */
async function doRemind() {
  try {
    const r = await batchRemindBills(picked.value.map(b => b.billId), { operator: '物业前台' })
    const tip = !r.ok
      ? `选中的 ${r.total} 张都没有欠费，无需催缴——切到「有欠费」视图后再批量催缴`
      : (r.failed.length
        ? `${r.ok} 张已催缴（批次 ${r.batchNo}）；跳过 ${r.failed.length} 张：${r.failed.slice(0, 3).map(f => f.reason).join('、')}${r.failed.length > 3 ? ' 等' : ''}`
        : `${r.ok} 张已生成催缴记录（批次 ${r.batchNo}）`)
    ElMessage({ type: r.failed.length ? 'warning' : 'success', message: tip, duration: 4200 })
    picked.value = []
    run()
  } catch (e) { ElMessage.error(e?.message || '批量催缴失败') }
}

/** 批量减免：原因必填，减免后未收清零、状态转「已减免」 */
async function doReduce() {
  if (!picked.value.length) return
  let reason = ''
  try {
    const r = await ElMessageBox.prompt(
      `将对 ${picked.value.length} 张账单减免未收金额（不可撤销，请填写原因）`,
      '批量减免', {
        confirmButtonText: '确认减免', cancelButtonText: '取消', inputPlaceholder: '如：管道漏水协商减免',
        inputValidator: v => (String(v || '').trim().length >= 4 ? true : '原因至少 4 个字')
      }
    )
    reason = r.value
  } catch { return }
  try {
    const res = await batchReduceBills(picked.value.map(b => b.billId), { reason, operator: '项目经理' })
    const tip = res.failed.length
      ? `已减免 ${res.ok} 张；跳过 ${res.failed.length} 张：${res.failed.slice(0, 3).map(f => f.reason).join('、')}`
      : `已减免 ${res.ok} 张，未收金额已清零`
    ElMessage({ type: res.failed.length ? 'warning' : 'success', message: tip, duration: 4200 })
    picked.value = []
    run()
  } catch (e) { ElMessage.error(e?.message || '批量减免失败') }
}

const highlightId = ref('')
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getBillDetail)

function clearScope() { Object.assign(query, BLANK); onlyPark.value = false }
function onResetAll() { Object.assign(query, BLANK); onlyPark.value = false; reset(); syncScopeSum() }

function onRow(row) { openDetail(row.billId) }
function rowClass({ row }) { return row.billId === highlightId.value ? 'row--focus' : '' }
/** 房屋全名带项目前缀（翡翠城 1栋1单元0101），项目已在副行给出，主行只留房号 */
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
function jump(path, focus) { router.push(`${path}?focus=${focus}&open=1`) }

onMounted(run)

/* 落地：房屋台账 / 业主档案跳过来带 house:房号 或 bill:账单号 */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  if ((focus?.type === 'bill' || focus?.type === 'house') && location) {
    Object.assign(query, BLANK)
    Object.assign(query, {
      communityId: location.communityId || '', buildingId: location.buildingId || '', unitId: location.unitId || ''
    })
    // 账单按账期倒序，单号未必落在第一页；带单号进来时用关键字锁到该张，否则高亮不可见
    if (focus.type === 'bill') query.kw = focus.id
    await load()
    await syncScopeSum()
    if (focus.type === 'bill') {
      highlightId.value = location.billId || ''
      if (open && location.billId) openDetail(location.billId)
    }
    return
  }
  Object.assign(query, BLANK)
  onlyPark.value = false
  await load()
  await syncScopeSum()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.is-warn { color: var(--biz-danger); }
.qvwrap { padding-bottom: 10px; border-bottom: 1px solid var(--biz-border-light); margin-bottom: 4px; }
.scopebar__sum { font-size: 12px; color: var(--biz-text-2); }
.scopebar__sum b { font-variant-numeric: tabular-nums; color: var(--biz-text-1); }
</style>
