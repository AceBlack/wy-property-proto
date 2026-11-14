<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>经营日报</b>：一天一列、科目一行，看的是<b>每天收了多少钱、钱是怎么进来的</b>。
        三段结构跟线下那张表一致 —— <b>合计 = 收入 + 往来款（押金收取）− 退款（押金退还）</b>：
        押金收进来是负债、退出去是冲负债，都不是收入。
        <br />
        与线下表的三处不同：<b>① 按自然月切</b>，没有「补记上月尾数」那一列（系统按收款日归月，不存在补记）；
        <b>② 科目用系统的费用分类字典</b>，不用各项目自定义的那套；
        <b>③ 减免单列、不进差额</b> —— 线下把「特殊优惠」当收款方式，是为了让手工表平账；
        减免不是钱，混进收款方式会让"当天收了多少"变成一个假数。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form class="filter-bar" label-width="56px" @submit.prevent>
        <el-form-item label="月份">
          <el-date-picker v-model="month" type="month" value-format="YYYY-MM" style="width:132px" :clearable="false" />
        </el-form-item>
        <el-form-item label="项目">
          <el-select v-model="communityId" placeholder="全部项目" clearable style="width:150px">
            <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item class="acts" style="margin-left:auto;">
          <el-button :icon="'Download'" @click="onExport">导出明细</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(6,minmax(0,1fr));">
      <div class="panel rsum" data-card="d-income">
        <div class="rsum__l">收入</div>
        <div class="rsum__v">¥ {{ wan(d.summary.income) }}</div>
        <div class="rsum__s">{{ d.groups[0].rows.length }} 个科目</div>
      </div>
      <div class="panel rsum" data-card="d-liaison">
        <div class="rsum__l">往来款</div>
        <div class="rsum__v">¥ {{ wan(d.summary.liaison) }}</div>
        <div class="rsum__s">押金收取 · 负债不是收入</div>
      </div>
      <div class="panel rsum" data-card="d-refund">
        <div class="rsum__l">退款</div>
        <div class="rsum__v">¥ {{ wan(d.summary.refund) }}</div>
        <div class="rsum__s">押金退还 · 冲负债</div>
      </div>
      <div class="panel rsum" data-card="d-grand">
        <div class="rsum__l">合计</div>
        <div class="rsum__v money">¥ {{ wan(d.summary.grand) }}</div>
        <div class="rsum__s">收入 + 往来 − 退款</div>
      </div>
      <div class="panel rsum" data-card="d-discount">
        <div class="rsum__l">当日减免</div>
        <div class="rsum__v">¥ {{ wan(d.summary.discount) }}</div>
        <div class="rsum__s">不是钱 · 不参与差额</div>
      </div>
      <div class="panel rsum" data-card="d-diff">
        <div class="rsum__l">差额</div>
        <div class="rsum__v" :class="d.diff.ok ? '' : 'money--out'">¥ {{ money(d.diff.total) }}</div>
        <div class="rsum__s">{{ d.diff.ok ? '每天都平' : d.diff.badDays.length + ' 天不平' }}</div>
      </div>
    </div>

    <div class="check" :class="d.diff.ok ? 'is-ok' : 'is-bad'">
      <b>{{ d.diff.ok ? '✓ 日结差额全月为 0' : '✗ 有 ' + d.diff.badDays.length + ' 天差额不为 0' }}</b>
      <span v-if="d.diff.ok">
        {{ d.summary.activeDays }} / {{ d.summary.days }} 天有收款 · 收入 ¥{{ money(d.summary.income) }}
        = 收款点合计 ¥{{ money(d.summary.cash) }}
        —— 按科目看的钱和按收款点看的钱对得上（押金走独立台账，不在此列）
      </span>
      <span v-else>
        {{ d.diff.badDays.map(x => x.day.slice(5) + ' 日差 ' + money(x.diff)).join('；') }}
        · 两种可能：现金长短款，或者某笔收款没录收款点
      </span>
    </div>

    <div class="panel" style="margin-top:16px;padding:0;">
      <div class="sec__hd" style="margin:0;padding:12px 14px 8px;">
        <h4>{{ d.month }} 收银日报</h4>
        <span class="desc">
          横向滚动看全月 · 金额按元取整，合计保留两位 · 空白天 = 当天这个科目没收钱
        </span>
      </div>
      <el-table
        :data="rows" size="small" border style="width:100%"
        :row-class-name="rowClass" :cell-class-name="cellClass"
        max-height="620"
      >
        <el-table-column label="科目" width="196" fixed="left">
          <template #default="{ row }">
            <span class="dr-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column
          v-for="(day, i) in d.days" :key="day"
          :label="String(i + 1)" width="56" align="right"
        >
          <template #default="{ row }">
            <span v-if="row.amounts" class="num dr-day">{{ fmtDay(row.amounts[i]) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="合计" width="112" align="right" fixed="right">
          <template #default="{ row }">
            <span class="num">{{ row.total == null ? '' : money(row.total) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="panel foot-note">
      <b>差额为什么应当是 0</b>：按科目加一遍、按收款点加一遍，是同一批钱的两条路。
      差额不为 0 只有两种原因 —— 现金长短款，或者某笔收款没录收款点。
      这一行**只校验账单收入**，不含押金（见下）。
      <br /><br />
      <b>押金为什么不进收款点</b>：押金台账没有「收款方式」字段。硬把它归到现金，
      一天退几笔押金之后现金就变成负数 —— 那不是发现问题，是造了一个假问题。
      所以押金只进「往来款 / 退款」两段参与合计，不进日结差额；
      正式实现应当在收押金那一刻写入收款方式，届时可以一起纳进来。
      <br /><br />
      <b>水电为什么在收入段</b>：本系统把转供水电计为「其他业务收入」。
      如果客户实际是代收代付，把水电改成负债类科目，日报会自动挪到往来款段 —— 不用改这张报表。
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { communityOpts, dailyRevenueReport } from '@/api'
import { exportList } from '@/utils/export'
import { money, wan } from '@/utils/format'

const cmOpts = communityOpts()
/* 默认演示月的最后一个月：数据集流水只覆盖 2026-08 ~ 2026-10 */
const month = ref('2026-10')
const communityId = ref('')

const d = computed(() => {
  try {
    return dailyRevenueReport({ month: month.value, communityId: communityId.value })
  } catch (e) {
    const empty = {
      month: month.value, days: [],
      groups: [
        { key: 'income', name: '收入', rows: [], subtotal: [], total: 0 },
        { key: 'liaison', name: '往来款', rows: [], subtotal: [], total: 0 },
        { key: 'refund', name: '退款', rows: [], subtotal: [], total: 0 }
      ],
      grand: { amounts: [], total: 0 },
      payPoints: [], discount: { amounts: [], total: 0 },
      diff: { amounts: [], total: 0, ok: true, badDays: [] },
      summary: { income: 0, liaison: 0, refund: 0, grand: 0, discount: 0, cash: 0, days: 0, activeDays: 0 },
      error: e?.message
    }
    return empty
  }
})

/* 收款点按天合计 —— 用来做"收款点小计"和差额那一行的参照 */
const cashByDay = computed(() => d.value.days.map((_, i) =>
  d.value.payPoints.reduce((s, p) => s + (p.amounts[i] || 0), 0)
))

/* 一张表把三段 + 收款点 + 抵减 + 差额全排进去：
   分成多张表反而看不清"合计"和"差额"的上下关系 —— 客户那张表就是一张长表，这点是对的。 */
const rows = computed(() => {
  const out = []
  const sumOf = arr => Math.round(arr.reduce((s, v) => s + (v || 0), 0) * 100) / 100

  for (const g of d.value.groups) {
    out.push({ rowType: 'group', name: g.name, amounts: null, total: g.total })
    for (const r of g.rows) {
      out.push({ rowType: 'item', name: '　' + r.name, amounts: r.amounts, total: sumOf(r.amounts) })
    }
    out.push({ rowType: 'subtotal', name: g.name + '小计', amounts: g.subtotal, total: g.total })
  }

  out.push({ rowType: 'grand', name: '合计（收入 + 往来 − 退款）', amounts: d.value.grand.amounts, total: d.value.grand.total })
  out.push({ rowType: 'group', name: '收款点（钱怎么进来的）', amounts: null, total: null })
  for (const p of d.value.payPoints) {
    out.push({ rowType: 'point', name: '　' + p.name, amounts: p.amounts, total: p.total })
  }
  out.push({ rowType: 'subtotal', name: '收款点小计', amounts: cashByDay.value, total: sumOf(cashByDay.value) })
  out.push({ rowType: 'discount', name: '当日减免（抵减 · 不算现金）', amounts: d.value.discount.amounts, total: d.value.discount.total })
  out.push({ rowType: 'diff', name: '差额（收入 − 收款点）', amounts: d.value.diff.amounts, total: d.value.diff.total })
  return out
})

/* 日期格只放整数：46px 塞不下两位小数，而日报看的是量级不是分毫 */
const fmtDay = v => {
  if (!v) return ''
  const n = Math.round(v)
  return n === 0 ? '' : n.toLocaleString('zh-CN')
}

const rowClass = ({ row }) => 'dr-' + row.rowType
const cellClass = ({ row, column }) => (row.rowType === 'diff' && column.label === '合计' && Math.abs(row.total || 0) >= 0.01 ? 'cell-bad' : '')

function onExport() {
  const list = []
  for (const g of d.value.groups) {
    for (const r of g.rows) {
      r.amounts.forEach((v, i) => {
        if (Math.abs(v) < 0.01) return
        list.push({ group: g.name, name: r.name, day: d.value.days[i], amount: v })
      })
    }
  }
  exportList({
    name: `经营日报 ${d.value.month}`, source: '/b/revenue-report',
    columns: [
      { prop: 'group', label: '段' }, { prop: 'name', label: '科目' },
      { prop: 'day', label: '日期' }, { prop: 'amount', label: '金额' }
    ],
    rows: list,
    filters: { month: d.value.month, communityId: d.value.communityId }
  })
}
</script>

<style scoped>
.dr-name { font-size: 12.5px; }
.num.dr-day { font-size: 11px; color: var(--biz-text-2); font-family: var(--biz-font-num); }

:deep(.dr-group) td { background: #f2f5f9 !important; }
:deep(.dr-group) .dr-name { font-weight: 600; color: var(--biz-text); }
:deep(.dr-subtotal) td { background: #fafbfc !important; }
:deep(.dr-subtotal) .dr-name { font-weight: 600; }
:deep(.dr-grand) td { background: #eef4ff !important; }
:deep(.dr-grand) .dr-name { font-weight: 700; }
:deep(.dr-discount) td { background: #fffdf5 !important; }
:deep(.dr-diff) td { background: #fff8f8 !important; }
:deep(.dr-diff) .dr-name { font-weight: 600; }
:deep(.cell-bad) { color: #b33 !important; font-weight: 600; }

.foot-note {
  margin-top: 16px; font-size: 12px; line-height: 1.75; color: var(--biz-text-2);
}
.foot-note b { color: var(--biz-text); }
</style>
