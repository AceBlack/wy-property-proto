<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>装修押金台账 · A 级交互</b>：押金场景已收敛为<b>装修押金</b>一种（租约押金、车位押金不存在）。
        流程为「<b>收取 → 装修登记 → 验收 → 退款 / 扣款</b>」：①「登记押金」新建；②装修中 / 已逾期的记录可「验收」，验收时填验收日与扣款；
        ③验收后可「退款」，支持部分退，退完自动置「已退还」。三项写操作均为<b>内存态</b>。
        口径：<code>收 = 退 + 扣 + 在账</code>（押金报表与此处同源）。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(5,minmax(0,1fr));">
      <div class="panel rsum"><div class="rsum__l">押金笔数</div><div class="rsum__v">{{ sum.count }}<span class="unit">笔</span></div></div>
      <div class="panel rsum"><div class="rsum__l">收取合计</div><div class="rsum__v">¥ {{ money(sum.payable) }}</div></div>
      <div class="panel rsum"><div class="rsum__l">已退</div><div class="rsum__v">¥ {{ money(sum.paid) }}</div></div>
      <div class="panel rsum"><div class="rsum__l">扣除</div><div class="rsum__v money--out">¥ {{ money(sum.deduct) }}</div></div>
      <div class="panel rsum"><div class="rsum__l">在账余额</div><div class="rsum__v money--out">¥ {{ money(sum.unpaid) }}</div></div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px">
            <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
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
        <el-button type="primary" :icon="'Plus'" @click="$router.push('/b/deposits/new')">登记装修押金</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 笔 · 逾期未验收 {{ sum.overdueCount }} 笔</span>
      </div>
      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 420px)" @row-click="onRow">
        <el-table-column prop="applyNo" label="申请单号" width="130" />
        <el-table-column prop="houseName" label="房屋" min-width="170" show-overflow-tooltip />
        <el-table-column prop="ownerName" label="业主" width="90" />
        <el-table-column label="押金" width="100" align="right">
          <template #default="{ row }"><span class="money">¥ {{ money(row.amount) }}</span></template>
        </el-table-column>
        <el-table-column prop="paidDate" label="收款日" width="110" />
        <el-table-column prop="startDate" label="开工日" width="110" />
        <el-table-column prop="planEndDate" label="计划完工" width="110" />
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
              link type="primary" :disabled="!['装修中', '已逾期'].includes(row.status)"
              @click.stop="openCheck(row)"
            >验收</el-button>
            <el-button
              link type="primary" :disabled="!row.checkDate || !canRefund(row)"
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
    <DetailDrawer v-model="detailVisible" :loading="detailLoading" title="装修押金详情" width="640">
      <template v-if="detailData">
        <div class="sec">
          <div class="sec__hd"><h4>押金信息</h4></div>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="申请单号">{{ detailData.applyNo }}</el-descriptions-item>
            <el-descriptions-item label="房屋">{{ detailData.houseName }}</el-descriptions-item>
            <el-descriptions-item label="业主">{{ detailData.ownerName }}</el-descriptions-item>
            <el-descriptions-item label="联系电话">{{ maskPhone(detailData.phone) }}</el-descriptions-item>
            <el-descriptions-item label="押金金额">¥ {{ money(detailData.amount) }}</el-descriptions-item>
            <el-descriptions-item label="在账余额">¥ {{ money(detailData.balance) }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <StatusTag domain="deposit" :value="detailData.status" />
            </el-descriptions-item>
            <el-descriptions-item label="经办人">{{ detailData.operator }}</el-descriptions-item>
          </el-descriptions>
        </div>
        <div class="sec" style="margin-top:14px;">
          <div class="sec__hd"><h4>时间线</h4></div>
          <el-timeline style="margin-top:10px;">
            <el-timeline-item timestamp="收款" :type="'success'">{{ detailData.paidDate }} 收取押金 ¥{{ money(detailData.amount) }}</el-timeline-item>
            <el-timeline-item timestamp="开工">{{ detailData.startDate }}（计划完工 {{ detailData.planEndDate }}）</el-timeline-item>
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
          type="primary" v-if="detailData && ['装修中', '已逾期'].includes(detailData.status)"
          @click="openCheck(detailData); detailVisible = false"
        >验收</el-button>
        <el-button
          type="primary" v-else-if="detailData && detailData.checkDate && canRefund(detailData)"
          @click="openRefund(detailData); detailVisible = false"
        >退款</el-button>
      </template>
    </DetailDrawer>

    <!-- 验收 -->
    <el-dialog v-model="checkVisible" title="装修验收" width="480">
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
  PAGE_SIZES, checkDeposit, communityOpts, depositStatusOpts, depositSummary,
  getDepositDetail, queryDeposits, refundDeposit
} from '@/utils/api'

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(queryDeposits, {
  filters: { communityId: '', status: '', kw: '' }, size: 20
})
const sum = ref(depositSummary())
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
  { prop: 'applyNo', label: '申请单号' }, { prop: 'houseName', label: '房屋' },
  { prop: 'ownerName', label: '业主' }, { prop: 'amount', label: '押金' },
  { prop: 'paidDate', label: '收款日' }, { prop: 'planEndDate', label: '计划完工' },
  { prop: 'status', label: '状态' }, { prop: 'deductAmount', label: '扣除' },
  { prop: 'balance', label: '在账' }
]
function onExport() {
  exportList({ name: '装修押金台账', source: '/b/deposits', columns: COlS, rows: rows.value, filters: { ...query } })
}
</script>
