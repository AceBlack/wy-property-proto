<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>考核项由模板带出，权重由你定</b>：项目经理和四个班组各一套模板，<b>考什么</b>由运营管理部维护，
        但<b>每一项占多少</b>是你在这一步填的 —— 本月哪个是重点，就给它多一点。
        系统先按条目数平均预填 100%，你只需要改需要调的那几项。
        <br />
        <b>各项权重合计必须正好 100%</b>：多了少了都提交不了，页面会告诉你差几个百分点。
        每一项<b>只能按 5% 调</b>（10、15、20……），输入框旁边的加减也是 5 一档。
        监控指标不占权重，只扣分，不用管。
        <br />
        <b>提交审批 → 运营管理部审核下发 → 执行 → 月底报完成情况 → 复评</b>。
        审核阶段运营管理部可以直接改指标、权重和计划（不走驳回），改动会留痕。
        实际完成情况和自评分在<b>执行阶段</b>才填，这一步只报计划。
      </div>
    </div>

    <div v-if="noLead" class="panel" style="margin-top:16px;">
      <EmptyState type="denied" title="你不是任何部门的负责人"
        desc="计划由部门负责人提报。如果你确实是负责人，请先到「组织架构」把你的名字设为该部门负责人 —— 否则提报主体会是别人。" />
      <div style="text-align:center;">
        <el-button @click="$router.push('/f/plans')">返回计划列表</el-button>
      </div>
    </div>

    <template v-else>
      <div class="panel" style="margin-top:16px;">
        <div class="sec__hd">
          <h4>计划信息</h4>
          <span class="desc">{{ isEdit ? '编辑已保存的计划' : '新建月度计划' }}</span>
        </div>
        <el-form label-width="96px" style="margin-top:14px;">
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="计划月份" required>
                <el-select v-model="form.planMonth" style="width:100%" :disabled="isEdit" @change="onMonthChange">
                  <el-option v-for="m in months" :key="m" :label="`${m}${m === curMonth ? '（本月）' : ''}`" :value="m" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="16">
              <el-form-item label="提报部门" required>
                <div v-if="leads.length === 1" class="org-one">
                  <el-tag effect="plain" type="primary" size="large">{{ leads[0].orgName }}</el-tag>
                  <span class="org-one__path">{{ leads[0].orgPath }}</span>
                  <span class="muted">你是该部门负责人</span>
                </div>
                <el-select v-else v-model="form.orgId" style="width:100%" :disabled="isEdit"
                  placeholder="选择以哪个部门的负责人身份提报" @change="onOrgChange">
                  <el-option v-for="l in leadOpts" :key="l.orgId" :value="l.orgId" :label="l.orgName"
                    :disabled="l.taken">
                    <div class="org-opt">
                      <span class="org-opt__n">{{ l.orgName }}</span>
                      <el-tag size="small" effect="plain" :type="l.duty === '正职' ? 'primary' : 'info'">{{ l.duty }}</el-tag>
                      <el-tag v-if="!l.isPrimary" size="small" effect="plain" type="warning">兼管</el-tag>
                      <span class="org-opt__p">{{ l.orgPath }}</span>
                      <span v-if="l.taken" class="org-opt__x">本月已提报</span>
                    </div>
                  </el-option>
                </el-select>
              </el-form-item>
              <div v-if="leads.length > 1" class="lead-tip">
                你负责 <b>{{ leads.length }}</b> 个部门（{{ leads.map(shortPath).join('、') }}）——
                每个月每个部门各提一份，不能合并成一份。
              </div>
            </el-col>
          </el-row>

          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="提报人">
                <div class="ro">{{ me.name }} · {{ me.position }}</div>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="提报身份">
                <div class="ro">
                  {{ curLead?.duty || '正职' }}
                  <span v-if="curLead?.endDate" class="muted">至 {{ curLead.endDate }}</span>
                  <span v-if="curLead && !curLead.isPrimary" class="muted">（人事主职在 {{ me.orgName }}）</span>
                </div>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="考核模板">
                <!-- 模板由组织类型自动匹配；能改模板的只有运营管理部（f.planTpl.edit） -->
                <el-select v-if="canSwitchTpl" v-model="form.tplId" style="width:100%" @change="onTplChange">
                  <el-option v-for="t in tplOpts" :key="t.tplId" :label="t.label" :value="t.tplId" />
                </el-select>
                <div v-else class="ro">
                  <span v-if="form.tplName">{{ form.tplName }}</span>
                  <span v-else class="warn-txt">未匹配到模板</span>
                  <span class="muted">（只决定考核项，不含权重）</span>
                </div>
              </el-form-item>
            </el-col>
          </el-row>

          <div v-if="dupPlan" class="dup-warn">
            <el-icon><WarningFilled /></el-icon>
            <div>
              该部门 <b>{{ form.planMonth }}</b> 已有计划 <code>{{ dupPlan.planId }}</code>（{{ dupPlan.status }}，提报人 {{ dupPlan.submitterName }}）。
              一个部门一个月只能有一份 —— 要改内容请打开已有计划，不要新建。
              <el-button link type="primary" @click="$router.push(`/f/plans/${dupPlan.planId}`)">打开已有计划</el-button>
            </div>
          </div>
        </el-form>
      </div>

      <div v-if="!form.tplId" class="panel" style="margin-top:16px;">
        <EmptyState type="denied" title="这个部门还没有匹配到考核模板"
          desc="模板按组织类型匹配：项目部用项目经理模板，班组按 T1–T4 对应客服 / 工程 / 秩序 / 环境，总部部门用职能兜底。请运营管理部先到「计划模板」补一套。" />
      </div>

      <template v-else>
        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd">
            <h4>一、量化指标 <span class="wq">权重 {{ qs }}%</span></h4>
            <span class="desc">填目标值即可，否决值和挑战值自动算</span>
            <span class="spacer" />
            <span class="rule">挑战 = 目标 × 105% · 否决 = 目标 × 95%（成本类镜像）</span>
          </div>
          <el-table :data="sections.q" size="small" style="width:100%;margin-top:10px;">
            <el-table-column label="#" width="42" align="center">
              <template #default="{ $index }"><span class="muted">{{ $index + 1 }}</span></template>
            </el-table-column>
            <el-table-column label="考核项" min-width="170">
              <template #default="{ row }">
                {{ row.name }}
                <el-tag v-if="row.direction === -1" size="small" effect="plain" type="warning" style="margin-left:4px;">逆向</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="目标值" width="150">
              <template #default="{ row }">
                <el-input v-model.number="row.target" size="small" placeholder="填数值" style="width:100%">
                  <template #append>{{ row.unit || '元' }}</template>
                </el-input>
              </template>
            </el-table-column>
            <el-table-column label="否决值" width="118" align="right">
              <template #default="{ row }">
                <span class="num">{{ row.reject == null ? '—' : money(row.reject) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="挑战值" width="118" align="right">
              <template #default="{ row }">
                <span class="num">{{ row.challenge == null ? '—' : money(row.challenge) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="完成时间" width="152">
              <template #default="{ row }">
                <el-date-picker v-model="row.dueDate" type="date" value-format="YYYY-MM-DD"
                  size="small" style="width:100%" :disabled-date="beforeMonth" />
              </template>
            </el-table-column>
            <el-table-column label="权重" width="112" align="center">
              <template #default="{ row }">
                <el-input-number v-model="row.weight" :min="0" :max="100" :step="WEIGHT_STEP"
                  step-strictly :precision="0" size="small" controls-position="right" style="width:100%" />
              </template>
            </el-table-column>
            <el-table-column label="备注" min-width="120">
              <template #default="{ row }">
                <el-input v-model="row.remark" size="small" placeholder="选填" maxlength="40" />
              </template>
            </el-table-column>
          </el-table>
          <div class="sumline">
            本段权重合计 <b :class="qs > 0 ? 'is-ok' : 'is-warn'">{{ qs }}%</b>
            <span class="muted">（各项合计 100% 即可，不要求某一段占固定比例；每项只能按 5% 调）</span>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd">
            <h4>二、监控指标 <span class="wq">权重 0%</span></h4>
            <span class="desc">固定考核标准，权重为 0，只扣分</span>
            <span class="spacer" />
            <span class="rule">扣分在执行阶段填，模板只定规则文字</span>
          </div>
          <el-table :data="sections.m" size="small" style="width:100%;margin-top:10px;">
            <el-table-column label="#" width="42" align="center">
              <template #default="{ $index }"><span class="muted">{{ $index + 1 }}</span></template>
            </el-table-column>
            <el-table-column label="考核项" min-width="160" prop="name" />
            <el-table-column label="评价标准（模板固定）" min-width="380">
              <template #default="{ row }"><span class="muted">{{ row.standard }}</span></template>
            </el-table-column>
            <el-table-column label="权重" width="70" align="center">
              <template #default><span class="num">0%</span></template>
            </el-table-column>
            <el-table-column label="备注" min-width="120">
              <template #default="{ row }">
                <el-input v-model="row.remark" size="small" placeholder="选填" maxlength="40" />
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd">
            <h4>三、重点工作计划 <span class="wq">权重 {{ ks }}%</span></h4>
            <span class="desc">考核项固定，补写计划内容与完成标准</span>
            <span class="spacer" />
            <span class="rule">自评与复评按 1–5 档打分</span>
          </div>
          <el-table :data="sections.k" size="small" style="width:100%;margin-top:10px;">
            <el-table-column label="#" width="42" align="center">
              <template #default="{ $index }"><span class="muted">{{ $index + 1 }}</span></template>
            </el-table-column>
            <el-table-column label="考核项" width="200" prop="name" />
            <el-table-column label="计划内容" min-width="260">
              <template #default="{ row }">
                <el-input v-model="row.content" type="textarea" :rows="2" maxlength="300"
                  placeholder="本月打算做什么，可分行写" />
              </template>
            </el-table-column>
            <el-table-column label="完成标准" min-width="240">
              <template #default="{ row }">
                <el-input v-model="row.standard" type="textarea" :rows="2" maxlength="200"
                  placeholder="可检验的口径，如：抽检合格率 ≥ 95%" />
              </template>
            </el-table-column>
            <el-table-column label="完成时间" width="152">
              <template #default="{ row }">
                <el-date-picker v-model="row.dueDate" type="date" value-format="YYYY-MM-DD"
                  size="small" style="width:100%" :disabled-date="beforeMonth" />
              </template>
            </el-table-column>
            <el-table-column label="权重" width="112" align="center">
              <template #default="{ row }">
                <el-input-number v-model="row.weight" :min="0" :max="100" :step="WEIGHT_STEP"
                  step-strictly :precision="0" size="small" controls-position="right" style="width:100%" />
              </template>
            </el-table-column>
            <el-table-column label="附件" width="86" align="center">
              <template #default="{ row }">
                <el-upload :auto-upload="false" :show-file-list="false" multiple :on-change="f => onFile(row, f)">
                  <el-button link type="primary" size="small">{{ (row.files || []).length ? `+${row.files.length}` : '上传' }}</el-button>
                </el-upload>
              </template>
            </el-table-column>
          </el-table>
          <div class="sumline">
            本段权重合计 <b :class="ks > 0 ? 'is-ok' : 'is-warn'">{{ ks }}%</b>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd"><h4>备注</h4><span class="desc">选填 · 部门本月整体情况说明</span></div>
          <el-input v-model="form.summary" type="textarea" :rows="2" maxlength="200" show-word-limit
            placeholder="如：本月承接 2 场业主活动，另加 1 项临时任务" style="margin-top:10px;" />
        </div>

        <div class="wbar" :class="wc.ok ? 'is-ok' : 'is-warn'">
          <span class="wbar__k">权重校验</span>
          <div class="wbar__track">
            <div class="wbar__fill" :style="{ width: Math.min(wc.total, 100) + '%' }" />
          </div>
          <span class="wbar__v">{{ wc.total }} / 100</span>
          <span class="wbar__m">{{ wc.ok ? '✓ 合计正好 100%，可以提报' : wc.msg }}</span>
          <el-button size="small" @click="evenWeights">平均分配</el-button>
        </div>

        <div class="foot-bar">
          <el-button @click="$router.back()">取消</el-button>
          <el-button :loading="saving" @click="save(true)">保存草稿</el-button>
          <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="save(false)">
            提交审批
          </el-button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PLAN_WEIGHT_STEP, canEditPlanTpl, getDeptPlanDetail, planCurrentMonth, planEvenWeights, planIdentity,
  planMonthOpts, planOfMonth, planTargetOf, planTplBundle, planTplOpts, planWeightCheck,
  saveDeptPlan, submitDeptPlan
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'

const route = useRoute()
const router = useRouter()
const planId = computed(() => route.params.id || '')
const isEdit = computed(() => !!planId.value)
const months = planMonthOpts()
const curMonth = planCurrentMonth()
const tplOpts = planTplOpts()
const WEIGHT_STEP = PLAN_WEIGHT_STEP
/** 能改模板的只有运营管理部（计划模板维护权限） */
const canSwitchTpl = computed(() => canEditPlanTpl())

const me = ref({ name: '', position: '', orgName: '', leads: [], leadCount: 0 })
const leads = computed(() => me.value.leads || [])
const noLead = computed(() => me.value.leadCount === 0)

const form = reactive({
  planMonth: curMonth,
  orgId: '',
  tplId: '',
  tplName: '',
  tplVersion: 0,
  summary: '',
  items: []
})
const curLead = computed(() => leads.value.find(l => l.orgId === form.orgId) || null)
const saving = ref(false)
const submitting = ref(false)
const dupPlan = ref(null)
const takenIds = ref(new Set())
const leadOpts = computed(() => leads.value.map(l => ({ ...l, taken: takenIds.value.has(l.orgId) })))

const sections = computed(() => ({
  q: form.items.filter(i => i.section === 'q').map(withTargets),
  m: form.items.filter(i => i.section === 'm'),
  k: form.items.filter(i => i.section === 'k')
}))

/** 表格里要显示派生的否决/挑战值，但不写回数据（目标一改就变） */
function withTargets(row) {
  const t = planTargetOf(row)
  return Object.assign(row, { reject: t.reject, challenge: t.challenge })
}

const wc = computed(() => planWeightCheck(form.items))
const qs = computed(() => wc.value.qs)
const ks = computed(() => wc.value.ks)
const canSubmit = computed(() => wc.value.ok && !dupPlan.value && form.items.length > 0)

/** 把 100% 重新平摊一遍。改乱了权重之后，从头分比一项项凑快 */
function evenWeights() {
  planEvenWeights(form.items)
  ElMessage.success('已按条目数平均分配，合计 100%')
}

const shortPath = l => String(l.orgPath || l.orgName).split(' / ').slice(-2).join(' / ')
const money = n => Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })

function beforeMonth(d) {
  return d < new Date(`${form.planMonth}-01T00:00:00`)
}

const monthEnd = m => {
  const [y, mm] = String(m || curMonth).split('-').map(Number)
  const d = new Date(y, mm, 0)
  return `${y}-${String(mm).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function refreshTaken() {
  const set = new Set()
  for (const l of leads.value) {
    const p = planOfMonth(form.planMonth, l.orgId)
    if (p && p.planId !== planId.value) set.add(l.orgId)
  }
  takenIds.value = set
}

function checkDup() {
  if (!form.orgId) { dupPlan.value = null; return }
  const p = planOfMonth(form.planMonth, form.orgId)
  dupPlan.value = p && p.planId !== planId.value ? p : null
}

function onMonthChange() {
  refreshTaken()
  checkDup()
  const end = monthEnd(form.planMonth)
  for (const it of form.items) if (!it._touched) it.dueDate = end
}

function onOrgChange() {
  checkDup()
  /* 换部门就换模板：不同岗位的考核项完全不同，保留旧条目等于拿错尺子量 */
  applyBundle()
}

/** 铺开模板：已有条目会被替换，所以只在新建或换模板时调 */
function applyBundle(tplId) {
  const b = planTplBundle(form.orgId, form.planMonth, tplId || '')
  form.tplId = b.tpl?.tplId || ''
  form.tplName = b.tpl?.name || ''
  form.tplVersion = b.tpl?.version || 0
  /* 换模板就是重新铺条目，权重由 planItemsFromTpl 平均预填 —— 旧权重跟新条目对不上，
     留着只会让人以为系统算错了 */
  form.items = b.items
}

function onTplChange(id) {
  const t = tplOpts.find(x => x.tplId === id)
  if (!t) return
  applyBundle(id)
  ElMessage.success(`已换成「${t.label}」，条目按新模板重铺`)
}

function onFile(row, file) {
  if (!row.files) row.files = []
  row.files.push({ name: file.name, size: file.size })
  ElMessage.success(`已附加「${file.name}」（原型只登记文件名）`)
}

onMounted(() => {
  const id = planIdentity()
  me.value = id
  if (!id.leadCount) return
  refreshTaken()

  if (isEdit.value) {
    const p = getDeptPlanDetail(planId.value)
    if (!p) { ElMessage.error('计划不存在'); router.replace('/f/plans'); return }
    if (!p.canEdit) {
      ElMessage.warning(`计划已「${p.status}」，不能再改考核项`)
      router.replace(`/f/plans/${p.planId}`)
      return
    }
    form.planMonth = p.planMonth
    form.orgId = p.orgId
    form.tplId = p.tplId
    form.tplName = p.tplName
    form.tplVersion = p.tplVersion
    form.summary = p.summary || ''
    form.items = p.items.map(t => ({ ...t, _touched: true }))
    checkDup()
    return
  }

  const primary = leads.value.find(l => l.isPrimary)
  const avail = leadOpts.value.find(l => !l.taken)
  form.orgId = primary && !takenIds.value.has(primary.orgId) ? primary.orgId : (avail?.orgId || '')
  checkDup()
  if (form.orgId) applyBundle()
})

function payload() {
  return {
    planMonth: form.planMonth,
    orgId: form.orgId,
    tplId: form.tplId,
    tplName: form.tplName,
    tplVersion: form.tplVersion,
    summary: form.summary,
    items: form.items.map(t => ({
      taskId: t.taskId, itemId: t.itemId, section: t.section, name: t.name,
      content: t.content, standard: t.standard, weight: t.weight, direction: t.direction,
      unit: t.unit, target: t.target, dueDate: t.dueDate, files: t.files || [],
      remark: t.remark, actual: t.actual, actualNote: t.actualNote,
      selfScore: t.selfScore, selfWeighted: t.selfWeighted,
      reviewScore: t.reviewScore, reviewWeighted: t.reviewWeighted
    }))
  }
}

async function save(draft) {
  if (!form.orgId) { ElMessage.warning('请选择提报部门'); return }
  if (!form.items.length) { ElMessage.warning('这个部门没有匹配到模板，请联系运营管理部'); return }
  if (!draft) {
    if (!wc.value.ok) { ElMessage.warning(`权重校验不通过：${wc.value.msg}`); return }
    const noTarget = sections.value.q.filter(t => t.target === '' || !Number.isFinite(Number(t.target)))
    if (noTarget.length) { ElMessage.warning(`量化指标要填目标值：${noTarget.map(t => t.name).join('、')}`); return }
    if (form.items.some(t => !t.dueDate)) { ElMessage.warning('每条都要填完成时间'); return }
    if (dupPlan.value) { ElMessage.warning('该部门本月已有计划，请打开已有计划修改'); return }
  }
  draft ? (saving.value = true) : (submitting.value = true)
  try {
    const p = saveDeptPlan(payload(), planId.value)
    if (draft) {
      ElMessage.success(`草稿已保存（${p.planId}）`)
      router.replace(`/f/plans/${p.planId}/edit`)
      return
    }
    const r = submitDeptPlan(p.planId, { tplId: form.tplId })
    const next = r.approval?.flow?.find(n => n.action === '待处理')
    ElMessage.success(`已提交审批，下一节点「${next?.node || '审核'}」（${next?.handler || '待指派'}）`)
    router.replace(`/f/plans/${p.planId}`)
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
    submitting.value = false
  }
}
</script>

<style scoped>
.ro { font-size: 13px; color: var(--biz-text-1); padding-top: 4px; }
.org-one { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
.org-one__path { font-size: 11.5px; color: var(--biz-text-3); }
.org-opt { display: flex; align-items: center; gap: 6px; }
.org-opt__n { font-weight: 500; }
.org-opt__p { font-size: 11px; color: var(--biz-text-3); flex: 1; overflow: hidden; text-overflow: ellipsis; }
.org-opt__x { font-size: 11px; color: var(--biz-danger, #e34d59); }
.lead-tip {
  margin: -10px 0 10px 96px; padding: 7px 10px; border-radius: 7px; font-size: 12px;
  background: var(--biz-bg-fill); color: var(--biz-text-2);
}
.dup-warn {
  display: flex; gap: 8px; align-items: flex-start; margin: 4px 0 0 96px; padding: 9px 12px;
  border-radius: 8px; font-size: 12.5px; line-height: 1.7;
  background: rgba(227, 77, 89, .08); color: var(--biz-text-1);
}
.dup-warn .el-icon { color: var(--biz-danger, #e34d59); margin-top: 2px; }
.sec__hd h4 .wq {
  font-size: 12px; font-weight: 500; color: var(--biz-text-3);
  background: var(--biz-bg-fill); border-radius: 4px; padding: 0 5px; margin-left: 4px;
}
.rule { font-size: 11.5px; color: var(--biz-text-3); }
.num { font-family: var(--biz-font-num); font-size: 12.5px; }
.sumline {
  margin-top: 8px; font-size: 12px; color: var(--biz-text-2);
  display: flex; gap: 6px; align-items: center;
}
.sumline b { font-family: var(--biz-font-num); }
.warn-txt { color: var(--biz-danger, #e34d59); }
.is-ok { color: var(--biz-success, #12b98a); }
.is-warn { color: var(--biz-warning, #d98a1f); }
.wbar { display: flex; align-items: center; gap: 10px; margin-top: 14px; font-size: 12.5px; }
.wbar__k { width: 64px; color: var(--biz-text-2); }
.wbar__track { flex: 1; height: 9px; border-radius: 5px; background: var(--biz-bg-fill); overflow: hidden; }
.wbar__fill { height: 100%; background: var(--biz-success, #12b98a); transition: width .25s; }
.wbar.is-warn .wbar__fill { background: var(--biz-warning, #d98a1f); }
.wbar__v { font-family: var(--biz-font-num); font-weight: 600; width: 78px; text-align: right; }
.wbar__m { color: var(--biz-text-3); }
.wbar.is-ok .wbar__m { color: var(--biz-success, #12b98a); }
.wbar.is-warn .wbar__m { color: var(--biz-warning, #d98a1f); }
.foot-bar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; padding: 12px 0 24px; }
</style>
