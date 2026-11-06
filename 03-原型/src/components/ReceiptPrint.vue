<template>
  <el-dialog
    :model-value="modelValue" title="收据 · 打印预览" width="780"
    :close-on-click-modal="false" @update:model-value="v => emit('update:modelValue', v)"
    @open="onOpen"
  >
    <div class="rp-tip">
      按「开票设置 → 票据模板」的参数渲染（{{ tpl.paper.width }} × {{ tpl.paper.height }} mm，
      {{ tpl.font.family }} {{ tpl.font.size }}pt，{{ tpl.copies }} 联）。
      <b>针打是套打</b>：纸上已印好框线，机器只负责把字打进去 —— 打歪 2mm 就压到预印线上了，
      所以调偏移（X/Y）比调字号有用。
      <br />
      浏览器打印能把版面和纸张尺寸做对，但<b>做不到 0.1mm 级的连续纸对位</b>；
      真正投产要用本地打印控件（如 C-Lodop）或后端直发 ESC/P。
    </div>

    <div class="rp-stage">
      <div
        v-for="(c, i) in tpl.copyTitles" :key="i"
        class="rp-paper"
        :style="paperStyle"
      >
        <div class="rp-inner" :style="innerStyle">
          <div class="rp-title">{{ tpl.title }}</div>

          <div class="rp-meta">
            <span>编号：{{ inv.invoiceNo }}</span>
            <span>日期：{{ dateText }}</span>
          </div>

          <div class="rp-row">
            <span class="rp-buyer">付款方：{{ inv.buyerTitle || '—' }}</span>
            <span v-if="inv.houseName" class="rp-house">房屋：{{ inv.houseName }}</span>
          </div>

          <table class="rp-table">
            <thead>
              <tr>
                <th class="c1">项目</th>
                <th class="c2">金额</th>
                <th class="c3">备注</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="c1">{{ inv.itemName }}</td>
                <td class="c2 num">{{ money(inv.amount) }}</td>
                <td class="c3">{{ inv.communityName }}</td>
              </tr>
            </tbody>
          </table>

          <div class="rp-sum">
            <span class="rp-words">合计人民币（大写）：<b>{{ words }}</b></span>
            <span class="rp-amt num">¥ {{ money(inv.amount) }}</span>
          </div>

          <div class="rp-row">
            <span>收款方式：{{ inv.payMethodText || '—' }}</span>
          </div>

          <div class="rp-foot">
            <span>{{ tpl.footerLeft }}{{ inv.issuer }}</span>
            <span>{{ tpl.footerRight }}</span>
          </div>

          <div class="rp-note">{{ tpl.note }}</div>
          <div class="rp-copy">{{ c }}</div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button type="primary" :icon="'Printer'" @click="doPrint">打印（{{ tpl.copies }} 联）</el-button>
    </template>
  </el-dialog>

  <!-- 打印走独立 portal 挂到 body：@media print 里隐藏 #app 只留它，
       不用和 Element Plus 的 dialog / overlay 层级纠缠 -->
  <Teleport to="body">
    <div v-if="printing" class="receipt-portal">
      <div
        v-for="(c, i) in tpl.copyTitles" :key="i"
        class="rp-paper"
        :style="paperStyle"
      >
        <div class="rp-inner" :style="innerStyle">
          <div class="rp-title">{{ tpl.title }}</div>
          <div class="rp-meta">
            <span>编号：{{ inv.invoiceNo }}</span>
            <span>日期：{{ dateText }}</span>
          </div>
          <div class="rp-row">
            <span class="rp-buyer">付款方：{{ inv.buyerTitle || '—' }}</span>
            <span v-if="inv.houseName" class="rp-house">房屋：{{ inv.houseName }}</span>
          </div>
          <table class="rp-table">
            <thead>
              <tr><th class="c1">项目</th><th class="c2">金额</th><th class="c3">备注</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="c1">{{ inv.itemName }}</td>
                <td class="c2 num">{{ money(inv.amount) }}</td>
                <td class="c3">{{ inv.communityName }}</td>
              </tr>
            </tbody>
          </table>
          <div class="rp-sum">
            <span class="rp-words">合计人民币（大写）：<b>{{ words }}</b></span>
            <span class="rp-amt num">¥ {{ money(inv.amount) }}</span>
          </div>
          <div class="rp-row"><span>收款方式：{{ inv.payMethodText || '—' }}</span></div>
          <div class="rp-foot">
            <span>{{ tpl.footerLeft }}{{ inv.issuer }}</span>
            <span>{{ tpl.footerRight }}</span>
          </div>
          <div class="rp-note">{{ tpl.note }}</div>
          <div class="rp-copy">{{ c }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref } from 'vue'
import { amountInWords, invoiceTplGet } from '@/utils/api'
import { money } from '@/utils/format'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 票据对象（invoices 里的一条）。缺字段时用占位，不抛错 —— 打印预览不该因为数据不全就打不开 */
  invoice: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['update:modelValue'])

const tpl = ref(invoiceTplGet())
const inv = ref({})
const printing = ref(false)
/* 241mm 的纸按 0.72 缩到约 655px：再小字就看不清了（10pt 缩到 0.6 只有 7pt 的观感）；
   打印时 zoom 归 1 */
const PREVIEW_ZOOM = 0.72

function onOpen() {
  tpl.value = invoiceTplGet()
  inv.value = props.invoice || {}
}

const dateText = computed(() => String(inv.value.issueTime || '').slice(0, 10) || '—')
const words = computed(() => amountInWords(inv.value.amount || 0))

const paperStyle = computed(() => {
  const t = tpl.value
  return {
    width: t.paper.width + 'mm',
    height: t.paper.height + 'mm',
    paddingTop: t.margin.top + 'mm',
    paddingRight: t.margin.right + 'mm',
    paddingBottom: t.margin.bottom + 'mm',
    paddingLeft: t.margin.left + 'mm',
    transform: `translate(${t.offset.x}mm, ${t.offset.y}mm)`,
    zoom: PREVIEW_ZOOM
  }
})
const innerStyle = computed(() => {
  const t = tpl.value
  return {
    fontFamily: t.font.family + ', serif',
    fontSize: t.font.size + 'pt',
    lineHeight: t.font.lineHeight
  }
})

function doPrint() {
  const t = tpl.value
  printing.value = true
  const rule = document.createElement('style')
  rule.id = 'receipt-page-rule'
  /* 纸张尺寸必须跟着模板走；多联是一次走纸，高度乘联数 */
  rule.textContent = `@page { size: ${t.paper.width}mm ${t.paper.height * t.copies}mm; margin: 0 }`
  document.head.appendChild(rule)
  document.body.classList.add('printing-receipt')
  setTimeout(() => {
    window.print()
    setTimeout(() => {
      document.body.classList.remove('printing-receipt')
      rule.remove()
      printing.value = false
    }, 900)
  }, 120)
}
</script>

<style>
/* 非 scoped：portal 挂在 body 下，scoped 的 data 属性带不过去 */
.receipt-portal { display: none; }
.receipt-portal .rp-paper { zoom: 1 !important; }

@media print {
  body.printing-receipt #app { display: none !important; }
  body.printing-receipt .receipt-portal { display: block !important; }
}
</style>

<style scoped>
.rp-tip {
  padding: 9px 12px; border-radius: 8px; background: var(--biz-bg-fill);
  font-size: 11.5px; line-height: 1.85; color: var(--biz-text-2);
}
.rp-tip b { color: var(--biz-text-1); }

.rp-stage {
  margin-top: 14px; padding: 16px; border-radius: 10px;
  background: var(--biz-bg-fill); display: flex; flex-direction: column;
  align-items: center; gap: 12px; max-height: 460px; overflow: auto;
}

.rp-paper {
  background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, .1);
  box-sizing: border-box; flex: 0 0 auto;
}
.rp-inner { height: 100%; display: flex; flex-direction: column; color: #1a1a1a; }

.rp-title { text-align: center; font-size: 1.5em; letter-spacing: .4em; margin-bottom: .5em; }
.rp-meta { display: flex; justify-content: space-between; font-size: .92em; }
.rp-row { display: flex; justify-content: space-between; gap: 8px; margin-top: .35em; }
.rp-buyer { flex: 1; }
.rp-house { text-align: right; }

.rp-table {
  width: 100%; border-collapse: collapse; margin-top: .4em; font-size: .95em;
}
.rp-table th, .rp-table td {
  border: 1px solid #333; padding: .18em .35em; text-align: left;
}
.rp-table th { font-weight: 400; background: #fafafa; }
.rp-table .c1 { width: 42%; }
.rp-table .c2 { width: 24%; text-align: right; }
.rp-table .num { font-variant-numeric: tabular-nums; }

.rp-sum {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 8px; margin-top: .4em; font-size: .95em;
}
.rp-words { flex: 1; }
.rp-words b { font-weight: 400; }
.rp-amt { font-size: 1.12em; }

.rp-foot {
  display: flex; justify-content: space-between;
  margin-top: .5em; font-size: .92em;
}
.rp-note { margin-top: .25em; font-size: .82em; color: #555; }

.rp-copy {
  margin-top: auto; text-align: right; font-size: .82em; color: #666;
}
</style>
