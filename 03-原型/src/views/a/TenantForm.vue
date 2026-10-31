<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="loading" :saving="saving" :dirty="dirty"
    :title="editing ? '编辑住户信息' : '代业主登记租户'"
    :subtitle="editing ? '物业补充 / 修正，保存即生效（留痕到操作记录）' : '租户新增以业主小程序为主，此处为前台代录，记「物业补录 · 待核验」'"
    :submit-text="editing ? '保存修改' : '登记租户'"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />租户信息由业主出租产生、<b>主要由业主在小程序维护</b>；物业补录或修正后<b>立即生效</b>，无需业主确认。
      <b>租金属业主与租户的商业条款，后台不展示、不统计</b>（字段仍保留在数据里供业主端使用）。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>承租与租期</h4><span class="desc">选中房屋后自动带出产权业主；编辑时房屋与租期只读（业主维护字段）</span></div>
      <el-row :gutter="24">
        <el-col :span="12">
          <el-form-item label="承租房屋" prop="houseId">
            <el-select v-model="form.houseId" filterable :disabled="editing" style="width:100%" placeholder="按房号搜索" @change="onHouseChange">
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
      <div class="sec__hd"><h4>租期与居住</h4><span class="desc">届满前 90 天提醒业主确认续租/退租；<b>租金不采集</b></span></div>
      <el-row :gutter="24">
        <el-col :span="6">
          <el-form-item label="起租日" prop="leaseStart">
            <el-date-picker v-model="form.leaseStart" type="date" value-format="YYYY-MM-DD" :disabled="editing" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="到期日" prop="leaseEnd">
            <el-date-picker v-model="form.leaseEnd" type="date" value-format="YYYY-MM-DD" :disabled="editing" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="与业主关系" prop="relation">
            <el-select v-model="form.relation" style="width:100%">
              <el-option v-for="r in TENANT_RELATIONS" :key="r" :label="r" :value="r" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="居住人数">
            <el-input-number v-model="form.residents" :min="1" :max="20" controls-position="right" style="width:100%" />
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
import {
  TENANT_RELATIONS, getTenantDetail, houseOptions, liveTenantOfHouse, ownerName,
  registerTenantByOwner, supplementTenant
} from '@/utils/api'
import { dateAfter, idCard, name, phone, reqSel } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')

const EMPTY = {
  houseId: '', ownerId: '', name: '', phone: '', idCard: '',
  certified: false, faceRegistered: false,
  leaseStart: '', leaseEnd: '', relation: '承租人', residents: 1, remark: ''
}
const form = reactive({ ...EMPTY })
const rules = {
  houseId: reqSel('承租房屋'),
  name: name('姓名'),
  phone: phone('手机号'),
  /* 编辑既有租户时放宽校验位：历史数据多为运营导入，不能因为校验位挡住物业修正 */
  idCard: idCard('证件号码', { checkBit: !editing.value }),
  leaseStart: reqSel('起租日', 'change'),
  leaseEnd: [...reqSel('到期日', 'change'), ...dateAfter('leaseStart', { label: '到期日' })]
}
// 租金与付款周期属业主与租户的商业条款：后台不采集、不展示、不统计（字段保留在数据里供业主端用）

/* 可代录的房屋：排除已有在住租户的（编辑时保留当前房屋，否则下拉会丢选项） */
const houseOpts = computed(() =>
  houseOptions(1000, { onlyVacant: true })
    .filter(h => !liveTenantOfHouse(h.houseId) || h.houseId === form.houseId)
)
const curHouse = computed(() => houseOpts.value.find(h => h.houseId === form.houseId))
const houseAreaText = computed(() => (curHouse.value?.area ? `${curHouse.value.area} ㎡` : '-'))
const ownerText = computed(() => {
  const o = curHouse.value?.ownerId
  return o ? `${ownerName(o)}（${o}）` : '该房屋未绑定业主'
})
function onHouseChange(hid) {
  const h = houseOpts.value.find(x => x.houseId === hid)
  form.ownerId = h?.ownerId || ''
}

const shell = ref()
const loading = ref(false)
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    if (editing.value) {
      /* 编辑：只提交物业可改的字段（姓名/联系方式/证件/关系/居住人数/备注），房屋与租期受保护 */
      supplementTenant(id.value, {
        name: form.name, phone: form.phone, idCard: form.idCard,
        relation: form.relation, residents: form.residents, remark: form.remark
      }, '物业前台')
    } else {
      registerTenantByOwner({
        houseId: form.houseId, name: form.name, phone: form.phone, idCard: form.idCard,
        certified: form.certified, faceRegistered: form.faceRegistered,
        leaseStart: form.leaseStart, leaseEnd: form.leaseEnd,
        relation: form.relation, residents: form.residents, remark: form.remark,
        source: '物业补录'
      }, '物业前台（代录）')
    }
  }
})

async function onSubmit() {
  const ok = await submit(editing.value ? '住户信息已更新' : '租户已登记')
  if (!ok) return
  try {
    await ElMessageBox.confirm(
      editing.value
        ? '住户信息已更新并立即生效，操作已记录到「操作记录」。'
        : '租户已登记，状态为「待核验」；补全 8 项信息后可提交核验、开通门禁。',
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
        relation: t.relation || '承租人', residents: t.residents || 1, remark: t.remark || ''
      })
      markSaved()
    }
  } finally {
    loading.value = false
  }
})
</script>
