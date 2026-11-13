<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>支出归集</b>：支出不是一张表，是四类来源汇过来的 ——
        <b>费用报销</b>（按付款日确认）、<b>工资</b>（按当月，含社保与福利估算）、
        <b>合同支出</b>（按期间摊，3 年的保洁合同不能一次记进当月）、
        <b>手工补录</b>（税费、通道手续费这类没有单据流的）。
        <br />
        四个来源必须分列：合并之后问"这个月运营费用为什么涨了"，就分不清是报销多了还是合同摊多了。
        <b>只算已付款的报销</b>：审批通过但没付款，钱还在账上，记成支出就是提前确认成本。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form class="filter-bar" label-width="56px" @submit.prevent>
        <el-form-item label="账期">
          <el-select v-model="period" style="width:118px">
            <el-option v-for="p in months" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="项目">
          <el-select v-model="communityId" placeholder="全部项目" clearable style="width:130px">
            <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="来源">
          <el-select v-model="source" placeholder="全部来源" clearable style="width:124px">
            <el-option v-for="s in EXPENSE_SOURCES" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item class="acts" style="margin-left:auto;">
          <el-button :icon="'Download'" :disabled="!data.rows.length" @click="onExport">导出归集表</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(5,minmax(0,1fr));">
      <div class="panel rsum" data-card="ec-total">
        <div class="rsum__l">{{ period }} 支出合计</div>
        <div class="rsum__v">¥ {{ wan(data.total) }}</div>
        <div class="rsum__s">{{ data.rows.length }} 个分类 · {{ data.count }} 笔</div>
      </div>
      <div class="panel rsum" data-card="ec-exp">
        <div class="rsum__l">费用报销</div>
        <div class="rsum__v">¥ {{ wan(srcOf('费用报销')) }}</div>
        <div class="rsum__s">{{ data.expenseCount }} 笔已付款 · 已批未付不计入</div>
      </div>
      <div class="panel rsum" data-card="ec-pay">
        <div class="rsum__l">工资</div>
        <div class="rsum__v">¥ {{ wan(srcOf('工资')) }}</div>
        <div class="rsum__s">{{ data.payroll.headcount }} 人 · 社保福利按比例估算</div>
      </div>
      <div class="panel rsum" data-card="ec-contract">
        <div class="rsum__l">合同支出</div>
        <div class="rsum__v">¥ {{ wan(srcOf('合同支出')) }}</div>
        <div class="rsum__s">{{ data.contractCount }} 份在期合同按月摊</div>
      </div>
      <div class="panel rsum" data-card="ec-manual">
        <div class="rsum__l">手工补录</div>
        <div class="rsum__v">¥ {{ wan(srcOf('手工补录')) }}</div>
        <div class="rsum__s">{{ hasManual ? '税费 / 通道费 / 赔偿 · 无单据流' : '本期无补录（税费按季申报，看 3/6/9 月）' }}</div>
      </div>
    </div>

    <!-- 已批未付是提醒，不是支出：放在提示条里，不占指标位 -->
    <div v-if="data.unpaidExpense > 0" class="pending">
      <b>{{ period }} 还有 ¥{{ money(data.unpaidExpense) }} 已批未付</b>
      <span>审批通过但钱还没出去，<b>不计入本月支出</b>。付款后自动进下期账。</span>
    </div>

    <div class="two" style="margin-top:16px;">
      <!-- 一级构成：报表第一层看的是「人力 / 合同 / 运营」，不是几十个二级 -->
      <div class="panel">
        <div class="sec__hd" style="margin:0 0 12px;">
          <h4>按一级分类</h4>
          <span class="desc">人力 / 合同 / 运营 / 其他</span>
        </div>
        <div v-for="p in data.byParent" :key="p.code" class="bx">
          <div class="bx__hd">
            <span class="bx__n">{{ p.name }}</span>
            <span class="bx__v">¥{{ money(p.amount) }}</span>
            <span class="bx__r">{{ pct(p.amount) }}%</span>
          </div>
          <div class="bx__bar"><i :style="{ width: pct(p.amount) + '%' }" /></div>
        </div>
        <div v-if="!data.byParent.length" class="blk__empty">该账期没有支出</div>
        <div v-if="contractGap > 0" class="bx-note">
          口径差异：「按来源」的合同支出 ¥{{ money(srcOf('合同支出')) }}，
          其中 ¥{{ money(contractGap) }} 落在人力成本（外包人力）与运营费用（采购）里 ——
          一级分类按「钱花在什么上」分，来源按「单据从哪来」分，两个视角不冲突。
        </div>
      </div>

      <div class="panel">
        <div class="sec__hd" style="margin:0 0 12px;">
          <h4>按来源</h4>
          <span class="desc">四类来源的确认时点不同，不能合并</span>
        </div>
        <div class="src">
          <div v-for="s in data.bySource" :key="s.source" class="src__i">
            <div class="src__k">{{ s.source }}</div>
            <div class="src__v">¥{{ money(s.amount) }}</div>
            <div class="src__r">占 {{ pct(s.amount) }}%</div>
          </div>
        </div>
        <div class="src__note">
          <b>费用报销</b>按付款日 · <b>工资</b>按当月 · <b>合同支出</b>按期间摊 · <b>手工补录</b>按账期。
          四类口径不同，所以这张表不提供"合并成一笔"的视图。
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <span class="muted" style="font-size:12.5px;">
          共 {{ data.rows.length }} 个分类 · 合计 ¥{{ money(data.total) }}
        </span>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">金额列按来源拆分，横向相加 = 合计</span>
      </div>
      <el-table :data="data.rows" style="width:100%" max-height="calc(100vh - 560px)" show-summary
        :summary-method="summaryRow">
        <el-table-column label="分类" min-width="180">
          <template #default="{ row }">
            <div class="nowrap">{{ row.categoryName }}</div>
            <div class="ps-sub">{{ row.parentName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }"><span class="num money">¥{{ money(row.amount) }}</span></template>
        </el-table-column>
        <el-table-column label="占比" width="80" align="right">
          <template #default="{ row }">{{ pct(row.amount) }}%</template>
        </el-table-column>
        <el-table-column label="费用报销" width="110" align="right">
          <template #default="{ row }"><span class="num">{{ row.bySource['费用报销'] ? '¥' + money(row.bySource['费用报销']) : '—' }}</span></template>
        </el-table-column>
        <el-table-column label="工资" width="110" align="right">
          <template #default="{ row }"><span class="num">{{ row.bySource['工资'] ? '¥' + money(row.bySource['工资']) : '—' }}</span></template>
        </el-table-column>
        <el-table-column label="合同支出" width="110" align="right">
          <template #default="{ row }"><span class="num">{{ row.bySource['合同支出'] ? '¥' + money(row.bySource['合同支出']) : '—' }}</span></template>
        </el-table-column>
        <el-table-column label="手工补录" width="110" align="right">
          <template #default="{ row }"><span class="num">{{ row.bySource['手工补录'] ? '¥' + money(row.bySource['手工补录']) : '—' }}</span></template>
        </el-table-column>
        <el-table-column label="笔数" width="72" align="right">
          <template #default="{ row }"><span class="muted">{{ row.count }}</span></template>
        </el-table-column>
        <template #empty><EmptyState type="empty" desc="该账期没有支出记录" /></template>
      </el-table>
    </div>

    <div class="legal">
      <b>为什么没有"支出总额"这一个数就够</b>：<br />
      · 报销里可能混着「维修材料」和「招待费」，两者的管控方式完全不同；<br />
      · 工资是固定成本，合同是长约成本，报销是弹性成本 —— 只报一个总数，管理层无从下手；<br />
      · 税金及附加只能走手工补录（分类字典里 `EXP_OP_TAX` 的允许来源只有 manual），
      这类钱没有单据流，单独一列才能被审计追到。
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import { communityOpts, expenseCollect, EXPENSE_SOURCES } from '@/api'
import { exportList } from '@/utils/export'
import { money, wan } from '@/utils/format'

const cmOpts = communityOpts()

/* 账期下拉：从演示时钟往前 12 个月 */
const NOW = '2026-10'
const months = (() => {
  const [y, m] = NOW.split('-').map(Number)
  const out = []
  for (let i = 0; i < 12; i++) {
    let yy = y
    let mm = m - i
    while (mm <= 0) { mm += 12; yy -= 1 }
    out.push(`${yy}-${String(mm).padStart(2, '0')}`)
  }
  return out
})()

const period = ref(NOW)
const communityId = ref('')
const source = ref('')

const data = computed(() => expenseCollect({
  period: period.value, communityId: communityId.value, source: source.value
}))

const pct = n => (data.value.total ? Math.round(n / data.value.total * 1000) / 10 : 0)
/* 指标卡与「按来源」用同一个数：两处口径一致，才不会出现"上面 22 万、下面 31 万" */
const srcOf = name => (data.value.bySource.find(s => s.source === name) || {}).amount || 0
const parentOf = code => (data.value.byParent.find(p => p.code === code) || {}).amount || 0
/* 合同来源里有 9.5 万落在别的口径下（外包人力→人力成本、采购→运营费用），
   所以「按一级分类」的合同支出 < 「按来源」的合同支出。这个差额要写出来，否则一定被问 */
const contractGap = computed(() => Math.round((srcOf('合同支出') - parentOf('EXP_CONTRACT')) * 100) / 100)
const hasManual = computed(() => srcOf('手工补录') > 0)

/* 合计行：金额列与占比列都要有值，否则最后一行看着像漏了 */
function summaryRow({ columns, data: rows }) {
  return columns.map((c, i) => {
    if (i === 0) return '合计'
    if (i === 1) return '¥' + money(rows.reduce((s, r) => s + r.amount, 0))
    if (i === 2) return '100%'
    if (i === 7) return rows.reduce((s, r) => s + r.count, 0)
    if (i >= 3 && i <= 6) {
      const key = ['费用报销', '工资', '合同支出', '手工补录'][i - 3]
      const sum = rows.reduce((s, r) => s + (r.bySource[key] || 0), 0)
      return sum ? '¥' + money(sum) : '—'
    }
    return ''
  })
}

const COLS = [
  { prop: 'categoryName', label: '分类' },
  { prop: 'parentName', label: '一级分类' },
  { prop: 'amount', label: '金额' },
  { prop: 'count', label: '笔数' }
]
function onExport() {
  exportList({
    name: `支出归集 ${period.value}`, source: '/b/expense-collect',
    columns: COLS,
    rows: data.value.rows.map(r => ({
      ...r,
      费用报销: r.bySource['费用报销'] || 0,
      工资: r.bySource['工资'] || 0,
      合同支出: r.bySource['合同支出'] || 0,
      手工补录: r.bySource['手工补录'] || 0
    })),
    filters: { period: period.value, communityId: communityId.value, source: source.value }
  })
}
</script>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

.bx { margin-bottom: 12px; }
.bx__hd { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; }
.bx__n { flex: 1; color: var(--biz-text-2); }
.bx__v { font-family: var(--biz-font-num); font-weight: 600; color: var(--biz-text-1); }
.bx__r { width: 52px; text-align: right; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.bx__bar { height: 6px; border-radius: 3px; background: var(--biz-bg-fill); margin-top: 5px; overflow: hidden; }
.bx__bar i { display: block; height: 100%; border-radius: 3px; background: var(--el-color-primary); }

.src { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.src__i {
  padding: 10px 12px; border-radius: 9px;
  background: var(--biz-bg-fill); border: 1px solid var(--biz-border-light);
}
.src__k { font-size: 12px; color: var(--biz-text-3); }
.src__v { margin-top: 3px; font-family: var(--biz-font-num); font-size: 15px; font-weight: 600; color: var(--biz-text-1); }
.src__r { margin-top: 2px; font-size: 11px; color: var(--biz-text-3); }
.src__note { margin-top: 12px; font-size: 11.5px; line-height: 1.7; color: var(--biz-text-3); }
.src__note b { color: var(--biz-text-2); }

.pending {
  margin-top: 12px; padding: 10px 14px; border-radius: 10px;
  background: #fdf6e8; border: 1px solid #f0d9a8; font-size: 12.5px; color: #8a5a12;
  display: flex; flex-direction: column; gap: 3px;
}
.pending span { color: #9a6a1f; font-size: 12px; }
.pending span b { color: #8a5a12; }

.bx-note {
  margin-top: 10px; padding-top: 9px; border-top: 1px dashed var(--biz-border-light);
  font-size: 11.5px; line-height: 1.7; color: var(--biz-text-3);
}

.legal {
  margin-top: 14px; padding: 12px 16px; border-radius: 10px;
  background: #f7f9fc; border: 1px solid var(--biz-border-light);
  font-size: 12px; line-height: 1.85; color: var(--biz-text-3);
}
.legal b { color: var(--biz-text-2); }
</style>
