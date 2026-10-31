<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>收费日结 · 一天一笔账</b>：按<b>收款方式</b>汇总当日收款、退款与实收净额 ——
        现金要<b>实点</b>（点完填实收，系统算差异），微信 / 支付宝 / 银行按渠道流水<b>自动对平</b>。
        有现金差异必须写说明才能提交；<b>一天只能结一次</b>，结完当日流水锁定，不再允许改动。
        退款不是只给流水打标记：它会把对应账单的已收减回、未收加回，已开票的同时红冲发票。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel rsum">
        <div class="rsum__l">当日收款</div>
        <div class="rsum__v">{{ pre.count }}<span class="unit">笔</span></div>
        <div class="rsum__s">{{ pre.date }} · {{ pre.rows.length }} 种方式</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">收款金额</div>
        <div class="rsum__v money">¥ {{ money(income) }}</div>
        <div class="rsum__s">含预存抵扣，不重复计收入</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">当日退款</div>
        <div class="rsum__v money--out">¥ {{ money(pre.refund) }}</div>
        <div class="rsum__s">退款笔数见下方明细</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">实收净额</div>
        <div class="rsum__v money">¥ {{ money(pre.totalNet) }}</div>
        <div class="rsum__s">收款 − 退款</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <span class="toolbar__t">对账日期</span>
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :clearable="false"
          style="width:150px" @change="reload" />
        <el-tag v-if="pre.closed" type="success" effect="plain" size="small">已日结 · {{ pre.closed.closeNo }}</el-tag>
        <span class="spacer" />
        <span class="muted" style="font-size:12px;">现金按实点、非现金按渠道流水自动对平</span>
      </div>

      <el-table :data="pre.rows" size="small" style="width:100%" show-summary :summary-method="sumRow">
        <el-table-column prop="method" label="收款方式" min-width="110" />
        <el-table-column prop="count" label="收款笔数" width="100" align="right" />
        <el-table-column prop="amount" label="收款金额" min-width="130" align="right">
          <template #default="{ row }"><span class="money money--in">¥ {{ money(row.amount) }}</span></template>
        </el-table-column>
        <el-table-column prop="refundCount" label="退款笔数" width="100" align="right" />
        <el-table-column prop="refund" label="退款金额" min-width="120" align="right">
          <template #default="{ row }">
            <span v-if="row.refund > 0" class="money money--out">-¥ {{ money(row.refund) }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="net" label="实收净额" min-width="130" align="right">
          <template #default="{ row }"><b class="money">¥ {{ money(row.net) }}</b></template>
        </el-table-column>
        <el-table-column label="核对方式" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.auto ? 'info' : 'warning'" effect="plain">{{ row.mode }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:minmax(0,1fr) 380px;">
      <div class="panel">
        <div class="toolbar">
          <span class="toolbar__t">现金实点与差异</span>
          <span class="spacer" />
          <span class="muted" style="font-size:12px;">系统应有现金 = 现金收款 − 现金退款</span>
        </div>
        <el-form label-width="104px" :model="form">
          <el-form-item label="应有现金">
            <span class="money">¥ {{ money(pre.cashExpected) }}</span>
          </el-form-item>
          <el-form-item label="实点现金">
            <el-input v-model="form.cashActual" :disabled="!!pre.closed" placeholder="点完钱填这里，留空视为无差异" style="width:220px">
              <template #append>元</template>
            </el-input>
          </el-form-item>
          <el-form-item label="差异">
            <span v-if="pre.cashDiff === null" class="muted">未填实点数量</span>
            <span v-else :class="Math.abs(pre.cashDiff) > 0.01 ? 'money money--out' : 'money money--in'">
              {{ pre.cashDiff > 0 ? '+' : '' }}{{ money(pre.cashDiff) }} 元
              <span class="muted" style="font-size:12px;">{{ Math.abs(pre.cashDiff) > 0.01 ? '需写说明' : '账实相符' }}</span>
            </span>
          </el-form-item>
          <el-form-item label="说明">
            <el-input v-model="form.memo" type="textarea" :rows="2" :disabled="!!pre.closed"
              maxlength="100" show-word-limit placeholder="有差异时必填，如：找零备用金未入账" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :disabled="!!pre.closed" @click="doClose">提交日结</el-button>
            <span v-if="pre.closed" class="muted" style="margin-left:10px;font-size:12px;">
              {{ pre.closed.at }} 由 {{ pre.closed.operator }} 提交
            </span>
          </el-form-item>
        </el-form>
      </div>

      <div class="panel">
        <div class="toolbar">
          <span class="toolbar__t">日结记录</span>
          <span class="spacer" />
          <span class="muted" style="font-size:12px;">{{ history.length }} 天</span>
        </div>
        <el-table :data="history" size="small" max-height="300">
          <el-table-column prop="closeNo" label="日结单" min-width="128" show-overflow-tooltip />
          <el-table-column prop="net" label="净额" width="86" align="right">
            <template #default="{ row }">{{ money(row.net) }}</template>
          </el-table-column>
          <el-table-column label="差异" width="72" align="right">
            <template #default="{ row }">
              <span :class="Math.abs(row.cashDiff) > 0.01 ? 'money money--out' : 'muted'">{{ money(row.cashDiff) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="operator" label="提交人" width="72" />
        </el-table>
        <div v-if="!history.length" class="muted" style="padding:14px 0;font-size:12px;">
          还没有日结记录。选择日期 → 核对 → 提交后，这里会留一条不可修改的日结单。
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { dailyCloseHistory, dailyClosePreview, submitDailyClose } from '@/utils/api'
import { money } from '@/utils/format'

/* 数据集「当下」= 2026-10-21，默认就结这一天，打开即有数可看 */
const date = ref('2026-10-21')
const ver = ref(0)
const form = reactive({ cashActual: '', memo: '' })

const pre = computed(() => {
  void ver.value
  return dailyClosePreview(date.value, form.cashActual)
})
const income = computed(() => Math.round(pre.value.rows.reduce((s, r) => s + r.amount, 0) * 100) / 100)
const history = computed(() => {
  void ver.value
  return dailyCloseHistory()
})

function reload() {
  form.cashActual = ''
  form.memo = ''
  ver.value++
}

function sumRow({ columns, data }) {
  const out = []
  columns.forEach((col, i) => {
    const p = col.property
    if (i === 0) return out.push('合计')
    if (p === 'count' || p === 'refundCount') return out.push(String(data.reduce((s, r) => s + (r[p] || 0), 0)))
    if (p === 'amount' || p === 'refund' || p === 'net') {
      const sum = data.reduce((s, r) => s + (r[p] || 0), 0)
      return out.push(p === 'refund' && sum === 0 ? '—' : `¥ ${money(sum)}`)
    }
    out.push('')
  })
  return out
}

function doClose() {
  try {
    const rec = submitDailyClose({
      date: date.value,
      cashActual: form.cashActual === '' ? null : form.cashActual,
      operator: '收银员',
      memo: form.memo
    })
    ElMessage.success(`${rec.closeNo} 已日结：净额 ¥${money(rec.net)}${Math.abs(rec.cashDiff) > 0.01 ? `，现金差异 ¥${money(rec.cashDiff)}` : '，账实相符'}`)
    reload()
  } catch (e) {
    ElMessage.error(e?.message || '日结失败')
  }
}
</script>

<style scoped>
.toolbar__t { font-size: 13px; color: var(--biz-text-1); font-weight: 500; }
</style>
