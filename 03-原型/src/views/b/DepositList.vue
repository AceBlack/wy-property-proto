<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>押金台账 · 所有押金类都在这里</b>：装修押金、门禁卡 / 车牌押金、履约保证金、租约押金。
        流程按<b>类型</b>驱动 —— 要工期的走「收取 → 施工 → 验收 → 退款」，
        不要工期的走「收取 → 退款」，不硬套一套状态机。
        <br />
        口径：<code>收 = 退 + 扣 + 在账</code>；押金是<b>负债不是收入</b>，对应分类「押金及保证金」（<code>LIA_DEPOSIT</code>），
        只有<b>扣款部分</b>（违约扣留）才转收入 —— 混进营业收入就是虚增营收（和已下线的预存是同一类错）。
        <br />
        类型决定四件事：要不要工期 / 要不要验收 / 金额是否固定 / 能否部分退。维护类型去
        <router-link to="/b/deposit-types">押金类型字典</router-link>。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(5,minmax(0,1fr));">
      <div class="panel rsum"><div class="rsum__l">押金笔数</div><div class="rsum__v">{{ sum.count }}<span class="unit">笔</span></div></div>
      <div class="panel rsum"><div class="rsum__l">收取合计</div><div class="rsum__v">¥ {{ money(sum.payable) }}</div></div>
      <div class="panel rsum"><div class="rsum__l">已退</div><div class="rsum__v">¥ {{ money(sum.paid) }}</div></div>
      <div class="panel rsum"><div class="rsum__l">扣除</div><div class="rsum__v money--out">¥ {{ money(sum.deduct) }}</div></div>
      <div class="panel rsum"><div class="rsum__l">在账余额</div><div class="rsum__v money--out">¥ {{ money(sum.unpaid) }}</div></div>
    </div>

    <div v-if="sum.byType?.length" class="panel typebar">
      <div class="typebar__t">按类型在账</div>
      <div class="typebar__i" v-for="t in sum.byType" :key="t.type"
        :class="{ 'is-on': query.type === t.type }" @click="filterType(t.type)">
        <span class="typebar__n">{{ t.type }}</span>
        <span class="typebar__c">{{ t.count }} 笔</span>
        <span class="typebar__v">¥ {{ money(t.balance) }}</span>
      </div>
      <span class="spacer" />
      <span class="muted" style="font-size:11.5px;">在账合计 ¥ {{ money(sum.unpaid) }}</span>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px">
            <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="query.type" placeholder="全部" clearable style="width:140px" @change="search">
            <el-option v-for="o in typeOpts" :key="o.value" :label="o.value" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width:110px">
            <el-option v-for="s in depositStatusOpts()" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="单号 / 房号 / 业主" clearable style="width:160px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Plus'" @click="$router.push('/b/deposits/new')">登记押金</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 笔 · 逾期未验收 {{ sum.overdueCount }} 笔</span>
      </div>
      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 420px)" @row-click="onRow">
        <el-table-column prop="applyNo" label="申请单号" width="130" />
        <el-table-column label="类型" width="120">
          <template #default="{ row }"><span class="dtype">{{ row.type }}</span></template>
        </el-table-column>
        <el-table-column prop="houseName" label="房屋" min-width="150" show-overflow-tooltip />
        <el-table-column prop="ownerName" label="业主" width="90" />
        <el-table-column label="押金" width="100" align="right">
          <template #default="{ row }"><span class="money">¥ {{ money(row.amount) }}</span></template>
        </el-table-column>
        <el-table-column prop="paidDate" label="收款日" width="110" />
        <el-table-column label="工期" width="180">
          <template #default="{ row }">
            <span v-if="row.startDate" class="muted">{{ row.startDate }} ~ {{ row.planEndDate }}</span>
            <span v-else class="muted">不设工期</span>
          </template>
        </el-table-column>
        <el-table-column prop="checkDate" label="验收日" width="110">
          <template #default="{ row }">{{ row.checkDate || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><StatusTag domain="deposit" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="扣除" width="90" align="right">
          <template #default="{ row }">
            <span v-if="row.deductAmount" class="money--out">¥ {{ money(row.deductAmount) }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="在账" width="100" align="right">
          <template #default="{ row }">
            <span :class="row.balance > 0 ? 'money--out' : 'muted'">¥ {{ money(row.balance) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button
              link type="primary" :disabled="!canCheck(row)"
              @click.stop="openCheck(row)"
            >验收</el-button>
            <el-button
              link type="primary" :disabled="!canRefundRow(row)"
              @click.stop="openRefund(row)"
            >退款</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          background layout="total, sizes, prev, pager, next"
          :total="total" :current-page="pageNo" :page-size="size" :page-sizes="PAGE_SIZES"
          @current-change="p => { pageNo.value = p; load() }" @size-change="s => { size.value = s; load() }"
        />
      </div>
    </div>

    <!-- 详情抽屉 -->
    <DetailDrawer v-model="detailVisible" :loading="detailLoading" title="押金详情" width="640">
      <template v-if="detailData">
        <div class="sec">
          <div class="sec__hd"><h4>押金信息</h4></div>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="申请单号">{{ detailData.applyNo }}</el-descriptions-item>
            <el-descriptions-item label="押金类型">{{ detailData.type }}</el-descriptions-item>
            <el-descriptions-item label="房屋">{{ detailData.houseName }}</el-descriptions-item>
            <el-descriptions-item label="业主">{{ detailData.ownerName }}</el-descriptions-item>
            <el-descriptions-item label="联系电话">{{ maskPhone(detailData.phone) }}</el-descriptions-item>
            <el-descriptions-item label="押金金额">¥ {{ money(detailData.amount) }}</el-descriptions-item>
            <el-descriptions-item label="在账余额">¥ {{ money(detailData.balance) }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <StatusTag domain="deposit" :value="detailData.status" />
            </el-descriptions-item>
            <el-descriptions-item label="经办人">{{ detailData.operator }}</el-descriptions-item>
            <el-descriptions-item label="是否需验收">{{ needCheckOf(detailData.type) ? '需要' : '不需要（退卡/退牌即退）' }}</el-descriptions-item>
          </el-descriptions>
        </div>
        <div class="sec" style="margin-top:14px;">
          <div class="sec__hd"><h4>时间线</h4></div>
          <el-timeline style="margin-top:10px;">
            <el-timeline-item timestamp="收款" :type="'success'">{{ detailData.paidDate }} 收取押金 ¥{{ money(detailData.amount) }}</el-timeline-item>
            <el-timeline-item v-if="detailData.startDate" timestamp="开工">
              {{ detailData.startDate }}（计划完工 {{ detailData.planEndDate }}）
            </el-timeline-item>
            <el-timeline-item :timestamp="detailData.checkDate || '未验收'" :type="detailData.checkDate ? 'success' : 'primary'" :hollow="!detailData.checkDate">
              <span v-if="detailData.checkDate">
                验收完成<span v-if="detailData.deductAmount"> · 扣款 ¥{{ money(detailData.deductAmount) }}（{{ detailData.deductReason }}）</span>
              </span>
              <span v-else>待验收<span v-if="detailData.status === '已逾期'"> · 已超期 {{ detailData.overdueDays }} 天</span></span>
            </el-timeline-item>
            <el-timeline-item :timestamp="detailData.refundDate || '未退款'" :type="detailData.refundDate ? 'success' : 'primary'" :hollow="!detailData.refundDate">
              <span v-if="detailData.refundDate">退款 ¥{{ money(detailData.refundAmount) }}</span>
              <span v-else>待退款</span>
            </el-timeline-item>
          </el-timeline>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button
          type="primary" v-if="detailData && canCheck(detailData)"
          @click="openCheck(detailData); detailVisible = false"
        >验收</el-button>
        <el-button
          type="primary" v-else-if="detailData && canRefundRow(detailData)"
          @click="openRefund(detailData); detailVisible = false"
        >退款</el-button>
      </template>
    </DetailDrawer>

    <!-- 验收 -->
    <el-dialog v-model="checkVisible" title="押金验收" width="480">
      <el-form v-if="cur" label-width="96px">
        <el-form-item label="房屋">{{ cur.houseName }} · {{ cur.ownerName }}</el-form-item>
        <el-form-item label="押金金额">¥ {{ money(cur.amount) }}</el-form-item>
        <el-form-item label="验收日期" required>
          <el-date-picker v-model="checkForm.checkDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
        </el-form-item>
        <el-form-item label="扣款金额">
          <el-input v-model.number="checkForm.deductAmount" type="number" :min="0" :max="cur.amount" placeholder="无扣款填 0">
            <template #append>元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="扣款原因" v-if="checkForm.deductAmount > 0">
          <el-select v-model="checkForm.deductReason" allow-create filterable style="width:100%" placeholder="选择或输入">
            <el-option v-for="r in DEDUCT_REASONS" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="checkVisible = false">取消</el-button>
        <el-button type="primary" @click="doCheck">确认验收</el-button>
      </template>
    </el-dialog>

    <!-- 退款 -->
    <el-dialog v-model="refundVisible" title="押金退款" width="460">
      <el-form v-if="cur" label-width="96px">
        <el-form-item label="房屋">{{ cur.houseName }} · {{ cur.ownerName }}</el-form-item>
        <el-form-item label="可退余额">¥ {{ money(refundable(cur)) }}</el-form-item>
        <el-form-item label="退款金额">
          <el-input v-model.number="refundForm.refundAmount" type="number" :min="0" :max="refundable(cur)">
            <template #append>元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="退款日期">
          <el-date-picker v-model="refundForm.refundDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="refundVisible = false">取消</el-button>
        <el-button type="primary" @click="doRefund">确认退款</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { exportList } from '@/utils/export'
import { maskPhone, money } from '@/utils/format'
import {
  PAGE_SIZES, checkDeposit, communityOpts, depositStatusOpts, depositSummary, depositTypeOf,
  depositTypeOpts, getDepositDetail, queryDeposits, refundDeposit
} from '@/utils/api'

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(queryDeposits, {
  filters: { communityId: '', type: '', status: '', kw: '' }, size: 20
})
const sum = ref(depositSummary())
const typeOpts = depositTypeOpts().map(o => ({ value: o.value, label: o.label }))
function filterType(t) {
  query.type = query.type === t ? '' : t
  search()
}
const needCheckOf = type => {
  const def = depositTypeOf(type)
  return !def || def.needCheck
}
/* 验收：类型要验收 + 状态还没验收过。门禁卡、车牌不出现"验收"这个动作 */
const canCheck = d => needCheckOf(d.type) && ['在押', '装修中', '已逾期'].includes(d.status)
/* 退款：有余额可退；需验收的类型必须先验收 */
const canRefundRow = d => canRefund(d) && (!needCheckOf(d.type) || !!d.checkDate)
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getDepositDetail)
function onRow(row) { openDetail(row.depositId) }

const cur = ref(null)
const checkVisible = ref(false)
const refundVisible = ref(false)
const checkForm = ref({ checkDate: '', deductAmount: 0, deductReason: '' })
const refundForm = ref({ refundAmount: 0, refundDate: '' })
const DEDUCT_REASONS = [
  '破坏承重墙未恢复原状', '占用公共通道堆放装修垃圾', '超时施工引发多次投诉',
  '损坏电梯轿厢未赔偿', '装修垃圾未清运', '超出申请范围拆改阳台'
]

const refundable = d => Math.round((d.amount - d.deductAmount - d.refundAmount) * 100) / 100
const canRefund = d => refundable(d) > 0

function openCheck(row) {
  cur.value = row
  checkForm.value = { checkDate: '', deductAmount: 0, deductReason: '' }
  checkVisible.value = true
}
function openRefund(row) {
  cur.value = row
  refundForm.value = { refundAmount: refundable(row), refundDate: '' }
  refundVisible.value = true
}
async function doCheck() {
  try {
    const d = checkDeposit(cur.value.depositId, { ...checkForm.value })
    ElMessage.success(`验收完成，状态：${d.status}${d.deductAmount ? `，扣款 ¥${money(d.deductAmount)}` : ''}`)
    checkVisible.value = false
    sum.value = depositSummary()
    load()
  } catch (e) { ElMessage.error(e?.message || '验收失败') }
}
async function doRefund() {
  try {
    const d = refundDeposit(cur.value.depositId, { ...refundForm.value })
    ElMessage.success(`退款 ¥${money(d.refundAmount)} 成功，在账余额 ¥${money(d.balance)}`)
    refundVisible.value = false
    sum.value = depositSummary()
    load()
  } catch (e) { ElMessage.error(e?.message || '退款失败') }
}

const COlS = [
  { prop: 'applyNo', label: '申请单号' }, { prop: 'type', label: '押金类型' }, { prop: 'houseName', label: '房屋' },
  { prop: 'ownerName', label: '业主' }, { prop: 'amount', label: '押金' },
  { prop: 'paidDate', label: '收款日' }, { prop: 'planEndDate', label: '计划完工' },
  { prop: 'status', label: '状态' }, { prop: 'deductAmount', label: '扣除' },
  { prop: 'balance', label: '在账' }
]
function onExport() {
  exportList({ name: '押金台账', source: '/b/deposits', columns: COlS, rows: rows.value, filters: { ...query } })
}
</script>

<style scoped>
/* 按类型在账：一行铺开、可点筛选。押金是负债，"欠谁的钱、欠多少"要能一眼分类型看出来 */
.typebar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 16px; padding: 10px 14px;
}
.typebar__t { font-size: 12.5px; color: var(--biz-text-3); }
.typebar__i {
  display: inline-flex; align-items: baseline; gap: 8px; cursor: pointer;
  padding: 6px 12px; border: 1px solid var(--biz-border-light); border-radius: 8px;
  font-size: 12px; background: #fff; transition: all .16s;
}
.typebar__i:hover { border-color: var(--el-color-primary-light-5); }
.typebar__i.is-on { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.typebar__n { color: var(--biz-text-1); font-weight: 500; }
.typebar__c { color: var(--biz-text-3); }
.typebar__v { font-family: var(--biz-font-num); font-weight: 600; color: #a33; }
.dtype { font-size: 12px; color: var(--biz-text-2); }
</style>
