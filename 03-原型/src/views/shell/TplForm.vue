<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>表单页模板 · A 级交互</b>：分区块（每区 ≤8 字段）→ 单/双列栅格（标签右对齐，宽 72–96px）→ 底部固定操作栏。
        ①必填红星 + 红框红字错误态（勾「演示错误态」可复现）；②有未保存改动时「取消 / 离开」二次确认；
        ③保存成功后可跳详情页；④带 <code>?id=</code> 进入时为<b>编辑模式</b>，数据由 <code>api.getHouseDetail</code> 回填。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form ref="formRef" v-loading="loading" :model="form" :rules="rules" label-width="96px" label-position="right">
        <div class="sec">
          <div class="sec__hd"><h4>基本信息</h4><span class="desc">房屋物理属性，变更后同步资产台账</span></div>
          <el-row :gutter="24">
            <el-col :span="8">
              <el-form-item label="所属项目" prop="communityId">
                <el-select v-model="form.communityId" placeholder="请选择" style="width:100%" @change="form.buildingId=''">
                  <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="楼栋" prop="buildingId">
                <el-select v-model="form.buildingId" placeholder="请选择" style="width:100%">
                  <el-option v-for="b in buildingOpts" :key="b.buildingId" :label="b.name" :value="b.buildingId" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="房号" prop="room">
                <el-input v-model="form.room" placeholder="4 位，如 0101" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="用途" prop="usage">
                <el-select v-model="form.usage" placeholder="请选择" style="width:100%">
                  <el-option v-for="u in usageOpts" :key="u" :label="u" :value="u" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="户型" prop="houseType">
                <el-select v-model="form.houseType" placeholder="请选择" style="width:100%">
                  <el-option v-for="u in houseTypeOpts" :key="u" :label="u" :value="u" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="建筑面积" prop="area">
                <el-input v-model.number="form.area" placeholder="请输入"><template #append>㎡</template></el-input>
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="sec">
          <div class="sec__hd"><h4>产权与交付</h4><span class="desc">影响收费面积与产权报表</span></div>
          <el-row :gutter="24">
            <el-col :span="8">
              <el-form-item label="产权状态" prop="propertyStatus">
                <el-radio-group v-model="form.propertyStatus">
                  <el-radio value="已办证">已办证</el-radio>
                  <el-radio value="未办证">未办证</el-radio>
                </el-radio-group>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="产权证号">
                <el-input v-model="form.certNo" placeholder="选填" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="交付状态" prop="deliverStatus">
                <el-select v-model="form.deliverStatus" placeholder="请选择" style="width:100%">
                  <el-option v-for="u in ['已交付','未交付','待交付']" :key="u" :label="u" :value="u" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="交付日期">
                <el-date-picker v-model="form.deliverDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="使用状态">
                <el-select v-model="form.useStatus" placeholder="请选择" style="width:100%">
                  <el-option v-for="u in useStatusOpts" :key="u" :label="u" :value="u" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="sec">
          <div class="sec__hd"><h4>业主与收费</h4><span class="desc">绑定业主后自动生成收费台账</span></div>
          <el-row :gutter="24">
            <el-col :span="8">
              <el-form-item label="业主" prop="ownerId">
                <el-select v-model="form.ownerId" filterable placeholder="姓名 / 手机号" style="width:100%">
                  <el-option v-for="o in ownerOpts" :key="o.ownerId" :label="`${o.name} ${o.phone}`" :value="o.ownerId" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="收费面积">
                <el-input v-model.number="form.chargeArea" placeholder="默认等于建筑面积"><template #append>㎡</template></el-input>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="单价标准">
                <el-input :model-value="priceText" disabled />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="form.remark" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="选填，200 字以内" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="sec">
          <div class="sec__hd"><h4>附件</h4><span class="desc">产权证 / 交付验收单，单张 ≤10MB</span></div>
          <el-form-item label-width="0">
            <el-upload action="#" :auto-upload="false" list-type="picture-card" :file-list="files">
              <el-icon><Plus /></el-icon>
              <template #tip><div class="muted" style="font-size:12px;margin-top:6px;">支持 jpg/png/pdf</div></template>
            </el-upload>
          </el-form-item>
        </div>
      </el-form>
    </div>

    <!-- 底部操作栏 -->
    <div class="panel form-foot">
      <el-checkbox v-model="demoError">演示错误态（清空必填后点保存）</el-checkbox>
      <span v-if="dirty" class="muted" style="font-size:12px;">有未保存的改动</span>
      <span class="spacer" />
      <el-button style="width:100px;" @click="onCancel">取消</el-button>
      <el-button style="width:100px;" :loading="saving" @click="onSaveDraft">存为草稿</el-button>
      <el-button type="primary" style="width:100px;" :loading="saving" @click="onSubmit">保存</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  buildingsOf, communities, getHouseDetail, houseTypeOpts as houseTypeOptsApi,
  houseUsageOpts, houseUseStatusOpts, ownerOptions
} from '@/utils/api'
import { money } from '@/utils/format'

const route = useRoute()
const router = useRouter()

const formRef = ref()
const saving = ref(false)
const demoError = ref(false)
const files = ref([])
const loading = ref(false)
const editing = ref(false)      // ?id= 进来为编辑模式

const EMPTY = {
  communityId: 'P01', buildingId: '', room: '', usage: '住宅', houseType: '',
  area: null, propertyStatus: '已办证', certNo: '', deliverStatus: '已交付',
  deliverDate: '', useStatus: '自住', ownerId: '', chargeArea: null, remark: ''
}
const form = reactive({ ...EMPTY })
const snapshot = ref(JSON.stringify(EMPTY))
const dirty = computed(() => JSON.stringify(form) !== snapshot.value)

const rules = {
  communityId: [{ required: true, message: '请选择所属项目', trigger: 'change' }],
  buildingId: [{ required: true, message: '请选择楼栋', trigger: 'change' }],
  room: [
    { required: true, message: '请输入房号', trigger: 'blur' },
    { pattern: /^\d{4}$/, message: '房号为 4 位数字，如 0101', trigger: 'blur' }
  ],
  usage: [{ required: true, message: '请选择用途', trigger: 'change' }],
  area: [{ required: true, message: '请输入建筑面积', trigger: 'blur' }],
  ownerId: [{ required: true, message: '请绑定业主', trigger: 'change' }]
}

const buildingOpts = computed(() => buildingsOf(form.communityId))
const usageOpts = houseUsageOpts()
const houseTypeOpts = houseTypeOptsApi()
const useStatusOpts = houseUseStatusOpts()
const ownerOpts = ownerOptions(200)
const priceText = computed(() => {
  const c = communities.find(x => x.communityId === form.communityId)
  return c ? `${money(c.propertyFee)} 元/㎡·月` : '-'
})

/* ---- 编辑模式回填 ---- */
onMounted(async () => {
  const id = route.query.id
  if (!id) return
  editing.value = true
  loading.value = true
  try {
    const d = await getHouseDetail(String(id))
    if (!d) { ElMessage.warning('未找到该房屋，已切换为新增模式'); return }
    Object.assign(form, {
      communityId: d.house.communityId, buildingId: d.house.buildingId, room: d.house.room,
      usage: d.house.usage, houseType: d.house.houseType, area: d.house.area,
      propertyStatus: d.house.propertyStatus, certNo: d.house.certNo || '',
      deliverStatus: d.house.deliverStatus, useStatus: d.house.useStatus,
      ownerId: d.house.ownerId || '', chargeArea: null, remark: ''
    })
    snapshot.value = JSON.stringify(form)
  } finally {
    loading.value = false
  }
})

async function validate() {
  if (demoError.value) {
    ElMessage.error('请检查标红的必填项')
    await formRef.value?.validate().catch(() => {})
    return false
  }
  return formRef.value?.validate().catch(() => false).then(Boolean)
}

/** 离开确认：只有真的改过才拦 */
async function confirmLeave() {
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('有未保存的改动，离开后不会保留。', '确认离开？', {
      type: 'warning', confirmButtonText: '确认离开', cancelButtonText: '继续编辑'
    })
    return true
  } catch { return false }
}
onBeforeRouteLeave(async () => await confirmLeave())

async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/shell/list')
}

async function onSubmit() {
  const ok = await validate()
  if (!ok) return
  saving.value = true
  setTimeout(async () => {
    saving.value = false
    snapshot.value = JSON.stringify(form)   // 保存后视为已同步
    try {
      await ElMessageBox.confirm(
        editing.value ? '房屋信息已更新（原型阶段不写库）' : '房屋已新增（原型阶段不写库）',
        '保存成功',
        { confirmButtonText: '去列表页', cancelButtonText: '留在本页', type: 'success' }
      )
      router.push('/shell/list')
    } catch { /* 留在本页 */ }
  }, 500)
}

async function onSaveDraft() {
  saving.value = true
  setTimeout(() => {
    saving.value = false
    snapshot.value = JSON.stringify(form)
    ElMessage.success('草稿已保存')
  }, 400)
}
</script>

<style scoped>
.form-foot { display: flex; align-items: center; gap: 12px; margin-top: 16px; position: sticky; bottom: 0; }
.form-foot .spacer { flex: 1; }
</style>
