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
          <el-form-item label="科目分类" prop="category">
            <el-select v-model="form.category" allow-create filterable style="width:100%">
              <el-option v-for="t in feeCategoryOpts()" :key="t" :label="t" :value="t" />
            </el-select>
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
import { feeCalcTypeOpts, feeCategoryOpts, getFeeItemDetail } from '@/utils/api'
import { amount, number, reqSel } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')

const EMPTY = {
  name: '', category: '', bizType: '住宅', status: '启用',
  calcType: '按面积', price: null, unit: '元/㎡·月', cycle: '月', taxRate: 6, remark: ''
}
const form = reactive({ ...EMPTY })
const rules = {
  name: [{ required: true, message: '请输入科目名称', trigger: 'blur' }],
  category: reqSel('科目分类'),
  bizType: reqSel('适用业态'),
  status: reqSel('状态'),
  calcType: reqSel('计费方式'),
  price: amount('单价'),
  unit: [{ required: true, message: '请输入计价单位', trigger: 'blur' }],
  cycle: reqSel('计费周期'),
  taxRate: number('税率', { min: 0, max: 100, precision: 2 })
}

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
        name: it.name, category: it.category, bizType: it.bizType || '住宅', status: it.status || '启用',
        calcType: it.calcType, price: it.price, unit: it.unit, cycle: it.cycle || '月',
        taxRate: it.taxRate ?? 6, remark: it.remark || ''
      })
      markSaved()
    }
  } finally { loading.value = false }
})
</script>
