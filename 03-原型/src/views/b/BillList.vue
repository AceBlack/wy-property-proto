<template>
  <div class="page bl-page">
    <div class="bl-main">
        <!-- 单行工具条 -->
        <div class="bl-bar">
          <el-input v-model="query.kw" class="bl-search" placeholder="搜索业主 / 账单号 / 房号"
            clearable @keyup.enter="run" @clear="run">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>

          <el-select v-model="query.period" class="bl-period" placeholder="账期" clearable @change="run">
            <el-option v-for="p in periodOpts" :key="p" :label="p" :value="p" />
          </el-select>

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
          <template v-if="picked.length">
            <el-button text @click="doRemind">批量催缴 {{ picked.length }}</el-button>
            <el-button text @click="doReduce">批量减免 {{ picked.length }}</el-button>
          </template>
          <el-popover placement="bottom-end" :width="440" trigger="click" popper-class="bl-pop">
            <template #reference>
              <button class="bl-ibtn" title="这页怎么用">ⓘ</button>
            </template>
            <div class="bl-tip">
              <b>以「一张账单」为行。</b>顶部<b>快捷视图</b>定状态（有欠费 / 已逾期 / 未缴 / 部分缴），
              左侧<b>空间树</b>定范围（项目 → 楼栋 → 单元），两者可叠加——「1 栋的已逾期账单」一次筛出。
              当前范围的小计在表格上方实时给出；按楼扫楼的催缴作业在「催缴工作台」，那里按户归集、带责任楼管与催缴记录。
            </div>
          </el-popover>
          <el-button text :disabled="!rows.length" @click="onExport">导出</el-button>
        </div>

        <!-- 更多筛选：就地展开，不再用弹层遮挡表格 -->
        <transition name="bl-exp">
          <div v-if="moreOpen" class="bl-morepanel">
            <el-form :model="query" :inline="true" class="bl-moreform" @submit.prevent>
              <el-form-item label="科目">
                <el-select v-model="query.itemId" placeholder="全部" clearable style="width:132px" @change="run">
                  <el-option v-for="i in feeItems" :key="i.itemId" :label="i.name" :value="i.itemId" />
                </el-select>
              </el-form-item>
              <el-form-item label="状态">
                <el-select v-model="query.status" placeholder="全部" clearable style="width:112px" @change="run">
                  <el-option v-for="s in statusOpts" :key="s" :label="s" :value="s" />
                </el-select>
              </el-form-item>
              <ScopeFilter :model="query" :levels="['building', 'unit']"
                @patch="p => Object.assign(query, p)" @change="run" />
              <el-form-item label="范围">
                <el-checkbox v-model="onlyPark" @change="onOnlyPark">只看车位账单</el-checkbox>
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
            <div class="bl-kpi-v">{{ summary.total }}<span class="bl-kpi-u">张</span></div>
            <div class="bl-kpi-l">账单总数</div>
          </div>
          <div class="bl-kpi">
            <div class="bl-kpi-ic"><el-icon><Money /></el-icon></div>
            <div class="bl-kpi-v">¥{{ wan(summary.payable) }}</div>
            <div class="bl-kpi-l">应收合计</div>
          </div>
          <div class="bl-kpi">
            <div class="bl-kpi-ic is-dan"><el-icon><Warning /></el-icon></div>
            <div class="bl-kpi-v is-dan">¥{{ wan(summary.unpaid) }}</div>
            <div class="bl-kpi-l">欠费合计<span class="bl-kpi-d">占 {{ unpaidRate }}%</span></div>
          </div>
          <div class="bl-kpi">
            <div class="bl-kpi-ic is-dan"><el-icon><Bell /></el-icon></div>
            <div class="bl-kpi-v is-dan">{{ summary.debtCount }}<span class="bl-kpi-u">张</span></div>
            <div class="bl-kpi-l">
              有欠费账单
              <el-popover placement="top" :width="360" trigger="click" popper-class="bl-pop">
                <template #reference>
                  <el-icon class="bl-info is-sm"><InfoFilled /></el-icon>
                </template>
                <div class="bl-tip">
                  欠费 = 未缴 / 部分缴 / 逾期 三类账单的未收金额之和，已减免与已作废不计入，与费用驾驶舱同源。
                  KPI 为全量口径，不随筛选变化；下方「本范围小计」才随筛选变化。
                </div>
              </el-popover>
            </div>
          </div>
        </div>

        <!-- 当前范围小计（单行） -->
        <div class="bl-scope">
          <span class="bl-scope-t">{{ scopeText }}</span>
          <span class="bl-scope-d">
            本范围 <b>{{ scopeSum.count }}</b> 张 · 应收 <b>¥{{ money(scopeSum.payable) }}</b> ·
            未收 <b class="is-warn">¥{{ money(scopeSum.unpaid) }}</b>（{{ scopeSum.debtCount }} 张有欠费）
          </span>
          <span v-if="vnLabel" class="bl-scope-tag">{{ vnLabel }}</span>
          <span v-if="query.subjectType" class="bl-scope-tag">{{ query.subjectType === 'park' ? '车位账单' : '房屋账单' }}</span>
          <span class="spacer" />
          <span class="bl-scope-page">本页 {{ rows.length }} 张 · 应收 ¥{{ money(pageSum.payable) }}</span>
        </div>

        <!-- 表格：无卡片，整页白底 -->
        <div class="bl-table">
          <div class="bl-tblwrap">
          <el-table v-loading="loading" :data="rows" class="bl-tbl" style="width:100%"
            height="100%" :row-class-name="rowClass"
            @row-click="onRow" @selection-change="onSel">
            <el-table-column type="selection" width="42" />
            <el-table-column prop="billId" label="账单号" min-width="104">
              <template #default="{ row }"><span class="bl-id">{{ row.billId }}</span></template>
            </el-table-column>
            <el-table-column label="房屋 / 车位" min-width="138" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="nowrap bl-addr">{{ shortSubject(row) }}</div>
                <div class="ps-sub">{{ row.communityName }}</div>
              </template>
            </el-table-column>
            <el-table-column label="业主" min-width="82" show-overflow-tooltip>
              <template #default="{ row }">{{ row.ownerName || ownerName(row.ownerId) }}</template>
            </el-table-column>
            <el-table-column prop="itemName" label="科目" min-width="92" show-overflow-tooltip>
              <template #default="{ row }"><span class="bl-subj">{{ row.itemName }}</span></template>
            </el-table-column>
            <el-table-column prop="period" label="账期" width="82" />
            <el-table-column prop="payable" label="应收" width="98" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.payable) }}</span></template>
            </el-table-column>
            <el-table-column prop="paidAmount" label="已收" width="98" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.paidAmount) }}</span></template>
            </el-table-column>
            <el-table-column prop="unpaid" label="欠费" width="98" align="right">
              <template #default="{ row }">
                <span class="money" :class="{ 'money--out': row.unpaid > 0 }">{{ money(row.unpaid) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="92">
              <template #default="{ row }"><span class="bl-st"><StatusTag domain="bill" :value="row.status" /></span></template>
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
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="detailData?.bill?.houseId" @click="jump('/a/houses', 'house:' + detailData.bill.houseId)">房屋台账</el-button>
        <el-button @click="jump('/b/payments', 'bill:' + detailData?.bill?.billId)">缴费流水</el-button>
        <el-button v-if="canCashier" type="primary" @click="goCashier">去收银台缴费</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { InfoFilled, Search, Tickets, Money, Warning, Bell } from '@element-plus/icons-vue'
import {
  PAGE_SIZES, batchReduceBills, batchRemindBills, billQuerySummary, billScopeSummary, billVirtualNodes,
  cashierBuildingOpts, cashierUnitOpts,
  communities, feeItems, getBillDetail, ownerName, queryBills, subjectLabel
} from '@/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { useFocusLanding } from '@/composables/useFocus'
import ScopeFilter from '@/components/ScopeFilter.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { canVisit } from '@/utils/auth'
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

/* 快捷视图：带计数，与空间范围叠加 */
const quickViews = [{ key: '', label: '全部', n: summary.total }, ...billVirtualNodes()]
const vnLabel = computed(() => (query.vf ? (quickViews.find(v => v.key === query.vf)?.label || '') : ''))

/* 「更多筛选」上的角标：只数被折叠起来的条件 */
const extraCount = computed(() =>
  (query.itemId ? 1 : 0) + (query.status ? 1 : 0) + (query.subjectType ? 1 : 0) + (onlyPark.value ? 1 : 0))

/* 当前范围小计：与列表同源；越权/异常时静默归零，不让页面抛未捕获异常 */
const scopeSum = ref({ count: 0, payable: 0, unpaid: 0, debtCount: 0, overdueCount: 0 })
async function syncScopeSum() {
  try { scopeSum.value = await billScopeSummary({ ...query }) }
  catch { scopeSum.value = Object.fromEntries(Object.keys(scopeSum.value).map(k => [k, 0])) }
}
function run() { search(); syncScopeSum() }

const hasScope = computed(() => !!(query.communityId || query.buildingId || query.unitId || query.vf ||
  query.subjectType || query.period || query.itemId || query.status || query.kw))
const scopeText = computed(() => {
  const b = cashierBuildingOpts(query.communityId).find(x => x.value === query.buildingId)?.label
  const u = cashierUnitOpts(query.buildingId).find(x => x.value === query.unitId)?.label
  if (b) return [b, u].filter(Boolean).join(' · ')
  return communities.find(x => x.communityId === query.communityId)?.name || '全部账单'
})

const unpaidRate = computed(() => summary.payable
  ? ((summary.unpaid / summary.payable) * 100).toFixed(1) : '0.0')

const canCashier = computed(() => canVisit('/b/cashier'))

const pageSum = computed(() =>
  rows.value.reduce((s, b) => ({ payable: s.payable + (b.payable || 0), unpaid: s.unpaid + (b.unpaid || 0) }), { payable: 0, unpaid: 0 })
)

/* 快捷视图：点已选中的再点一次取消 */
function pickView(v) {
  query.vf = query.vf === v.key ? '' : v.key
  run()
}

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

const moreOpen = ref(false)
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
.bl-page { height: 100%; display: flex; flex-direction: column; }
.bl-info { font-size: 14px; color: var(--biz-text-4); cursor: pointer; }
.bl-info:hover { color: var(--el-color-primary); }
.bl-info.is-sm { font-size: 12px; margin-left: 3px; }
.bl-tip { font-size: 12.5px; line-height: 1.8; color: var(--biz-text-2); }
.bl-tip b { color: var(--biz-text-1); font-weight: 500; }

/* 工具条 */
.bl-main { flex: 1; min-height: 0; display: flex; flex-direction: column; min-width: 0; padding: 12px 24px 0; }
.bl-bar { display: flex; align-items: center; gap: 8px; height: 40px; margin-bottom: 4px; }
.bl-search { flex: 0 0 268px; }
.bl-period { flex: 0 0 108px; }
.bl-chips { display: flex; align-items: center; gap: 2px; }
.bl-chip {
  appearance: none; border: 0; background: transparent; height: 32px; padding: 0 11px;
  border-radius: 999px; font-size: 12.5px; color: var(--biz-text-2); cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
}
.bl-chip:hover { background: #F4F5F9; }
.bl-chip.is-on { background: #fff; color: var(--biz-text-1); font-weight: 500; box-shadow: 0 1px 2px rgba(16, 24, 40, .08); }
.bl-chip-n { font-size: 11px; color: var(--biz-text-4); font-variant-numeric: tabular-nums; }
.bl-chip.is-on .bl-chip-n { color: var(--el-color-primary); }
.bl-more {
  appearance: none; border: 0; background: transparent; height: 32px; padding: 0 10px;
  border-radius: 8px; font-size: 12.5px; color: var(--el-color-primary); cursor: pointer; font-family: inherit;
  white-space: nowrap;
}
.bl-more:hover { background: #EEF0FF; }
.bl-caret { margin-left: 4px; font-size: 10px; }
.bl-more.is-on { background: #EEF0FF; }
/* 就地展开的筛选面板 */
.bl-morepanel {
  background: #fff; border: 1px solid #F0F2F6; border-radius: 12px;
  padding: 14px 18px 2px; margin-bottom: 12px;
}
.bl-moreform :deep(.el-form-item) { margin-bottom: 12px; margin-right: 26px; }
.bl-exp-enter-active, .bl-exp-leave-active { transition: opacity .16s ease, transform .16s ease; }
.bl-exp-enter-from, .bl-exp-leave-to { opacity: 0; transform: translateY(-4px); }
.bl-ibtn {
  appearance: none; border: 0; background: transparent; width: 28px; height: 28px;
  border-radius: 8px; color: var(--biz-text-4); font-size: 15px; cursor: pointer; font-family: inherit;
}
.bl-ibtn:hover { background: #F1F2F6; color: var(--el-color-primary); }

/* KPI */
.bl-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
.bl-kpi { background: #fff; border-radius: 14px; padding: 13px 16px 11px; }
.bl-kpi-ic {
  width: 28px; height: 28px; border-radius: 9px; background: #F4F5F9;
  display: grid; place-items: center; font-size: 14px; color: #616A7D;
}
.bl-kpi-ic.is-dan { background: #FDECEF; color: var(--biz-danger); }
.bl-kpi-v {
  font-size: 26px; font-weight: 600; letter-spacing: -.02em; margin-top: 6px;
  color: var(--biz-text-1); font-variant-numeric: tabular-nums;
}
.bl-kpi-v.is-dan { color: var(--biz-danger); }
.bl-kpi-u { font-size: 12px; font-weight: 400; color: var(--biz-text-3); margin-left: 3px; }
.bl-kpi-l { font-size: 12px; color: var(--biz-text-3); margin-top: 4px; display: flex; align-items: center; gap: 6px; }
.bl-kpi-d { font-size: 11px; color: var(--biz-danger); background: #FDECEF; border-radius: 999px; padding: 1px 7px; font-variant-numeric: tabular-nums; }

/* 范围小计 */
.bl-scope { display: flex; align-items: center; gap: 10px; height: 30px; margin-bottom: 4px; }
.bl-scope-t { font-size: 12.5px; color: var(--biz-text-1); font-weight: 500; }
.bl-scope-d { font-size: 12px; color: var(--biz-text-3); font-variant-numeric: tabular-nums; }
.bl-scope-d b { color: var(--biz-text-1); font-weight: 500; }
.bl-scope-tag {
  font-size: 11.5px; color: var(--el-color-primary); background: #EEF0FF;
  border-radius: 999px; padding: 1px 8px;
}
.bl-scope-page { font-size: 11.5px; color: var(--biz-text-4); font-variant-numeric: tabular-nums; }

/* 表格：透明底，行直接铺在画布上（对齐效果图） */
.bl-tbl { --el-table-bg-color: transparent; --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent; background: transparent; }
.bl-tbl :deep(.el-table__inner-wrapper),
.bl-tbl :deep(.el-table__body-wrapper),
.bl-tbl :deep(.el-table__header-wrapper) { background: transparent; }
.bl-table { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.bl-tblwrap { flex: 1; min-height: 0; overflow: hidden; }
.bl-tbl :deep(.el-table__header th) {
  background: transparent; font-weight: 400; font-size: 12px; color: var(--biz-text-3);
  border-bottom: 1px solid #F0F2F6; height: 38px; padding: 0;
}
.bl-tbl :deep(.el-table__row td) { height: 46px; padding: 0; border-bottom: 1px solid #F6F7FA; font-size: 13px; }
.bl-tbl :deep(.el-table__row:hover > td) { background: #F2F4FF; }
.bl-tbl :deep(.el-table__inner-wrapper::before) { display: none; }
.bl-id { font-size: 12px; color: var(--biz-text-3); font-variant-numeric: tabular-nums; }
.bl-addr { color: var(--biz-text-1); line-height: 1.3; font-size: 12.5px; }
.bl-subj { color: var(--biz-text-3); font-size: 12.5px; }
.ps-sub { font-size: 11px; color: var(--biz-text-4); margin-top: 0; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.is-warn { color: var(--biz-danger); }
/* 状态：标签去底色，改成圆点 + 文字 */
.bl-st :deep(.el-tag) {
  background: transparent !important; border: 0 !important; padding: 0 !important;
  height: auto !important; font-size: 12.5px;
}
.bl-st :deep(.el-tag)::before {
  content: ""; display: inline-block; width: 6px; height: 6px;
  border-radius: 50%; background: currentColor; margin-right: 6px; vertical-align: 1px;
}
.bl-foot { display: flex; justify-content: flex-end; padding: 10px 0 0; }
</style>
