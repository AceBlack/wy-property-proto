<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="loading" :saving="saving" :dirty="dirty"
    :title="editing ? '编辑科目' : '新增科目'"
    :subtitle="editing ? '调价后仅影响新生成账单，历史账单不变' : '科目启用后方可被账单引用'"
    :submit-text="editing ? '保存修改' : '创建科目'"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note><br />提交为<b>内存态</b>（原型阶段不写库，刷新还原）。</template>

    <div class="sec">
      <div class="sec__hd"><h4>科目定义</h4><span class="desc">名称在同类目下唯一</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="科目名称" prop="name"><el-input v-model="form.name" placeholder="如 物业服务费" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="方向" prop="direction">
            <el-select v-model="form.direction" style="width:100%">
              <el-option v-for="o in FEE_ITEM_DIRECTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <div class="fld-tip">
              押金类选「负债」：它不参与应收与收缴率，收了进负债表（见押金台账）
            </div>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="适用业态" prop="bizType">
            <el-select v-model="form.bizType" style="width:100%">
              <el-option v-for="t in ['住宅', '商业', '车位', '通用']" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="状态" prop="status">
            <el-radio-group v-model="form.status">
              <el-radio v-for="s in ['启用', '停用']" :key="s" :value="s">{{ s }}</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>计费方式</h4><span class="desc">单价与周期决定账单金额；税率影响开票</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="计费方式" prop="calcType">
            <el-select v-model="form.calcType" style="width:100%">
              <el-option v-for="t in feeCalcTypeOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="单价" prop="price">
            <el-input v-model.number="form.price" placeholder="请输入"><template #append>元</template></el-input>
            <div class="fld-tip">
              <el-checkbox v-model="isReference">这是参考价（不参与计算）</el-checkbox>
              <span>水电这类按项目价目表 / 房屋覆盖价结算的，勾上；否则账单会拿这个价当成交价</span>
            </div>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="计价单位" prop="unit"><el-input v-model="form.unit" placeholder="如 元/㎡·月" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="计费周期" prop="cycle">
            <el-select v-model="form.cycle" style="width:100%">
              <el-option v-for="t in ['月', '季', '年', '一次性']" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="税率" prop="taxRate">
            <el-input v-model.number="form.taxRate" placeholder="百分比"><template #append>%</template></el-input>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="24">
        <el-col :span="24">
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="选填，200 字以内" />
          </el-form-item>
        </el-col>
      </el-row>
    </div>
  </FormShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import { FEE_ITEM_DIRECTIONS, feeCalcTypeOpts, getFeeItemDetail } from '@/utils/api'
import { amount, number, reqSel } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')

const EMPTY = {
  name: '', direction: 'billable', bizType: '住宅', status: '启用',
  calcType: '按面积', price: null, unit: '元/㎡·月', cycle: '月', taxRate: 6, remark: '',
  priceMode: 'standard'
}
const form = reactive({ ...EMPTY })
const rules = {
  name: [{ required: true, message: '请输入科目名称', trigger: 'blur' }],
  direction: reqSel('方向'),
  bizType: reqSel('适用业态'),
  status: reqSel('状态'),
  calcType: reqSel('计费方式'),
  price: amount('单价'),
  unit: [{ required: true, message: '请输入计价单位', trigger: 'blur' }],
  cycle: reqSel('计费周期'),
  taxRate: number('税率', { min: 0, max: 100, precision: 2 })
}

/* 参考价开关独立出来：priceMode 是枚举，用 checkbox 表达比下拉块 */
const isReference = computed({
  get: () => form.priceMode === 'reference',
  set: v => { form.priceMode = v ? 'reference' : 'standard' }
})

const shell = ref()
const loading = ref(false)
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => { await new Promise(r => setTimeout(r, 400)) }
})

async function onSubmit() {
  const ok = await submit(editing.value ? '科目已更新' : '科目已创建')
  if (!ok) return
  try {
    await ElMessageBox.confirm('保存成功（原型阶段为内存态，刷新还原）', '提示',
      { confirmButtonText: '返回列表', cancelButtonText: '继续编辑', type: 'success' })
    router.push('/b/fee-items')
  } catch { /* 继续编辑 */ }
}
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/b/fee-items')
}

onMounted(async () => {
  if (!id.value) return
  loading.value = true
  try {
    const d = await getFeeItemDetail(String(id.value))
    const it = d?.item || d
    if (it) {
      Object.assign(form, {
        name: it.name, direction: it.direction || 'billable', bizType: it.bizType || '住宅', status: it.status || '启用',
        calcType: it.calcType, price: it.price, unit: it.unit, cycle: it.cycle || '月',
        taxRate: it.taxRate ?? 6, remark: it.remark || '', priceMode: it.priceMode || 'standard'
      })
      markSaved()
    }
  } finally { loading.value = false }
})
</script>

<style scoped>
.fld-tip { font-size: 11.5px; line-height: 1.7; color: var(--biz-text-3); margin-top: 4px; }
</style>
