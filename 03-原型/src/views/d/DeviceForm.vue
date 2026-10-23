<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :saving="saving" :dirty="dirty" :loading="loading"
    :title="editing ? '编辑设备' : '新增设备'"
    :subtitle="editing ? '修改档案与维保周期，历史告警与维保记录不受影响' : '设备建档后进入在线率统计与告警联动'"
    :submit-text="editing ? '保存修改' : '创建设备'"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />提交为<b>内存态</b>（原型阶段不写库，刷新还原）。维保到期前 30 天进入临期提醒。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>设备档案</h4><span class="desc">设备编号用于现场张贴二维码</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="设备编号" prop="deviceCode"><el-input v-model="form.deviceCode" placeholder="如 摄-001" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="设备名称" prop="name"><el-input v-model="form.name" placeholder="如 3栋摄像头" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="设备类型" prop="type">
            <el-select v-model="form.type" allow-create filterable style="width:100%">
              <el-option v-for="t in deviceTypeOpts()" :key="t" :label="t" :value="t" />
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
          <el-form-item label="安装位置" prop="location"><el-input v-model="form.location" placeholder="如 1栋单元门口" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="品牌"><el-input v-model="form.brand" placeholder="选填" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="型号"><el-input v-model="form.model" placeholder="选填" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="供应商"><el-input v-model="form.vendor" placeholder="选填" /></el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>接入与维保</h4><span class="desc">IP 与固件版本用于远程运维</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="IP 地址" prop="ip"><el-input v-model="form.ip" placeholder="如 10.0.31.242" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="固件版本"><el-input v-model="form.firmware" placeholder="如 v3.6.10" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="安装日期" prop="installDate">
            <el-date-picker v-model="form.installDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="维保周期" prop="maintainCycle">
            <el-select v-model="form.maintainCycle" style="width:100%">
              <el-option v-for="t in ['月度', '季度', '半年', '年度']" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="下次维保" prop="nextMaintain">
            <el-date-picker v-model="form.nextMaintain" type="date" value-format="YYYY-MM-DD" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="状态" prop="status">
            <el-select v-model="form.status" style="width:100%">
              <el-option v-for="t in deviceStatusOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
    </div>
  </FormShell>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import {
  communityOpts, deviceStatusOpts, deviceTypeOpts, getDeviceDetail, updateDevice
} from '@/utils/api'
import { dateAfter, req, reqSel } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')
const EMPTY = {
  deviceCode: '', name: '', type: '', communityId: 'P01', location: '', brand: '', model: '', vendor: '',
  ip: '', firmware: '', installDate: '', maintainCycle: '半年', nextMaintain: '', status: '在线'
}
const form = reactive({ ...EMPTY })
const rules = {
  deviceCode: req('设备编号'),
  name: req('设备名称'),
  type: reqSel('设备类型'),
  communityId: reqSel('所属项目'),
  location: req('安装位置'),
  ip: [{
    pattern: /^(\d{1,3}\.){3}\d{1,3}$/, message: 'IP 格式不正确', trigger: 'blur'
  }],
  installDate: reqSel('安装日期', 'change'),
  maintainCycle: reqSel('维保周期'),
  nextMaintain: [...reqSel('下次维保', 'change'), ...dateAfter('installDate', { label: '下次维保' })],
  status: reqSel('状态')
}

const shell = ref()
const loading = ref(false)
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    if (editing.value) updateDevice(String(id.value), { ...form })
    await new Promise(r => setTimeout(r, 400))
  }
})
async function onSubmit() {
  let ok = false
  try {
    ok = await submit(editing.value ? '设备已更新' : '设备已创建')
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
    return
  }
  if (!ok) return
  try {
    await ElMessageBox.confirm(`${editing.value ? '设备已更新' : '设备已创建'}（原型阶段为内存态，刷新还原）`, '提示',
      { confirmButtonText: '返回列表', cancelButtonText: '继续编辑', type: 'success' })
    router.push('/d/devices')
  } catch { /* 继续编辑 */ }
}
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/d/devices')
}

onMounted(async () => {
  if (!id.value) return
  loading.value = true
  try {
    const d = await getDeviceDetail(String(id.value))
    const dev = d?.device || d
    if (dev) {
      Object.assign(form, {
        deviceCode: dev.deviceCode, name: dev.name, type: dev.type, communityId: dev.communityId,
        location: dev.location, brand: dev.brand, model: dev.model, vendor: dev.vendor,
        ip: dev.ip, firmware: dev.firmware, installDate: dev.installDate,
        maintainCycle: dev.maintainCycle, nextMaintain: dev.nextMaintain, status: dev.status
      })
      markSaved()
    }
  } finally { loading.value = false }
})
</script>
