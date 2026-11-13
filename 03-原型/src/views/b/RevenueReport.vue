<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>经营报表</b>：三率不是三个百分比，是<b>同一套数的三种切法</b>，所以一次算完 ——
        <b>应收</b>按账期铺（不看有没有开单）、<b>已收</b>与<b>减免</b>来自同一张矩阵、
        <b>未收 = 应收 − 已收 − 减免</b>（<b>不减到 0</b>：超额收款会显示负数，那是有用的信息）。
        <br />
        报表自带一条自检线：<code>已收 + 减免 + 未收 = 应收</code>。对不上就说明矩阵里有孤儿流水，
        或者某期应收算错了 —— 这条线不通过时，下面的百分比一个都不能信。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form class="filter-bar" label-width="64px" @submit.prevent>
        <el-form-item label="账期">
          <el-date-picker v-model="from" type="month" value-format="YYYY-MM" style="width:118px" :clearable="false" />
          <span class="rng">至</span>
          <el-date-picker v-model="to" type="month" value-format="YYYY-MM" style="width:118px" :clearable="false" />
        </el-form-item>
        <el-form-item label="项目">
          <el-select v-model="communityId" placeholder="全部项目" clearable style="width:132px">
            <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="收费项">
          <el-select v-model="itemId" style="width:150px">
            <el-option v-for="i in itemOpts" :key="i.value" :label="i.label" :value="i.value" />
          </el-select>
        </el-form-item>
        <el-form-item class="acts" style="margin-left:auto;">
          <el-button :icon="'Download'" @click="onExport">导出报表</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-tabs v-model="tab" style="margin-top:6px;">
      <!-- ============ 三率 ============ -->
      <el-tab-pane label="三率与清欠" name="rate">
        <div class="grid" style="margin-top:12px;grid-template-columns:repeat(6,minmax(0,1fr));">
          <div class="panel rsum" data-card="r-rcv">
            <div class="rsum__l">应收</div>
            <div class="rsum__v">¥ {{ wan(rate.receivable) }}</div>
            <div class="rsum__s">{{ rate.houses }} 户 × {{ rate.periods }} 期</div>
          </div>
          <div class="panel rsum" data-card="r-paid">
            <div class="rsum__l">已收</div>
            <div class="rsum__v">¥ {{ wan(rate.received) }}</div>
            <div class="rsum__s">矩阵流水，含预缴与清欠</div>
          </div>
          <div class="panel rsum" data-card="r-waive">
            <div class="rsum__l">减免</div>
            <div class="rsum__v">¥ {{ wan(rate.waived) }}</div>
            <div class="rsum__s">应收不减，单列扣分母</div>
          </div>
          <div class="panel rsum" data-card="r-unpaid">
            <div class="rsum__l">未收</div>
            <div class="rsum__v" :class="rate.unpaid > 0 ? 'money--out' : ''">¥ {{ wan(rate.unpaid) }}</div>
            <div class="rsum__s">{{ rate.unpaid < 0 ? '负数 = 超额收款' : '欠费余额' }}</div>
          </div>
          <div class="panel rsum" data-card="r-collect">
            <div class="rsum__l">收缴率</div>
            <div class="rsum__v">{{ rate.collectionRate }}<span class="unit">%</span></div>
            <div class="rsum__s">已收 ÷ (应收 − 减免)</div>
          </div>
          <div class="panel rsum" data-card="r-arrears">
            <div class="rsum__l">欠费率</div>
            <div class="rsum__v" :class="rate.arrearsRate > 10 ? 'money--out' : ''">{{ rate.arrearsRate }}<span class="unit">%</span></div>
            <div class="rsum__s">1 − 收缴率</div>
          </div>
        </div>

        <!-- 自检线：不通过时百分比全部作废 -->
        <div class="check" :class="rate.identity.ok ? 'is-ok' : 'is-bad'">
          <b>{{ rate.identity.ok ? '✓ 恒等式成立' : '✗ 恒等式不成立，下面的百分比不能用' }}</b>
          <span>
            已收 ¥{{ money(rate.received) }} + 减免 ¥{{ money(rate.waived) }} + 未收 ¥{{ money(rate.unpaid) }}
            = ¥{{ money(rate.received + rate.waived + rate.unpaid) }}，
            应收 ¥{{ money(rate.receivable) }}
            <template v-if="!rate.identity.ok">（差 ¥{{ money(rate.identity.diff) }}）</template>
          </span>
        </div>

        <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="panel rsum is-soft">
            <div class="rsum__l">预缴率（{{ to }} 之后 12 期）</div>
            <div class="rsum__v">{{ rate.prepayRate }}<span class="unit">%</span></div>
            <div class="rsum__s">已预收 ¥{{ money(rate.prepayReceived) }} / 应收 ¥{{ money(rate.prepayReceivable) }}</div>
          </div>
          <div class="panel rsum is-soft">
            <div class="rsum__l">清欠额（{{ from }} 之前）</div>
            <div class="rsum__v">¥ {{ wan(rate.clearingAmount) }}</div>
            <div class="rsum__s">本期收回的历史欠费，不算本期收缴率</div>
          </div>
          <div class="panel rsum is-soft">
            <div class="rsum__l">现金收入（按收款日）</div>
            <div class="rsum__v">¥ {{ wan(rate.cashIncome) }}</div>
            <div class="rsum__s">与归属口径并行，可互相勾稽</div>
          </div>
          <div class="panel rsum is-soft">
            <div class="rsum__l">超额收款户</div>
            <div class="rsum__v">{{ rate.overpaid }}<span class="unit">户</span></div>
            <div class="rsum__s">未收为负，通常是预缴冲到了已收满的期</div>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd" style="margin:0 0 10px;">
            <h4>按账期</h4>
            <span class="desc">哪一期掉下去，一眼能看出来</span>
          </div>
          <el-table :data="rate.byPeriod" size="small" max-height="320">
            <el-table-column prop="period" label="账期" width="96" />
            <el-table-column label="应收" width="130" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.receivable) }}</span></template>
            </el-table-column>
            <el-table-column label="已收" width="130" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.received) }}</span></template>
            </el-table-column>
            <el-table-column label="减免" width="110" align="right">
              <template #default="{ row }"><span class="num">{{ row.waived ? '¥' + money(row.waived) : '—' }}</span></template>
            </el-table-column>
            <el-table-column label="未收" width="130" align="right">
              <template #default="{ row }">
                <span class="num" :class="row.unpaid > 0 ? 'money--out' : ''">¥{{ money(row.unpaid) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="收缴率" min-width="180">
              <template #default="{ row }">
                <div class="rbar">
                  <i :style="{ width: Math.min(100, rowRate(row)) + '%' }" :class="{ 'is-low': rowRate(row) < 70 }" />
                  <span>{{ rowRate(row) }}%</span>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd" style="margin:0 0 10px;">
            <h4>欠费 TOP 8</h4>
            <span class="desc">按未收金额倒序，负数在最后（超额收款）</span>
          </div>
          <el-table :data="rate.topDebtors" size="small" max-height="300">
            <el-table-column prop="houseName" label="房屋" min-width="200" show-overflow-tooltip />
            <el-table-column label="应收" width="130" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.receivable) }}</span></template>
            </el-table-column>
            <el-table-column label="已收" width="130" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.received) }}</span></template>
            </el-table-column>
            <el-table-column label="未收" width="130" align="right">
              <template #default="{ row }">
                <span class="num" :class="row.unpaid > 0 ? 'money--out' : ''">¥{{ money(row.unpaid) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="row.unpaid > 0 ? 'danger' : 'success'">
                  {{ row.unpaid > 0 ? '欠费' : '超额' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ============ 收支与结余 ============ -->
      <el-tab-pane label="收支与结余" name="pl">
        <div class="grid" style="margin-top:12px;grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="panel rsum" data-card="p-inc">
            <div class="rsum__l">收入合计</div>
            <div class="rsum__v">¥ {{ wan(pl.incomeTotal) }}</div>
            <div class="rsum__s">账单实收 + 合同 + 临时 + 补录</div>
          </div>
          <div class="panel rsum" data-card="p-exp">
            <div class="rsum__l">支出合计</div>
            <div class="rsum__v money--out">¥ {{ wan(pl.expenseTotal) }}</div>
            <div class="rsum__s">报销 + 工资 + 合同摊 + 补录</div>
          </div>
          <div class="panel rsum" data-card="p-bal">
            <div class="rsum__l">结余</div>
            <div class="rsum__v" :class="pl.balance < 0 ? 'money--out' : ''">¥ {{ wan(pl.balance) }}</div>
            <div class="rsum__s">
              {{ pl.balance < 0 ? '收入不足支出 · 见页脚「演示数据说明」' : '收入 − 支出 · 不含押金（负债）' }}
            </div>
          </div>
          <div class="panel rsum" data-card="p-margin">
            <div class="rsum__l">结余率</div>
            <div class="rsum__v">{{ pl.margin }}<span class="unit">%</span></div>
            <div class="rsum__s">结余 ÷ 收入</div>
          </div>
        </div>

        <div class="two" style="margin-top:16px;">
          <div class="panel">
            <div class="sec__hd" style="margin:0 0 10px;"><h4>收入分项</h4><span class="desc">{{ pl.incomeRows.length }} 个分类</span></div>
            <el-table :data="pl.incomeRows" size="small" max-height="380">
              <el-table-column label="分类" min-width="150">
                <template #default="{ row }">
                  <div class="nowrap">{{ row.name }}</div>
                  <div class="ps-sub">{{ row.parentName }}</div>
                </template>
              </el-table-column>
              <el-table-column label="金额" width="130" align="right">
                <template #default="{ row }"><span class="num money">¥{{ money(row.amount) }}</span></template>
              </el-table-column>
              <el-table-column label="占比" width="76" align="right">
                <template #default="{ row }">{{ incPct(row.amount) }}%</template>
              </el-table-column>
            </el-table>
          </div>

          <div class="panel">
            <div class="sec__hd" style="margin:0 0 10px;"><h4>支出分项</h4><span class="desc">{{ pl.expenseRows.length }} 个分类</span></div>
            <el-table :data="pl.expenseRows" size="small" max-height="380">
              <el-table-column label="分类" min-width="150">
                <template #default="{ row }">
                  <div class="nowrap">{{ row.name }}</div>
                  <div class="ps-sub">{{ row.parentName }}</div>
                </template>
              </el-table-column>
              <el-table-column label="金额" width="130" align="right">
                <template #default="{ row }"><span class="num money--out">¥{{ money(row.amount) }}</span></template>
              </el-table-column>
              <el-table-column label="占比" width="76" align="right">
                <template #default="{ row }">{{ expPct(row.amount) }}%</template>
              </el-table-column>
            </el-table>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd" style="margin:0 0 10px;">
            <h4>按月趋势</h4>
            <span class="desc">结余为负的月份标红 —— 单月亏损不是问题，连续三个月才是</span>
          </div>
          <el-table :data="pl.byMonth" size="small" max-height="300">
            <el-table-column prop="period" label="账期" width="96" />
            <el-table-column label="收入" width="140" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.income) }}</span></template>
            </el-table-column>
            <el-table-column label="支出" width="140" align="right">
              <template #default="{ row }"><span class="num money--out">¥{{ money(row.expense) }}</span></template>
            </el-table-column>
            <el-table-column label="结余" width="140" align="right">
              <template #default="{ row }">
                <span class="num" :class="{ 'money--out': row.balance < 0 }">¥{{ money(row.balance) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="水位" min-width="160">
              <template #default="{ row }">
                <div class="rbar">
                  <i :style="{ width: monthPct(row) + '%' }" :class="{ 'is-low': row.balance < 0 }" />
                  <span>{{ monthPct(row) }}%</span>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <div class="legal">
      <b>三个口径不能混</b>：<br />
      · <b>收缴率</b>看"该收的收回来多少"，分母是应收 − 减免；<br />
      · <b>预缴率</b>看"未来的钱提前收了多少"，它拉高收缴率但不会拉高当期现金水位；<br />
      · <b>清欠额</b>是本期收回的历史欠费，它让收缴率好看但和本期应收无关 —— 三者混算，报表就失去解释力。
      <br /><br />
      <b>演示数据说明</b>：<br />
      · 账单只覆盖 2026-08 之后，所以默认区间取最近 3 期；往前看时"没开单的月份"仍按面积计应收，
      收缴率会明显下降 —— 这是数据边界，不是收缴水平；<br />
      · 预缴为演示种子（80 户 × 6 期），正式上线后全部来自真实收款；<br />
      · 在管 756 户的物业费规模与数据集里 120 人的薪酬规模不匹配，所以结余为负是数据问题，
      不是口径问题 —— 换成真实数据后这一项才有解释力。
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { communityOpts, feeItemRows, incomeExpenseReport, threeRateReport } from '@/api'
import { exportList } from '@/utils/export'
import { money, wan } from '@/utils/format'

const cmOpts = communityOpts()
/* 只列有月度应收的收费项 —— 水电按账单缴，三率对它不成立 */
const itemOpts = feeItemRows()
  .filter(i => ['按面积', '按车位', '按户'].includes(i.calcType) && i.cycle === '月')
  .map(i => ({ value: i.itemId, label: i.name }))

/* 默认最近 3 个账期：演示数据集的账单只覆盖 2026-08 之后，
   往前看会把"没开单的月份"也算进应收，收缴率会掉到 30% 多 —— 那是数据边界，不是收缴水平 */
const from = ref('2026-08')
const to = ref('2026-10')
const communityId = ref('')
const itemId = ref('FI01')
const tab = ref('rate')

const rate = computed(() => {
  try {
    return threeRateReport({ from: from.value, to: to.value, communityId: communityId.value, itemId: itemId.value })
  } catch (e) {
    return {
      receivable: 0, received: 0, waived: 0, unpaid: 0, collectionRate: 0, arrearsRate: 0,
      prepayRate: 0, prepayReceived: 0, prepayReceivable: 0, clearingAmount: 0, cashIncome: 0,
      periods: 0, houses: 0, byPeriod: [], topDebtors: [], overpaid: 0,
      identity: { ok: true, diff: 0 }, error: e?.message || '统计失败'
    }
  }
})

const pl = computed(() => {
  try {
    return incomeExpenseReport({ from: from.value, to: to.value, communityId: communityId.value })
  } catch (e) {
    return { incomeRows: [], expenseRows: [], incomeTotal: 0, expenseTotal: 0, balance: 0, margin: 0, byMonth: [] }
  }
})

const rowRate = r => {
  const base = r.receivable - r.waived
  return base > 0 ? Math.round(r.received / base * 1000) / 10 : 0
}
const incPct = n => (pl.value.incomeTotal ? Math.round(n / pl.value.incomeTotal * 1000) / 10 : 0)
const expPct = n => (pl.value.expenseTotal ? Math.round(n / pl.value.expenseTotal * 1000) / 10 : 0)
/* 水位：正结余按「结余 ÷ 收入」画；负结余按「缺口 ÷ 支出」画 ——
   两者用同一个分母会把亏损月份全部画成满格，看不出谁更糟 */
const monthPct = r => {
  const base = r.balance >= 0 ? r.income : r.expense
  if (!base) return 0
  return Math.max(2, Math.min(100, Math.round(Math.abs(r.balance) / base * 100)))
}

function onExport() {
  if (tab.value === 'rate') {
    exportList({
      name: `三率报表 ${from.value}_${to.value}`, source: '/b/revenue-report',
      columns: [
        { prop: 'period', label: '账期' }, { prop: 'receivable', label: '应收' },
        { prop: 'received', label: '已收' }, { prop: 'waived', label: '减免' },
        { prop: 'unpaid', label: '未收' }
      ],
      rows: rate.value.byPeriod,
      filters: { from: from.value, to: to.value, communityId: communityId.value, itemId: itemId.value }
    })
    return
  }
  exportList({
    name: `收支分项 ${from.value}_${to.value}`, source: '/b/revenue-report',
    columns: [
      { prop: 'kind', label: '方向' }, { prop: 'parentName', label: '一级分类' },
      { prop: 'name', label: '分类' }, { prop: 'amount', label: '金额' }
    ],
    rows: [
      ...pl.value.incomeRows.map(r => ({ ...r, kind: '收入' })),
      ...pl.value.expenseRows.map(r => ({ ...r, kind: '支出' }))
    ],
    filters: { from: from.value, to: to.value, communityId: communityId.value }
  })
}
</script>

<style scoped>
.rng { margin: 0 6px; color: var(--biz-text-3); font-size: 12px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

.check {
  margin-top: 12px; padding: 10px 14px; border-radius: 10px;
  display: flex; flex-direction: column; gap: 3px; font-size: 12.5px;
}
.check.is-ok { background: #f0f9eb; border: 1px solid #c8e6b8; color: #3f7f2a; }
.check.is-bad { background: #fff5f5; border: 1px solid #f5c2c2; color: #a33; }
.check span { font-size: 12px; opacity: .9; }

.rbar { display: flex; align-items: center; gap: 8px; }
.rbar i {
  flex: 1; height: 6px; border-radius: 3px; background: var(--el-color-primary);
  min-width: 2px; display: block;
}
.rbar i.is-low { background: var(--biz-danger); }
.rbar span { flex: 0 0 44px; text-align: right; font-family: var(--biz-font-num); font-size: 12px; color: var(--biz-text-3); }

.legal {
  margin-top: 14px; padding: 12px 16px; border-radius: 10px;
  background: #f7f9fc; border: 1px solid var(--biz-border-light);
  font-size: 12px; line-height: 1.85; color: var(--biz-text-3);
}
.legal b { color: var(--biz-text-2); }
</style>
