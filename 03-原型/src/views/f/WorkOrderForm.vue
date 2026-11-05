<template>
  <FormShell
    ref="shell" :form="form" :rules="rules" :loading="false" :saving="saving" :dirty="dirty"
    title="发起工单"
    subtitle="客服代客报事 / 内部报修统一入口；提交后进入「待派单」，由派单规则或人工指派处理人"
    submit-text="提交工单"
    @submit="onSubmit" @cancel="onCancel"
  >
    <template #note>
      <br />提交为<b>内存态</b>：工单写入当前会话（工单列表立即可见），刷新还原。
      SLA 按优先级自动带出（特急 4h / 紧急 8h / 普通 24h）。
      <br />两条维修线：<b>公共区域维修免费</b>（按设施部位报，不生成账单）；<b>商业服务收费</b>
      （必须选服务项目，价格来自「商业服务项目」字典，金额按下单时的价格快照写进工单）。
    </template>

    <div class="sec">
      <div class="sec__hd"><h4>报事信息</h4><span class="desc">标题与描述将推送给业主 App</span></div>
      <el-row :gutter="24">
        <el-col :span="6">
          <el-form-item label="工单类型" prop="type">
            <el-select v-model="form.type" style="width:100%" @change="onTypeChange">
              <el-option v-for="t in woTypeOpts()" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>

        <!-- 商业服务：选项目（价格与服务范围都写在项目里，不让人手填） -->
        <el-col v-if="form.type === '商业服务'" :span="10">
          <el-form-item label="服务项目" prop="serviceCode">
            <el-select v-model="form.serviceCode" filterable style="width:100%" placeholder="按分类选项目"
              @change="onServiceChange">
              <el-option-group v-for="g in serviceGroups" :key="g.category" :label="g.category">
                <el-option v-for="it in g.items" :key="it.code" :label="it.label" :value="it.code">
                  <span>{{ it.label }}</span>
                  <span class="opt-fee">¥{{ it.price }}</span>
                </el-option>
              </el-option-group>
            </el-select>
          </el-form-item>
        </el-col>

        <!-- 公共区域维修：选设施部位（部位维度，不是工种） -->
        <el-col v-else-if="form.type === '公共区域维修'" :span="10">
          <el-form-item label="设施部位" prop="category">
            <el-select v-model="form.category" style="width:100%" placeholder="问题出在哪儿">
              <el-option v-for="c in publicCats" :key="c.value" :label="c.label" :value="c.value">
                <span>{{ c.label }}</span>
                <span class="opt-desc">{{ c.desc }}</span>
              </el-option>
            </el-select>
          </el-form-item>
        </el-col>

        <!-- 非维修类：分类是自由文本（投诉对象 / 咨询主题），不强制 -->
        <el-col v-else :span="10">
          <el-form-item label="问题分类">
            <el-select v-model="form.category" filterable allow-create clearable style="width:100%"
              placeholder="选填，可输入">
              <el-option v-for="c in otherCats" :key="c" :label="c" :value="c" />
            </el-select>
          </el-form-item>
        </el-col>

        <el-col :span="8">
          <el-form-item label="优先级" prop="priority">
            <el-radio-group v-model="form.priority">
              <el-radio-button v-for="p in woPriorityOpts()" :key="p" :label="p" :value="p" />
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="16">
          <el-form-item label="工单标题" prop="title">
            <el-input v-model="form.title" maxlength="40" show-word-limit placeholder="一句话说明问题，如：主卫水管漏水" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="来源" prop="source">
            <el-select v-model="form.source" style="width:100%">
              <el-option v-for="s in woSourceOpts()" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="问题描述" prop="description">
            <el-input v-model="form.description" type="textarea" :rows="3" maxlength="200" show-word-limit
              placeholder="补充现场情况、业主诉求、可上门时间等" />
          </el-form-item>
        </el-col>
      </el-row>
    </div>

    <!-- 商业服务：选中项目即见价，金额按项目快照写进工单 -->
    <div v-if="form.type === '商业服务' && curService" class="fee-preview">
      <div class="fee-preview__hd">
        <b>{{ curService.name }}</b>
        <span class="muted">{{ curService.category }} · 约 {{ curService.minutes }} 分钟 · 计费方式：完工后生成账单（可在线付或挂账并入物业费）</span>
      </div>
      <div class="fee-preview__row">
        <div class="fee-preview__i"><span>材料费</span><b>¥ {{ money(curService.material) }}</b></div>
        <div class="fee-preview__i"><span>人工费</span><b>¥ {{ money(curService.labor) }}</b></div>
        <div class="fee-preview__i is-total"><span>服务价格</span><b>¥ {{ money(curService.price) }}</b></div>
        <div class="fee-preview__i is-muted"><span>内部成本</span><b>¥ {{ money(curService.cost) }}</b></div>
      </div>
      <div class="fee-preview__note">
        服务价格对业主展示；成本价仅内部可见（材料按成本价过账、人工费是师傅提成基数）。
      </div>
    </div>
    <div v-else-if="form.type === '公共区域维修'" class="fee-preview is-free">
      <div class="fee-preview__hd">
        <b>公共区域维修 · 免费</b>
        <span class="muted">公共设施维修不向业主收费，费用走物业运营成本；完工后不生成账单。</span>
      </div>
    </div>

    <div class="sec">
      <div class="sec__hd">
        <h4>位置与联系人</h4>
        <span class="desc">{{ form.type === '商业服务' ? '商业服务需选房屋（入户作业，业主需在场或授权）' : '公共区域工单不入户，无需业主配合；关联房屋选填' }}</span>
      </div>
      <el-row :gutter="24">
        <el-col :span="8">
          <el-form-item label="所属项目" prop="communityId">
            <el-select v-model="form.communityId" style="width:100%">
              <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="关联房屋">
            <el-select v-model="form.houseId" filterable clearable style="width:100%" placeholder="选择房屋（公共区域可不选）"
              @change="onHouseChange">
              <el-option v-for="h in houseOpts" :key="h.houseId" :label="h.label" :value="h.houseId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="联系人">
            <el-input v-model="form.ownerName" placeholder="选填，默认取产权业主" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="联系电话" prop="phone">
            <el-input v-model="form.phone" maxlength="11" placeholder="选填，需回访时填写" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="预约上门">
            <el-date-picker v-model="form.appointAt" type="datetime" value-format="YYYY-MM-DD HH:mm"
              placeholder="选填" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="指定处理人">
            <el-select v-model="form.assignee" filterable clearable style="width:100%" placeholder="不选则进入待派单池">
              <el-option v-for="e in repairCandidates()" :key="e.empId" :label="`${e.name} · ${e.position}`" :value="e.name" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
    </div>
  </FormShell>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import FormShell from '@/components/FormShell.vue'
import { useForm } from '@/composables/useForm'
import {
  communityOpts, createWorkOrder, houseOptions, publicCategoryOpts, repairCandidates,
  serviceItemOptions, woCategoryOpts, woPriorityOpts, woSourceOpts, woTypeOpts
} from '@/utils/api'
import { phoneOptional, reqSel, req as reqText } from '@/utils/rules'
import { money } from '@/utils/format'

const router = useRouter()
/* 默认「公共区域维修」：报修里最常见的一类，且不需要房屋与业主配合，开单门槛最低 */
const EMPTY = {
  type: '公共区域维修', category: '', serviceCode: '', priority: '普通', title: '', source: '客服代客',
  description: '', communityId: 'P01', houseId: '', ownerName: '', phone: '', appointAt: '', assignee: ''
}
const form = reactive({ ...EMPTY })

/** 校验按类型切换：维修两类各有必填项，非维修类不强制分类 */
const rules = computed(() => {
  const base = {
    type: reqSel('工单类型'),
    priority: reqSel('优先级'),
    title: reqText('工单标题'),
    description: reqText('问题描述'),
    communityId: reqSel('所属项目'),
    phone: phoneOptional('联系电话')
  }
  if (form.type === '商业服务') {
    base.serviceCode = [{
      validator: (_r, v, cb) => (v ? cb() : cb(new Error('请选择服务项目：价格与服务范围都在项目里'))),
      trigger: 'change'
    }]
  } else if (form.type === '公共区域维修') {
    base.category = reqSel('设施部位', 'change')
  }
  return base
})

const houseOpts = ref([])
const publicCats = publicCategoryOpts()
/** 商业服务：在售项目按分类分组（同一分类下按价目表顺序，不乱序） */
const serviceGroups = computed(() => {
  const list = serviceItemOptions()
  const map = new Map()
  for (const it of list) {
    if (!map.has(it.category)) map.set(it.category, [])
    map.get(it.category).push(it)
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }))
})
const curService = computed(() => serviceItemOptions().find(i => i.code === form.serviceCode) || null)
/** 非维修类的历史分类（投诉对象 / 咨询主题这类自由文本，给个常用项省得手打） */
const otherCats = computed(() => woCategoryOpts('投诉建议'))

/** 切类型：清掉不属于新类型的分类与项目，避免「商业服务单里躺着电梯」这种脏组合 */
function onTypeChange() {
  form.category = ''
  form.serviceCode = ''
  if (form.type !== '商业服务') form.houseId = ''
}
function onServiceChange(code) {
  const it = serviceItemOptions().find(i => i.code === code)
  form.category = it ? it.category : ''
  if (!form.title && it) form.title = it.name
}
watch(() => form.communityId, cid => {
  houseOpts.value = houseOptions(300, { communityId: cid })
  if (form.houseId && !houseOpts.value.some(h => h.houseId === form.houseId)) form.houseId = ''
}, { immediate: true })
function onHouseChange() {
  const h = houseOpts.value.find(x => x.houseId === form.houseId)
  if (h?.ownerName) form.ownerName = h.ownerName
}

const shell = ref()
const { saving, dirty, submit, confirmLeave } = useForm(form, {
  formRef: () => shell.value?.formRef,
  onSave: async () => {
    const wo = createWorkOrder({ ...form })
    if (!wo) throw new Error('提交失败')
  }
})
async function onSubmit() {
  const ok = await submit(`工单已提交，单号待派单（SLA ${form.priority === '特急' ? 4 : form.priority === '紧急' ? 8 : 24} 小时）`)
  if (!ok) return
  try {
    await ElMessageBox.confirm('工单已提交，状态为「待派单」（原型阶段为内存态，刷新还原）', '提示',
      { confirmButtonText: '去工单列表', cancelButtonText: '继续发起', type: 'success' })
    router.push('/f/workorders')
  } catch { /* 继续发起 */ }
}
async function onCancel() {
  if (!(await confirmLeave())) return
  router.push('/f/workorders')
}
</script>

<style scoped>
.fee-preview {
  margin-top: 16px; padding: 12px 14px; border-radius: 9px;
  background: rgba(91, 108, 255, .05); border: 1px solid rgba(91, 108, 255, .16);
}
.fee-preview.is-free { background: rgba(18, 185, 138, .05); border-color: rgba(18, 185, 138, .18); }
.fee-preview__hd { display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
.fee-preview__hd .muted { font-size: 11.5px; line-height: 1.6; }
.fee-preview__row { display: flex; flex-wrap: wrap; gap: 22px; margin-top: 10px; }
.fee-preview__i { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; color: var(--biz-text-3); }
.fee-preview__i b { font-family: var(--biz-font-num); font-size: 15px; color: var(--biz-text-1); }
.fee-preview__i.is-total b { color: var(--biz-primary, #5b6cff); }
.fee-preview__i.is-muted b { color: var(--biz-text-2); }
.fee-preview__note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; }
.opt-fee { float: right; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.opt-desc { float: right; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--biz-text-3); font-size: 11.5px; }
</style>
