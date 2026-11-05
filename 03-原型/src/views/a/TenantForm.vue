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
      <div class="sec__hd">
        <h4>承租主体</h4>
        <span class="desc">个人与公司的证件、核验方式不同——切换类型后，下面的字段会整组替换</span>
      </div>
      <el-row :gutter="24">
        <el-col :span="24">
          <el-form-item label="租客类型">
            <el-radio-group v-model="form.tenantType" @change="onTypeChange">
              <el-radio-button value="个人">个人</el-radio-button>
              <el-radio-button value="公司">公司</el-radio-button>
            </el-radio-group>
            <span class="muted" style="margin-left:10px;font-size:12px;">
              {{ form.tenantType === '公司'
                ? '公司以统一社会信用代码作为主体凭证；门禁人脸录的是经办人'
                : '个人以身份证件作为主体凭证；门禁人脸录本人' }}
              <template v-if="editing"> · 换主体是「变更」，保存时才生效（会撤销人脸、重新核验）</template>
            </span>
            <div v-if="pendingType" class="field-warn">
              正在把承租主体从「{{ originalType }}」换成「{{ pendingType }}」：保存后
              <b>人脸授权撤销、核验状态复位为待核验</b>{{ pendingType === '公司' ? '，且要重新上传营业执照' : '' }}。
              原因：{{ typeReason }}
              <el-button link type="primary" @click="cancelTypeSwitch">撤销变更</el-button>
            </div>
          </el-form-item>
        </el-col>
      </el-row>

      <!-- 个人 -->
      <el-row v-if="form.tenantType === '个人'" :gutter="24">
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

      <!-- 公司 -->
      <template v-else>
        <el-row :gutter="24">
          <el-col :span="12">
            <el-form-item label="公司名称" prop="companyName">
              <el-input v-model="form.companyName" maxlength="40" show-word-limit placeholder="与营业执照一致（如 成都市味知香餐饮有限公司）" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="信用代码" prop="creditCode">
              <el-input v-model="form.creditCode" maxlength="18" placeholder="18 位统一社会信用代码"
                @input="codeHint = creditCodeCheck(form.creditCode)" />
              <div v-if="form.creditCode && codeHint" class="field-err">{{ codeHint }}</div>
              <div v-else-if="form.creditCode" class="field-ok">校验位正确</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="法定代表人" prop="legalPerson">
              <el-input v-model="form.legalPerson" maxlength="20" placeholder="执照上的法定代表人" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="法人电话" prop="legalPersonPhone">
              <el-input v-model="form.legalPersonPhone" maxlength="11" placeholder="紧急联络用" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="成立日期">
              <el-date-picker v-model="form.establishDate" type="date" value-format="YYYY-MM-DD"
                :disabled-date="d => d.getTime() > Date.now()" placeholder="选填" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="经办人" prop="agentName">
              <el-input v-model="form.agentName" maxlength="20" placeholder="日常对接人" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="经办人手机" prop="agentPhone">
              <el-input v-model="form.agentPhone" maxlength="11" placeholder="11 位手机号" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="经办人证件">
              <el-input v-model="form.agentIdCard" maxlength="18" placeholder="选填；录门禁人脸时需要" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="经营类目" prop="businessCategory">
              <el-select v-model="form.businessCategory" style="width:100%" placeholder="决定消防与排污要求">
                <el-option v-for="c in BUSINESS_CATEGORIES" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="承租用途">
              <el-select v-model="form.leasePurpose" style="width:100%" placeholder="与房屋用途不同">
                <el-option v-for="u in LEASE_PURPOSES" :key="u" :label="u" :value="u" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="员工人数">
              <el-input-number v-model="form.employeeCount" :min="1" :max="9999" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="24">
          <el-col :span="24">
            <el-form-item label="注册地址" prop="regAddress">
              <el-input v-model="form.regAddress" maxlength="80" placeholder="执照上的住所；用于文书送达与工商核查" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="营业执照">
              <LicenseUpload
                :tenant-id="editing && !pendingType ? id : ''" :local="!editing || !!pendingType"
                :files="licenseFiles" :operator="editing ? '物业前台' : '物业前台（代录）'"
                @changed="onLicenseChanged"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </template>
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
        <el-col v-if="form.tenantType === '个人'" :span="6">
          <el-form-item label="与业主关系" prop="relation">
            <el-select v-model="form.relation" style="width:100%">
              <el-option v-for="r in TENANT_RELATIONS.filter(x => x !== '企业承租')" :key="r" :label="r" :value="r" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col v-if="form.tenantType === '个人'" :span="6">
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

  <el-dialog v-model="typeDlgVisible" title="换承租主体" width="560px" append-to-body>
    <div class="type-dlg">
      <div class="type-dlg__row">
        <span class="type-dlg__k">变更方向</span>
        <span class="type-dlg__v">{{ originalType }} → <b>{{ typeDlgTo }}</b>（{{ curHouse?.label || '承租房屋不变' }}）</span>
      </div>
      <div class="type-dlg__warn">
        换主体不是改一个字段，下面这些会同时发生：
        <ul>
          <li>撤销门禁人脸授权（人脸属于自然人，公司主体没有脸）</li>
          <li>核验状态复位为「待核验」，需重新核验{{ typeDlgTo === '公司' ? '并上传营业执照影像件' : '' }}</li>
          <li>另一套字段清空，{{ typeDlgTo === '公司' ? '姓名与证件迁移到经办人' : '经办人迁移为承租人' }}</li>
        </ul>
        租约与房屋不变，操作记录留痕。
      </div>
      <div class="type-dlg__row">
        <span class="type-dlg__k">变更原因</span>
        <div style="flex:1;">
          <el-select v-model="typeDlgReason" placeholder="选一个常见原因，或直接写" filterable allow-create
            default-first-option style="width:100%">
            <el-option v-for="r in CHANGE_TYPE_REASONS" :key="r" :label="r" :value="r" />
          </el-select>
          <div class="muted" style="font-size:12px;margin-top:4px;">至少 4 个字；这条记录用来解释"为什么换过"</div>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="typeDlgVisible = false">取消</el-button>
      <el-button type="primary" :disabled="typeDlgReason.trim().length < 4" @click="confirmTypeSwitch">
        确认换主体
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import LicenseUpload from '@/components/LicenseUpload.vue'
import { useForm } from '@/composables/useForm'
import {
  BUSINESS_CATEGORIES, CHANGE_TYPE_REASONS, LEASE_PURPOSES, TENANT_RELATIONS, changeTenantType,
  creditCodeCheck, getTenantDetail, houseOptions, liveTenantOfHouse, ownerName,
  registerTenantByOwner, supplementTenant
} from '@/utils/api'
import { dateAfter, idCard, name, phone, reqSel } from '@/utils/rules'

const route = useRoute()
const router = useRouter()
const editing = computed(() => !!route.params.id)
const id = computed(() => route.params.id || '')

const EMPTY = {
  tenantType: '个人',
  houseId: '', ownerId: '', name: '', phone: '', idCard: '',
  certified: false, faceRegistered: false,
  leaseStart: '', leaseEnd: '', relation: '承租人', residents: 1, remark: '',
  /* 公司 */
  companyName: '', creditCode: '', legalPerson: '', legalPersonPhone: '',
  agentName: '', agentPhone: '', agentIdCard: '', businessCategory: '',
  leasePurpose: '', regAddress: '', establishDate: '', employeeCount: 5
}
const form = reactive({ ...EMPTY })
const codeHint = ref('')
/* 载入的原始租户：撤销换主体时靠它把表单还原（页面不能自己记一份拼装值） */
const loadedTenant = ref(null)
/* 影像件：新建时挂在表单上随主体一次提交；编辑时由 LicenseUpload 直接落库并回写这里 */
const licenseFiles = ref([])
function onLicenseChanged (files) { licenseFiles.value = [...(files || [])] }

/**
 * 校验规则按类型**整套切换**：不是"个人必填 + 公司选填"的叠加。
 * 叠加的后果是公司租户永远被"姓名必填"挡住，而姓名对一家公司根本没有意义。
 */
const rules = computed(() => (form.tenantType === '公司'
  ? {
      houseId: reqSel('承租房屋'),
      companyName: [
        { required: true, message: '请填写公司名称', trigger: 'blur' },
        { min: 2, max: 40, message: '公司名称 2–40 个字', trigger: 'blur' }
      ],
      creditCode: [{
        required: true,
        validator: (_r, v, cb) => {
          const err = creditCodeCheck(v)
          return err ? cb(new Error(err)) : cb()
        },
        trigger: 'blur'
      }],
      legalPerson: [
        { required: true, message: '请填写法定代表人', trigger: 'blur' },
        { min: 2, max: 20, message: '法定代表人 2–20 个字', trigger: 'blur' }
      ],
      legalPersonPhone: [
        { required: true, message: '请填写法人电话', trigger: 'blur' },
        { pattern: /^1[3-9]\d{9}$/, message: '应为 11 位手机号', trigger: 'blur' }
      ],
      agentName: [
        { required: true, message: '请填写经办人', trigger: 'blur' },
        { min: 2, max: 20, message: '经办人 2–20 个字', trigger: 'blur' }
      ],
      agentPhone: [
        { required: true, message: '请填写经办人手机', trigger: 'blur' },
        { pattern: /^1[3-9]\d{9}$/, message: '应为 11 位手机号', trigger: 'blur' }
      ],
      businessCategory: reqSel('经营类目', 'change'),
      regAddress: [
        { required: true, message: '请填写注册地址', trigger: 'blur' },
        { min: 6, message: '注册地址太短，请写完整', trigger: 'blur' }
      ],
      establishDate: [{
        validator: (_r, v, cb) => {
          if (v && v > new Date().toISOString().slice(0, 10)) return cb(new Error('成立日期不能晚于今天'))
          return cb()
        },
        trigger: 'change'
      }],
      leaseStart: reqSel('起租日', 'change'),
      leaseEnd: [...reqSel('到期日', 'change'), ...dateAfter('leaseStart', { label: '到期日' })]
    }
  : {
      houseId: reqSel('承租房屋'),
      name: name('姓名'),
      phone: phone('手机号'),
      /* 编辑既有租户时放宽校验位：历史数据多为运营导入，不能因为校验位挡住物业修正 */
      idCard: idCard('证件号码', { checkBit: !editing.value }),
      leaseStart: reqSel('起租日', 'change'),
      leaseEnd: [...reqSel('到期日', 'change'), ...dateAfter('leaseStart', { label: '到期日' })]
    }))

/** 首次载入时的原始类型：编辑态用来判断"用户是否真的要换主体" */
const originalType = ref(EMPTY.tenantType)
const pendingType = ref('')
const typeReason = ref('')
const typeDlgVisible = ref(false)
const typeDlgTo = ref('个人')
const typeDlgReason = ref('')

/** 清空另一套字段：个人租户里躺着公司名，列表与报表都会算错 */
function clearOtherSet (t) {
  if (t === '公司') {
    form.name = ''
    form.idCard = ''
    form.certified = false
    form.faceRegistered = false
    form.relation = '企业承租'
  } else {
    for (const k of ['companyName', 'creditCode', 'legalPerson', 'legalPersonPhone', 'agentName',
      'agentPhone', 'agentIdCard', 'businessCategory', 'leasePurpose', 'regAddress', 'establishDate']) {
      form[k] = ''
    }
    form.relation = '承租人'
    licenseFiles.value = []
    codeHint.value = ''
  }
}

/**
 * 切换类型有两套路径，别混在一起：
 *   · 新建：直接把表单换成目标字段组（没有历史状态要保护）；
 *   · 编辑：租户已经有租约、核验与人脸，换主体必须**先问原因**，确认后才改表单；
 *     否则用户点一下 radio 就"看起来换了"，保存时才发现代价。
 */
function onTypeChange (t) {
  if (!editing.value) { clearOtherSet(t); shell.value?.formRef?.clearValidate?.(); return }
  if (t === originalType.value) { pendingType.value = ''; typeReason.value = ''; applyOriginal(); return }
  /* 先把 radio 弹回去，等确认后再切 —— 没确认就换，会让人以为已经生效 */
  form.tenantType = originalType.value
  typeDlgTo.value = t
  typeDlgReason.value = ''
  typeDlgVisible.value = true
}

/** 确认换主体：按迁移规则把表单预填好（用户可以随后微调），保存时才真正落库 */
function confirmTypeSwitch () {
  const to = typeDlgTo.value
  typeReason.value = typeDlgReason.value.trim()
  typeDlgVisible.value = false
  if (to === '公司') {
    /* 原承租人 → 这家公司的对外信息：手机做对外电话、姓名做经办人、证件做经办人证件 */
    form.companyName = ''
    form.creditCode = ''
    codeHint.value = ''
    form.phone = form.phone || ''
    form.agentName = form.agentName || form.name
    form.agentPhone = form.agentPhone || form.phone
    form.agentIdCard = form.agentIdCard || form.idCard
    form.employeeCount = form.employeeCount || form.residents
    form.relation = '企业承租'
    form.name = ''
    form.idCard = ''
    form.certified = false
    form.faceRegistered = false
    licenseFiles.value = []
  } else {
    form.name = form.agentName || form.name
    form.phone = form.agentPhone || form.phone
    form.idCard = form.agentIdCard || form.idCard
    form.relation = '承租人'
    form.residents = form.residents || 1
    clearOtherSet('个人')
  }
  form.tenantType = to
  pendingType.value = to
  shell.value?.formRef?.clearValidate?.()
}

function cancelTypeSwitch () {
  pendingType.value = ''
  typeReason.value = ''
  form.tenantType = originalType.value
  applyOriginal()
  shell.value?.formRef?.clearValidate?.()
}

/** 撤销后要能把表单恢复成数据里那份（否则界面上留着半套迁移过的值） */
function applyOriginal () {
  if (!editing.value) return
  const t = loadedTenant.value
  if (!t) return
  Object.assign(form, {
    tenantType: t.tenantType || '个人',
    name: t.name || '', phone: t.phone || '', idCard: t.idCard || '',
    certified: !!t.certified, faceRegistered: !!t.faceRegistered,
    relation: t.relation || '承租人', residents: t.residents || 1,
    companyName: t.companyName || '', creditCode: t.creditCode || '',
    legalPerson: t.legalPerson || '', legalPersonPhone: t.legalPersonPhone || '',
    agentName: t.agentName || '', agentPhone: t.agentPhone || '', agentIdCard: t.agentIdCard || '',
    businessCategory: t.businessCategory || '', leasePurpose: t.leasePurpose || '',
    regAddress: t.regAddress || '', establishDate: t.establishDate || '',
    employeeCount: t.employeeCount || 5
  })
  licenseFiles.value = [...(t.licenseFiles || [])]
  codeHint.value = form.creditCode ? creditCodeCheck(form.creditCode) : ''
}

// 租金与付款周期属业主与租户的商业条款：后台不采集、不展示、不统计（字段保留在数据里供业主端用）

/* 可代录的房屋：排除已有在住租户的（编辑时保留当前房屋，否则下拉会丢选项） */
const houseOpts = computed(() =>
  houseOptions(1000, { onlyVacant: true })
    .filter(h => !liveTenantOfHouse(h.houseId) || h.houseId === form.houseId)
)
const curHouse = computed(() => houseOpts.value.find(h => h.houseId === form.houseId))
const houseAreaText = computed(() => (curHouse.value?.area ? `${curHouse.value.area} m²` : '-'))
const ownerText = computed(() => {
  const o = curHouse.value?.ownerId
  return o ? `${ownerName(o)}（${o}）` : '该房屋未绑定业主'
})
function onHouseChange (hid) {
  const h = houseOpts.value.find(x => x.houseId === hid)
  form.ownerId = h?.ownerId || ''
}

const shell = ref()
const loading = ref(false)
const { saving, dirty, submit, markSaved, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    if (editing.value) {
      /* 换承租主体：类型、目标字段、清空与复位必须在一次调用里完成，
         分成"先改类型再补字段"会出现"类型换了但主体是空的"的中间态。 */
      if (pendingType.value) {
        const to = pendingType.value
        const patch = to === '公司'
          ? {
              companyName: form.companyName, creditCode: form.creditCode,
              legalPerson: form.legalPerson, legalPersonPhone: form.legalPersonPhone,
              agentName: form.agentName, agentPhone: form.agentPhone, agentIdCard: form.agentIdCard,
              businessCategory: form.businessCategory, leasePurpose: form.leasePurpose,
              regAddress: form.regAddress, establishDate: form.establishDate,
              employeeCount: form.employeeCount, phone: form.phone,
              licenseFiles: licenseFiles.value
            }
          : {
              name: form.name, phone: form.phone, idCard: form.idCard,
              relation: form.relation, residents: form.residents
            }
        changeTenantType(id.value, { toType: to, reason: typeReason.value, operator: '物业前台', patch })
        if (form.remark) supplementTenant(id.value, { remark: form.remark }, '物业前台')
        return
      }
      /* 编辑：只提交物业可改的字段（主体信息/联系方式/证件/关系/人数/备注），房屋与租期受保护。
         公司租户改公司名时，api 会同步 name，列表不会出现"新旧两个名字"。 */
      if (form.tenantType === '公司') {
        supplementTenant(id.value, {
          companyName: form.companyName, creditCode: form.creditCode,
          legalPerson: form.legalPerson, legalPersonPhone: form.legalPersonPhone,
          agentName: form.agentName, agentPhone: form.agentPhone, agentIdCard: form.agentIdCard,
          businessCategory: form.businessCategory, leasePurpose: form.leasePurpose,
          regAddress: form.regAddress, establishDate: form.establishDate,
          employeeCount: form.employeeCount, phone: form.phone, remark: form.remark
        }, '物业前台')
      } else {
        supplementTenant(id.value, {
          name: form.name, phone: form.phone, idCard: form.idCard,
          relation: form.relation, residents: form.residents, remark: form.remark
        }, '物业前台')
      }
      return
    }
    const isCo = form.tenantType === '公司'
    registerTenantByOwner({
      tenantType: form.tenantType,
      houseId: form.houseId,
      leaseStart: form.leaseStart, leaseEnd: form.leaseEnd,
      phone: form.phone, remark: form.remark,
      source: '物业补录',
      ...(isCo
        ? {
            companyName: form.companyName, creditCode: form.creditCode,
            legalPerson: form.legalPerson, legalPersonPhone: form.legalPersonPhone,
            agentName: form.agentName, agentPhone: form.agentPhone, agentIdCard: form.agentIdCard,
            businessCategory: form.businessCategory, leasePurpose: form.leasePurpose,
            regAddress: form.regAddress, establishDate: form.establishDate,
            employeeCount: form.employeeCount,
            licenseFiles: licenseFiles.value,
            /* 公司不押身份证；门禁人脸录经办人，故 faceRegistered 表示"经办人人脸已录" */
            certified: !!form.creditCode, faceRegistered: false,
            relation: '企业承租', residents: form.employeeCount
          }
        : {
            name: form.name, idCard: form.idCard,
            certified: form.certified, faceRegistered: form.faceRegistered,
            relation: form.relation, residents: form.residents
          })
    }, '物业前台（代录）')
  }
})

async function onSubmit () {
  const switched = pendingType.value
  const ok = await submit(editing.value ? (switched ? '承租主体已变更' : '住户信息已更新') : '租户已登记')
  if (!ok) return
  try {
    await ElMessageBox.confirm(
      switched
        ? `承租主体已从「${originalType.value}」变更为「${switched}」：人脸授权已撤销、核验状态复位为「待核验」，请重新核验${switched === '公司' ? '并上传营业执照影像件' : ''}。变更原因已记入操作记录。`
        : (editing.value
          ? '住户信息已更新并立即生效，操作已记录到「操作记录」。'
          : `租户已登记，状态为「待核验」；补全 ${form.tenantType === '公司' ? '公司资质 8 项' : '8 项'}信息后可提交核验、开通门禁。`),
      '保存成功', { confirmButtonText: '返回列表', cancelButtonText: '继续编辑', type: 'success' }
    )
    router.push('/a/tenants')
  } catch { /* 继续编辑 */ }
}
async function onCancel () {
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
      loadedTenant.value = t
      originalType.value = t.tenantType || '个人'
      Object.assign(form, {
        tenantType: t.tenantType || '个人',
        houseId: t.houseId || '', ownerId: t.ownerId || '', name: t.name || '',
        phone: t.phone || '', idCard: t.idCard || '',
        certified: !!t.certified, faceRegistered: !!t.faceRegistered,
        leaseStart: t.leaseStart || '', leaseEnd: t.leaseEnd || '',
        relation: t.relation || '承租人', residents: t.residents || 1, remark: t.remark || '',
        companyName: t.companyName || '', creditCode: t.creditCode || '',
        legalPerson: t.legalPerson || '', legalPersonPhone: t.legalPersonPhone || '',
        agentName: t.agentName || '', agentPhone: t.agentPhone || '', agentIdCard: t.agentIdCard || '',
        businessCategory: t.businessCategory || '', leasePurpose: t.leasePurpose || '',
        regAddress: t.regAddress || '', establishDate: t.establishDate || '',
        employeeCount: t.employeeCount || 5
      })
      licenseFiles.value = [...(t.licenseFiles || [])]
      if (form.creditCode) codeHint.value = creditCodeCheck(form.creditCode)
      markSaved()
    }
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.field-err { font-size: 12px; color: var(--biz-danger); margin-top: 2px; }
.field-ok { font-size: 12px; color: #12B98A; margin-top: 2px; }
.field-warn {
  margin-top: 6px; padding: 7px 10px; border-radius: 6px; font-size: 12px; line-height: 1.7;
  background: rgba(217, 138, 31, .1); color: var(--biz-text-2, #5c6272);
}
.field-warn b { color: var(--biz-danger, #e34d59); }
.type-dlg__row { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
.type-dlg__k { width: 72px; flex: none; font-size: 13px; color: var(--biz-text-3, #8a90a2); padding-top: 7px; }
.type-dlg__v { font-size: 13px; color: var(--biz-text-1, #1f2430); padding-top: 7px; }
.type-dlg__warn {
  padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.8;
  background: rgba(227, 77, 89, .06); color: var(--biz-text-2, #5c6272); margin-bottom: 14px;
}
.type-dlg__warn ul { margin: 4px 0 4px; padding-left: 20px; }
.type-dlg__warn li { list-style: disc; }
</style>
