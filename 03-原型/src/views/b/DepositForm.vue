<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="false" :saving="saving" :dirty="dirty"
    title="登记装修押金"
    subtitle="押金场景只有「装修押金」一种；登记后状态为「装修中」，完工验收后再退款或扣款"
    submit-text="登记押金"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />提交为<b>内存态</b>（台账立即可见，刷新还原）。金额建议按面积分档：&lt;90㎡ 2000 / 90–140㎡ 3000 / &gt;140㎡ 或商铺 5000。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>装修房屋</h4><span class="desc">选房后自动带出项目、业主与建议金额</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="所属项目" prop="communityId">
            <el-select v-model="form.communityId" style="width:100%">
              <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="装修房屋" prop="houseId">
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
      <div class="sec__hd"><h4>押金与工期</h4><span class="desc">计划完工日须晚于开工日；逾期未验收会进入「已逾期」</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="押金金额" prop="amount">
            <el-input v-model.number="form.amount" type="number" :min="0">
              <template #append>元</template>
            </el-input>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="收款日期" prop="paidDate">
            <el-date-picker v-model="form.paidDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="开工日期" prop="startDate">
            <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
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
            <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="120" placeholder="选填，如装修范围、注意事项" />
          </el-form-item>
        </el-col>
      </el-row>
    </div>
  </FormShell>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import { communityOpts, createDeposit, houseOptions } from '@/utils/api'
import { amount, dateAfter, phoneOptional, reqSel } from '@/utils/rules'

const router = useRouter()
const EMPTY = {
  communityId: 'P01', houseId: '', ownerName: '', phone: '', area: 0,
  amount: 3000, paidDate: '', startDate: '', planEndDate: '', operator: '当前登录人', remark: ''
}
const form = reactive({ ...EMPTY })
const rules = {
  communityId: reqSel('所属项目'),
  houseId: reqSel('装修房屋'),
  phone: phoneOptional('联系电话'),
  amount: amount('押金金额'),
  paidDate: reqSel('收款日期', 'change'),
  startDate: reqSel('开工日期', 'change'),
  planEndDate: [...reqSel('计划完工', 'change'), ...dateAfter('startDate', { label: '计划完工' })]
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
  // 建议金额：与数据集口径一致（<90㎡ 2000 / 90–140㎡ 3000 / 其他 5000）
  form.amount = h.area < 90 ? 2000 : (h.area < 140 ? 3000 : 5000)
}

const shell = ref()
const { saving, dirty, submit, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => { createDeposit({ ...form }) }
})
async function onSubmit() {
  const ok = await submit(`装修押金已登记 ¥${form.amount}`)
  if (!ok) return
  try {
    await ElMessageBox.confirm('押金已登记，状态「装修中」（原型阶段为内存态，刷新还原）', '提示',
      { confirmButtonText: '返回台账', cancelButtonText: '继续登记', type: 'success' })
    router.push('/b/deposits')
  } catch { /* 继续登记 */ }
}
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/b/deposits')
}
</script>
