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
      <div class="sec__hd"><h4>计划定义</h4><span class="desc">模板决定巡检项与合格标准；类型决定由谁执行</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="计划名称" prop="name"><el-input v-model="form.name" placeholder="如 保洁责任区日检" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="任务类型" prop="taskType">
            <el-radio-group v-model="form.taskType" @change="onTypeChange">
              <el-radio value="执行">执行（一线作业）</el-radio>
              <el-radio value="监督">监督（组长核验）</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item v-if="isSup" label="被检岗位" prop="targetPost">
            <el-select v-model="form.targetPost" style="width:100%" @change="onPostChange">
              <el-option v-for="t in supPostOpts" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item v-else label="岗位" prop="post">
            <el-select v-model="form.post" style="width:100%">
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
            <el-select v-model="form.templateId" style="width:100%" @change="onTemplateChange">
              <el-option v-for="t in templateOpts" :key="t.templateId" :label="t.label" :value="t.templateId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item :label="isSup ? '监督人（组长）' : '执行人'" prop="executor">
            <el-select v-model="form.executor" filterable :allow-create="!isSup" style="width:100%"
              :placeholder="isSup ? '从本组组长中选' : '可输入新执行人'">
              <el-option v-for="e in execOpts" :key="e.v" :label="e.l" :value="e.v" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col v-if="isSup" :span="8">
          <el-form-item label="被检班组" prop="targetDept">
            <el-select v-model="form.targetDept" style="width:100%" placeholder="选择被核验的班组">
              <el-option v-for="d in deptOpts" :key="d.id" :label="d.name" :value="d.id" />
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
      <el-alert v-if="isSup" type="warning" :closable="false" show-icon style="margin-top:4px;"
        title="监督任务由品质督导下达：执行人是部门经理（组长），到现场核验下属责任区实际达标情况，发现问题须指定责任员工。" />
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
  communityOpts, createInspectPlan, deptManagerOpts, empOptions, getInspectPlanDetail,
  inspectTargetDeptOpts, planCycleOpts, planPostOpts, templateOptionsOf, tplPostOpts,
  updateInspectPlan
} from '@/utils/api'
import { intPositive, req, reqSel } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')

const EMPTY = {
  name: '', taskType: '执行', post: '', targetPost: '', targetDept: '',
  cycle: '', communityId: 'P01', templateId: '', executor: '', items: 1, status: '启用'
}
const form = reactive({ ...EMPTY })
const isSup = computed(() => form.taskType === '监督')

/** 模板下拉按类型过滤：选监督就只能挑监督模板；选了被检岗位后只留该岗位的模板 */
const templateOpts = computed(() => {
  const list = templateOptionsOf(form.taskType)
  if (!isSup.value || !form.targetPost) return list
  return list.filter(t => !t.applyPost || t.applyPost === form.targetPost)
})
/** 监督岗位来自监督模板的「被检岗位」；执行岗位沿用原岗位字典 */
const supPostOpts = computed(() => tplPostOpts('监督'))
/** 被检班组：只列本项目下的班组 */
const deptOpts = computed(() => inspectTargetDeptOpts().filter(d => !form.communityId || d.communityId === form.communityId))
/** 执行人：监督任务只能从本项目的组长池里选，避免指派给一线员工 */
const execOpts = computed(() => {
  if (isSup.value) {
    return deptManagerOpts()
      .filter(e => !form.communityId || e.communityId === form.communityId)
      .filter(e => !form.targetPost || e.post === form.targetPost)
      .map(e => ({ v: e.id, l: e.name }))
  }
  return empOptions(200).map(e => ({ v: e.label.split(' · ')[0], l: e.label.split(' · ')[0] }))
})

const baseRules = {
  name: req('计划名称'),
  cycle: reqSel('周期'),
  communityId: reqSel('所属项目'),
  templateId: reqSel('检查模板'),
  executor: req('执行人'),
  items: intPositive('巡检项数', 99),
  status: reqSel('状态')
}
const rules = computed(() => (isSup.value
  ? { ...baseRules, targetPost: reqSel('被检岗位'), targetDept: reqSel('被检班组') }
  : { ...baseRules, post: reqSel('岗位') }))

/** 切换类型：清空类型相关的三个字段，避免带着旧模板提交 */
function onTypeChange() {
  form.templateId = ''
  form.post = ''
  form.targetPost = ''
  form.targetDept = ''
  form.executor = ''
}
/** 换被检岗位：模板与被检岗位不一致时清掉模板，避免「客服计划挂环境模板」 */
function onPostChange() {
  const t = templateOpts.value.find(x => x.templateId === form.templateId)
  if (t && t.applyPost && t.applyPost !== form.targetPost) {
    form.templateId = ''
    form.executor = ''
  }
}
/** 选模板后自动带出岗位、项数；监督模板还会带出被检岗位 */
function onTemplateChange(tid) {
  const t = templateOpts.value.find(x => x.templateId === tid)
  if (!t) return
  form.items = t.count || form.items
  if (t.type === '监督') {
    form.targetPost = t.applyPost || form.targetPost
    form.executor = ''
  } else if (t.applyPost) {
    form.post = t.applyPost
  }
}
/** 提交载荷：监督计划的 post 直接取被检岗位，列表「岗位」列才有意义 */
const payload = () => ({ ...form, post: isSup.value ? form.targetPost : form.post })

const shell = ref()
const loading = ref(false)
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    // F5：新建 / 编辑真正落到 inspectPlans（内存态）
    if (editing.value) updateInspectPlan(String(id.value), payload())
    else createInspectPlan(payload())
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
      const type = p.taskType || '执行'
      Object.assign(form, {
        name: p.name, taskType: type,
        post: type === '执行' ? p.post : (p.targetPost || ''),
        targetPost: p.targetPost || (type === '监督' ? p.post : ''),
        targetDept: p.targetDept || '',
        cycle: p.cycle, communityId: p.communityId,
        templateId: p.templateId, executor: p.executor, items: p.items ?? 1, status: p.status || '启用'
      })
      markSaved()
    }
  } finally { loading.value = false }
})
</script>
