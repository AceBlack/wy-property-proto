<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="loading" :saving="saving" :dirty="dirty"
    :title="editing ? '编辑巡检计划' : '新建巡检计划'"
    :subtitle="editing ? '修改周期 / 执行人后，已生成的任务不受影响' : '计划启用后按周期自动生成巡检任务'"
    :submit-text="editing ? '保存修改' : '创建计划'"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note><br />提交为<b>内存态</b>（原型阶段不写库，刷新还原）。</template>

    <div class="sec">
      <div class="sec__hd"><h4>计划定义</h4><span class="desc">模板决定巡检项与合格标准</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="计划名称" prop="name"><el-input v-model="form.name" placeholder="如 保洁责任区日检" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="岗位" prop="post">
            <el-select v-model="form.post" allow-create filterable style="width:100%">
              <el-option v-for="t in planPostOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="周期" prop="cycle">
            <el-select v-model="form.cycle" style="width:100%">
              <el-option v-for="t in planCycleOpts()" :key="t" :label="t" :value="t" />
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
          <el-form-item label="检查模板" prop="templateId">
            <el-select v-model="form.templateId" style="width:100%">
              <el-option v-for="t in templateOptions()" :key="t.templateId" :label="t.label" :value="t.templateId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="执行人" prop="executor">
            <el-select v-model="form.executor" filterable allow-create style="width:100%" placeholder="可输入新执行人">
              <el-option v-for="e in empOptions(200)" :key="e.empId" :label="e.label.split(' · ')[0]" :value="e.label.split(' · ')[0]" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="巡检项数" prop="items">
            <el-input v-model.number="form.items" placeholder="模板生成，可手改"><template #append>项</template></el-input>
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
  </FormShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import { ElMessage } from 'element-plus'
import {
  communityOpts, createInspectPlan, empOptions, getInspectPlanDetail,
  planCycleOpts, planPostOpts, templateOptions, updateInspectPlan
} from '@/utils/api'
import { intPositive, req, reqSel } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')

const EMPTY = {
  name: '', post: '', cycle: '', communityId: 'P01', templateId: '', executor: '', items: 1, status: '启用'
}
const form = reactive({ ...EMPTY })
const rules = {
  name: req('计划名称'),
  post: reqSel('岗位'),
  cycle: reqSel('周期'),
  communityId: reqSel('所属项目'),
  templateId: reqSel('检查模板'),
  executor: req('执行人'),
  items: intPositive('巡检项数', 99),
  status: reqSel('状态')
}

const shell = ref()
const loading = ref(false)
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    // F5：新建 / 编辑真正落到 inspectPlans（内存态）
    if (editing.value) updateInspectPlan(String(id.value), { ...form })
    else createInspectPlan({ ...form })
    await new Promise(r => setTimeout(r, 400))
  }
})
async function onSubmit() {
  let ok = false
  try {
    ok = await submit(editing.value ? '计划已更新' : '计划已创建')
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
    return
  }
  if (!ok) return
  try {
    await ElMessageBox.confirm('保存成功（原型阶段为内存态，刷新还原）', '提示',
      { confirmButtonText: '返回列表', cancelButtonText: '继续编辑', type: 'success' })
    router.push('/f/inspect-plans')
  } catch { /* 继续编辑 */ }
}
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/f/inspect-plans')
}

onMounted(async () => {
  if (!id.value) return
  loading.value = true
  try {
    const d = await getInspectPlanDetail(String(id.value))
    const p = d?.plan || d
    if (p) {
      Object.assign(form, {
        name: p.name, post: p.post, cycle: p.cycle, communityId: p.communityId,
        templateId: p.templateId, executor: p.executor, items: p.items ?? 1, status: p.status || '启用'
      })
      markSaved()
    }
  } finally { loading.value = false }
})
</script>
