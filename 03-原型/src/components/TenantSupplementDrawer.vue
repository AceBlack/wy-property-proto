<template>
  <DetailDrawer
    v-model="inner" width="640px"
    :title="tenant ? `补充租户信息 · ${tenant.name}` : '补充租户信息'"
    :subtitle="tenant ? `${tenant.houseName} · 来源 ${tenant.source} · 当前核验：${tenant.verifyStatus}` : ''"
  >
    <template v-if="tenant">
      <div class="ts-note">
        <el-icon><InfoFilled /></el-icon>
        <div>
          租户信息由业主在小程序维护，物业<b>可代为补充或修正，保存即生效</b>（留痕：谁在什么时候改了什么）。
          姓名、租期、房屋属于业主维护字段，如需变更请业主在小程序操作。
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
        <span class="desc">完整度 {{ preview.filled }} / {{ preview.total }} · 核验门槛 {{ 5 - preview.missingBasic.length }}/5</span>
      </div>
      <el-form label-width="112px" class="ts-form">
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
                <el-option v-for="r in TENANT_RELATIONS" :key="r" :label="r" :value="r" />
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

      <div class="ts-miss" v-if="preview.missingBasic.length">
        核验门槛还缺：{{ preview.missingBasic.join('、') }}
        <span class="muted">（这 6 项齐了才能提交物业核验；实名与人脸属核验结果，不在此处填）</span>
      </div>
      <div class="ts-miss is-ok" v-else>
        基础 5 项已齐，可提交物业核验；核验通过后再录入人脸即开通门禁。
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
import { TENANT_RELATIONS, TENANT_SPECIAL_CARE, supplementTenant } from '@/utils/api'

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

const saving = ref(false)
const operator = ref(props.defaultOperator)
const form = reactive({
  name: '', phone: '', idCard: '', secondPhone: '', relation: '承租人',
  residents: 1, emergencyContact: '', vehicles: '', pets: false, specialCare: [], remark: ''
})

function fill(t) {
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
}
watch(() => props.tenant, t => { if (t) fill(t); operator.value = props.defaultOperator }, { immediate: true })
watch(() => props.modelValue, v => { if (v) fill(props.tenant) })

/** 保存前的完整度预览：与 api 的 8 项口径一致 */
const preview = computed(() => {
  const items = [
    ['姓名', form.name], ['手机号', form.phone], ['证件号', form.idCard],
    ['实名认证', props.tenant?.certified], ['人脸录入', props.tenant?.faceRegistered],
    ['与业主关系', form.relation], ['居住人数', form.residents], ['紧急联系人', form.emergencyContact]
  ]
  const missing = items.filter(([, v]) => (typeof v === 'boolean' ? !v : !String(v ?? '').trim())).map(([k]) => k)
  const basic = [['姓名', form.name], ['手机号', form.phone], ['证件号', form.idCard],
    ['与业主关系', form.relation], ['居住人数', form.residents], ['紧急联系人', form.emergencyContact]]
  const missingBasic = basic.filter(([, v]) => !String(v ?? '').trim()).map(([k]) => k)
  return { total: items.length, filled: items.length - missing.length, missing, missingBasic }
})

function save() {
  if (!props.tenant) return
  if (!String(form.phone || '').trim()) { ElMessage.warning('手机号至少要有，否则无法触达'); return }
  saving.value = true
  try {
    const r = supplementTenant(props.tenant.tenantId, { ...form }, operator.value || '物业前台')
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
</style>
