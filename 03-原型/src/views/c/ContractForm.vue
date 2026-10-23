<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="loading" :saving="saving" :dirty="dirty"
    :title="editing ? '编辑合同' : '新建合同'"
    :subtitle="editing ? '变更 / 续签均需走审批，保存后发起流程' : '五类合同统一建档：劳动、采购、租赁、服务、经营'"
    :submit-text="editing ? '保存并发起审批' : '创建合同'"
    show-draft @submit="onSubmit" @cancel="onCancel" @draft="onDraft"
  >
    <template #note>
      <br />提交为<b>内存态</b>（原型阶段不写库，刷新还原）。合同状态由起止日期派生，不手工填写。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>合同主体</h4><span class="desc">编号自动生成；乙方为外部单位或个人</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="合同编号"><el-input :model-value="form.contractNo" disabled /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="合同名称" prop="name"><el-input v-model="form.name" placeholder="如 白静 · 劳务协议" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="合同类型" prop="type">
            <el-select v-model="form.type" style="width:100%" @change="form.subtype = ''">
              <el-option v-for="t in contractTypeOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="合同子类" prop="subtype">
            <el-select v-model="form.subtype" style="width:100%">
              <el-option v-for="t in contractSubtypeOpts(form.type)" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="乙方" prop="partyB"><el-input v-model="form.partyB" placeholder="单位或个人名称" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="联系人"><el-input v-model="form.contact" placeholder="选填" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="联系电话" prop="phone"><el-input v-model="form.phone" maxlength="11" placeholder="11 位手机号" /></el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>金额与周期</h4><span class="desc">金额单位元，保留 2 位小数</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="合同金额" prop="amount">
            <el-input v-model.number="form.amount" placeholder="请输入"><template #append>元</template></el-input>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="付款周期" prop="payCycle">
            <el-select v-model="form.payCycle" style="width:100%">
              <el-option v-for="t in contractPayCycleOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="附件数量" prop="attachments">
            <el-input v-model.number="form.attachments" placeholder="选填"><template #append>份</template></el-input>
          </el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>期限与归属</h4><span class="desc">到期日不得早于生效日；项目留空表示集团级合同</span></div>
      <el-row :gutter="24">
        <el-col :span="6">
          <el-form-item label="签订日期" prop="signDate">
            <el-date-picker v-model="form.signDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="生效日" prop="startDate">
            <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="到期日" prop="endDate">
            <el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="所属项目">
            <el-select v-model="form.communityId" clearable style="width:100%" placeholder="留空为集团级">
              <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="归属部门">
            <el-select v-model="form.orgId" clearable filterable style="width:100%">
              <el-option v-for="o in orgOptions()" :key="o.orgId" :label="o.label" :value="o.orgId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="责任人">
            <el-select v-model="form.ownerEmpId" clearable filterable style="width:100%">
              <el-option v-for="e in empOptions(200)" :key="e.empId" :label="e.label" :value="e.empId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="选填，200 字以内" />
          </el-form-item>
        </el-col>
      </el-row>
    </div>
    <div v-if="editing" class="sec">
      <div class="sec__hd">
        <h4>变更信息</h4>
        <span class="desc">原合同不允许直接改，保存即提交变更审批，通过后才回写并留痕</span>
      </div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="变更类型" prop="changeType">
            <el-select v-model="form.changeType" style="width:100%">
              <el-option v-for="t in CONTRACT_CHANGE_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="16">
          <el-form-item label="变更原因" prop="changeReason">
            <el-input v-model="form.changeReason" placeholder="必填，会写进变更留痕" />
          </el-form-item>
        </el-col>
      </el-row>
    </div>
  </FormShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import {
  CONTRACT_CHANGE_TYPES, communityOpts, contractPayCycleOpts, contractSubtypeOpts, contractTypeOpts,
  createContract, empOptions, getContractDetail, nextContractNo, orgOptions, submitContractChange
} from '@/utils/api'
import { amount, dateAfter, name, number, phone, reqSel } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')
const year = new Date().getFullYear()

const EMPTY = {
  contractNo: nextContractNo(year), name: '', type: '', subtype: '', partyB: '', contact: '', phone: '',
  amount: null, payCycle: '', attachments: 0,
  signDate: '', startDate: '', endDate: '',
  communityId: '', orgId: '', ownerEmpId: '', remark: '',
  changeType: '金额变更', changeReason: ''
}
const form = reactive({ ...EMPTY })
const rules = {
  name: [{ required: true, message: '请输入合同名称', trigger: 'blur' }],
  type: reqSel('合同类型'),
  subtype: reqSel('合同子类'),
  partyB: name('乙方'),
  phone: phone('联系电话'),
  amount: amount('合同金额'),
  payCycle: reqSel('付款周期'),
  // 附件是选填项，0 份也要能通过（原来用 intPositive 要求 ≥1，导致默认值直接被拦）
  attachments: number('附件数量', { min: 0, max: 99, precision: 0, required: false }),
  signDate: reqSel('签订日期', 'change'),
  startDate: reqSel('生效日', 'change'),
  endDate: [...reqSel('到期日', 'change'), ...dateAfter('startDate', { label: '到期日' })],
  changeReason: [{
    validator: (r, v, cb) =>
      (editing.value && !String(v || '').trim() ? cb(new Error('请填写变更原因')) : cb()),
    trigger: 'blur'
  }]
}

const shell = ref()
const loading = ref(false)
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    if (editing.value) {
      // 原合同不允许直接改：走变更单 + 审批单，审批通过后才回写
      submitContractChange(id.value, {
        type: form.changeType,
        patch: {
          name: form.name, amount: form.amount, partyB: form.partyB,
          startDate: form.startDate, endDate: form.endDate
        },
        reason: form.changeReason
      })
    } else {
      createContract({ ...form })
    }
  }
})

async function onSubmit() {
  const ok = await submit(editing.value ? '变更单已提交审批' : `合同已创建（${form.contractNo}），已提交审批`)
  if (!ok) return
  try {
    await ElMessageBox.confirm(
      editing.value
        ? '变更单已提交，审批通过后才会回写合同（原型阶段为内存态）'
        : '合同已建档并提交审批，审批通过后才生效（原型阶段为内存态，刷新还原）',
      '提交成功', { confirmButtonText: '返回列表', cancelButtonText: '留在本页', type: 'success' }
    )
    router.push('/c/contracts')
  } catch { /* 留在本页 */ }
}
function onDraft() { markSaved(); ElMessage.success('草稿已保存') }
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/c/contracts')
}

onMounted(async () => {
  if (!id.value) return
  loading.value = true
  try {
    const d = await getContractDetail(String(id.value))
    const c = d?.contract || d
    if (c) {
      Object.assign(form, {
        contractNo: c.contractNo, name: c.name, type: c.type, subtype: c.subtype,
        partyB: c.partyB, contact: c.contact || '', phone: c.phone || '',
        amount: c.amount ?? null, payCycle: c.payCycle || '', attachments: c.attachments ?? 0,
        signDate: c.signDate || '', startDate: c.startDate || '', endDate: c.endDate || '',
        communityId: c.communityId || '', orgId: c.orgId || '', ownerEmpId: c.ownerEmpId || '',
        remark: c.remark || ''
      })
      markSaved()
    }
  } finally {
    loading.value = false
  }
})
</script>
