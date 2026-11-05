<template>
  <DetailDrawer
    v-model="inner" width="680px"
    :title="tenant ? `补充租户信息 · ${tenant.name}` : '补充租户信息'"
    :subtitle="tenant ? `${tenant.houseName} · ${tenant.tenantType === '公司' ? '公司承租' : '个人承租'} · 来源 ${tenant.source} · 当前核验：${tenant.verifyStatus}` : ''"
  >
    <template v-if="tenant">
      <div class="ts-note">
        <el-icon><InfoFilled /></el-icon>
        <div>
          租户信息由业主在小程序维护，物业<b>可代为补充或修正，保存即生效</b>（留痕：谁在什么时候改了什么）。
          姓名 / 公司名、租期、房屋属于业主维护字段，如需变更请业主在小程序操作。
          <template v-if="isCompany">
            <br />公司租户的核验核的是<b>营业执照</b>（信用代码 + 法人 + 经办人），不是人脸；
            门禁人脸录的是<b>经办人</b>。
          </template>
        </div>
      </div>

      <div class="sec__hd" style="margin-top:16px;"><h4>业主维护字段</h4><span class="desc">只读</span></div>
      <div class="dl">
        <div class="dl__i"><span class="dl__k">承租房屋</span><span class="dl__v">{{ tenant.houseName }}</span></div>
        <div class="dl__i"><span class="dl__k">产权业主</span><span class="dl__v">{{ tenant.ownerName }}</span></div>
        <div class="dl__i"><span class="dl__k">起租日</span><span class="dl__v">{{ tenant.leaseStart }}</span></div>
        <div class="dl__i"><span class="dl__k">到期日</span><span class="dl__v">{{ tenant.leaseEnd }}</span></div>
      </div>

      <div class="sec__hd" style="margin-top:18px;">
        <h4>物业补充 / 修正</h4>
        <span class="desc">
          完整度 {{ preview.filled }} / {{ preview.total }} ·
          核验门槛 {{ preview.basicTotal - preview.missingBasic.length }}/{{ preview.basicTotal }}
          （{{ isCompany ? '公司资质' : '个人信息' }}口径）
        </span>
      </div>

      <!-- 个人 -->
      <el-form v-if="!isCompany" label-width="112px" class="ts-form">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="姓名"><el-input v-model="form.name" placeholder="可修正错别字" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="手机号"><el-input v-model="form.phone" maxlength="11" placeholder="11 位手机号" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="证件号"><el-input v-model="form.idCard" maxlength="18" placeholder="身份证 / 护照 / 港澳台" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="第二联系电话"><el-input v-model="form.secondPhone" maxlength="11" placeholder="选填" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="与业主关系">
              <el-select v-model="form.relation" style="width:100%">
                <el-option v-for="r in TENANT_RELATIONS.filter(x => x !== '企业承租')" :key="r" :label="r" :value="r" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="居住人数">
              <el-input-number v-model="form.residents" :min="1" :max="20" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="紧急联系人"><el-input v-model="form.emergencyContact" placeholder="姓名 + 电话" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="车辆信息"><el-input v-model="form.vehicles" placeholder="如 川A·12345，多辆用逗号分隔" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="是否养宠"><el-switch v-model="form.pets" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="特殊人群">
              <el-select v-model="form.specialCare" multiple collapse-tags clearable placeholder="无" style="width:100%">
                <el-option v-for="c in TENANT_SPECIAL_CARE" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <!-- 公司 -->
      <el-form v-else label-width="112px" class="ts-form">
        <el-row :gutter="12">
          <el-col :span="24">
            <el-form-item label="公司名称">
              <el-input v-model="form.companyName" maxlength="40" placeholder="与营业执照一致" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="信用代码">
              <el-input v-model="form.creditCode" maxlength="18" placeholder="18 位统一社会信用代码"
                @input="codeHint = creditCodeCheck(form.creditCode)" />
              <div v-if="form.creditCode && codeHint" class="field-err">{{ codeHint }}</div>
              <div v-else-if="form.creditCode" class="field-ok">校验位正确</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="法定代表人"><el-input v-model="form.legalPerson" maxlength="20" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="法人电话">
              <el-input v-model="form.legalPersonPhone" maxlength="11" placeholder="紧急联络用" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经办人"><el-input v-model="form.agentName" maxlength="20" placeholder="日常对接人" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经办人手机"><el-input v-model="form.agentPhone" maxlength="11" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经办人证件"><el-input v-model="form.agentIdCard" maxlength="18" placeholder="选填；录人脸时需要" /></el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="成立日期">
              <el-date-picker v-model="form.establishDate" type="date" value-format="YYYY-MM-DD"
                :disabled-date="d => d.getTime() > Date.now()" placeholder="选填" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经营类目">
              <el-select v-model="form.businessCategory" clearable style="width:100%" placeholder="请选择">
                <el-option v-for="c in BUSINESS_CATEGORIES" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="承租用途">
              <el-select v-model="form.leasePurpose" clearable style="width:100%" placeholder="请选择">
                <el-option v-for="u in LEASE_PURPOSES" :key="u" :label="u" :value="u" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="员工人数">
              <el-input-number v-model="form.employeeCount" :min="1" :max="9999" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="对外电话"><el-input v-model="form.phone" maxlength="11" placeholder="公司对外联系手机" /></el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="注册地址">
              <el-input v-model="form.regAddress" maxlength="80" placeholder="执照上的住所" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="营业执照">
              <LicenseUpload :tenant-id="tenant.tenantId" :files="licenseFiles" :operator="operator"
                @changed="onLicenseChanged" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <el-form label-width="112px" class="ts-form">
        <el-row :gutter="12">
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="如：白天无人、宠物需提前告知、上门服务注意事项" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="操作人">
              <el-input v-model="operator" style="width:180px" />
              <span class="muted" style="font-size:12px;margin-left:8px;">记录到操作留痕，谁改的谁负责</span>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <div class="ts-miss" v-if="preview.missingBasic.length || !preview.licenseReady">
        核验门槛还缺：{{ [...preview.missingBasic, ...(preview.licenseReady ? [] : ['营业执照影像件'])].join('、') }}
        <span class="muted">
          （这 {{ preview.basicTotal }} 项齐了才能提交物业核验；{{ isCompany ? '营业执照由物业现场核验' : '实名与人脸属核验结果，不在此处填' }}）
        </span>
      </div>
      <div class="ts-miss is-ok" v-else>
        门槛项已齐，可提交物业核验；{{ isCompany ? '核验通过后为经办人录入人脸即开通门禁。' : '核验通过后再录入人脸即开通门禁。' }}
      </div>
    </template>

    <template #footer>
      <el-button @click="inner = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存并生效</el-button>
    </template>
  </DetailDrawer>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import DetailDrawer from '@/components/DetailDrawer.vue'
import {
  BUSINESS_CATEGORIES, LEASE_PURPOSES, TENANT_RELATIONS, TENANT_SPECIAL_CARE,
  computeTenantFill, creditCodeCheck, supplementTenant
} from '@/utils/api'
import LicenseUpload from '@/components/LicenseUpload.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  tenant: { type: Object, default: null },
  defaultOperator: { type: String, default: '物业前台' }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const inner = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

const isCompany = computed(() => (props.tenant?.tenantType || '个人') === '公司')
const saving = ref(false)
const operator = ref(props.defaultOperator)
const codeHint = ref('')
/* 影像件的写操作在 LicenseUpload 里直接落库，这里只留一份副本用于展示计数 */
const licenseFiles = ref([])
function onLicenseChanged (files) {
  licenseFiles.value = [...(files || [])]
  emit('saved', { tenantId: props.tenant?.tenantId, changes: [], licenseChanged: true })
}

const form = reactive({
  /* 个人 */
  name: '', phone: '', idCard: '', secondPhone: '', relation: '承租人',
  residents: 1, emergencyContact: '', vehicles: '', pets: false, specialCare: [], remark: '',
  /* 公司 */
  companyName: '', creditCode: '', legalPerson: '', legalPersonPhone: '',
  agentName: '', agentPhone: '', agentIdCard: '', businessCategory: '',
  leasePurpose: '', regAddress: '', establishDate: '', employeeCount: 1
})

function fill (t) {
  if (!t) return
  form.name = t.name || ''
  form.phone = t.phone || ''
  form.idCard = t.idCard || ''
  form.secondPhone = t.secondPhone || ''
  form.relation = t.relation || '承租人'
  form.residents = t.residents || 1
  form.emergencyContact = t.emergencyContact || ''
  form.vehicles = t.vehicles || ''
  form.pets = !!t.pets
  form.specialCare = [...(t.specialCare || [])]
  form.remark = t.remark || ''
  form.companyName = t.companyName || ''
  form.creditCode = t.creditCode || ''
  form.legalPerson = t.legalPerson || ''
  form.legalPersonPhone = t.legalPersonPhone || ''
  form.agentName = t.agentName || ''
  form.agentPhone = t.agentPhone || ''
  form.agentIdCard = t.agentIdCard || ''
  form.businessCategory = t.businessCategory || ''
  form.leasePurpose = t.leasePurpose || ''
  form.regAddress = t.regAddress || ''
  form.establishDate = t.establishDate || ''
  form.employeeCount = t.employeeCount || 1
  licenseFiles.value = [...(t.licenseFiles || [])]
  codeHint.value = form.creditCode ? creditCodeCheck(form.creditCode) : ''
}
watch(() => props.tenant, t => { if (t) fill(t); operator.value = props.defaultOperator }, { immediate: true })
watch(() => props.modelValue, v => { if (v) fill(props.tenant) })

/**
 * 完整度预览与列表同一个函数（computeTenantFill）：
 * 之前抽屉里自己写了一套 8 项，和 api 里的那套阈值不同，
 * 于是出现过「列表说 62%、抽屉说 75%」——同一个租户两个数。
 */
const preview = computed(() => computeTenantFill({ ...props.tenant, ...form, licenseFiles: licenseFiles.value }))

/** 按类型组装 patch：只提交这一套字段，避免把空的公司字段写进个人租户 */
function buildPatch () {
  if (isCompany.value) {
    return {
      companyName: form.companyName, creditCode: form.creditCode,
      legalPerson: form.legalPerson, legalPersonPhone: form.legalPersonPhone,
      agentName: form.agentName, agentPhone: form.agentPhone, agentIdCard: form.agentIdCard,
      businessCategory: form.businessCategory, leasePurpose: form.leasePurpose,
      regAddress: form.regAddress, establishDate: form.establishDate,
      employeeCount: form.employeeCount, phone: form.phone, secondPhone: form.secondPhone,
      remark: form.remark
    }
  }
  return {
    name: form.name, phone: form.phone, idCard: form.idCard, secondPhone: form.secondPhone,
    relation: form.relation, residents: form.residents, emergencyContact: form.emergencyContact,
    vehicles: form.vehicles, pets: form.pets, specialCare: form.specialCare, remark: form.remark
  }
}

function save () {
  if (!props.tenant) return
  const patch = buildPatch()
  /* 前端先挡一道：手机号与信用代码这种"抄错一位也看不出来"的字段，不该等提交后才报错 */
  if (!String(patch.phone || '').trim()) { ElMessage.warning('对外电话至少要有，否则无法触达'); return }
  if (isCompany.value) {
    const cc = creditCodeCheck(patch.creditCode)
    if (cc) { ElMessage.warning(cc); return }
    if (!String(patch.companyName || '').trim()) { ElMessage.warning('公司名称必填'); return }
    if (!String(patch.legalPerson || '').trim()) { ElMessage.warning('法定代表人必填'); return }
    if (!String(patch.agentName || '').trim()) { ElMessage.warning('经办人必填'); return }
    if (!/^1[3-9]\d{9}$/.test(String(patch.agentPhone || ''))) { ElMessage.warning('经办人手机应为 11 位'); return }
    if (!patch.businessCategory) { ElMessage.warning('请选择经营类目'); return }
  }
  saving.value = true
  try {
    const r = supplementTenant(props.tenant.tenantId, patch, operator.value || '物业前台')
    if (!r.changes.length) {
      ElMessage.info('没有变更内容')
    } else {
      ElMessage.success(`已保存 ${r.changes.length} 项变更并立即生效（操作人 ${operator.value}）`)
      emit('saved', r)
    }
    inner.value = false
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally { saving.value = false }
}
</script>

<style scoped>
.ts-note {
  display: flex; gap: 8px; padding: 10px 12px; border-radius: 8px;
  background: rgba(91, 108, 255, .06); color: var(--biz-text-2);
  font-size: 12px; line-height: 1.65;
}
.ts-note .el-icon { color: var(--biz-primary, #5b6cff); margin-top: 2px; }
.ts-form { margin-top: 4px; }
.ts-miss {
  margin-top: 6px; padding: 8px 12px; border-radius: 6px;
  background: rgba(217, 138, 31, .08); color: var(--biz-text-2); font-size: 12px;
}
.ts-miss.is-ok { background: rgba(18, 185, 138, .08); }
.field-err { font-size: 12px; color: var(--biz-danger); margin-top: 2px; }
.field-ok { font-size: 12px; color: #12B98A; margin-top: 2px; }
</style>
