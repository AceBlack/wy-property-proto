<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="loading" :saving="saving" :dirty="dirty"
    :title="editing ? '编辑业主' : '新增业主'"
    :subtitle="editing ? '修改后需重新提交认证' : '业主建档后可绑定房屋、车位并发起收费'"
    :submit-text="editing ? '保存修改' : '创建业主'"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />人脸状态由「人脸核验」工作台回写，这里的开关已撤掉。<br />提交<b>写入内存数据</b>（刷新还原为种子数据）；校验规则来自 <code>utils/rules.js</code> 与 <code>saveOwnerProfile</code> 的白名单。
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
      <div class="sec__hd"><h4>客户画像</h4><span class="desc">标签是筛选与关怀的入口；分类、经济状况会影响催缴与减免判断</span></div>
      <el-row :gutter="24">
        <el-col :span="24">
          <el-form-item label="业主标签">
            <el-select v-model="form.tagIds" multiple filterable collapse-tags collapse-tags-tooltip
              style="width:100%" placeholder="按分类选标签">
              <el-option-group v-for="g in tagGroups" :key="g.category" :label="g.category">
                <el-option v-for="t in g.tags" :key="t.tagId" :value="t.tagId"
                  :label="t.enabled ? t.name : `${t.name}（已停用）`">
                  <span class="tag-opt">
                    <span class="tag-dot" :style="{ background: tagColor(t.color) }" />
                    {{ t.name }}
                    <span v-if="!t.enabled" class="muted">已停用 · 不能再新打</span>
                  </span>
                </el-option>
              </el-option-group>
            </el-select>
            <div class="tip">
              只能选启用词条；已打上的停用词条保留显示，取消即移除。
              维护词条去 <router-link to="/a/owner-tags">业主标签字典</router-link>（需 e.ownerTags.edit）
            </div>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="业主分类">
            <el-select v-model="form.ownerCategory" clearable style="width:100%" placeholder="选填">
              <el-option v-for="o in OWNER_CATEGORY" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="经济状况">
            <el-select v-model="form.economicLevel" clearable style="width:100%" placeholder="选填">
              <el-option v-for="o in ECON_LEVELS" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="政治面貌">
            <el-select v-model="form.politicalStatus" clearable style="width:100%" placeholder="选填">
              <el-option v-for="o in POLITICAL_STATUS" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="职业"><el-input v-model="form.occupation" placeholder="选填，如：教师" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="单位名称"><el-input v-model="form.employer" placeholder="选填" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="结婚纪念日">
            <el-date-picker v-model="form.weddingDate" type="date" value-format="YYYY-MM-DD" style="width:100%" placeholder="选填" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="负面信息">
            <el-input v-model="form.negativeNotes" type="textarea" :rows="2" maxlength="200" show-word-limit
              placeholder="选填：涉诉、长期欠费、违规装修等（含敏感信息，仅授权人员可见）" />
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
          <!-- H4：人脸不再是随手勾的开关，只能经「人脸核验」工作台通过后生效 -->
          <el-form-item label="人脸状态">
            <div class="face-state">
              <el-tag size="small" :type="form.faceRegistered ? 'success' : 'info'" effect="plain">
                {{ form.faceRegistered ? '已录人脸' : '未采集 / 待核验' }}
              </el-tag>
              <el-button link type="primary" size="small" @click="$router.push('/a/faces')">去核验</el-button>
            </div>
          </el-form-item>
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
  ECON_LEVELS, OWNER_CATEGORY, POLITICAL_STATUS,
  creditLevelOpts, getOwnerDetail, houseOptions, nextOwnerId, ownerTagRows,
  ownerTypeOpts, saveOwnerProfile
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
  certified: false, faceRegistered: false, appRegistered: false, remark: '',
  tagIds: [], ownerCategory: '', economicLevel: '', politicalStatus: '',
  occupation: '', employer: '', weddingDate: '', negativeNotes: ''
}
const form = reactive({ ...EMPTY })

/* 历史证件号原样保留、不重新校验：
   种子数据里的身份证是随机生成的，校验位基本都不对 ——
   一旦改成"真写库"，校验位规则会让**任何历史业主都存不上**（提示"请检查标红的 1 项"，
   而用户根本没改这一格）。新填/改过的证件号仍走校验位，历史值只在改动时才要求合法。 */
const loadedIdCard = ref('')
const rules = computed(() => ({
  name: name('姓名'),
  phone: phone('手机号'),
  idCard: form.idCard && form.idCard === loadedIdCard.value ? [] : idCard('证件号码'),
  ownerType: reqSel('业主类型'),
  creditLevel: reqSel('信用等级'),
  emergencyPhone: phoneOptional('紧急联系电话'),
  email: emailOptional('邮箱')
}))
const houseOpts = houseOptions(300)

/* 标签按分类分组。**已选中的停用词条也要出现在选项里** ——
   否则 el-select 找不到对应 option，会把 id 原样显示成 "OT07" */
const tagGroups = computed(() => {
  const enabled = ownerTagRows({ enabled: true })
  const pickedDisabled = ownerTagRows({ enabled: false }).filter(t => form.tagIds.includes(t.tagId))
  const all = [...enabled, ...pickedDisabled]
  const order = ['关怀', '风险', '价值', '行为']
  const cats = [...new Set(all.map(t => t.category))]
  cats.sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  return cats.map(c => ({ category: c, tags: all.filter(t => t.category === c) }))
})
const TAG_COLORS = { blue: '#3b82f6', green: '#22c55e', orange: '#f59e0b', red: '#ef4444', purple: '#8b5cf6', gray: '#94a3b8' }
const tagColor = c => TAG_COLORS[c] || TAG_COLORS.blue

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
const createdId = ref('')
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    /* 2026-11-13：改成真写库。原来只 sleep 一下，新增/编辑都不落库，
       于是"在档案页打标签"回列表就没了，看着像功能坏了 */
    const saved = saveOwnerProfile({ ...form }, id.value)
    if (!id.value) createdId.value = saved.ownerId
  }
})

async function onSubmit() {
  const ok = await submit(editing.value ? '业主信息已更新' : `业主已创建（${createdId.value || nextOwnerId()}）`)
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
      loadedIdCard.value = o.idCard || ''
      Object.assign(form, {
        name: o.name || '', phone: o.phone || '', idCard: o.idCard || '',
        gender: o.gender || '', birthday: o.birthday || '',
        ownerType: o.ownerType || '业主', creditLevel: o.creditLevel || 'A',
        registerDate: o.registerDate || today, houseIds: o.houseIds || [],
        emergencyContact: o.emergencyContact || '', emergencyPhone: o.emergencyPhone || '',
        email: o.email || '', certified: !!o.certified, faceRegistered: !!o.faceRegistered,
        appRegistered: !!o.appRegistered, remark: o.remark || '',
        tagIds: [...(o.tagIds || [])],
        ownerCategory: o.ownerCategory || '', economicLevel: o.economicLevel || '',
        politicalStatus: o.politicalStatus || '', occupation: o.occupation || '',
        employer: o.employer || '', weddingDate: o.weddingDate || '',
        negativeNotes: o.negativeNotes || ''
      })
      markSaved()
    }
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.face-state { display: flex; align-items: center; gap: 8px; }
.tip { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.7; margin-top: 4px; }
.tag-opt { display: inline-flex; align-items: center; gap: 6px; }
.tag-opt .muted { color: var(--biz-text-3); font-size: 11px; }
.tag-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
</style>
