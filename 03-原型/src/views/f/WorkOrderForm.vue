<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="false" :saving="saving" :dirty="dirty"
    title="发起工单"
    subtitle="客服代客报事 / 内部报修统一入口；提交后进入「待派单」，由派单规则或人工指派处理人"
    submit-text="提交工单"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />提交为<b>内存态</b>：工单写入当前会话（工单列表立即可见），刷新还原。
      SLA 按优先级自动带出（特急 4h / 紧急 8h / 普通 24h）。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>报事信息</h4><span class="desc">标题与描述将推送给业主 App</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="工单类型" prop="type">
            <el-select v-model="form.type" style="width:100%" @change="form.category = ''">
              <el-option v-for="t in woTypeOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="问题分类" prop="category">
            <el-select v-model="form.category" filterable allow-create style="width:100%" placeholder="选择或输入">
              <el-option v-for="c in categoryOpts" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="优先级" prop="priority">
            <el-radio-group v-model="form.priority">
              <el-radio-button v-for="p in woPriorityOpts()" :key="p" :label="p" :value="p" />
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="16">
          <el-form-item label="工单标题" prop="title">
            <el-input v-model="form.title" maxlength="40" show-word-limit placeholder="一句话说明问题，如：主卫水管漏水" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="来源" prop="source">
            <el-select v-model="form.source" style="width:100%">
              <el-option v-for="s in woSourceOpts()" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="问题描述" prop="description">
            <el-input v-model="form.description" type="textarea" :rows="3" maxlength="200" show-word-limit
              placeholder="补充现场情况、业主诉求、可上门时间等" />
          </el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd">
        <h4>位置与联系人</h4>
        <span class="desc">不选房屋即为公共区域工单（不入户，无需业主配合）</span>
      </div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="所属项目" prop="communityId">
            <el-select v-model="form.communityId" style="width:100%">
              <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="关联房屋">
            <el-select v-model="form.houseId" filterable clearable style="width:100%" placeholder="选择房屋（公共区域可不选）"
              @change="onHouseChange">
              <el-option v-for="h in houseOpts" :key="h.houseId" :label="h.label" :value="h.houseId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="联系人">
            <el-input v-model="form.ownerName" placeholder="选填，默认取产权业主" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="联系电话" prop="phone">
            <el-input v-model="form.phone" maxlength="11" placeholder="选填，需回访时填写" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="预约上门">
            <el-date-picker v-model="form.appointAt" type="datetime" value-format="YYYY-MM-DD HH:mm"
              placeholder="选填" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="指定处理人">
            <el-select v-model="form.assignee" filterable clearable style="width:100%" placeholder="不选则进入待派单池">
              <el-option v-for="e in repairCandidates()" :key="e.empId" :label="`${e.name} · ${e.position}`" :value="e.name" />
            </el-select>
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
import {
  communityOpts, createWorkOrder, houseOptions, repairCandidates,
  woCategoryOpts, woPriorityOpts, woSourceOpts, woTypeOpts
} from '@/utils/api'
import { phoneOptional, reqSel, req as reqText } from '@/utils/rules'

const router = useRouter()
const EMPTY = {
  type: '入户维修', category: '', priority: '普通', title: '', source: '客服代客', description: '',
  communityId: 'P01', houseId: '', ownerName: '', phone: '', appointAt: '', assignee: ''
}
const form = reactive({ ...EMPTY })
const rules = {
  type: reqSel('工单类型'),
  category: reqSel('问题分类'),
  priority: reqSel('优先级'),
  title: reqText('工单标题'),
  description: reqText('问题描述'),
  communityId: reqSel('所属项目'),
  phone: phoneOptional('联系电话')
}

const houseOpts = ref([])
const categoryOpts = computed(() => woCategoryOpts(form.type))
watch(() => form.communityId, cid => {
  houseOpts.value = houseOptions(300, { communityId: cid })
  if (form.houseId && !houseOpts.value.some(h => h.houseId === form.houseId)) form.houseId = ''
}, { immediate: true })
function onHouseChange() {
  const h = houseOpts.value.find(x => x.houseId === form.houseId)
  if (h?.ownerName) form.ownerName = h.ownerName
}

const shell = ref()
const { saving, dirty, submit, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    const wo = createWorkOrder({ ...form })
    if (!wo) throw new Error('提交失败')
  }
})
async function onSubmit() {
  const ok = await submit(`工单已提交，单号待派单（SLA ${form.priority === '特急' ? 4 : form.priority === '紧急' ? 8 : 24} 小时）`)
  if (!ok) return
  try {
    await ElMessageBox.confirm('工单已提交，状态为「待派单」（原型阶段为内存态，刷新还原）', '提示',
      { confirmButtonText: '去工单列表', cancelButtonText: '继续发起', type: 'success' })
    router.push('/f/workorders')
  } catch { /* 继续发起 */ }
}
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/f/workorders')
}
</script>
