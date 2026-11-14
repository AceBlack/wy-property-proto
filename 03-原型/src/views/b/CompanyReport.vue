<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>公司经营月报</b>：多项目<b>横向对比</b>。单项目报表回答"这个项目怎么样"，
        这一张回答"<b>谁在拖后腿</b>"。
        <br />
        三处口径先说清：<b>① 收缴率按物业费算</b>，收入/支出是全部科目 —— 两列不是一套数；
        <b>② 合计的率是重算的</b>，不是各行相加（三个 80% 加起来是 240%）；
        <b>③ 不摊管理费用</b> —— 客户那张表里的「管理费用」是总部摊过来的，系统还没有分摊能力，
        所以这里只列项目自身的收支。不摊，总比摊一个假数好。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form class="filter-bar" label-width="64px" @submit.prevent>
        <el-form-item label="账期">
          <el-date-picker v-model="from" type="month" value-format="YYYY-MM" style="width:118px" :clearable="false" />
          <span class="rng">至</span>
          <el-date-picker v-model="to" type="month" value-format="YYYY-MM" style="width:118px" :clearable="false" />
        </el-form-item>
        <el-form-item class="acts" style="margin-left:auto;">
          <el-button :icon="'Download'" @click="onExport">导出月报</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel rsum" data-card="c-income">
        <div class="rsum__l">收入合计</div>
        <div class="rsum__v">¥ {{ wan(d.totals.income) }}</div>
        <div class="rsum__s">{{ d.rows.length }} 个项目 · {{ d.months }} 个月</div>
      </div>
      <div class="panel rsum" data-card="c-expense">
        <div class="rsum__l">支出合计</div>
        <div class="rsum__v money--out">¥ {{ wan(d.totals.expense) }}</div>
        <div class="rsum__s">不摊总部管理费用</div>
      </div>
      <div class="panel rsum" data-card="c-balance">
        <div class="rsum__l">结余</div>
        <div class="rsum__v" :class="d.totals.balance < 0 ? 'money--out' : ''">{{ d.totals.balance < 0 ? '−' : '' }}¥ {{ wan(Math.abs(d.totals.balance)) }}</div>
        <div class="rsum__s">结余率 {{ d.totals.margin }}%</div>
      </div>
      <div class="panel rsum" data-card="c-rate">
        <div class="rsum__l">合计收缴率</div>
        <div class="rsum__v">{{ d.totals.collectionRate == null ? '—' : d.totals.collectionRate }}<span class="unit">%</span></div>
        <div class="rsum__s">已收 ÷ (应收 − 减免) · 重算，不是各行相加</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="sec__hd" style="margin:0 0 10px;">
        <h4>各项目收支</h4>
        <span class="desc">{{ d.note }}</span>
      </div>
      <el-table :data="tableRows" size="small" :row-class-name="rowClass" border>
        <el-table-column label="项目" min-width="150" fixed="left">
          <template #default="{ row }">
            <div class="nowrap"><b>{{ row.name }}</b></div>
            <div class="ps-sub">{{ row.manager || '—' }}<template v-if="row.houses"> · {{ row.houses }} 户</template></div>
          </template>
        </el-table-column>
        <el-table-column label="应收（物业费）" width="126" align="right">
          <template #default="{ row }"><span class="num">{{ row.receivable ? '¥' + money(row.receivable) : '—' }}</span></template>
        </el-table-column>
        <el-table-column label="已收" width="120" align="right">
          <template #default="{ row }"><span class="num">{{ row.received ? '¥' + money(row.received) : '—' }}</span></template>
        </el-table-column>
        <el-table-column label="收缴率" width="132">
          <template #default="{ row }">
            <div v-if="row.collectionRate != null" class="rbar">
              <i :style="{ width: Math.min(100, row.collectionRate) + '%' }" :class="{ 'is-low': row.collectionRate < 70 }" />
              <span>{{ row.collectionRate }}%</span>
            </div>
            <span v-else class="ps-sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="住宅(含公寓)" width="106" align="right">
          <template #default="{ row }">
            <span :class="{ 'money--out': row.houseRate != null && row.houseRate < 70 }">{{ row.houseRate == null ? '—' : row.houseRate + '%' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="商业" width="82" align="right">
          <template #default="{ row }">
            <span :class="{ 'money--out': row.bizRate != null && row.bizRate < 70 }">{{ row.bizRate == null ? '—' : row.bizRate + '%' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="收入" width="120" align="right">
          <template #default="{ row }"><span class="num">¥{{ money(row.income) }}</span></template>
        </el-table-column>
        <el-table-column label="支出" width="120" align="right">
          <template #default="{ row }"><span class="num money--out">¥{{ money(row.expense) }}</span></template>
        </el-table-column>
        <el-table-column label="结余" width="120" align="right">
          <template #default="{ row }">
            <span class="num" :class="{ 'money--out': row.balance < 0 }">
              {{ row.balance < 0 ? '−' : '' }}¥{{ money(Math.abs(row.balance)) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="结余率" width="90" align="right">
          <template #default="{ row }">
            <span :class="{ 'money--out': row.margin < 0 }">{{ row.margin }}%</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="panel foot-note">
      <b>为什么不摊管理费用</b>：客户月报里「管理费用」与「支出」并列，说明它是总部摊下来的。
      系统现在没有公共费用池、也没有分摊规则（按面积？按收入？按人头？），
      这时候摊出来的执行率是假的 —— 与其给一个错数，不如这一列先空着，等分摊口径定了再补。
      <br /><br />
      <b>为什么合计的率要重算</b>：翡翠城应收 100 万收了 80 万（80%）、锦绣家园应收 10 万收了 5 万（50%），
      合计是 85 万 ÷ 110 万 = 77%，不是 (80% + 50%) ÷ 2 = 65%。分母不同，率不能加。
      <br /><br />
      <b>结余为负说明什么</b>：项目自身的收入盖不住自身支出。不含总部管理费用、不含押金（负债）——
      所以负得比客户月报好看，那部分差额就是没摊的管理费用。
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { companyReport } from '@/api'
import { exportList } from '@/utils/export'
import { money, wan } from '@/utils/format'

/* 与经营报表同区间：演示数据集的账单只覆盖 2026-08 之后 */
const from = ref('2026-08')
const to = ref('2026-10')

const d = computed(() => {
  try {
    return companyReport({ from: from.value, to: to.value })
  } catch (e) {
    return {
      from: from.value, to: to.value, months: 0, itemName: '',
      rows: [],
      totals: { name: '合计', houses: 0, receivable: 0, received: 0, collectionRate: null, houseRate: null, bizRate: null, income: 0, expense: 0, balance: 0, margin: 0 },
      note: e?.message || '', allocated: false, error: e?.message
    }
  }
})

/* 合计单独一行放在表尾：el-table 自带的 summary 走不了自定义格式（负号、百分比列） */
const tableRows = computed(() => [...d.value.rows, { ...d.value.totals, _total: true }])

const rowClass = ({ row }) => (row._total ? 'cr-total' : row.balance < 0 ? 'cr-loss' : '')

function onExport() {
  exportList({
    name: `公司经营月报 ${d.value.from}_${d.value.to}`, source: '/b/company-report',
    columns: [
      { prop: 'name', label: '项目' }, { prop: 'manager', label: '项目经理' },
      { prop: 'houses', label: '户数' },
      { prop: 'receivable', label: '应收（物业费）' }, { prop: 'received', label: '已收' },
      { prop: 'collectionRate', label: '收缴率%' },
      { prop: 'houseRate', label: '住宅收费率%' }, { prop: 'bizRate', label: '商业收费率%' },
      { prop: 'income', label: '收入' }, { prop: 'expense', label: '支出' },
      { prop: 'balance', label: '结余' }, { prop: 'margin', label: '结余率%' }
    ],
    rows: d.value.rows,
    filters: { from: d.value.from, to: d.value.to }
  })
}
</script>

<style scoped>
:deep(.cr-total) td { background: #eef4ff !important; font-weight: 600; }
:deep(.cr-loss) td { background: #fffbfb; }
.foot-note {
  margin-top: 16px; font-size: 12px; line-height: 1.75; color: var(--biz-text-2);
}
.foot-note b { color: var(--biz-text); }
</style>
