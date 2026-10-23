<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>发票与收据 · A 级交互</b>：票据台账 + 待开票池两张表。①待开票勾选后可<b>单张或批量</b>开票（电子发票 / 增值税普通发票 / 收据）；
        ②「已开具」的票据可<b>红冲</b>（必填原因），红冲后缴费流水回到未开票；③开具失败的票据可重试。
        开票为<b>内存态</b>，刷新还原；正式实现应接税控设备并返回票据号与 PDF 地址。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel rsum"><div class="rsum__l">票据总数</div><div class="rsum__v">{{ sum.count }}<span class="unit">张</span></div></div>
      <div class="panel rsum"><div class="rsum__l">开票金额</div><div class="rsum__v">¥ {{ money(sum.amount) }}</div></div>
      <div class="panel rsum"><div class="rsum__l">税额合计</div><div class="rsum__v">¥ {{ money(sum.tax) }}</div></div>
      <div class="panel rsum">
        <div class="rsum__l">红冲 / 失败</div>
        <div class="rsum__v">{{ sum.redCount }}<span class="unit"> / {{ sum.failCount }}</span></div>
      </div>
    </div>

    <el-tabs v-model="tab" style="margin-top:16px;">
      <el-tab-pane label="票据台账" name="list">
        <div class="panel" style="margin-top:12px;">
          <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
            <el-form-item label="票据类型">
              <el-select v-model="query.type" placeholder="全部" clearable style="width:140px">
                <el-option v-for="t in INVOICE_TYPES" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width:110px">
                <el-option v-for="s in ['已开具', '已红冲', '开具失败']" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item label="项目">
              <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px">
                <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="票据号 / 业主 / 流水号" clearable style="width:160px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>
        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 张</span>
            <span class="spacer" />
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
          </div>
          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 400px)">
            <el-table-column prop="invoiceNo" label="票据号" width="150" />
            <el-table-column prop="type" label="类型" width="140" />
            <el-table-column prop="houseName" label="房屋" min-width="170" show-overflow-tooltip />
            <el-table-column prop="ownerName" label="业主" width="90" />
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }"><span class="money">¥ {{ money(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column label="税额" width="100" align="right">
              <template #default="{ row }"><span class="muted">¥ {{ money(row.taxAmount) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }"><StatusTag domain="invoice" :value="row.status" /></template>
            </el-table-column>
            <el-table-column prop="channel" label="渠道" width="100" />
            <el-table-column prop="issueTime" label="开具时间" width="140" />
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button link type="danger" :disabled="row.status !== '已开具'" @click="onRed(row)">红冲</el-button>
                <el-button
                  link type="primary" v-if="row.status === '开具失败'"
                  @click="retry(row)"
                >重试</el-button>
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
      </el-tab-pane>

      <el-tab-pane :label="`待开票 ${pendTotal}`" name="pending">
        <div class="panel" style="margin-top:12px;">
          <el-form :model="pq" class="filter-bar" label-width="72px" @submit.prevent>
            <el-form-item label="项目">
              <el-select v-model="pq.communityId" placeholder="全部" clearable style="width:130px">
                <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="pq.kw" placeholder="流水号 / 业主 / 交易号" clearable style="width:170px" @keyup.enter="searchP" />
            </el-form-item>
            <el-form-item class="acts"><el-button :icon="'Search'" @click="searchP">查询</el-button></el-form-item>
          </el-form>
        </div>
        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Printer'" :disabled="!picked.length" @click="issueVisible = true">
              批量开票{{ picked.length ? `（${picked.length} 笔）` : '' }}
            </el-button>
            <span class="spacer" />
            <span class="muted" style="font-size:12.5px;">
              已选 {{ picked.length }} 笔 / ¥{{ money(pickedAmount) }}
            </span>
          </div>
          <el-table v-loading="pLoading" :data="pRows" style="width:100%" max-height="calc(100vh - 380px)" @selection-change="onSel">
            <el-table-column type="selection" width="46" />
            <el-table-column prop="payId" label="流水号" width="110" />
            <el-table-column prop="houseName" label="房屋" min-width="170" show-overflow-tooltip />
            <el-table-column prop="ownerName" label="业主" width="90" />
            <el-table-column label="收款金额" width="110" align="right">
              <template #default="{ row }"><span class="money">¥ {{ money(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column prop="method" label="支付方式" width="100" />
            <el-table-column prop="channel" label="渠道" width="110" />
            <el-table-column prop="payTime" label="收款时间" width="120" />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="issueOne(row)">开票</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination
              background layout="total, sizes, prev, pager, next"
              :total="pendTotal" :current-page="pPageNo" :page-size="pSize" :page-sizes="PAGE_SIZES"
              @current-change="p => { pPageNo.value = p; loadP() }" @size-change="s => { pSize.value = s; loadP() }"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 批量开票 -->
    <el-dialog v-model="issueVisible" title="开具票据" width="460">
      <el-form label-width="88px">
        <el-form-item label="开票笔数"><b>{{ picked.length }}</b> 笔</el-form-item>
        <el-form-item label="金额合计"><span class="money">¥ {{ money(pickedAmount) }}</span></el-form-item>
        <el-form-item label="票据类型">
          <el-select v-model="issueType" style="width:100%">
            <el-option v-for="t in INVOICE_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="issueVisible = false">取消</el-button>
        <el-button type="primary" @click="doIssue">确认开具</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import { useListQuery } from '@/composables/useQuery'
import { exportList } from '@/utils/export'
import { money } from '@/utils/format'
import {
  INVOICE_TYPES, PAGE_SIZES, communityOpts, invoiceSummary, issueInvoice,
  pendingInvoiceRows, queryInvoices, redInvoice
} from '@/utils/api'

const tab = ref('list')
const sum = ref(invoiceSummary())

// —— 票据台账 ——
const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(queryInvoices, {
  filters: { type: '', status: '', communityId: '', kw: '' }, size: 20
})

async function onRed(row) {
  try {
    const { value } = await ElMessageBox.prompt('请填写红冲原因（将记录在票据台账）', '红冲票据', {
      inputPlaceholder: '如：业主要求拆分票据', inputValidator: v => !!v || '原因必填'
    })
    redInvoice(row.invoiceId, value)
    ElMessage.success('已红冲，缴费流水回到未开票')
    sum.value = invoiceSummary()
    load(); loadP()
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.message)
  }
}
function retry(row) {
  ElMessage.info(`已重新提交开票请求（${row.invoiceNo}）——原型阶段为提示`);
}

// —— 待开票 ——
const pq = ref({ communityId: '', kw: '' })
const pRows = ref([]); const pendTotal = ref(0); const pPageNo = ref(1); const pSize = ref(20); const pLoading = ref(false)
async function loadP() {
  pLoading.value = true
  try {
    const res = await pendingInvoiceRows({ pageNo: pPageNo.value, size: pSize.value, filters: { ...pq.value } })
    pRows.value = res.rows; pendTotal.value = res.total
  } finally { pLoading.value = false }
}
function searchP() { pPageNo.value = 1; loadP() }
loadP()

// 缴费流水页「开票」带 ?pay=流水号 过来：直接定位到待开票页签的这一笔
const route = useRoute()
if (route.query.pay) {
  tab.value = 'pending'
  pq.value = { ...pq.value, kw: String(route.query.pay) }
  loadP()
}

const picked = ref([])
const pickedAmount = computed(() => picked.value.reduce((s, r) => s + r.amount, 0))
function onSel(list) { picked.value = list }

const issueVisible = ref(false)
const issueType = ref('电子发票')
async function issueOne(row) {
  picked.value = [row]
  issueType.value = '电子发票'
  issueVisible.value = true
}
async function doIssue() {
  try {
    const res = issueInvoice(picked.value.map(r => r.payId), issueType.value)
    ElMessage.success(`已开具 ${res.count} 张${issueType.value}${res.skipped.length ? `，跳过 ${res.skipped.length} 笔` : ''}`)
    issueVisible.value = false
    picked.value = []
    sum.value = invoiceSummary()
    tab.value = 'list'
    load(); loadP()
  } catch (e) { ElMessage.error(e?.message || '开票失败') }
}

const INV_COLS = [
  { prop: 'invoiceNo', label: '票据号' }, { prop: 'type', label: '类型' },
  { prop: 'houseName', label: '房屋' }, { prop: 'ownerName', label: '业主' },
  { prop: 'amount', label: '金额' }, { prop: 'taxAmount', label: '税额' },
  { prop: 'status', label: '状态' }, { prop: 'issueTime', label: '开具时间' }
]
function onExport() {
  exportList({ name: '票据台账', source: '/b/invoices', columns: INV_COLS, rows: rows.value, filters: { ...query } })
}
</script>
