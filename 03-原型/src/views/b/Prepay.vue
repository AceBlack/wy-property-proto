<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>预存与抵扣 · A 级交互</b>：业主预存账户 = 「先存钱、后扣费」。充值写入余额并留流水；
        抵扣按<b>账期最早的未缴账单</b>逐笔冲抵，抵扣结果直接改写账单的已收 / 欠费与状态。
        写操作均为<b>内存态</b>，刷新还原。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(5,minmax(0,1fr));">
      <div class="panel rsum" data-card="pp-count"><div class="rsum__l">账户数 / 在用</div><div class="rsum__v">{{ sum.count }}<span class="unit">/ {{ sum.live }}</span></div></div>
      <div class="panel rsum" data-card="pp-balance"><div class="rsum__l">在账余额</div><div class="rsum__v">¥ {{ money(sum.balance) }}</div></div>
      <div class="panel rsum" data-card="pp-recharge"><div class="rsum__l">累计充值</div><div class="rsum__v">¥ {{ money(sum.recharge) }}</div></div>
      <div class="panel rsum" data-card="pp-deduct"><div class="rsum__l">累计抵扣</div><div class="rsum__v money--out">¥ {{ money(sum.deduct) }}</div></div>
      <div class="panel rsum" data-card="pp-auto"><div class="rsum__l">自动抵扣 / 冻结</div><div class="rsum__v">{{ sum.auto }}<span class="unit">/ {{ sum.frozen }}</span></div></div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="56px" @submit.prevent>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:120px">
            <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width:100px">
            <el-option v-for="s in PREPAY_STATUS" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="业主 / 手机号 / 房屋 / 账户号" clearable style="width:190px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 个账户 · 余额低于 ¥100 的 {{ sum.low }} 户建议提醒补存</span>
      </div>
      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 430px)" @row-click="onRow">
        <el-table-column prop="accountId" label="账户号" width="100" />
        <el-table-column prop="ownerName" label="业主" width="80" />
        <el-table-column prop="phone" label="手机号" width="120" />
        <el-table-column prop="houseName" label="房屋" min-width="180" show-overflow-tooltip />
        <el-table-column label="余额" width="110" align="right">
          <template #default="{ row }">
            <span class="money" :class="{ 'money--out': row.balance < 100 }">¥ {{ money(row.balance) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalRecharge" label="累计充值" width="100" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.totalRecharge) }}</span></template>
        </el-table-column>
        <el-table-column prop="totalDeduct" label="累计抵扣" width="100" align="right">
          <template #default="{ row }"><span class="money money--out">{{ money(row.totalDeduct) }}</span></template>
        </el-table-column>
        <el-table-column prop="lastRechargeDate" label="最近充值" width="110" />
        <el-table-column prop="lastDeductDate" label="最近抵扣" width="110" />
        <el-table-column label="自动抵扣" width="92" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.autoDeduct" size="small" @click.stop @change="onAuto(row)" />
          </template>
        </el-table-column>
        <el-table-column label="状态" width="86">
          <template #default="{ row }"><StatusTag domain="prepay" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openRecharge(row)">充值</el-button>
            <el-button link type="warning" @click.stop="openDeduct(row)">抵扣</el-button>
            <el-button link @click.stop="onRow(row)">流水</el-button>
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

    <!-- 充值 / 抵扣 -->
    <el-dialog v-model="dlgVisible" :title="mode === 'in' ? '账户充值' : '余额抵扣'" width="460">
      <div class="muted" style="font-size:12.5px;margin-bottom:12px;">
        {{ cur.ownerName }} · {{ cur.houseName }} · 当前余额 ¥{{ money(cur.balance) }}
      </div>
      <el-form ref="dlgRef" :model="dlgForm" :rules="dlgRules" label-width="88px">
        <el-form-item v-if="mode === 'in'" label="充值方式">
          <el-select v-model="dlgForm.method" style="width:180px">
            <el-option v-for="m in PREPAY_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item :label="mode === 'in' ? '充值金额' : '抵扣金额'" prop="amount">
          <el-input-number v-model="dlgForm.amount" :min="0.01" :max="mode === 'in' ? 50000 : cur.balance"
            :precision="2" :controls="false" style="width:180px" />
          <span v-if="mode === 'out'" class="muted" style="font-size:12px;margin-left:8px;">
            将按账期由早到晚冲抵未缴账单
          </span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">{{ mode === 'in' ? '确认充值' : '确认抵扣' }}</el-button>
      </template>
    </el-dialog>

    <!-- 流水抽屉 -->
    <DetailDrawer v-model="logVisible" :title="`预存流水 · ${cur.ownerName || ''}`"
      :subtitle="cur.accountId ? `${cur.accountId} · ${cur.houseName}` : ''" width="640">
      <el-table :data="logs" size="small" max-height="460">
        <el-table-column prop="logId" label="流水号" width="96" />
        <el-table-column prop="time" label="时间" width="150" />
        <el-table-column prop="type" label="类型" width="76">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.type === '充值' ? 'success' : 'warning'">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="100" align="right">
          <template #default="{ row }">
            <span class="money" :class="row.amount >= 0 ? '' : 'money--out'">
              {{ row.amount >= 0 ? '+' : '-' }}¥{{ money(Math.abs(row.amount)) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="balance" label="余额" width="96" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.balance) }}</span></template>
        </el-table-column>
        <el-table-column prop="method" label="方式" width="96" />
        <el-table-column prop="operator" label="操作人" width="100" />
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <template #empty><EmptyState type="empty" desc="本次会话暂无流水（写操作为内存态）" /></template>
      </el-table>
      <template #footer><el-button @click="logVisible = false">关闭</el-button></template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, PREPAY_METHODS, PREPAY_STATUS, communityOpts, deductPrepay, prepayLogs,
  prepaySummary, queryPrepayAccounts, recharge, toggleAutoDeduct
} from '@/utils/api'
import { useListQuery } from '@/composables/useQuery'
import { exportList } from '@/utils/export'
import { money } from '@/utils/format'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryPrepayAccounts, { filters: { communityId: '', status: '', kw: '' } }
)
const sum = ref(prepaySummary())
function refresh() { sum.value = prepaySummary(); load() }

const cur = ref({})
const mode = ref('in')
const dlgVisible = ref(false)
const dlgRef = ref(null)
const dlgForm = ref({ amount: 0, method: '微信' })
const dlgRules = {
  amount: [{
    validator: (_r, v, cb) => (Number(v) > 0 ? cb() : cb(new Error('金额须大于 0'))), trigger: 'change'
  }]
}
function openRecharge(row) {
  cur.value = { ...row }; mode.value = 'in'
  dlgForm.value = { amount: 500, method: '微信' }
  dlgVisible.value = true
}
function openDeduct(row) {
  cur.value = { ...row }; mode.value = 'out'
  dlgForm.value = { amount: Math.min(row.balance, 100), method: '余额抵扣' }
  dlgVisible.value = true
}
async function submit() {
  try {
    await dlgRef.value.validate()
    if (mode.value === 'in') {
      const r = recharge(cur.value.accountId, dlgForm.value.amount, dlgForm.value.method)
      ElMessage.success(`已充值 ¥${money(dlgForm.value.amount)}，余额 ¥${money(r.balance)}`)
    } else {
      const r = deductPrepay(cur.value.accountId, dlgForm.value.amount)
      ElMessage.success(`已抵扣 ¥${money(r.used)}，冲抵 ${r.detail.length} 笔账单，余额 ¥${money(r.account.balance)}`)
    }
    dlgVisible.value = false
    refresh()
  } catch (e) { if (e?.message) ElMessage.error(e.message) }
}
function onAuto(row) {
  try {
    const r = toggleAutoDeduct(row.accountId)
    ElMessage.success(`${r.ownerName} 自动抵扣已${r.autoDeduct ? '开启' : '关闭'}`)
    refresh()
  } catch (e) { ElMessage.error(e?.message || '操作失败') }
}

const logVisible = ref(false)
const logs = ref([])
function onRow(row) {
  cur.value = { ...row }
  logs.value = prepayLogs(row.accountId)
  logVisible.value = true
}

const EXPORT_COLS = [
  { prop: 'accountId', label: '账户号' }, { prop: 'ownerName', label: '业主' },
  { prop: 'houseName', label: '房屋' }, { prop: 'balance', label: '余额' },
  { prop: 'totalRecharge', label: '累计充值' }, { prop: 'totalDeduct', label: '累计抵扣' },
  { prop: 'lastRechargeDate', label: '最近充值' }, { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '预存账户', source: '/b/prepay', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}
</script>
