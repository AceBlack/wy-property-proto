<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="loading" :saving="saving" :dirty="dirty"
    :title="editing ? '编辑业主' : '新增业主'"
    :subtitle="editing ? '修改后需重新提交认证' : '业主建档后可绑定房屋、车位并发起收费'"
    :submit-text="editing ? '保存修改' : '创建业主'"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />提交为<b>内存态</b>（原型阶段不写库，刷新还原）；校验规则全部来自 <code>utils/rules.js</code>。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>基本信息</h4><span class="desc">证件号填全后自动带出性别与出生日期</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="姓名" prop="name"><el-input v-model="form.name" placeholder="2–20 个中英文字符" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="手机号" prop="phone"><el-input v-model="form.phone" maxlength="11" placeholder="11 位手机号" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="证件号码" prop="idCard"><el-input v-model="form.idCard" maxlength="18" placeholder="身份证 18 位 / 护照 / 港澳台通行证" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="性别">
            <el-input :model-value="form.gender || '由证件号带出'" disabled />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="出生日期">
            <el-input :model-value="form.birthday || '由证件号带出'" disabled />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="业主类型" prop="ownerType">
            <el-select v-model="form.ownerType" style="width:100%">
              <el-option v-for="t in ownerTypeOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="信用等级" prop="creditLevel">
            <el-select v-model="form.creditLevel" style="width:100%">
              <el-option v-for="t in creditLevelOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="建档日期" prop="registerDate">
            <el-date-picker v-model="form.registerDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>关联资产</h4><span class="desc">一人可有多房；未绑定房屋也可建档（待确认是否允许「无房业主」）</span></div>
      <el-row :gutter="24">
        <el-col :span="24">
          <el-form-item label="名下房屋">
            <el-select v-model="form.houseIds" multiple filterable style="width:100%" placeholder="按房号搜索，可多选">
              <el-option v-for="h in houseOpts" :key="h.houseId" :label="h.label" :value="h.houseId" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>联系与认证</h4><span class="desc">用于催缴触达与门禁开通</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="紧急联系人"><el-input v-model="form.emergencyContact" placeholder="选填" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="紧急联系电话" prop="emergencyPhone">
            <el-input v-model="form.emergencyPhone" placeholder="选填" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="邮箱" prop="email"><el-input v-model="form.email" placeholder="选填" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="已实名"><el-switch v-model="form.certified" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="已录人脸"><el-switch v-model="form.faceRegistered" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="已注册 App"><el-switch v-model="form.appRegistered" /></el-form-item>
        </el-col>
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
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import {
  creditLevelOpts, getOwnerDetail, houseOptions, nextOwnerId, ownerTypeOpts
} from '@/utils/api'
import { emailOptional, idCard, name, phone, phoneOptional, reqSel } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')

const today = new Date().toISOString().slice(0, 10)
const EMPTY = {
  name: '', phone: '', idCard: '', gender: '', birthday: '',
  ownerType: '业主', creditLevel: 'A', registerDate: today,
  houseIds: [], emergencyContact: '', emergencyPhone: '', email: '',
  certified: false, faceRegistered: false, appRegistered: false, remark: ''
}
const form = reactive({ ...EMPTY })
const rules = {
  name: name('姓名'),
  phone: phone('手机号'),
  idCard: idCard('证件号码'),
  ownerType: reqSel('业主类型'),
  creditLevel: reqSel('信用等级'),
  emergencyPhone: phoneOptional('紧急联系电话'),
  email: emailOptional('邮箱')
}
const houseOpts = houseOptions(300)

/* 证件号 → 性别 / 出生日期（18 位身份证）
   注意：mock 的身份证是随机生成的，日期段可能不是合法日期，这里做范围校验，非法则不回填 */
watch(() => form.idCard, v => {
  const s = String(v || '').trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(s)) return
  form.gender = Number(s[16]) % 2 === 1 ? '男' : '女'
  const y = Number(s.slice(6, 10))
  const m = Number(s.slice(10, 12))
  const d = Number(s.slice(12, 14))
  const ok = y >= 1900 && y <= new Date().getFullYear() && m >= 1 && m <= 12 && d >= 1 && d <= 31
  form.birthday = ok ? `${s.slice(6, 10)}-${s.slice(10, 12)}-${s.slice(12, 14)}` : ''
})

const shell = ref()
const loading = ref(false)
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    await new Promise(r => setTimeout(r, 400))     // 模拟提交往返
    // 原型阶段不写库：正式实现改为 POST /owners，返回新 ownerId 后跳详情
  }
})

async function onSubmit() {
  const ok = await submit(editing.value ? '业主信息已更新' : `业主已创建（${nextOwnerId()}）`)
  if (!ok) return
  try {
    await ElMessageBox.confirm(
      editing.value ? '业主信息已更新（原型阶段为内存态，刷新还原）' : '业主已创建（原型阶段为内存态，刷新还原）',
      '保存成功',
      { confirmButtonText: '返回列表', cancelButtonText: '继续编辑', type: 'success' }
    )
    router.push('/a/owners')
  } catch { /* 继续编辑 */ }
}

async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/a/owners')
}

onMounted(async () => {
  if (!id.value) return
  loading.value = true
  try {
    const d = await getOwnerDetail(String(id.value))
    const o = d?.owner || d
    if (o) {
      Object.assign(form, {
        name: o.name || '', phone: o.phone || '', idCard: o.idCard || '',
        gender: o.gender || '', birthday: o.birthday || '',
        ownerType: o.ownerType || '业主', creditLevel: o.creditLevel || 'A',
        registerDate: o.registerDate || today, houseIds: o.houseIds || [],
        emergencyContact: o.emergencyContact || '', emergencyPhone: o.emergencyPhone || '',
        email: o.email || '', certified: !!o.certified, faceRegistered: !!o.faceRegistered,
        appRegistered: !!o.appRegistered, remark: o.remark || ''
      })
      markSaved()
    }
  } finally {
    loading.value = false
  }
})
</script>
