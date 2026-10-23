<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="loading" :saving="saving" :dirty="dirty"
    title="新增车辆"
    subtitle="车辆建档后写入车行白名单，道闸按车牌识别放行"
    submit-text="创建车辆"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />提交为<b>内存态</b>（原型阶段不写库，刷新还原）。车牌格式校验见 <code>rules.plateNo</code>。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>车辆信息</h4><span class="desc">车牌为道闸识别唯一依据</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="车牌号" prop="plateNo"><el-input v-model="form.plateNo" placeholder="如 川A12345" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="车辆类型" prop="vehicleType">
            <el-select v-model="form.vehicleType" style="width:100%">
              <el-option v-for="t in vehicleTypeOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="品牌"><el-input v-model="form.brand" placeholder="选填" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="颜色"><el-input v-model="form.color" placeholder="选填" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="卡号"><el-input v-model="form.cardNo" placeholder="选填，IC / 蓝牙卡号" /></el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>归属与授权</h4><span class="desc">绑定业主与车位后自动生成月卡授权</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="所属项目" prop="communityId">
            <el-select v-model="form.communityId" style="width:100%">
              <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="关联业主">
            <el-select v-model="form.ownerId" filterable clearable style="width:100%" placeholder="姓名 / 手机号">
              <el-option v-for="o in ownerOptions(200)" :key="o.ownerId" :label="`${o.name} ${o.phone}`" :value="o.ownerId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="绑定车位">
            <el-select v-model="form.parkId" filterable clearable style="width:100%">
              <el-option v-for="p in parkOptions(300, { communityId: form.communityId })" :key="p.parkId" :label="p.label" :value="p.parkId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="授权状态" prop="authStatus">
            <el-select v-model="form.authStatus" style="width:100%">
              <el-option v-for="t in authStatusOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="进出类型" prop="inOutType">
            <el-select v-model="form.inOutType" style="width:100%">
              <el-option v-for="t in inOutTypeOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
    </div>
  </FormShell>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import {
  authStatusOpts, communityOpts, inOutTypeOpts, ownerOptions, parkOptions, vehicleTypeOpts
} from '@/utils/api'
import { plateNo, reqSel } from '@/utils/rules'

const router = useRouter()
const EMPTY = {
  plateNo: '', vehicleType: '小型车', brand: '', color: '', cardNo: '',
  communityId: 'P01', ownerId: '', parkId: '', authStatus: '正常', inOutType: '月卡'
}
const form = reactive({ ...EMPTY })
const rules = {
  plateNo: plateNo('车牌号'),
  vehicleType: reqSel('车辆类型'),
  communityId: reqSel('所属项目'),
  authStatus: reqSel('授权状态'),
  inOutType: reqSel('进出类型')
}

const shell = ref()
const { saving, dirty, submit, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => { await new Promise(r => setTimeout(r, 400)) }
})
async function onSubmit() {
  const ok = await submit('车辆已创建')
  if (!ok) return
  try {
    await ElMessageBox.confirm('车辆已创建（原型阶段为内存态，刷新还原）', '提示',
      { confirmButtonText: '返回列表', cancelButtonText: '继续编辑', type: 'success' })
    router.push('/a/vehicles')
  } catch { /* 继续编辑 */ }
}
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/a/vehicles')
}
</script>
