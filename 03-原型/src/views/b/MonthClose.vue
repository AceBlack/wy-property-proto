<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>收费月结 · 一月一笔账</b>：结的是<b>账面</b>，不是现金——收款 / 退款 / 净额，
        再对上当月<b>应收 / 已收 / 欠费</b>。日结把每天的钱点清楚，月结把整月的账封起来。
        <b>一个自然月只能结一次</b>，结完该月流水与退款只读；还有未开票或欠费时，说明必填（不能只点确认）。
        <br />
        <b>结完会立刻重跑该月报表</b>：「试算（未月结）」转成定稿，旧批次保留可查。
        结错了走<b>反结</b>——不删记录、留红冲凭证号，反结后该期报表批次标「已作废」并回到试算。
        <br />
        <b>可以按项目分别结</b>：一个项目账清了就能单独封。但<b>全公司结账要求有业务的项目先结</b>——
        汇总前明细不清，等于用总数掩盖某个项目的问题。全公司反结会级联反结该期各项目。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel rsum">
        <div class="rsum__l">当月收款</div>
        <div class="rsum__v">{{ pre.count }}<span class="unit">笔</span></div>
        <div class="rsum__s">{{ pre.period }} · {{ scopeLabel }} · {{ pre.rows.length }} 种方式</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">实收净额</div>
        <div class="rsum__v money">¥ {{ money(pre.net) }}</div>
        <div class="rsum__s">
          收款 ¥{{ money(pre.income) }} − 退款 ¥{{ money(pre.refund) }}
          <template v-if="pre.prevNet !== null && pre.prevNet !== undefined"> · 上月 ¥{{ money(pre.prevNet) }}</template>
          <template v-else> · 上月未结账</template>
        </div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">当月应收 / 已收</div>
        <div class="rsum__v money">¥ {{ money(pre.receivable) }}</div>
        <div class="rsum__s">已收 ¥{{ money(pre.received) }} · 收缴率 {{ rateText }}</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">当月欠费余额</div>
        <div class="rsum__v money--out">¥ {{ money(pre.debt) }}</div>
        <div class="rsum__s">{{ pre.debtBills }} 张账单未结清</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <span class="toolbar__t">结账范围</span>
        <el-select v-model="scope" style="width:170px" @change="onScopeChange">
          <el-option v-for="o in scopeOpts" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <span class="toolbar__t">结账期次</span>
        <el-select v-model="period" style="width:170px" @change="reload">
          <el-option v-for="o in periodOpts" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-tag v-if="pre.closed" type="success" effect="plain" size="small">已月结 · {{ pre.closed.closeNo }}</el-tag>
        <el-tag v-else-if="!pre.closable" type="info" effect="plain" size="small">不可结账</el-tag>
        <el-tag v-else type="warning" effect="plain" size="small">待结账</el-tag>
        <el-tag v-if="blockedByProjects" type="danger" effect="plain" size="small">
          {{ pre.unclosedCommunities.length }} 个项目未结
        </el-tag>
        <span class="spacer" />
        <span class="muted" style="font-size:12px;">现金按实点、非现金按渠道流水自动对平（口径同日结）</span>
      </div>

      <el-alert
        v-if="blockedByProjects" type="warning" :closable="false" show-icon style="margin-bottom:12px;"
        :title="`还有 ${pre.unclosedCommunities.length} 个项目未结：${pre.unclosedCommunities.map(c => c.name).join('、')}`"
        description="全公司结账要求先把有业务的项目结清——汇总前明细不清，等于用总数掩盖某个项目的问题。把「结账范围」切到单个项目逐个结完，再回来结全公司。"
      />

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
            <el-tag size="small" :type="row.mode === '实点' ? 'warning' : 'info'" effect="plain">{{ row.mode }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:minmax(0,1fr) 420px;">
      <div class="panel">
        <div class="toolbar">
          <span class="toolbar__t">未核销事项与说明</span>
          <span class="spacer" />
          <span class="muted" style="font-size:12px;">有未开票 / 欠费时，说明必填</span>
        </div>

        <el-alert
          v-if="pre.uninvoiced + pre.debtBills > 0" type="warning" :closable="false" show-icon
          style="margin-bottom:12px;"
          :title="`还有 ${pre.uninvoiced} 笔未开票、${pre.debtBills} 笔欠费（¥${money(pre.debt)}）`"
          description="月结不要求清零，但要求写清楚：是留到下月继续催，还是已确认坏账。说明会写进月结记录，随报表一起可查。"
        />
        <el-alert
          v-else type="success" :closable="false" show-icon style="margin-bottom:12px;"
          title="本月无未核销事项" description="应收已收齐、发票已开完，可以直接结账。"
        />

        <el-form label-width="96px" :model="form">
          <el-form-item label="结账说明">
            <el-input v-model="form.memo" type="textarea" :rows="2" :disabled="!!pre.closed"
              maxlength="100" show-word-limit placeholder="如：10 月欠费 32 张已转下月催缴，未开票 96 笔 11 月补开" />
          </el-form-item>
          <el-form-item>
            <el-button
              type="primary" :disabled="!!pre.closed || !pre.closable || !canClose || blockedByProjects"
              :loading="submitting" @click="doClose">
              {{ scope ? '提交项目月结' : '提交全公司月结' }}
            </el-button>
            <el-button
              v-if="pre.closed" type="danger" plain :disabled="!canReopen"
              :loading="reopening" @click="doReopen">
              反结
            </el-button>
            <span v-if="blockedByProjects && !pre.closed" class="muted" style="margin-left:10px;font-size:12px;">
              先结清各项目，再结全公司
            </span>
            <span v-else-if="!canClose && !pre.closed" class="muted" style="margin-left:10px;font-size:12px;">
              封账是财务动作，当前角色没有「收费月结」操作权限
            </span>
            <span v-else-if="pre.closed && !canReopen" class="muted" style="margin-left:10px;font-size:12px;">
              反结需财务主管权限（e.monthReopen.edit）
            </span>
            <span v-if="pre.closed" class="muted" style="margin-left:10px;font-size:12px;">
              {{ pre.closed.at }} 由 {{ pre.closed.operator }} 提交
              <template v-if="pre.closed.reopenCount > 0">（已被反结 {{ pre.closed.reopenCount }} 次）</template>
            </span>
            <span v-else-if="!pre.closable" class="muted" style="margin-left:10px;font-size:12px;">
              该期次还不能结账（未来期间，或已结账）
            </span>
          </el-form-item>
        </el-form>
      </div>

      <div class="panel">
        <div class="toolbar">
          <span class="toolbar__t">月结记录</span>
          <span class="spacer" />
          <span class="muted" style="font-size:12px;">{{ history.length }} 条（含已反结）</span>
        </div>
        <el-table :data="history" size="small" max-height="320">
          <el-table-column label="期次 / 范围" width="104">
            <template #default="{ row }">
              <div>{{ row.period }}</div>
              <div class="ps-sub">{{ row.communityName || '全公司' }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="closeNo" label="月结单" min-width="118" show-overflow-tooltip />
          <el-table-column label="状态" width="86">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === '已反结' ? 'danger' : 'success'" effect="plain">
                {{ row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="net" label="净额" width="92" align="right">
            <template #default="{ row }">{{ money(row.net) }}</template>
          </el-table-column>
          <el-table-column label="欠费" width="86" align="right">
            <template #default="{ row }">
              <span class="money money--out">{{ money(row.debt) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="反结" width="70" align="center">
            <template #default="{ row }">
              <el-tooltip
                v-if="row.reopenCount > 0" placement="top"
                :content="`${row.reopenedAt} ${row.reversalNo}：${row.reopenReason}`">
                <span class="rev">{{ row.reopenCount }} 次</span>
              </el-tooltip>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
/* 月结走适配层（mock/http 同一签名，见 src/api/close.js） */
import {
  communityOpts, monthClosePeriodOpts, previewMonthClose, queryMonthCloses, reopenMonthClose, submitMonthClose
} from '@/api'
import { hasPerm } from '@/utils/auth'
import { money } from '@/utils/format'

/* 按钮级权限：页面能不能进由路由守卫管（b.monthClose.view），
   能不能结 / 能不能反由这里管——两者不是一回事，只读观察员两种都能看、都不能做 */
const canClose = computed(() => hasPerm('b.monthClose.edit'))
const canReopen = computed(() => hasPerm('e.monthReopen.edit'))

/* 结账范围：空串 = 全公司（汇总）。物业按项目核算，一个项目账清了就能单独封账 */
const scope = ref('')
const scopeOpts = [{ value: '', label: '全公司（汇总）' },
  ...communityOpts().map(c => ({ value: c.id, label: c.name }))]
const scopeLabel = computed(() => scopeOpts.find(o => o.value === scope.value)?.label || '全公司')

const periodOpts = ref(monthClosePeriodOpts(''))
const period = ref(periodOpts.value[0]?.value || '2026-10')
/* 初始给空壳：异步取数回来前模板要能渲染，不能靠 undefined 顶着 */
const pre = ref({
  period: period.value, scope: 'group', communityId: '', communityName: '', unclosedCommunities: [],
  rows: [], count: 0, income: 0, refund: 0, net: 0,
  receivable: 0, received: 0, debt: 0, uninvoiced: 0, debtBills: 0,
  prevNet: null, closed: null, closable: false
})
const history = ref([])
const submitting = ref(false)
const reopening = ref(false)
const form = reactive({ memo: '' })

/** 全公司口径下还有项目没结：按钮要拦住，并说清先去结哪几个 */
const blockedByProjects = computed(
  () => !scope.value && (pre.value.unclosedCommunities || []).length > 0
)

async function reload() {
  form.memo = ''
  try {
    pre.value = await previewMonthClose(period.value, scope.value)
  } catch (e) {
    ElMessage.error(e?.message || '预览加载失败')
  }
}

/** 换范围要重算期次下拉的「已结 / 待结」——项目结过不等于全公司结过 */
function onScopeChange() {
  periodOpts.value = monthClosePeriodOpts(scope.value)
  reload()
}

async function loadHistory() {
  try {
    /* 记录列表不分范围：全公司要能看到各项目的结账记录，否则「谁把 P02 结了」查不出来 */
    const res = await queryMonthCloses({ size: 50 })
    history.value = res.rows
  } catch {
    /* 记录列表拉不到不影响结账判断（预览里带 closed），页面不弹二次错误 */
    history.value = []
  }
}

/** 收缴率：本月口径（应收为 0 时显示「—」，不要显示 0%） */
const rateText = computed(() => {
  const p = pre.value
  if (!p.receivable) return '—'
  return (Math.round((p.received / p.receivable) * 10000) / 100).toFixed(2) + '%'
})

/** 合计行：金额列必须有 prop 才能被 show-summary 取到（踩过：空合计行） */
function sumRow({ columns, data }) {
  return columns.map((col, i) => {
    if (i === 0) return '合计'
    const sum = k => data.reduce((s, r) => s + (Number(r[k]) || 0), 0)
    if (col.property === 'count' || col.property === 'refundCount') return sum(col.property)
    if (col.property === 'amount' || col.property === 'refund' || col.property === 'net') {
      return '¥ ' + money(sum(col.property))
    }
    return ''
  })
}

async function doClose() {
  const p = pre.value
  if (p.closed || !p.closable || blockedByProjects.value) return
  const where = scope.value ? `「${scopeLabel.value}」${p.period}` : `${p.period} 全公司`
  try {
    await ElMessageBox.confirm(
      `确认将 ${where} 月结？结账后该范围内的流水与退款只读` +
      (scope.value ? '；报表仍按全公司口径，项目级结账不影响报表定稿状态。' : '，并重跑当月报表（试算转定稿）。'),
      '提交月结', { type: 'warning', confirmButtonText: '确认月结', cancelButtonText: '再核一遍' }
    )
  } catch { return }

  submitting.value = true
  try {
    const rec = await submitMonthClose({
      period: p.period, memo: form.memo, operator: '财务·雷志强', communityId: scope.value
    })
    await reload()
    await loadHistory()
    ElMessage.success(
      `${rec.closeNo} 已月结：净额 ¥${money(rec.net)}，欠费 ¥${money(rec.debt)}` +
      (rec.communityId ? '（项目级结账，报表待全公司结账后重跑）' : '（报表已重跑）')
    )
  } catch (e) {
    ElMessage.error(e?.message || '月结失败')
  } finally {
    submitting.value = false
  }
}

/**
 * 反结：必须写清原因（≥10 字）。
 * 不是"撤销"——记录留着、红冲凭证号留着，只是把封账状态推翻，让该期数据能改。
 */
async function doReopen() {
  const p = pre.value
  if (!p.closed) return
  let reason = ''
  const isGroup = !p.closed.communityId
  try {
    const r = await ElMessageBox.prompt(
      `反结 ${p.period}${isGroup ? '（全公司）' : `「${p.closed.communityName || p.closed.communityId}」`} 后：` +
      '该期流水与退款恢复可写' +
      (isGroup
        ? '；该期各项目级结账一并反结，报表批次标「已作废」并回到试算。'
        : '；报表按全公司口径，项目级反结不影响报表批次。') +
      '请写清原因（至少 10 个字）——这条会留在记录里，别人要靠它判断当时为什么推翻。',
      '反结月结',
      {
        type: 'warning', confirmButtonText: '确认反结', cancelButtonText: '取消',
        inputType: 'textarea', inputPlaceholder: '如：漏记一笔车位费收款，需补录后重新结账',
        inputValidator: v => (String(v || '').trim().length >= 10) || '原因至少 10 个字'
      }
    )
    reason = r.value
  } catch { return }

  reopening.value = true
  try {
    const rec = await reopenMonthClose({ closeId: p.closed.closeId, reason, operator: '财务·雷志强' })
    await reload()
    await loadHistory()
    ElMessage.success(
      `${rec.period}${rec.communityName ? '「' + rec.communityName + '」' : ''} 已反结（${rec.reversalNo}）：` +
      (rec.communityId ? '该范围数据恢复可写' : '该期报表回到试算，明细恢复可写')
    )
  } catch (e) {
    ElMessage.error(e?.message || '反结失败')
  } finally {
    reopening.value = false
  }
}

onMounted(async () => {
  await reload()
  await loadHistory()
})
</script>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.toolbar__t { font-size: 14px; font-weight: 600; color: var(--biz-text-1); }
.toolbar .spacer { flex: 1; }
.rsum { padding: 12px 16px; }
.rsum__l { font-size: 12px; color: var(--biz-text-3); }
.rsum__v { font-size: 20px; font-weight: 600; color: var(--biz-text-1); margin-top: 4px; }
.rsum__s { font-size: 12px; color: var(--biz-text-3); margin-top: 4px; }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 2px; }
.rev { color: #c45656; cursor: help; }
</style>
