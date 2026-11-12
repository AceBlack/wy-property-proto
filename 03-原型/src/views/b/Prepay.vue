<template>
  <div class="page">
    <!-- 页头：先把"这个页面为什么还活着"讲清楚，否则第一次进来的人会去找充值按钮 -->
    <div class="retire">
      <div class="retire__i">停用</div>
      <div class="retire__b">
        <div class="retire__t">预存账户体系已于 2026-11-13 停用，本页只处理<b>存量余额清退</b></div>
        <div class="retire__d">
          业主交的钱不再进"预存余额"，水电按<b>抄表推单 → 账单缴费</b>走，物业费按账期收。
          账上还挂着的余额必须退还给业主 —— 不退，这笔钱既不是收入、也不在负债里，审计一问就说不清。
          充值、抵扣、自动抵扣入口均已下线。
        </div>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(5,minmax(0,1fr));">
      <div class="panel rsum" data-card="pp-live"><div class="rsum__l">存量账户</div><div class="rsum__v">{{ sum.live }}<span class="unit">/ {{ sum.accounts }}</span></div></div>
      <div class="panel rsum" data-card="pp-balance"><div class="rsum__l">待退余额</div><div class="rsum__v money--out">¥ {{ money(sum.balance) }}</div></div>
      <div class="panel rsum" data-card="pp-pending"><div class="rsum__l">待清退户</div><div class="rsum__v">{{ sum.pending }}<span class="unit">户</span></div></div>
      <div class="panel rsum" data-card="pp-closed"><div class="rsum__l">已清退（销户）</div><div class="rsum__v">{{ sum.closed }}<span class="unit">户</span></div></div>
      <div class="panel rsum" data-card="pp-odd">
        <div class="rsum__l">销户仍有余额</div>
        <div class="rsum__v" :class="sum.closedWithBalance ? 'money--out' : ''">{{ sum.closedWithBalance }}</div>
      </div>
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
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出清退清单</el-button>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">
          共 {{ total }} 个账户 · 余额大于 0 的都可以退 · 退款是整额退，不做部分退
        </span>
      </div>
      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 470px)" @row-click="onRow">
        <el-table-column prop="accountId" label="账户号" width="100" />
        <el-table-column prop="ownerName" label="业主" width="80" />
        <el-table-column prop="phone" label="手机号" width="120" />
        <el-table-column prop="houseName" label="房屋" min-width="180" show-overflow-tooltip />
        <el-table-column label="余额" width="110" align="right">
          <template #default="{ row }">
            <span class="money" :class="{ 'money--out': row.balance > 0 }">¥ {{ money(row.balance) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalRecharge" label="累计充值" width="100" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.totalRecharge) }}</span></template>
        </el-table-column>
        <el-table-column prop="totalDeduct" label="累计抵扣" width="100" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.totalDeduct) }}</span></template>
        </el-table-column>
        <el-table-column prop="lastRechargeDate" label="最近充值" width="110" />
        <el-table-column prop="lastDeductDate" label="最近抵扣" width="110" />
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <StatusTag domain="prepay" :value="row.status" />
            <el-tag v-if="row.status === '已销户' && row.balance > 0" size="small" type="danger" effect="plain" style="margin-left:4px;">
              有余额
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="row.status === '已销户' || !(row.balance > 0)" @click.stop="openRefund(row)">
              退还余额
            </el-button>
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

    <!-- 退款 -->
    <el-dialog v-model="dlgVisible" title="退还预存余额" width="480">
      <div class="refund__hd">
        <div>{{ cur.ownerName }} · {{ cur.houseName }}</div>
        <div class="refund__amt">退还 <b>¥{{ money(cur.balance) }}</b></div>
      </div>
      <div class="refund__warn">
        退款后账户<b>销户并留档</b>，余额归零；历史充值 / 抵扣流水仍可查。此操作不可撤销。
      </div>
      <el-form :model="dlgForm" label-width="88px" style="margin-top:12px;">
        <el-form-item label="退款方式" required>
          <el-select v-model="dlgForm.method" style="width:180px">
            <el-option v-for="m in REFUND_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="收款人">
          <el-input v-model="dlgForm.payee" placeholder="默认业主本人，代领需写明关系" style="width:100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="dlgForm.remark" type="textarea" :rows="2" placeholder="如：业主到场现金退还，已签收" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlgVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doRefund">确认退款</el-button>
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
            <el-tag size="small" effect="plain" :type="row.type === '充值' ? 'success' : (row.type === '退款' ? 'danger' : 'warning')">
              {{ row.type }}
            </el-tag>
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
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PAGE_SIZES, PREPAY_STATUS, communityOpts, prepayClearanceSummary, prepayLogs,
  queryPrepayAccounts, refundPrepay
} from '@/utils/api'
import { useListQuery } from '@/composables/useQuery'
import { exportList } from '@/utils/export'
import { money } from '@/utils/format'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'

/** 退款方式：与收款方式不同 —— 退款是"往外给钱"，银行转账最常见，不会有 POS 刷卡 */
const REFUND_METHODS = ['现金', '银行转账', '微信支付', '支付宝']

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryPrepayAccounts, { filters: { communityId: '', status: '', kw: '' } }
)
const sum = ref(prepayClearanceSummary())
function refresh() { sum.value = prepayClearanceSummary(); load() }

const cur = ref({})
const dlgVisible = ref(false)
const saving = ref(false)
const dlgForm = ref({ method: '现金', payee: '', remark: '' })

function openRefund(row) {
  cur.value = { ...row }
  dlgForm.value = { method: '现金', payee: row.ownerName || '', remark: '' }
  dlgVisible.value = true
}

async function doRefund() {
  try {
    await ElMessageBox.confirm(
      `确认退还 ¥${money(cur.value.balance)} 给 ${cur.value.ownerName}？账户将销户。`,
      '退款确认', { type: 'warning', confirmButtonText: '确认退款', cancelButtonText: '再想想' }
    )
  } catch { return }

  saving.value = true
  try {
    const r = refundPrepay(cur.value.accountId, {
      method: dlgForm.value.method,
      remark: [dlgForm.value.payee && `收款人 ${dlgForm.value.payee}`, dlgForm.value.remark].filter(Boolean).join(' · ')
    })
    ElMessage.success(`已退还 ¥${money(r.amount)}（${r.method}），账户已销户`)
    dlgVisible.value = false
    refresh()
  } catch (e) {
    ElMessage.error(e?.message || '退款失败')
  } finally { saving.value = false }
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
  { prop: 'phone', label: '手机号' }, { prop: 'houseName', label: '房屋' },
  { prop: 'balance', label: '余额' }, { prop: 'totalRecharge', label: '累计充值' },
  { prop: 'totalDeduct', label: '累计抵扣' }, { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '预存余额清退清单', source: '/b/prepay', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}
</script>

<style scoped>
.retire {
  display: flex; gap: 14px; align-items: flex-start;
  padding: 16px 18px; border-radius: 12px;
  background: #fff8e8; border: 1px solid #f3d79a;
}
.retire__i {
  flex: none; padding: 3px 9px; border-radius: 6px;
  background: #e6a23c; color: #fff; font-size: 12px; font-weight: 600;
}
.retire__t { font-size: 13.5px; color: #8a5a12; font-weight: 600; }
.retire__d { margin-top: 6px; font-size: 12.5px; line-height: 1.7; color: #9a6a1f; }

.refund__hd {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-radius: 10px; background: var(--biz-bg-fill);
  font-size: 13px; color: var(--biz-text-2);
}
.refund__amt { font-size: 13px; }
.refund__amt b { font-family: var(--biz-font-num); font-size: 18px; color: var(--biz-danger); }
.refund__warn {
  margin-top: 10px; padding: 9px 12px; border-radius: 8px;
  background: #fdf3e3; color: #a76b13; font-size: 12px; line-height: 1.6;
}
</style>
