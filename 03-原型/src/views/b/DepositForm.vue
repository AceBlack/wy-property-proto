<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="false" :saving="saving" :dirty="dirty"
    title="登记押金"
    :subtitle="subtitle"
    submit-text="登记押金"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />提交为<b>内存态</b>（台账立即可见，刷新还原）。
      <br />金额规则由类型决定：<b>有标准额</b>的按标准额 × 数量（装修 3000 / 门禁卡 50 / 车牌 20）；
      <b>无标准额</b>的（履约保证金、租约押金）按合同或租约填，不能空着。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>押金类型与房屋</h4><span class="desc">类型决定要不要工期、要不要验收、金额是否固定</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="押金类型" prop="type">
            <el-select v-model="form.type" style="width:100%" @change="onType">
              <el-option v-for="o in typeOpts" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="所属项目" prop="communityId">
            <el-select v-model="form.communityId" style="width:100%">
              <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="房屋" prop="houseId">
            <el-select v-model="form.houseId" filterable style="width:100%" placeholder="选择房屋" @change="onHouse">
              <el-option v-for="h in houseOpts" :key="h.houseId" :label="h.label" :value="h.houseId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="业主">
            <el-input :model-value="form.ownerName" disabled placeholder="选房后自动带出" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="联系电话" prop="phone">
            <el-input v-model="form.phone" maxlength="11" placeholder="选填" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="建筑面积">
            <el-input :model-value="form.area ? form.area + ' ㎡' : ''" disabled placeholder="选房后自动带出" />
          </el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd">
        <h4>押金{{ def?.needDates ? '与工期' : '' }}</h4>
        <span class="desc">{{ secDesc }}</span>
      </div>
      <el-row :gutter="24">
        <el-col v-if="def?.byQuantity" :span="8">
          <el-form-item label="数量" prop="quantity">
            <el-input-number v-model="form.quantity" :min="1" :max="99" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item :label="def && def.standardAmount > 0 ? '押金金额' : '约定金额'" prop="amount">
            <el-input v-model.number="form.amount" type="number" :min="0" :disabled="fixedAmount">
              <template #append>元</template>
            </el-input>
          </el-form-item>
          <div v-if="fixedAmount" class="fld-tip">标准额 {{ def.standardAmount }} 元{{ def.byQuantity ? ' × 数量' : '' }}，不可改</div>
          <div v-else class="fld-tip">按合同 / 租约金额填写；退款时按这个数作为基数</div>
        </el-col>
        <el-col :span="8">
          <el-form-item label="收款日期" prop="paidDate">
            <el-date-picker v-model="form.paidDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col v-if="def?.needDates" :span="8">
          <el-form-item label="开工日期" prop="startDate">
            <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col v-if="def?.needDates" :span="8">
          <el-form-item label="计划完工" prop="planEndDate">
            <el-date-picker v-model="form.planEndDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="经办人">
            <el-input v-model="form.operator" placeholder="当前登录人" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="120"
              :placeholder="def?.standardAmount > 0 ? '选填，如装修范围、注意事项' : '建议写清合同号 / 租约编号，退款时对得上'" />
          </el-form-item>
        </el-col>
      </el-row>
    </div>
  </FormShell>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import { communityOpts, createDeposit, depositTypeOf, depositTypeOpts, houseOptions } from '@/utils/api'
import { dateAfter, phoneOptional, reqSel } from '@/utils/rules'

const router = useRouter()
const typeOpts = depositTypeOpts()
const EMPTY = {
  type: '装修押金', quantity: 1,
  communityId: 'P01', houseId: '', ownerName: '', phone: '', area: 0,
  amount: 3000, paidDate: '', startDate: '', planEndDate: '', operator: '当前登录人', remark: ''
}
const form = reactive({ ...EMPTY })

const def = computed(() => depositTypeOf(form.type))
const fixedAmount = computed(() => Number(def.value?.standardAmount) > 0)
const subtitle = computed(() => def.value
  ? (def.value.needCheck
    ? `${def.value.name}：登记后进入「${def.value.needDates ? '装修中' : '在押'}」，验收后办理退款或扣款`
    : `${def.value.name}：退卡 / 退牌时直接退款，不需要验收`)
  : '')
const secDesc = computed(() => {
  const d = def.value
  if (!d) return ''
  if (d.needDates) return '计划完工日须晚于开工日；逾期未验收会进入「已逾期」'
  if (d.needCheck) return '该类型不设工期，但需要验收/核验后才能退款'
  return '该类型不设工期也不需要验收，收取后随时可办理退款'
})

const rules = computed(() => {
  const r = {
    type: reqSel('押金类型'),
    communityId: reqSel('所属项目'),
    houseId: reqSel('房屋'),
    phone: phoneOptional('联系电话'),
    amount: [{
      validator: (_, v, cb) => {
        if (Number(v) > 0) return cb()
        cb(new Error(fixedAmount.value ? '押金金额必须大于 0' : '请按合同 / 租约填写约定金额'))
      }, trigger: 'blur'
    }],
    paidDate: reqSel('收款日期', 'change')
  }
  if (def.value?.needDates) {
    r.startDate = reqSel('开工日期', 'change')
    r.planEndDate = [...reqSel('计划完工', 'change'), ...dateAfter('startDate', { label: '计划完工' })]
  }
  return r
})

/** 标准额类型：金额 = 标准额 × 数量，且不允许手改 */
watch(() => [form.type, form.quantity], () => {
  const d = def.value
  if (!d) return
  if (Number(d.standardAmount) > 0) {
    const q = d.byQuantity ? Math.max(1, Number(form.quantity) || 1) : 1
    form.amount = Math.round(d.standardAmount * q * 100) / 100
  } else if (form.amount === 3000) {
    // 从"装修押金"切到"金额按约定"的类型时，别把 3000 当默认值带过去
    form.amount = 0
  }
})

function onType() {
  const d = def.value
  if (!d) return
  if (!d.needDates) { form.startDate = ''; form.planEndDate = '' }
  if (!d.byQuantity) form.quantity = 1
  if (Number(d.standardAmount) > 0) form.amount = d.standardAmount * (d.byQuantity ? form.quantity : 1)
  else form.amount = 0
}

const houseOpts = ref([])
watch(() => form.communityId, cid => {
  houseOpts.value = houseOptions(300, { communityId: cid })
  if (form.houseId && !houseOpts.value.some(h => h.houseId === form.houseId)) form.houseId = ''
}, { immediate: true })

function onHouse() {
  const h = houseOpts.value.find(x => x.houseId === form.houseId)
  if (!h) return
  form.ownerName = h.ownerName || ''
  form.phone = h.phone || form.phone
  form.area = h.area || 0
  /* 装修押金按面积分档给建议值（与数据集口径一致）；其余类型金额来自字典或合同，不猜 */
  if (form.type === '装修押金') {
    form.amount = h.area < 90 ? 2000 : (h.area < 140 ? 3000 : 5000)
  }
}

const shell = ref()
const { saving, dirty, submit, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => { createDeposit({ ...form }) }
})
async function onSubmit() {
  const ok = await submit(`${form.type}已登记 ¥${form.amount}`)
  if (!ok) return
  try {
    await ElMessageBox.confirm(
      `${form.type}已登记 ¥${form.amount}（原型阶段为内存态，刷新还原）`, '登记成功',
      { confirmButtonText: '返回台账', cancelButtonText: '继续登记', type: 'success' }
    )
    router.push('/b/deposits')
  } catch { /* 继续登记 */ }
}
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/b/deposits')
}
</script>

<style scoped>
.fld-tip { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }
</style>
