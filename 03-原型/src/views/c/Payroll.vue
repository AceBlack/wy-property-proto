<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>工资表</b>：按「应发 → 代扣 → 实发」三段核算，<b>金额由数据层算，页面不加总</b>。
        工资条是<b>核算快照</b>不是查询结果——生成 → 核算锁定 → 提交发放 → 审批 → 发放，
        核算那一刻金额就冻住了（实时算的话，补录一条加班数字就变，员工截图来问谁也说不清）。
        <b>提交人不能审批自己的发放单</b>，页面上会提示切换角色。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar" style="margin-bottom:0;">
        <el-select v-model="period" style="width:150px;" @change="reload">
          <el-option v-for="p in periods" :key="p.period" :label="`${p.period} · ${p.status}`" :value="p.period" />
        </el-select>
        <el-select v-model="org" placeholder="全部项目" clearable style="width:150px;" @change="reload">
          <el-option v-for="o in orgOpts" :key="o.orgId" :label="o.label" :value="o.orgId" />
        </el-select>
        <el-input v-model="kw" placeholder="姓名 / 工号" clearable style="width:170px;" @change="reload" />
        <span class="tag" :class="statusTagCls">{{ summary.status || '—' }}</span>
        <span v-if="summary.batchNo" class="desc">{{ summary.batchNo }}</span>
        <span class="spacer" />
        <el-button v-if="isDraft" :icon="'Refresh'" :loading="busy" @click="doRecalc">重新核算</el-button>
        <el-button v-if="isDraft" type="primary" :icon="'Lock'" :loading="busy" @click="doConfirm">核算锁定</el-button>
        <el-button v-if="isConfirmed" type="primary" :icon="'Money'" :loading="busy" @click="doPay">提交发放</el-button>
        <template v-if="isPending">
          <el-button type="success" :loading="busy" @click="doApprove">审批通过</el-button>
          <el-button :loading="busy" @click="doReject">驳回</el-button>
        </template>
        <el-button :icon="'Download'">导出工资表</el-button>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <KpiCard label="核算人数" :value="summary.employeeCount || 0" unit="人" icon="UserFilled" />
      <KpiCard label="应发合计" :value="summary.grossTotal || 0" unit="元" icon="Wallet" gradient />
      <KpiCard label="代扣合计" :value="summary.deductionTotal || 0" unit="元" icon="Remove" color="#FF9F40" />
      <KpiCard label="实发合计" :value="summary.netTotal || 0" unit="元" icon="Money" color="#2ED9A3" />
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>{{ summary.period || period }} 工资表</h3>
        <span class="spacer" />
        <span class="desc">
          共 {{ summary.employeeCount || 0 }} 人 · 数据来源：员工档案 + 考勤 + 绩效
          <template v-if="summary.reversedCount">
            · 已冲正 {{ summary.reversedCount }} 笔 / {{ money(summary.reversedAmount) }}（不计入实发）
          </template>
        </span>
      </div>

      <el-table v-loading="loading" :data="rows" max-height="calc(100vh - 390px)">
        <el-table-column prop="empNo" label="工号" width="92" fixed />
        <el-table-column prop="empName" label="姓名" min-width="92" fixed show-overflow-tooltip />
        <el-table-column prop="position" label="岗位" min-width="104" show-overflow-tooltip />
        <el-table-column prop="orgName" label="所属" min-width="130" show-overflow-tooltip />
        <el-table-column prop="base" label="基本工资" min-width="110" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.base) }}</span></template>
        </el-table-column>
        <el-table-column prop="performance" label="绩效" min-width="100" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.performance) }}</span></template>
        </el-table-column>
        <el-table-column prop="overtime" label="加班费" min-width="100" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.overtime) }}</span></template>
        </el-table-column>
        <el-table-column prop="grossPay" label="应发" min-width="118" align="right">
          <template #default="{ row }"><span class="money strong">{{ money(row.grossPay) }}</span></template>
        </el-table-column>
        <el-table-column prop="socialInsurance" label="社保" min-width="104" align="right">
          <template #default="{ row }"><span class="money money--out">{{ money(row.socialInsurance) }}</span></template>
        </el-table-column>
        <el-table-column prop="housingFund" label="公积金" min-width="104" align="right">
          <template #default="{ row }"><span class="money money--out">{{ money(row.housingFund) }}</span></template>
        </el-table-column>
        <el-table-column prop="tax" label="个税" min-width="96" align="right">
          <template #default="{ row }"><span class="money money--out">{{ money(row.tax) }}</span></template>
        </el-table-column>
        <el-table-column prop="netPay" label="实发" min-width="118" align="right">
          <template #default="{ row }"><span class="money strong">{{ money(row.netPay) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="112">
          <template #default="{ row }">
            <span class="tag" :class="rowTagCls(row.status)">{{ row.status }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" @click="openDetail(row)">明细</el-button>
            <el-button v-if="row.status === '已发放'" link type="danger" size="small" @click="doReverse(row)">冲正</el-button>
          </template>
        </el-table-column>
        <template #empty><EmptyState type="search" desc="该账期没有工资数据" /></template>
      </el-table>

      <div class="table-foot">
        <el-pagination v-model:current-page="page" :page-size="size" :total="total"
          layout="total, prev, pager, next" @current-change="reload" />
      </div>
    </div>

    <!-- 工资条明细：分解项 + 时间线，全部由服务端给，页面不自己拼 -->
    <el-drawer v-model="detailOpen" :title="detail?.payroll?.empName ? `${detail.payroll.empName} 工资条` : '工资条'" size="480px">
      <template v-if="detail">
        <div class="dl dl--2">
          <div class="dl__i"><span class="dl__k">账期</span><span class="dl__v">{{ detail.payroll.period }}</span></div>
          <div class="dl__i"><span class="dl__k">状态</span><span class="dl__v">{{ detail.payroll.status }}</span></div>
          <div class="dl__i"><span class="dl__k">岗位</span><span class="dl__v">{{ detail.payroll.position }}</span></div>
          <div class="dl__i"><span class="dl__k">职级</span><span class="dl__v">{{ detail.payroll.level }}</span></div>
        </div>

        <div class="sec__hd" style="margin:16px 0 8px;"><h4>应发</h4></div>
        <div class="calc">
          <div v-for="i in detail.calc.gross" :key="i.label" class="calc__r">
            <span>{{ i.label }}<em v-if="i.note">{{ i.note }}</em></span>
            <b class="money">{{ money(i.amount) }}</b>
          </div>
          <div class="calc__r calc__r--sum"><span>应发合计</span><b class="money">{{ money(detail.payroll.grossPay) }}</b></div>
        </div>

        <div class="sec__hd" style="margin:16px 0 8px;"><h4>代扣</h4></div>
        <div class="calc">
          <div v-for="i in detail.calc.deductions" :key="i.label" class="calc__r">
            <span>{{ i.label }}<em v-if="i.note">{{ i.note }}</em></span>
            <b class="money money--out">{{ money(i.amount) }}</b>
          </div>
          <div class="calc__r calc__r--sum"><span>代扣合计</span><b class="money money--out">{{ money(detail.payroll.deductionTotal) }}</b></div>
          <div class="calc__r calc__r--net"><span>实发</span><b class="money">{{ money(detail.calc.netPay) }}</b></div>
        </div>

        <div class="sec__hd" style="margin:16px 0 8px;"><h4>银行卡</h4></div>
        <div class="card-row">
          <span class="money">{{ detail.bankCard.masked }}</span>
          <el-button v-if="detail.bankCard.revealable" link size="small" @click="doReveal">查看完整卡号</el-button>
          <span v-else class="muted" style="font-size:12px;">无「敏感字段明文」权限</span>
        </div>

        <div class="sec__hd" style="margin:16px 0 8px;"><h4>流转记录</h4></div>
        <el-timeline>
          <el-timeline-item v-for="(e, i) in detail.timeline" :key="i" :timestamp="e.at" placement="top">
            <b>{{ e.action }}</b>
            <span v-if="e.operator" class="muted"> · {{ e.operator }}</span>
            <div v-if="e.note" class="muted" style="font-size:12px;">{{ e.note }}</div>
          </el-timeline-item>
        </el-timeline>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  approvePayrollPay, confirmPayroll, generatePayroll, getPayroll, orgOptions,
  payrollPeriods, payrollSummary, queryPayrolls, reversePayroll, revealPayrollBankCard,
  submitPayrollPay
} from '@/api'
import KpiCard from '@/components/KpiCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'

const orgOpts = orgOptions()
const periods = ref([])
const period = ref('')
const org = ref('')
const kw = ref('')
const page = ref(1)
const size = ref(20)
const rows = ref([])
const total = ref(0)
const summary = ref({})
const loading = ref(false)
const busy = ref(false)
const detailOpen = ref(false)
const detail = ref(null)

const rowTagCls = s => ({
  草稿: 'tag--muted', 已核算: 'tag--warning', 待发放审批: 'tag--warning',
  已发放: 'tag--success', 已冲正: 'tag--danger'
}[s] || 'tag--muted')

const status = computed(() => summary.value.status || '')
const statusTagCls = computed(() => rowTagCls(status.value))
const isDraft = computed(() => status.value === '草稿')
const isConfirmed = computed(() => status.value === '已核算')
const isPending = computed(() => status.value === '待发放审批')

async function reload() {
  loading.value = true
  try {
    const [list, sum] = await Promise.all([
      queryPayrolls({
        period: period.value, pageNo: page.value, size: size.value,
        filters: { orgId: org.value, kw: kw.value }
      }),
      payrollSummary(period.value)
    ])
    rows.value = list.rows
    total.value = list.total
    summary.value = sum
    if (!period.value) period.value = sum.period
    periods.value = await payrollPeriods()
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

/** 写操作统一走这里：成功刷列表，失败把后端那句话原样给用户（不要吞成"操作失败"） */
async function act(fn, okMsg) {
  busy.value = true
  try {
    await fn()
    ElMessage.success(okMsg)
    await reload()
    return true
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
    return false
  } finally {
    busy.value = false
  }
}

function doRecalc() {
  ElMessageBox.confirm('重新核算会按最新考勤与绩效重算本期全部金额（只有草稿期可重算）。', '重新核算', {
    type: 'warning', confirmButtonText: '重算', cancelButtonText: '取消'
  }).then(() => act(() => generatePayroll({ period: period.value, overwrite: true }), '已按最新数据重算'))
    .catch(() => {})
}

const doConfirm = () => act(() => confirmPayroll(period.value), '已核算锁定：金额冻结，可提交发放')

/** 默认发放日：次月 10 日 */
function nextPayDate() {
  const [y, m] = String(summary.value.period || period.value || '2026-10').split('-').map(Number)
  return new Date(Date.UTC(y, m, 10)).toISOString().slice(0, 10)
}

function doPay() {
  ElMessageBox.prompt('发放日期（YYYY-MM-DD）', '提交发放', {
    inputValue: nextPayDate(), confirmButtonText: '提交', cancelButtonText: '取消',
    inputPattern: /^\d{4}-\d{2}-\d{2}$/, inputErrorMessage: '格式应为 YYYY-MM-DD'
  }).then(({ value }) => act(() => submitPayrollPay(period.value, { payDate: value }), '已提交发放，等待审批'))
    .catch(() => {})
}

const doApprove = () => act(() => approvePayrollPay(period.value, { decision: 'approve' }), '审批通过，已发放')

function doReject() {
  ElMessageBox.prompt('驳回原因（至少 4 个字）', '驳回发放', {
    inputType: 'textarea', confirmButtonText: '驳回', cancelButtonText: '取消'
  }).then(({ value }) => act(() => approvePayrollPay(period.value, { decision: 'reject', reason: value }), '已驳回，回到已核算'))
    .catch(() => {})
}

function doReverse(row) {
  ElMessageBox.prompt(`冲正 ${row.empName} 这笔 ${money(row.netPay)}（原因至少 10 个字）`, '单笔冲正', {
    inputType: 'textarea', confirmButtonText: '冲正', cancelButtonText: '取消'
  }).then(({ value }) => act(() => reversePayroll(row.payrollId, value), '已冲正：这笔不再计入实发合计'))
    .catch(() => {})
}

async function openDetail(row) {
  try {
    detail.value = await getPayroll(row.payrollId)
    detailOpen.value = true
  } catch (e) {
    ElMessage.error(e?.message || '加载明细失败')
  }
}

async function doReveal() {
  try {
    const { value } = await ElMessageBox.prompt('查看完整卡号的原因（至少 4 个字，会记录留痕）', '揭示银行卡', {
      confirmButtonText: '查看', cancelButtonText: '取消'
    })
    const r = await revealPayrollBankCard(detail.value.payroll.payrollId, value)
    detail.value.bankCard = { ...detail.value.bankCard, masked: r.bankCard }
    ElMessage.success(`已记录留痕：${r.accessLogId || '—'}`)
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e?.message || '无权查看')
  }
}

onMounted(reload)
</script>

<style scoped>
.calc { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.calc__r { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.calc__r > span { color: var(--biz-text-2); }
.calc__r em { display: block; font-style: normal; font-size: 11px; color: var(--biz-text-3); }
.calc__r--sum { border-top: 1px dashed var(--biz-border); padding-top: 6px; }
.calc__r--net { border-top: 1px solid var(--biz-border); padding-top: 8px; margin-top: 2px; font-size: 15px; }
.card-row { display: flex; align-items: center; gap: 10px; }
</style>
