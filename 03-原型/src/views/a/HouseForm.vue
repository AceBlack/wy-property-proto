<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="loading" :saving="saving" :dirty="dirty"
    :title="editing ? '编辑房屋' : '新增房屋'"
    :subtitle="editing ? '变更后同步资产台账与收费面积' : '房屋建档后方可生成账单、发起工单'"
    :submit-text="editing ? '保存修改' : '创建房屋'"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />提交为<b>内存态</b>（原型阶段不写库，刷新还原）。房号在同一楼栋内唯一，切换楼栋会重新校验。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>空间位置</h4><span class="desc">项目 → 楼栋 → 房号，房号为 4 位数字</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="所属项目" prop="communityId">
            <el-select v-model="form.communityId" style="width:100%" @change="form.buildingId = ''">
              <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="楼栋" prop="buildingId">
            <el-select v-model="form.buildingId" style="width:100%">
              <el-option v-for="b in buildingOpts" :key="b.buildingId" :label="b.name" :value="b.buildingId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="单元" prop="unitId">
            <el-select v-model="form.unitId" style="width:100%" :disabled="!form.buildingId">
              <el-option v-for="u in unitOpts" :key="u.unitId" :label="u.name" :value="u.unitId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="房号" prop="room"><el-input v-model="form.room" placeholder="4 位，如 0101" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="楼层" prop="floor"><el-input v-model.number="form.floor" placeholder="如 5" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="户型" prop="houseType">
            <el-select v-model="form.houseType" style="width:100%">
              <el-option v-for="t in houseTypeOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="朝向"><el-input v-model="form.orientation" placeholder="选填，如 朝东" /></el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>面积与用途</h4><span class="desc">收费面积默认等于建筑面积，可按产证单独调整</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="用途" prop="usage">
            <el-select v-model="form.usage" style="width:100%">
              <el-option v-for="u in houseUsageOpts()" :key="u" :label="u" :value="u" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="建筑面积" prop="area">
            <el-input v-model.number="form.area" placeholder="请输入"><template #append>㎡</template></el-input>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="套内面积" prop="innerArea">
            <el-input v-model.number="form.innerArea" placeholder="选填"><template #append>㎡</template></el-input>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="收费面积" prop="chargeArea">
            <el-input v-model.number="form.chargeArea" placeholder="默认等于建筑面积"><template #append>㎡</template></el-input>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="项目单价">
            <el-input :model-value="priceText" disabled />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="装修情况"><el-input v-model="form.decoration" placeholder="选填" /></el-form-item>
        </el-col>
      </el-row>
    </div>

    <div class="sec">
      <div class="sec__hd"><h4>产权与交付</h4><span class="desc">影响收费起算与产权报表</span></div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="交付状态" prop="deliverStatus">
            <el-select v-model="form.deliverStatus" style="width:100%">
              <el-option v-for="s in ['已交付', '未交付', '待交付']" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="使用状态" prop="useStatus">
            <el-select v-model="form.useStatus" style="width:100%">
              <el-option v-for="s in houseUseStatusOpts()" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="产权状态"><el-input v-model="form.propertyStatus" placeholder="如 已办证" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="产权证号"><el-input v-model="form.certNo" placeholder="选填" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="责任楼管" prop="stewardEmpId">
            <el-select v-model="form.stewardEmpId" filterable style="width:100%" placeholder="按楼栋自动带出，可单独指定">
              <el-option v-for="s in stewardOpts" :key="s.empId" :label="s.label" :value="s.empId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="绑定业主">
            <el-select v-model="form.ownerId" filterable clearable style="width:100%" placeholder="姓名 / 手机号（可空，未售房屋）">
              <el-option v-for="o in ownerOptions(200)" :key="o.ownerId" :label="`${o.name} ${o.phone}`" :value="o.ownerId" />
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
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import {
  buildingsOf, cashierUnitOpts, communities, communityOpts, getHouseDetail, houseOptions, houseTypeOpts,
  houseUsageOpts, houseUseStatusOpts, ownerOptions, saveHouse, stewardOfBuilding, stewardOptions
} from '@/utils/api'
import { money } from '@/utils/format'
import { area, intPositive, number, reqSel, room, uniqueIn } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')

const EMPTY = {
  communityId: 'P01', buildingId: '', unitId: '', stewardEmpId: '', room: '', floor: null, houseType: '', orientation: '',
  usage: '住宅', area: null, innerArea: null, chargeArea: null, decoration: '',
  deliverStatus: '已交付', useStatus: '自住', propertyStatus: '已办证', certNo: '',
  ownerId: '', remark: ''
}
const form = reactive({ ...EMPTY })

// 房号在同一楼栋内唯一；编辑时排除自身。占用清单由 api 提供，页面不碰原始数据
const roomRules = computed(() => [
  ...room(),
  ...uniqueIn('该楼栋下房号', () => houseOptions(300, { communityId: form.communityId })
    .filter(h => h.buildingId === form.buildingId && h.houseId !== id.value)
    .map(h => h.room))
])

const rules = {
  communityId: reqSel('所属项目'),
  buildingId: reqSel('楼栋'),
  unitId: reqSel('单元'),
  stewardEmpId: reqSel('责任楼管'),
  room: roomRules,
  floor: intPositive('楼层', 99),
  houseType: reqSel('户型'),
  usage: reqSel('用途'),
  area: area('建筑面积'),
  innerArea: number('套内面积', { required: false }),
  chargeArea: number('收费面积', { required: false }),
  deliverStatus: reqSel('交付状态'),
  useStatus: reqSel('使用状态')
}

const buildingOpts = computed(() => buildingsOf(form.communityId))
const unitOpts = computed(() => cashierUnitOpts(form.buildingId).map(u => ({ unitId: u.value, name: u.label })))
const stewardOpts = stewardOptions()

/* 责任范围联动：选楼栋/单元自动带出该栋楼管；手动改过即视为房屋级例外。
   回填编辑数据时用 filling 挡住 watch，否则会把手动指定的例外覆盖成楼栋默认值 */
let filling = false
function syncStewardByBuilding() {
  const b = stewardOfBuilding(form.buildingId, form.unitId)
  if (b) form.stewardEmpId = b.empId
}
watch(() => form.buildingId, () => {
  if (filling) return
  form.unitId = ''
  syncStewardByBuilding()
})
watch(() => form.unitId, () => { if (!filling) syncStewardByBuilding() })
const priceText = computed(() => {
  const c = communities.find(x => x.communityId === form.communityId)
  return c ? `${money(c.propertyFee)} 元/㎡·月` : '-'
})

const shell = ref()
const loading = ref(false)
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    const r = saveHouse({ ...form }, id.value)
    savedHouseId = r.houseId
  }
})

let savedHouseId = ''
async function onSubmit() {
  const ok = await submit(editing.value ? '房屋信息已更新' : '房屋已创建')
  if (!ok) return
  if (!savedHouseId) {
    const { ElMessage } = await import('element-plus')
    ElMessage.error('保存失败：请检查项目 / 楼栋 / 单元 / 房号')
    return
  }
  try {
    await ElMessageBox.confirm(
      editing.value ? '房屋信息已更新（原型阶段为内存态，刷新还原）' : '房屋已创建（原型阶段为内存态，刷新还原）',
      '保存成功', { confirmButtonText: '返回列表', cancelButtonText: '继续编辑', type: 'success' }
    )
    router.push('/a/houses')
  } catch { /* 继续编辑 */ }
}
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/a/houses')
}

onMounted(async () => {
  if (!id.value) return
  loading.value = true
  try {
    const d = await getHouseDetail(String(id.value))
    const h = d?.house || d
    if (h) {
      filling = true
      Object.assign(form, {
        communityId: h.communityId, buildingId: h.buildingId, unitId: h.unitId || '',
        stewardEmpId: h.stewardEmpId || '', room: h.room, floor: h.floor,
        houseType: h.houseType, orientation: h.orientation || '', usage: h.usage, area: h.area,
        innerArea: h.innerArea, chargeArea: h.chargeArea ?? null, decoration: h.decoration || '',
        deliverStatus: h.deliverStatus, useStatus: h.useStatus, propertyStatus: h.propertyStatus,
        certNo: h.certNo || '', ownerId: h.ownerId || '', remark: ''
      })
      await nextTick()
      filling = false
      markSaved()
    }
  } finally {
    loading.value = false
  }
})
</script>
