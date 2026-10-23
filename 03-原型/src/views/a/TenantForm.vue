<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="loading" :saving="saving" :dirty="dirty"
    :title="editing ? '编辑租约' : '新增租约'"
    :subtitle="editing ? '续租 / 变更租期与租金' : '租约建立后自动生成承租人档案与门禁授权'"
    :submit-text="editing ? '保存修改' : '创建租约'"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />提交为<b>内存态</b>（原型阶段不写库，刷新还原）。<b>押金口径已确认</b>：押金场景只保留<b>装修押金</b>一种，租约不收押金；装修押金在「报表中心 · 装修押金报表」出数。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>租赁标的</h4><span class="desc">选中房屋后自动带出产权业主</span></div>
      <el-row :gutter="24">
        <el-col :span="12">
          <el-form-item label="承租房屋" prop="houseId">
            <el-select v-model="form.houseId" filterable style="width:100%" placeholder="按房号搜索" @change="onHouseChange">
              <el-option v-for="h in houseOpts" :key="h.houseId" :label="h.label" :value="h.houseId">
                <span>{{ h.label }}</span>
                <span class="muted" style="float:right;font-size:12px;">{{ h.useStatus }}</span>
              </el-option>
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="建筑面积"><el-input :model-value="houseAreaText" disabled /></el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="产权业主"><el-input :model-value="ownerText" disabled /></el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>承租人</h4><span class="desc">需实名后方可开通门禁与人脸</span></div>
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
          <el-form-item label="已实名"><el-switch v-model="form.certified" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="已录人脸"><el-switch v-model="form.faceRegistered" /></el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>租期与费用</h4><span class="desc">到期前 30 天进入续租提醒</span></div>
      <el-row :gutter="24">
        <el-col :span="6">
          <el-form-item label="起租日" prop="leaseStart">
            <el-date-picker v-model="form.leaseStart" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="到期日" prop="leaseEnd">
            <el-date-picker v-model="form.leaseEnd" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="月租金" prop="rent">
            <el-input v-model.number="form.rent" placeholder="请输入"><template #append>元/月</template></el-input>
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="付款周期">
            <el-select v-model="form.payCycle" style="width:100%">
              <el-option v-for="c in payCycles" :key="c" :label="c" :value="c" />
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
  </FormShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import { getTenantDetail, houseOptions, nextTenantId, ownerName } from '@/utils/api'
import { amount, dateAfter, idCard, name, phone, reqSel } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')

const EMPTY = {
  houseId: '', ownerId: '', name: '', phone: '', idCard: '',
  certified: false, faceRegistered: false,
  leaseStart: '', leaseEnd: '', rent: null, payCycle: '押一付三', remark: ''
}
const form = reactive({ ...EMPTY })
const rules = {
  houseId: reqSel('承租房屋'),
  name: name('姓名'),
  phone: phone('手机号'),
  idCard: idCard('证件号码'),
  leaseStart: reqSel('起租日', 'change'),
  leaseEnd: [...reqSel('到期日', 'change'), ...dateAfter('leaseStart', { label: '到期日' })],
  rent: amount('月租金')
}
// 押金场景已收敛为「装修押金」一种，租约不收押金，故本表单无押金字段
const payCycles = ['押一付一', '押一付三', '半年付', '年付']

const houseOpts = houseOptions(300)
const curHouse = computed(() => houseOpts.find(h => h.houseId === form.houseId))
const houseAreaText = computed(() => (curHouse.value?.area ? `${curHouse.value.area} ㎡` : '-'))
const ownerText = computed(() => {
  const o = curHouse.value?.ownerId
  return o ? `${ownerName(o)}（${o}）` : '该房屋未绑定业主'
})
function onHouseChange(hid) {
  const h = houseOpts.find(x => x.houseId === hid)
  form.ownerId = h?.ownerId || ''
}

const shell = ref()
const loading = ref(false)
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => { await new Promise(r => setTimeout(r, 400)) }
})

async function onSubmit() {
  const ok = await submit(editing.value ? '租约已更新' : `租约已创建（${nextTenantId()}）`)
  if (!ok) return
  try {
    await ElMessageBox.confirm(
      editing.value ? '租约已更新（原型阶段为内存态，刷新还原）' : '租约已创建（原型阶段为内存态，刷新还原）',
      '保存成功', { confirmButtonText: '返回列表', cancelButtonText: '继续编辑', type: 'success' }
    )
    router.push('/a/tenants')
  } catch { /* 继续编辑 */ }
}
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/a/tenants')
}

onMounted(async () => {
  if (!id.value) return
  loading.value = true
  try {
    const d = await getTenantDetail(String(id.value))
    const t = d?.tenant || d
    if (t) {
      Object.assign(form, {
        houseId: t.houseId || '', ownerId: t.ownerId || '', name: t.name || '',
        phone: t.phone || '', idCard: t.idCard || '',
        certified: !!t.certified, faceRegistered: !!t.faceRegistered,
        leaseStart: t.leaseStart || '', leaseEnd: t.leaseEnd || '',
        rent: t.rent ?? null, payCycle: t.payCycle || '押一付三', remark: t.remark || ''
      })
      markSaved()
    }
  } finally {
    loading.value = false
  }
})
</script>
