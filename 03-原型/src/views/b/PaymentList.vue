<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>缴费流水 · 以「一笔收款」为行</b>：顶部<b>快捷视图定状态</b>（现金收款 / 未开票 / 已冲红 / 预存抵扣），
        下方<b>范围筛选定空间</b>（项目 → 楼栋 → 单元），两者<b>可叠加</b>——财务对账靠的是时间 + 方式 + 渠道，不是楼栋。
        车位管理费上溯不到楼栋，用「只看车位收费」开关承接（原树的「车位收费」分支）；<b>现金收款</b>是对账重点，视图里一眼可见。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">流水笔数</div><div class="dstat__v">{{ summary.total }}<span class="unit">笔</span></div></div>
        <div class="dstat"><div class="dstat__k">累计收款</div><div class="dstat__v">¥ {{ wan(summary.amount) }}</div></div>
        <div class="dstat"><div class="dstat__k">本月收款</div><div class="dstat__v">¥ {{ wan(summary.monthAmount) }}<span class="unit">/ {{ summary.monthCount }} 笔</span></div></div>
        <div class="dstat"><div class="dstat__k">已开票</div><div class="dstat__v">{{ summary.invoiced }}<span class="unit">笔</span></div></div>
      </div>
      <div class="sum-note">
        口径：流水本身不带项目与科目，由数据层回连账单与房屋补齐，页面不做 join；「车位收费」分支是唯一的非楼栋分支。
      </div>
    </div>

    <div class="ia is-flat" style="margin-top:16px;">
      <div class="ia__main">
        <div class="panel">
          <div class="qvwrap">
            <QuickViews v-model="query.vf" :items="quickViews" hint="快捷视图与下方范围可叠加" @change="run">
              <template #after>
                <el-checkbox v-model="onlyPark" size="small" @change="onOnlyPark">只看车位收费</el-checkbox>
              </template>
            </QuickViews>
          </div>

          <el-form :model="query" class="filter-bar" label-width="56px" @submit.prevent>
            <ScopeFilter :model="query" @patch="p2 => Object.assign(query, p2)" @change="run" />
            <el-form-item label="方式">
              <el-select v-model="query.method" placeholder="全部" clearable style="width:80px">
                <el-option v-for="o in methodOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="渠道">
              <el-select v-model="query.channel" placeholder="全部" clearable style="width:88px">
                <el-option v-for="o in channelOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="开票">
              <el-select v-model="query.invoiceStatus" placeholder="全部" clearable style="width:80px">
                <el-option v-for="o in invoiceOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="流水号 / 交易号 / 业主" clearable style="width:120px" @keyup.enter="search" />
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
            <span v-if="query.subjectType" class="scopebar__vf">车位收费</span>
            <span v-if="vnLabel" class="scopebar__vf">{{ vnLabel }}</span>
            <span v-if="query.kw" class="scopebar__vf">关键字 {{ query.kw }}</span>
            <span class="spacer" />
            <span class="scopebar__sum">
              本范围 <b>{{ scopeSum.count }}</b> 笔 · 合计 <b>¥{{ money(scopeSum.amount) }}</b> ·
              现金 <b>{{ scopeSum.cash }}</b> 笔 · 未开票 <b>{{ scopeSum.uninvoiced }}</b> 笔
            </span>
            <el-button link type="primary" :disabled="!hasScope" @click="clearScope">清除范围</el-button>
          </div>

          <div class="toolbar">
            <el-date-picker v-model="query.range" type="daterange" unlink-panels
              start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" style="width:220px" />
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <el-button :icon="'Printer'" @click="$router.push('/b/invoices')">开票 / 票据台账</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 笔 · 合计 ¥ {{ wan(pageAmount) }}</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 470px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column label="流水号" min-width="96">
              <template #default="{ row }">
                <div class="nowrap">{{ row.payId }}</div>
                <div class="ps-sub">{{ row.payTime }}</div>
              </template>
            </el-table-column>
            <el-table-column label="业主" min-width="90" show-overflow-tooltip>
              <template #default="{ row }">{{ row.ownerName }}</template>
            </el-table-column>
            <el-table-column label="承载对象" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="nowrap">{{ row.subject }}</div>
                <div class="ps-sub">{{ row.itemName }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="period" label="账期" min-width="72" />
            <el-table-column label="金额" min-width="96" align="right">
              <template #default="{ row }"><span class="money money--in">¥ {{ money(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column prop="method" label="方式" min-width="86">
              <template #default="{ row }">
                <span :class="{ 'is-warn-text': row.method === '现金' }">{{ row.method }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="channel" label="渠道" min-width="88" show-overflow-tooltip />
            <el-table-column label="开票" min-width="80">
              <template #default="{ row }">
                <el-tag size="small" :type="row.invoiceStatus === '已开票' ? 'success' : (row.invoiceStatus === '已冲红' ? 'danger' : 'info')" effect="plain">
                  {{ row.invoiceStatus }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="退款" min-width="96">
              <template #default="{ row }">
                <span v-if="row.refundAmount > 0" class="money money--out">-{{ money(row.refundAmount) }}</span>
                <span v-else class="muted">—</span>
                <div v-if="row.refundStatus" class="ps-sub">{{ row.refundStatus }}</div>
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
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.payment?.payId"
      :subtitle="detailData ? `${detailData.payment.ownerName} · ${detailData.payment.subject} · ${detailData.payment.payTime}` : ''"
      :tag="detailData?.payment?.channel"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">收款金额</div><div class="dstat__v">¥ {{ money(detailData.payment.amount) }}</div></div>
          <div class="dstat"><div class="dstat__k">支付方式</div><div class="dstat__v" style="font-size:15px;">{{ detailData.payment.method }}</div></div>
          <div class="dstat"><div class="dstat__k">所属项目</div><div class="dstat__v" style="font-size:15px;">{{ detailData.payment.communityName }}</div></div>
          <div class="dstat"><div class="dstat__k">开票状态</div><div class="dstat__v" style="font-size:15px;">{{ detailData.payment.invoiceStatus }}</div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>流水信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">交易号</span><span class="dl__v">{{ detailData.payment.transNo }}</span></div>
          <div class="dl__i"><span class="dl__k">操作人</span><span class="dl__v">{{ detailData.payment.operator }}</span></div>
          <div class="dl__i"><span class="dl__k">发票号</span><span class="dl__v">{{ detailData.payment.invoiceNo || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">对应账单</span><span class="dl__v">{{ detailData.payment.billId }}</span></div>
          <div class="dl__i"><span class="dl__k">科目</span><span class="dl__v">{{ detailData.payment.itemName || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">账期</span><span class="dl__v">{{ detailData.payment.period || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">承载对象</span><span class="dl__v">{{ detailData.payment.subject }}</span></div>
          <div class="dl__i"><span class="dl__k">空间归属</span><span class="dl__v">{{ spaceText(detailData.payment) }}</span></div>
        </div>

        <template v-if="detailData.bill">
          <div class="sec__hd" style="margin-top:18px;"><h4>对应账单</h4><span class="desc">{{ detailData.bill.status }}</span></div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">应收</span><span class="dl__v money">¥ {{ money(detailData.bill.payable) }}</span></div>
            <div class="dl__i"><span class="dl__k">实收</span><span class="dl__v money">¥ {{ money(detailData.bill.paidAmount) }}</span></div>
            <div class="dl__i"><span class="dl__k">未收</span><span class="dl__v money">¥ {{ money(detailData.bill.unpaid) }}</span></div>
            <div class="dl__i"><span class="dl__k">逾期天数</span><span class="dl__v">{{ detailData.bill.overdueDays ?? 0 }} 天</span></div>
          </div>
        </template>

        <div v-if="detailData.siblings.length" style="margin-top:18px;">
          <div class="sec__hd"><h4>同账单其他流水</h4><span class="desc">{{ detailData.siblings.length }} 笔</span></div>
          <el-table :data="detailData.siblings" size="small">
            <el-table-column prop="payId" label="流水号" width="110" />
            <el-table-column prop="payTime" label="时间" width="130" />
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }"><span class="money">¥ {{ money(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column prop="method" label="方式" width="100" />
            <el-table-column prop="operator" label="操作人" min-width="120" />
          </el-table>
        </div>

        <template v-if="myRefunds.length">
          <div class="sec__hd" style="margin-top:18px;"><h4>退款 / 冲红</h4><span class="desc">{{ myRefunds.length }} 笔 · 合计 ¥{{ money(myRefundSum) }}</span></div>
          <el-table :data="myRefunds" size="small">
            <el-table-column prop="refundNo" label="退款单号" width="140" />
            <el-table-column label="金额" width="100" align="right">
              <template #default="{ row }"><span class="money money--out">-{{ money(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column prop="kind" label="类型" width="70" />
            <el-table-column prop="reason" label="原因" min-width="140" show-overflow-tooltip />
            <el-table-column prop="operator" label="操作人" width="90" />
            <el-table-column label="发票" width="86">
              <template #default="{ row }">
                <el-tag v-if="row.invoiceRedFlushed" size="small" type="danger" effect="plain">已红冲</el-tag>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
          </el-table>
        </template>

        <div class="rel">
          <span class="rel__note">流水只记 houseId，楼栋与单元由房屋台账反查得出；车位类流水无房屋，只能落到项目级。退款会同时把账单的已收减回、未收加回（不是只给流水打个标记）。</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="detailData?.payment?.billId" @click="jump('/b/bills', 'bill:' + detailData.payment.billId)">查看账单</el-button>
        <el-button v-if="detailData?.payment?.houseId" @click="jump('/a/houses', 'house:' + detailData.payment.houseId)">房屋台账</el-button>
        <el-button :icon="'Printer'" @click="receiptVisible = true">打印收据</el-button>
        <el-button v-if="canRefund" type="danger" plain @click="openRefund">发起退款</el-button>
        <el-button type="primary" @click="goInvoice">开票</el-button>
      </template>
    </DetailDrawer>

    <!-- 退款 / 冲红 -->
    <el-dialog v-model="refundVisible" title="发起退款" width="480">
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom:14px;"
        title="退款将同时冲回账单：对应账单已收减少、未收增加；已开票的流水会红冲发票。" />
      <el-form label-width="88px">
        <el-form-item label="原流水">
          <span>{{ detailData?.payment?.payId }} · {{ detailData?.payment?.ownerName }} · ¥{{ money(detailData?.payment?.amount || 0) }}</span>
        </el-form-item>
        <el-form-item label="可退金额">
          <span class="money">¥ {{ money(refundLeft) }}</span>
        </el-form-item>
        <el-form-item label="退款金额">
          <el-input v-model="refundForm.amount" placeholder="留空 = 全额退款">
            <template #append>元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="退款原因" required>
          <el-input v-model="refundForm.reason" type="textarea" :rows="2" maxlength="80" show-word-limit
            placeholder="如：重复缴费，业主申请退回" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="refundVisible = false">取消</el-button>
        <el-button type="danger" :loading="refunding" @click="doRefund">确认退款</el-button>
      </template>
    </el-dialog>

    <!-- X4 收据打印 -->
    <el-dialog v-model="receiptVisible" title="收据打印预览" width="620">
      <div class="print-area">
        <div class="print-area__hd">
          <div class="tt">物业费收款收据</div>
          <div class="muted">流水号 {{ detailData?.payment?.payId }} · 打印时间 {{ today }}</div>
        </div>
        <div class="receipt">
          <div class="receipt__i"><span class="k">业主 / 缴费人</span><span class="v">{{ detailData?.payment?.ownerName || '—' }}</span></div>
          <div class="receipt__i"><span class="k">房屋 / 车位</span><span class="v">{{ detailData?.payment?.subject || '—' }}</span></div>
          <div class="receipt__i"><span class="k">所属项目</span><span class="v">{{ detailData?.payment?.communityName || '—' }}</span></div>
          <div class="receipt__i"><span class="k">账期</span><span class="v">{{ detailData?.payment?.period || '—' }}</span></div>
          <div class="receipt__i"><span class="k">收费科目</span><span class="v">{{ detailData?.payment?.itemName || '—' }}</span></div>
          <div class="receipt__i"><span class="k">支付方式</span><span class="v">{{ detailData?.payment?.method }} · {{ detailData?.payment?.channel || '—' }}</span></div>
          <div class="receipt__i"><span class="k">交易号</span><span class="v">{{ detailData?.payment?.transNo || '—' }}</span></div>
          <div class="receipt__i"><span class="k">收款时间</span><span class="v">{{ detailData?.payment?.payTime || '—' }}</span></div>
        </div>
        <table class="print-tb">
          <thead><tr><th>项目</th><th class="r">金额（元）</th></tr></thead>
          <tbody>
            <tr><td>{{ detailData?.payment?.itemName || '物业费' }}</td><td class="r">¥ {{ money(detailData?.payment?.amount || 0) }}</td></tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="r">合计（大写 {{ amountCn }}）</td>
              <td class="r">¥ {{ money(detailData?.payment?.amount || 0) }}</td>
            </tr>
          </tfoot>
        </table>
        <div class="print-area__ft">
          本收据为物业服务收费凭证，请妥善保管；如需发票请在「票据管理」中开具。<br />
          收款人：{{ detailData?.payment?.operator || '—' }} · 服务热线：028-8888 6666
        </div>
      </div>
      <template #footer>
        <el-button @click="receiptVisible = false">关闭</el-button>
        <el-button type="primary" :icon="'Printer'" @click="doPrintReceipt">打印</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, cashierBuildingOpts, cashierUnitOpts, communities, getPaymentDetail, invoiceStatusOpts,
  payChannelOpts, payMethodOpts, payScopeSummary, payVirtualNodes, paymentSummary, queryPayments,
  refundPayment
} from '@/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { useFocusLanding } from '@/composables/useFocus'
import QuickViews from '@/components/QuickViews.vue'
import ScopeFilter from '@/components/ScopeFilter.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money, wan } from '@/utils/format'
import { exportList } from '@/utils/export'
import { printArea } from '@/utils/print'

const router = useRouter()
const BLANK = { communityId: '', buildingId: '', unitId: '', vf: '', subjectType: '', method: '', channel: '', invoiceStatus: '', kw: '' }

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryPayments, { immediate: false, filters: { ...BLANK, range: null } }
)

/* KPI 汇总：mock 同步、http 异步，统一 await；失败保留上一次的数（列表已提示错误） */
const summary = ref({
  total: 0, amount: 0, monthAmount: 0, invoiced: 0,
  todayCount: 0, todayAmount: 0, monthCount: 0,
  cashCount: 0, cashAmount: 0, byMethod: [], byChannel: []
})
async function syncSummary() {
  try { summary.value = await paymentSummary() } catch { /* 保持旧值 */ }
}
/* 快捷视图：原左树的虚拟视图节点搬到这里，全部 + 4 个状态视图，均带计数 */
const quickViews = computed(() => [{ key: '', label: '全部', n: summary.value.total }, ...payVirtualNodes()])
const methodOpts = payMethodOpts()
const channelOpts = payChannelOpts()
const invoiceOpts = invoiceStatusOpts()
const pageAmount = computed(() => rows.value.reduce((s, r) => s + (r.amount || 0), 0))

/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'payId', label: '流水号' }, { prop: 'payTime', label: '收款时间' },
  { prop: 'ownerName', label: '业主' }, { prop: 'houseName', label: '承载对象' },
  { prop: 'itemName', label: '科目' }, { prop: 'period', label: '账期' },
  { prop: 'amount', label: '金额' }, { prop: 'method', label: '方式' },
  { prop: 'channel', label: '渠道' }, { prop: 'invoiceStatus', label: '开票' }
]
function onExport() {
  exportList({ name: '缴费流水', source: '/b/payments', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

/* ---------- 退款 / 冲红 ---------- */
const refundState = ref(0)          // 版本号：退款后强制刷新派生展示
const refundVisible = ref(false)
const refunding = ref(false)
const refundForm = reactive({ amount: '', reason: '' })
const myRefunds = computed(() => {
  void refundState.value
  /* 退款记录随详情一起下发（契约 /payments/{payId} 的 refunds[]），不再全表扫描前端过滤 */
  return detailData.value?.refunds || []
})
const myRefundSum = computed(() => Math.round(myRefunds.value.reduce((s, r) => s + r.amount, 0) * 100) / 100)
const refundLeft = computed(() => {
  const p = detailData.value?.payment
  if (!p) return 0
  return Math.round(((p.amount || 0) - (p.refundAmount || 0)) * 100) / 100
})
const canRefund = computed(() => !!detailData.value?.payment && refundLeft.value > 0.01)

function openRefund() {
  refundForm.amount = ''
  refundForm.reason = ''
  refundVisible.value = true
}

async function doRefund() {
  const p = detailData.value?.payment
  if (!p) return
  refunding.value = true
  try {
    const row = refundPayment(p.payId, {
      amount: refundForm.amount === '' ? undefined : refundForm.amount,
      reason: refundForm.reason, operator: '项目经理'
    })
    refundVisible.value = false
    refundState.value++
    ElMessage.success(`${row.refundNo} 已退款 ¥${money(row.amount)}（${row.kind}）${row.invoiceRedFlushed ? '，发票已红冲' : ''}`)
    /* 重取详情：账单已收/未收、开票状态都变了 */
    detailData.value = await getPaymentDetail(p.payId)
    await load()
    await syncScopeSum()
    await syncSummary()          /* 退款会改「已开票 → 已冲红」和累计收款 */
  } catch (e) {
    ElMessage.error(e?.message || '退款失败')
  } finally { refunding.value = false }
}

const highlightId = ref('')
const vnLabel = computed(() => (query.vf ? (quickViews.value.find(v => v.key === query.vf)?.label || '') : ''))

/* 当前范围小计：替代原树节点上的金额 */
const scopeSum = ref({ count: 0, amount: 0, cash: 0, uninvoiced: 0 })
/* 小计与列表同源：越权/异常时不能让页面抛未捕获异常——列表已把 403 提示出来，这里静默归零 */
async function syncScopeSum() {
  try { scopeSum.value = await payScopeSummary({ ...query }) }
  catch { scopeSum.value = Object.fromEntries(Object.keys(scopeSum.value).map(k => [k, 0])) }
}
function run() { search(); syncScopeSum() }

const onlyPark = ref(false)
function onOnlyPark(v) { query.subjectType = v ? 'park' : ''; run() }

const hasScope = computed(() => !!(query.communityId || query.buildingId || query.unitId || query.vf ||
  query.subjectType || query.method || query.channel || query.invoiceStatus || query.kw || query.range))
const scopeText = computed(() => {
  const b = cashierBuildingOpts(query.communityId).find(x => x.value === query.buildingId)?.label
  const u = cashierUnitOpts(query.buildingId).find(x => x.value === query.unitId)?.label
  if (b) return [b, u].filter(Boolean).join(' · ')
  return communities.find(x => x.communityId === query.communityId)?.name || '全部收款'
})
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getPaymentDetail)

function clearScope() {
  Object.assign(query, BLANK)
  onlyPark.value = false
  run()
}
function onResetAll() {
  Object.assign(query, BLANK)
  onlyPark.value = false
  reset()
  syncScopeSum()
}

function onRow(row) { openDetail(row.payId) }
function rowClass({ row }) { return row.payId === highlightId.value ? 'row--focus' : '' }
function spaceText(p) {
  if (p.subjectType === 'park') return `${p.communityName} · 车位收费（无楼栋）`
  return [p.communityName, p.buildingName, p.unitName].filter(Boolean).join(' / ') || p.communityName
}
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }
function jump(path, focus) { router.push(`${path}?focus=${focus}&open=1`) }
/** B2：从流水直接开票 —— 带上流水号，票据页「待开票」页签自动定位该笔 */
function goInvoice() {
  const pid = detailData.value?.payment?.payId
  router.push(pid ? `/b/invoices?pay=${pid}` : '/b/invoices')
}

/* X4 收据打印 */
const receiptVisible = ref(false)
const today = new Date().toLocaleDateString('zh-CN')
const amountCn = computed(() => toCny(Number(detailData.value?.payment?.amount || 0)))
/** 人民币金额大写（收据用） */
function toCny(n) {
  const D = '零壹贰叁肆伍陆柒捌玖'
  if (!n || n <= 0) return '零元整'
  const int = Math.floor(n)
  const cents = Math.round(n * 100) - int * 100
  const jiao = Math.floor(cents / 10)
  const fen = cents % 10
  const U = ['', '拾', '佰', '仟']
  const G = ['', '万', '亿']
  let s = String(int), out = '', gi = 0
  while (s.length) {
    const g = s.slice(-4); s = s.slice(0, -4)
    let t = '', zero = false
    for (let i = 0; i < g.length; i++) {
      const d = +g[i], pos = g.length - 1 - i
      if (d === 0) { zero = true; continue }
      if (zero && t) t += '零'
      zero = false
      t += D[d] + U[pos]
    }
    out = t ? t + G[gi] + out : (out && !out.startsWith('零') ? '零' + out : out)
    gi++
  }
  out = (out || '零') + '元'
  if (!jiao && !fen) return out + '整'
  let dec = jiao ? D[jiao] + '角' : '零'
  if (fen) dec += D[fen] + '分'
  return out + dec
}
function doPrintReceipt() {
  const pid = detailData.value?.payment?.payId || '收据'
  if (!printArea(`收款收据 ${pid}`, '.print-area')) ElMessage.warning('打印窗口被浏览器拦截，请允许弹窗后重试')
}

/* 落地：账单页 / 房屋台账跳过来带 pay:流水号 或 house:房号 */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  if (focus?.type === 'pay' && location) {
    Object.assign(query, BLANK)
    // 带单号进来时同时用关键字锁到该笔：流水按时间倒序，单号未必落在第一页，不高亮就等于没落地
    Object.assign(query, {
      communityId: location.communityId || '', buildingId: location.buildingId || '',
      unitId: location.unitId || '', kw: focus.id
    })
    await load()
    await syncScopeSum()
    highlightId.value = location.payId || ''
    if (open && location.payId) openDetail(location.payId)
    return
  }
  if ((focus?.type === 'house' || focus?.type === 'bill') && location) {
    Object.assign(query, BLANK)
    Object.assign(query, {
      communityId: location.communityId || '', buildingId: location.buildingId || '', unitId: location.unitId || ''
    })
    await load()
    await syncScopeSum()
    return
  }
  Object.assign(query, BLANK)
  onlyPark.value = false
  await load()
  await syncScopeSum()
})
onMounted(() => { run(); syncSummary() })
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.is-warn-text { color: var(--biz-warning); }
</style>
