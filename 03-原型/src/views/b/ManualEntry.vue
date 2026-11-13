<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>手工补录</b>：给<b>没有单据流</b>的钱留的后门 —— 税金及附加、支付通道手续费、业主赔偿、
        无票的零星支出。这些钱真实发生了，但既没有报销单、也没有合同可摊。
        <br />
        规矩写在分类字典里：只有 <code>allowSources</code> 含 <b>manual</b> 的二级分类能选。
        <b>税费只能走这里</b>（`EXP_OP_TAX` 的允许来源只有 manual）；
        <b>差旅费、业务招待费</b>没有补录通道，必须走报销。
        办公费、维修材料虽然允许补录，但<b>优先走报销</b> —— 补录会绕过审批，只用于票据确实缺失的情形。
        补录只增不改：录错要作废重开，作废必须写原因。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(5,minmax(0,1fr));">
      <div class="panel rsum" data-card="me-count"><div class="rsum__l">已入账笔数</div><div class="rsum__v">{{ sum.count }}<span class="unit">笔</span></div></div>
      <div class="panel rsum" data-card="me-exp"><div class="rsum__l">支出合计</div><div class="rsum__v">¥ {{ wan(sum.expense) }}</div></div>
      <div class="panel rsum" data-card="me-inc"><div class="rsum__l">收入合计</div><div class="rsum__v">¥ {{ wan(sum.income) }}</div></div>
      <div class="panel rsum" data-card="me-tax">
        <div class="rsum__l">税金及附加</div>
        <div class="rsum__v money--out">¥ {{ wan(sum.tax) }}</div>
        <div class="rsum__s">{{ sum.taxCount }} 笔 · 只能补录，不能走报销</div>
      </div>
      <div class="panel rsum" data-card="me-void"><div class="rsum__l">已作废</div><div class="rsum__v">{{ sum.voided }}<span class="unit">笔</span></div></div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="56px" @submit.prevent>
        <el-form-item label="方向">
          <el-select v-model="query.direction" placeholder="全部" clearable style="width:96px" @change="onDirection">
            <el-option label="支出" value="expense" /><el-option label="收入" value="income" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="query.categoryCode" placeholder="全部" clearable style="width:150px">
            <el-option v-for="c in catOptsAll" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="账期">
          <el-date-picker v-model="query.period" type="month" value-format="YYYY-MM" placeholder="全部" clearable style="width:118px" />
        </el-form-item>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:120px">
            <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="单号 / 说明 / 来源" clearable style="width:160px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Plus'" @click="openNew">新建补录</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 笔 · 作废不删除，永久留档</span>
      </div>
      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 520px)">
        <el-table-column prop="entryNo" label="单号" width="126" />
        <el-table-column prop="period" label="账期" width="88" />
        <el-table-column label="方向" width="76">
          <template #default="{ row }">
            <span class="tag" :class="row.direction === 'income' ? 'tag--success' : 'tag--muted'">
              {{ row.direction === 'income' ? '收入' : '支出' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="分类" min-width="140">
          <template #default="{ row }">
            <div class="nowrap">{{ row.categoryName }}</div>
            <div class="ps-sub">{{ catParent(row.categoryCode) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="118" align="right">
          <template #default="{ row }">
            <span class="num" :class="row.direction === 'income' ? 'money' : 'money--out'">¥{{ money(row.amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="objectName" label="关联对象" min-width="120" show-overflow-tooltip />
        <el-table-column prop="source" label="来源" width="120" show-overflow-tooltip />
        <el-table-column label="附件" width="96">
          <template #default="{ row }">
            <span class="muted">{{ row.attachment ? '有' : '无' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="补录原因" min-width="180" show-overflow-tooltip />
        <el-table-column label="状态" width="92">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.status === '已作废' ? 'info' : 'success'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="86" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" :disabled="row.status === '已作废'" @click="doVoid(row)">作废</el-button>
          </template>
        </el-table-column>
        <template #empty><EmptyState type="search" desc="换个筛选条件试试" /></template>
      </el-table>
      <div class="pager">
        <el-pagination
          background layout="total, sizes, prev, pager, next"
          :total="total" :current-page="pageNo" :page-size="size" :page-sizes="PAGE_SIZES"
          @current-change="p => { pageNo = p; load() }" @size-change="s => { size = s; load() }"
        />
      </div>
    </div>

    <el-dialog v-model="dlgVisible" title="新建手工补录" width="560" :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="方向" prop="direction">
          <el-radio-group v-model="form.direction" @change="onFormDirection">
            <el-radio-button value="expense">支出</el-radio-button>
            <el-radio-button value="income">收入</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="费用分类" prop="categoryCode">
          <el-select v-model="form.categoryCode" filterable style="width:100%" placeholder="只列允许补录的二级分类">
            <el-option v-for="c in catOpts" :key="c.value" :label="`${c.parentName} / ${c.label}`" :value="c.value">
              <span>{{ c.label }}</span>
              <span class="opt-sub">{{ c.parentName }}</span>
            </el-option>
          </el-select>
          <div class="fld-tip">
            只列允许补录的分类。差旅费、业务招待费不在这里 —— 它们必须走报销，补录会把审批绕过去。
          </div>
        </el-form-item>
        <el-form-item label="金额" prop="amount">
          <el-input-number v-model="form.amount" :min="0.01" :precision="2" :controls="false" style="width:180px" />
          <span class="fld-unit">元</span>
        </el-form-item>
        <el-form-item label="账期" prop="period">
          <el-date-picker v-model="form.period" type="month" value-format="YYYY-MM" style="width:150px" />
          <span class="fld-tip" style="display:inline-block;margin-left:10px;">归属月，三率与分项报表按它统计</span>
        </el-form-item>
        <el-form-item label="业务日期">
          <el-date-picker v-model="form.bizDate" type="date" value-format="YYYY-MM-DD" style="width:150px" />
        </el-form-item>
        <el-form-item label="所属项目">
          <el-select v-model="form.communityId" placeholder="留空 = 集团 / 全项目" clearable style="width:100%">
            <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="来源">
          <el-input v-model="form.source" maxlength="20" placeholder="如：增值税及附加 / 支付通道结算" />
        </el-form-item>
        <el-form-item label="附件名">
          <el-input v-model="form.attachment" maxlength="40" placeholder="如：2026 年三季度完税凭证.pdf（原型不传文件）" />
        </el-form-item>
        <el-form-item label="补录原因" prop="reason">
          <el-input v-model="form.reason" type="textarea" :rows="2" maxlength="120" show-word-limit
            placeholder="必填：为什么没有单据、依据是什么" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSave">确认入账</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PAGE_SIZES, communityOpts, manualCategoryOpts, manualEntrySummary,
  queryManualEntries, saveManualEntry, voidManualEntry
} from '@/api'
import { useListQuery } from '@/composables/useQuery'
import { exportList } from '@/utils/export'
import { money, wan } from '@/utils/format'
import EmptyState from '@/components/EmptyState.vue'

const cmOpts = communityOpts()
const catOptsExpense = manualCategoryOpts('expense')
const catOptsIncome = manualCategoryOpts('income')
const catOptsAll = [...catOptsExpense, ...catOptsIncome]

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryManualEntries, { filters: { direction: '', categoryCode: '', period: '', communityId: '', kw: '' } }
)
const sum = ref(manualEntrySummary())
function refresh() { sum.value = manualEntrySummary(); load() }

function onDirection() { query.categoryCode = ''; search() }
function catParent(code) { return (catOptsAll.find(c => c.value === code) || {}).parentName || '' }

/* ---------- 新建 ---------- */
const dlgVisible = ref(false)
const saving = ref(false)
const formRef = ref()
const form = reactive({
  direction: 'expense', categoryCode: '', amount: null, period: '2026-10',
  bizDate: '2026-10-21', communityId: '', source: '', attachment: '', reason: ''
})
const catOpts = computed(() => (form.direction === 'income' ? catOptsIncome : catOptsExpense))

const rules = {
  categoryCode: [{ required: true, message: '请选择费用分类', trigger: 'change' }],
  amount: [{ validator: (_r, v, cb) => (Number(v) > 0 ? cb() : cb(new Error('金额须大于 0'))), trigger: 'change' }],
  period: [{ required: true, message: '请选择账期', trigger: 'change' }],
  reason: [{ required: true, message: '补录原因必填', trigger: 'blur' }]
}

function openNew() {
  Object.assign(form, {
    direction: 'expense', categoryCode: '', amount: null, period: '2026-10',
    bizDate: '2026-10-21', communityId: '', source: '', attachment: '', reason: ''
  })
  dlgVisible.value = true
}
function onFormDirection() { form.categoryCode = '' }

async function doSave() {
  try { await formRef.value.validate() } catch { return }
  saving.value = true
  try {
    const r = saveManualEntry({ ...form })
    ElMessage.success(`已入账 ${r.entryNo} · ¥${money(r.amount)}（${r.categoryName}）`)
    dlgVisible.value = false
    refresh()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally { saving.value = false }
}

/* ---------- 作废 ---------- */
async function doVoid(row) {
  let reason = ''
  try {
    const r = await ElMessageBox.prompt(
      `作废后这笔 ¥${money(row.amount)}（${row.categoryName}）不再计入报表，但单据永久留档。请写作废原因。`,
      '作废补录', {
        inputPlaceholder: '如：账期录错，已于 10 月重新入账',
        inputValidator: v => (String(v || '').trim() ? true : '必须写原因'),
        confirmButtonText: '确认作废', cancelButtonText: '取消', type: 'warning'
      }
    )
    reason = r.value
  } catch { return }
  try {
    voidManualEntry(row.entryId, reason)
    ElMessage.success('已作废（单据保留）')
    refresh()
  } catch (e) { ElMessage.error(e?.message || '作废失败') }
}

const COLS = [
  { prop: 'entryNo', label: '单号' }, { prop: 'period', label: '账期' },
  { prop: 'direction', label: '方向' }, { prop: 'categoryName', label: '分类' },
  { prop: 'amount', label: '金额' }, { prop: 'objectName', label: '关联对象' },
  { prop: 'source', label: '来源' }, { prop: 'reason', label: '补录原因' },
  { prop: 'operator', label: '经办人' }, { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '手工补录', source: '/b/manual-entries', columns: COLS, rows: rows.value, filters: { ...query } })
}
</script>

<style scoped>
.fld-tip { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; margin-top: 2px; }
.fld-unit { margin-left: 8px; font-size: 12px; color: var(--biz-text-3); }
.opt-sub { float: right; color: var(--biz-text-3); font-size: 11.5px; margin-left: 12px; }
</style>
