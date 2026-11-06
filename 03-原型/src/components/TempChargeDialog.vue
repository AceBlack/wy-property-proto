<template>
  <el-dialog
    :model-value="modelValue" title="临时收费 · 当场收款" width="560"
    :close-on-click-modal="false" @update:model-value="v => emit('update:modelValue', v)"
    @open="onOpen"
  >
    <div class="tc-tip">
      摆摊费、场地租用这类<b>与业务无关</b>的收费。收款后写一条流水（渠道「临时收费」），
      <b>计入收入但不进收缴率</b> —— 它没有应收，进分母只会让收缴率凭空下降。
    </div>

    <el-form label-width="92px" style="margin-top:12px;">
      <el-form-item label="付款方" required>
        <el-radio-group v-model="f.partyType" @change="onPartyChange">
          <el-radio-button v-for="p in TEMP_CHARGE_PARTY" :key="p" :label="p" :value="p">{{ p }}</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <template v-if="f.partyType === '外部'">
        <el-form-item label="单位 / 个人" required>
          <el-input v-model="f.partyName" maxlength="40" placeholder="如：陈记糖油果子" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="f.partyPhone" maxlength="11" placeholder="选填" style="width:180px" />
        </el-form-item>
      </template>

      <template v-else-if="f.partyType === '业主'">
        <el-form-item label="选择业主" required>
          <el-select v-model="f.ownerId" filterable remote :remote-method="searchOwners"
            :loading="ownerLoading" placeholder="输入姓名 / 手机号" style="width:100%" @change="onOwnerPick">
            <el-option v-for="o in ownerOpts" :key="o.value"
              :label="`${o.label}${o.houseName ? ' · ' + o.houseName : ''}`" :value="o.value" />
          </el-select>
        </el-form-item>
      </template>

      <template v-else>
        <el-form-item label="选择租户" required>
          <el-select v-model="f.tenantId" filterable remote :remote-method="searchTenants"
            :loading="tenantLoading" placeholder="输入姓名 / 公司名" style="width:100%" @change="onTenantPick">
            <el-option v-for="t in tenantOpts" :key="t.value"
              :label="`${t.label}${t.houseName ? ' · ' + t.houseName : ''}`" :value="t.value" />
          </el-select>
        </el-form-item>
      </template>

      <el-form-item label="所属项目" required>
        <el-select v-model="f.communityId" placeholder="收入按项目入账" style="width:100%">
          <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </el-form-item>

      <el-form-item label="收费事由" required>
        <el-select v-model="f.reason" filterable allow-create default-first-option style="width:100%"
          placeholder="选一个常用事由，或直接输入" @change="onReasonChange">
          <el-option v-for="r in reasonOpts" :key="r.value" :label="r.label" :value="r.value" />
        </el-select>
      </el-form-item>

      <el-form-item label="应收金额" required>
        <el-input-number v-model="f.amount" :min="0.01" :max="1000000" :precision="2" :step="10"
          controls-position="right" style="flex:0 0 180px;width:180px" />
        <span class="unit">元</span>
      </el-form-item>
    </el-form>

    <div class="sec__hd" style="margin:10px 0 8px;">
      <h4>收款方式</h4>
      <span class="desc">最多 {{ PAY_SPLIT_MAX }} 种 · 合计须等于应收</span>
    </div>

    <div class="splits" :key="splitKey">
      <div v-for="(r, i) in splits" :key="i" class="split-row">
        <el-select v-model="r.method" size="small" style="width:116px">
          <!-- 临时收费不挂房屋，预存抵扣用不了：直接不给选，比选了报错好 -->
          <el-option v-for="m in payMethods" :key="m" :label="m" :value="m"
            :disabled="m !== r.method && splits.some(x => x.method === m)" />
        </el-select>
        <el-input-number v-model="r.amount" :min="0" :max="999999" :precision="2" :step="10"
          size="small" controls-position="right" style="flex:1" />
        <el-button link type="danger" :disabled="splits.length === 1" @click="removeSplit(i)">删</el-button>
      </div>
      <div>
        <el-button link type="primary" :disabled="splits.length >= PAY_SPLIT_MAX" @click="addSplit">
          + 再加一种方式
        </el-button>
      </div>
    </div>

    <div class="split-check" :class="check.ok ? 'is-ok' : 'is-warn'">
      <span>已分配 <b class="money">¥{{ money(check.sum) }}</b> / 应收 <b class="money">¥{{ money(check.total) }}</b></span>
      <span class="split-check__m">{{ check.ok ? '✓ 可以收款' : check.msg }}</span>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :disabled="!check.ok" :loading="saving" @click="doPay">
        确认收款
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  PAY_METHODS, PAY_SPLIT_MAX, TEMP_CHARGE_PARTY, communityOpts, invoiceOwnerOpts,
  invoiceTenantOpts, paySplitCheck, payTempCharge, saveTempCharge, tempChargeReasonOpts
} from '@/utils/api'
import { money } from '@/utils/format'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'done'])

const cmOpts = communityOpts()
const reasonOpts = tempChargeReasonOpts()
/* 预存抵扣不在收银台的临时收费里出现：预存余额记在房屋账户上，而临时收费不挂房屋 */
const payMethods = PAY_METHODS.filter(m => m !== '预存抵扣')

const f = reactive({
  partyType: '外部', partyName: '', partyPhone: '',
  ownerId: '', tenantId: '', houseId: '', communityId: '', reason: '摆摊费', amount: null
})
const splits = ref([{ method: '微信支付', amount: 0 }])
const splitKey = ref(0)
const saving = ref(false)
const ownerOpts = ref([])
const tenantOpts = ref([])
const ownerLoading = ref(false)
const tenantLoading = ref(false)

const check = computed(() => paySplitCheck(splits.value, Number(f.amount) || 0))

function onOpen() {
  Object.assign(f, {
    partyType: '外部', partyName: '', partyPhone: '',
    ownerId: '', tenantId: '', houseId: '', communityId: cmOpts[0]?.id || '',
    reason: '摆摊费', amount: null
  })
  splits.value = [{ method: '微信支付', amount: 0 }]
  splitKey.value += 1
  searchOwners('')
  searchTenants('')
}

async function searchOwners(kw) {
  ownerLoading.value = true
  try { ownerOpts.value = await invoiceOwnerOpts(kw) } finally { ownerLoading.value = false }
}
async function searchTenants(kw) {
  tenantLoading.value = true
  try { tenantOpts.value = await invoiceTenantOpts(kw) } finally { tenantLoading.value = false }
}

function onPartyChange() {
  f.ownerId = ''
  f.tenantId = ''
  f.houseId = ''
  f.partyName = ''
  f.partyPhone = ''
}
function onOwnerPick(id) {
  const o = ownerOpts.value.find(x => x.value === id)
  if (!o) return
  f.partyName = o.label
  f.partyPhone = o.phone || ''
  f.houseId = o.houseId || ''
  if (o.communityId) f.communityId = o.communityId
}
function onTenantPick(id) {
  const t = tenantOpts.value.find(x => x.value === id)
  if (!t) return
  f.partyName = t.label
  f.partyPhone = t.phone || ''
  f.houseId = t.houseId || ''
  if (t.communityId) f.communityId = t.communityId
}
function onReasonChange() { /* 科目在数据层默认跟事由走，这里不再复写 */ }

/* 金额变了同步到单行；多行时让人自己分。
   用 watch 而不是 el-input-number 的 @change：@change 只在失焦 / 回车时触发，
   而 v-model 在输入过程中就更新了 —— 中间会出现"金额已变、收款行没跟上"的一段 */
watch(() => f.amount, v => {
  if (splits.value.length === 1) splits.value[0].amount = Number(v) || 0
})
function addSplit() {
  if (splits.value.length >= PAY_SPLIT_MAX) return
  const used = new Set(splits.value.map(r => r.method))
  const next = payMethods.find(m => !used.has(m)) || '现金'
  const host = splits.value.reduce((m, r) => (r.amount > m.amount ? r : m), splits.value[0])
  const half = Math.round((Number(host.amount) || 0) / 2 * 100) / 100
  host.amount = Math.round(((Number(host.amount) || 0) - half) * 100) / 100
  splits.value.push({ method: next, amount: half })
}
function removeSplit(i) {
  if (splits.value.length === 1) return
  splits.value.splice(i, 1)
}

async function doPay() {
  saving.value = true
  try {
    /* 建单 + 收款一次做完：前台窗口不该让人建完单再去台账点一次收款 */
    const created = await saveTempCharge({
      partyType: f.partyType,
      partyName: f.partyName,
      partyPhone: f.partyPhone,
      ownerId: f.ownerId,
      tenantId: f.tenantId,
      houseId: f.houseId,
      communityId: f.communityId,
      reason: f.reason,
      amount: f.amount
    })
    const res = await payTempCharge(created.chargeId, { splits: splits.value })
    ElMessage.success(`已收 ¥${money(res.charge.amount)}（${res.methodText}）`)
    emit('update:modelValue', false)
    emit('done', res)
  } catch (e) {
    ElMessage.error(e?.message || '收款失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.tc-tip {
  padding: 9px 12px; border-radius: 8px; background: var(--biz-bg-fill);
  font-size: 12px; line-height: 1.8; color: var(--biz-text-2);
}
.tc-tip b { color: var(--biz-text-1); }
.unit { margin-left: 8px; font-size: 12px; color: var(--biz-text-3); }
.splits { display: flex; flex-direction: column; gap: 8px; }
.split-row { display: flex; align-items: center; gap: 8px; }
.split-check {
  display: flex; flex-direction: column; gap: 2px; margin-top: 10px;
  padding: 8px 10px; border-radius: 8px; font-size: 12px; background: var(--biz-bg-fill);
}
.split-check.is-ok { color: var(--biz-success, #2f9e6e); }
.split-check.is-warn { color: var(--biz-danger, #d64545); }
.split-check .money { font-family: var(--biz-font-num); }
.split-check__m { font-size: 11.5px; opacity: .9; }
</style>
