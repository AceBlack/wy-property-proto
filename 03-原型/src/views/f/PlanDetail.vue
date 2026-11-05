<template>
  <div class="page">
    <AsyncBlock :loading="loading" :error="error" :empty="!data" empty-title="计划不存在"
      empty-desc="可能已被删除，或链接里的计划编号有误">
      <template v-if="data">
        <div class="panel" style="margin-top:0;">
          <div class="hd">
            <div>
              <div class="hd__t">
                {{ data.orgName }}
                <el-tag size="small" effect="plain" type="info">{{ data.planMonth }}</el-tag>
                <el-tag size="small" effect="plain" :type="statusType(data.status)">{{ data.status }}</el-tag>
                <el-tag v-if="data.submitterOrgId !== data.orgId" size="small" effect="plain" type="warning">兼管提报</el-tag>
                <el-tag v-if="data.submitterDuty && data.submitterDuty !== '正职'" size="small" effect="plain" type="info">
                  {{ data.submitterDuty }}身份
                </el-tag>
              </div>
              <div class="hd__s">
                {{ data.planId }} · {{ data.orgPath }} · 在编 {{ data.headcount }} 人
              </div>
            </div>
            <div class="hd__r">
              <el-button :icon="'ArrowLeft'" @click="$router.push('/f/plans')">返回列表</el-button>
              <el-button v-if="data.canWithdraw" :icon="'RefreshLeft'" @click="doWithdraw">撤回</el-button>
              <el-button v-if="data.canEdit" :icon="'EditPen'" @click="$router.push(`/f/plans/${data.planId}/edit`)">编辑</el-button>
              <el-button v-if="data.canSubmit" type="primary" :icon="'Promotion'" :disabled="!data.weightOk" @click="doSubmit">
                提报审批
              </el-button>
              <el-button v-if="data.canProgress" type="success" :icon="'Checked'" @click="doResult">
                提交完成情况
              </el-button>
              <el-button v-if="data.canReview" type="warning" :icon="'Medal'" @click="openReview">
                复评并归档
              </el-button>
              <el-button v-if="canAudit && !auditMode" type="warning" :icon="'EditPen'" @click="startAudit">
                审核调整
              </el-button>
            </div>
          </div>

          <el-descriptions :column="4" border size="small" style="margin-top:14px;">
            <el-descriptions-item label="提报人">
              {{ data.submitterName }}（{{ data.submitterPosition }}）
            </el-descriptions-item>
            <el-descriptions-item label="考核模板">
              {{ data.tplName || '—' }}
              <span class="muted" v-if="data.tplVersion">v{{ data.tplVersion }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="权重">
              各项合计 {{ data.weightTotal }}%
              <span :class="data.weightOk ? 'ok' : 'warn'">（{{ data.weightOk ? '正好 100%' : '应为 100%' }}）</span>
              <span class="muted">· 量化 {{ data.weightQs }}% / 重点 {{ data.weightKs }}%</span>
            </el-descriptions-item>
            <el-descriptions-item label="审批单">
              <el-button v-if="data.approval" link type="primary" @click="$router.push(`/c/approval/${data.approval.approvalId}`)">
                {{ data.approval.approvalNo }}
              </el-button>
              <span v-else class="muted">未提交</span>
            </el-descriptions-item>
            <el-descriptions-item label="自评加权">{{ data.selfTotal }} / 5</el-descriptions-item>
            <el-descriptions-item label="复评加权">{{ data.reviewTotal }} / 5</el-descriptions-item>
            <el-descriptions-item label="月度总得分">
              <span v-if="data.status === '已结案'" class="money">{{ data.totalScore }} · {{ gradeLabel(data.grade) }}</span>
              <span v-else class="muted">复评完成后出分</span>
            </el-descriptions-item>
            <el-descriptions-item label="当前节点">{{ data.approval?.currentNode || '—' }}</el-descriptions-item>
          </el-descriptions>

          <div v-if="auditMode" class="audit-bar">
            <div class="audit-bar__h">
              <b>审核调整</b>：可以直接改考核项名称、量化目标值、监控评价标准，以及<b>每一项的权重</b>
              （只能按 5% 调），改完点「通过并下发」。
            </div>
            <div v-if="!auditWc.ok" class="audit-warn">
              当前各项权重合计 <b>{{ auditWc.total }}%</b> —— {{ auditWc.msg }}；不合规时「通过并下发」会被拦下。
            </div>
            <div v-else class="audit-warn is-ok">权重合计 {{ auditWc.total }}%，可以下发</div>
            <div v-if="auditDiff.length" class="audit-diff">
              <span class="audit-diff__n">已调整 {{ auditDiff.length }} 处：</span>
              <span v-for="(d, i) in auditDiff" :key="i" class="audit-diff__i">
                {{ d.item }}·{{ d.field }}
                <span class="muted">{{ d.before || '空' }}</span><span class="arrow">→</span><b>{{ d.after || '空' }}</b>
              </span>
            </div>
            <div v-else class="muted" style="font-size:12px;margin-top:4px;">还没改，可以直接通过</div>
          </div>
          <div v-if="data.status === '已驳回' && data.approveNote" class="reject-box">
            <b>驳回原因</b>（{{ data.approveBy }} · {{ data.approveAt }}）：{{ data.approveNote }}
          </div>
          <div v-if="data.summary" class="sum-box"><b>部门备注</b>：{{ data.summary }}</div>
          <div v-if="(data.reviseLog || []).length" class="revise-box">
            <div class="revise-box__h">运营管理部审核时调整了 {{ data.reviseLog.length }} 项</div>
            <div v-for="(r, i) in data.reviseLog" :key="i" class="revise-row">
              {{ r.item }} · {{ r.field }}：<span class="muted">{{ r.before || '空' }}</span>
              <span class="arrow">→</span><b>{{ r.after || '删除' }}</b>
              <span class="muted">（{{ r.by }} · {{ r.at }}）</span>
            </div>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd">
            <h4>一、量化指标 <span class="wq">权重 {{ data.weightQs }}%</span></h4>
            <span class="desc">自评 = 5 ×（实际 − 否决）/（挑战 − 否决），夹在 1–5</span>
            <span class="spacer" />
            <span v-if="data.canProgress" class="muted" style="font-size:12px;">填实际值，自评自动算</span>
          </div>
          <el-table :data="sec.q" size="small" style="width:100%;margin-top:10px;">
            <el-table-column label="#" width="40" align="center">
              <template #default="{ $index }"><span class="muted">{{ $index + 1 }}</span></template>
            </el-table-column>
            <el-table-column label="考核项" min-width="150">
              <template #default="{ row }">
                <el-input v-if="auditMode" v-model="row.name" size="small" :class="{ 'is-chg': changedName(row) }" />
                <template v-else>
                  {{ row.name }}
                  <el-tag v-if="row.direction === -1" size="small" effect="plain" type="warning">逆向</el-tag>
                </template>
              </template>
            </el-table-column>
            <el-table-column label="目标值" width="150" align="right">
              <template #default="{ row }">
                <el-input v-if="auditMode" v-model="row.target" size="small" :class="{ 'is-chg': changedTarget(row) }"
                  style="text-align:right;">
                  <template #append>{{ row.unit || '元' }}</template>
                </el-input>
                <span v-else class="num">{{ fmt(row.target) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="否决值" width="110" align="right">
              <template #default="{ row }"><span class="num muted">{{ fmt(targets[row.taskId]?.reject) }}</span></template>
            </el-table-column>
            <el-table-column label="挑战值" width="110" align="right">
              <template #default="{ row }"><span class="num muted">{{ fmt(targets[row.taskId]?.challenge) }}</span></template>
            </el-table-column>
            <el-table-column label="实际完成" width="140">
              <template #default="{ row }">
                <el-input v-if="data.canProgress" v-model="row.actual" size="small" placeholder="填数值"
                  @change="v => saveItem(row, { actual: v })">
                  <template #append>{{ row.unit || '元' }}</template>
                </el-input>
                <span v-else class="num">{{ row.actual === '' ? '—' : fmt(row.actual) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="完成时间" width="102" align="center">
              <template #default="{ row }">
                <span class="ps-sub">{{ row.dueDate || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="权重" width="104" align="center">
              <template #default="{ row }">
                <el-input-number v-if="auditMode" v-model="row.weight" :min="0" :max="100" :step="WEIGHT_STEP"
                  step-strictly :precision="0" size="small" controls-position="right" style="width:100%"
                  :class="{ 'is-chg': changedWeight(row) }" />
                <span v-else class="num">{{ row.weight }}%</span>
              </template>
            </el-table-column>
            <el-table-column label="自评" width="72" align="right">
              <template #default="{ row }"><span class="money">{{ row.selfScore || '—' }}</span></template>
            </el-table-column>
            <el-table-column label="自评加权" width="84" align="right">
              <template #default="{ row }"><span class="money">{{ row.selfWeighted || '—' }}</span></template>
            </el-table-column>
            <el-table-column label="复评" width="72" align="right">
              <template #default="{ row }"><span class="money">{{ row.reviewScore || '—' }}</span></template>
            </el-table-column>
            <!-- 复评加权是「总分怎么来的」的最后一块拼图：缺了这一列，
                 复评合计就只有一个数，评审会上被问「这 0.19 是怎么加的」没法当场答 -->
            <el-table-column label="复评加权" width="84" align="right">
              <template #default="{ row }"><span class="money">{{ reviewWeighted(row) || '—' }}</span></template>
            </el-table-column>
          </el-table>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd">
            <h4>二、监控指标 <span class="wq">权重 0%</span></h4>
            <span class="desc">权重为 0，只扣分；扣多少由人判断，系统不做上限校验</span>
          </div>
          <el-table :data="sec.m" size="small" style="width:100%;margin-top:10px;">
            <el-table-column label="#" width="40" align="center">
              <template #default="{ $index }"><span class="muted">{{ $index + 1 }}</span></template>
            </el-table-column>
            <el-table-column label="考核项" width="170">
              <template #default="{ row }">
                <el-input v-if="auditMode" v-model="row.name" size="small" :class="{ 'is-chg': changedName(row) }" />
                <span v-else>{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column label="评价标准" min-width="260">
              <template #default="{ row }">
                <el-input v-if="auditMode" v-model="row.standard" size="small" type="textarea" :rows="1" autosize
                  :class="{ 'is-chg': changedStandard(row) }" />
                <span v-else class="muted">{{ row.standard }}</span>
              </template>
            </el-table-column>
            <el-table-column label="完成情况" min-width="180">
              <template #default="{ row }">
                <el-input v-if="data.canProgress" v-model="row.actual" size="small" placeholder="如：无 / 发生 1 起"
                  @change="v => saveItem(row, { actual: v })" />
                <span v-else>{{ row.actual || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="自评扣分" width="104">
              <template #default="{ row }">
                <el-input-number v-if="data.canProgress" v-model="row.selfWeighted" :step="0.05" :precision="2"
                  size="small" controls-position="right" style="width:100%"
                  @change="v => saveItem(row, { selfWeighted: v })" />
                <span v-else class="money neg">{{ row.selfWeighted }}</span>
              </template>
            </el-table-column>
            <el-table-column label="复评扣分" width="104">
              <template #default="{ row }">
                <el-input-number v-if="data.canReview" v-model="row.reviewWeighted" :step="0.05" :precision="2"
                  size="small" controls-position="right" style="width:100%" />
                <span v-else class="money neg">{{ row.reviewWeighted || '—' }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd">
            <h4>三、重点工作计划 <span class="wq">权重 {{ data.weightKs }}%</span></h4>
            <span class="desc">自评按评分表对照完成质量与完成时间，打 1–5 分</span>
          </div>
          <el-table :data="sec.k" size="small" style="width:100%;margin-top:10px;">
            <el-table-column label="#" width="40" align="center">
              <template #default="{ $index }"><span class="muted">{{ $index + 1 }}</span></template>
            </el-table-column>
            <el-table-column label="考核项" width="200">
              <template #default="{ row }">
                <el-input v-if="auditMode" v-model="row.name" size="small" :class="{ 'is-chg': changedName(row) }" />
                <span v-else>{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column label="计划 / 完成标准" min-width="260">
              <template #default="{ row }">
                <div class="ps-sub" v-if="row.content">{{ row.content }}</div>
                <div class="muted" style="font-size:11.5px;">{{ row.standard || '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="实际完成" min-width="170">
              <template #default="{ row }">
                <el-input v-if="data.canProgress" v-model="row.actual" type="textarea" :rows="2" maxlength="300"
                  placeholder="写清完成了什么" @change="v => saveItem(row, { actual: v })" />
                <span v-else style="font-size:12px;">{{ row.actual || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="权重" width="104" align="center">
              <template #default="{ row }">
                <el-input-number v-if="auditMode" v-model="row.weight" :min="0" :max="100" :step="WEIGHT_STEP"
                  step-strictly :precision="0" size="small" controls-position="right" style="width:100%"
                  :class="{ 'is-chg': changedWeight(row) }" />
                <span v-else class="num">{{ row.weight }}%</span>
              </template>
            </el-table-column>
            <el-table-column label="自评" width="92">
              <template #default="{ row }">
                <el-input-number v-if="data.canProgress" v-model="row.selfScore" :min="1" :max="5" :step="0.5"
                  size="small" controls-position="right" style="width:100%"
                  @change="v => saveItem(row, { selfScore: v })" />
                <span v-else class="money">{{ row.selfScore || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="自评加权" width="84" align="right">
              <template #default="{ row }"><span class="money">{{ row.selfWeighted || '—' }}</span></template>
            </el-table-column>
            <el-table-column label="复评" width="92">
              <template #default="{ row }">
                <el-input-number v-if="data.canReview" v-model="row.reviewScore" :min="1" :max="5" :step="0.5"
                  size="small" controls-position="right" style="width:100%" />
                <span v-else class="money">{{ row.reviewScore || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="复评加权" width="80" align="right">
              <template #default="{ row }">
                <span class="money">{{ reviewWeighted(row) || '—' }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div v-if="auditMode" class="audit-foot">
          <span class="muted" style="font-size:12px;">
            通过后进入执行，调整记录会写进操作轨迹，之后能查到改了什么。
          </span>
          <span style="flex:1;" />
          <el-button @click="cancelAudit">取消</el-button>
          <el-button :loading="auditing" @click="saveAudit">保存调整</el-button>
          <el-button type="primary" :loading="approving" @click="approvePlan">通过并下发</el-button>
        </div>

        <div class="totals">
          <div class="tot">
            <div class="tot__k">自评加权合计</div>
            <div class="tot__v">{{ data.selfTotal }}</div>
            <div class="tot__s">× 20%</div>
          </div>
          <div class="tot">
            <div class="tot__k">复评加权合计</div>
            <div class="tot__v">{{ data.reviewTotal }}</div>
            <div class="tot__s">× 80%</div>
          </div>
          <div class="tot is-main">
            <div class="tot__k">月度总得分</div>
            <div class="tot__v">{{ data.status === '已结案' ? data.totalScore : '—' }}</div>
            <div class="tot__s">
              {{ data.status === '已结案' ? gradeLabel(data.grade) : '复评归档后出分' }}
            </div>
          </div>
        </div>

        <div class="grid" style="margin-top:16px;grid-template-columns:1.1fr 1fr;">
          <div class="panel">
            <div class="sec__hd"><h4>审批流程</h4><span class="desc">审核通过后计划才能进入执行</span></div>
            <el-timeline v-if="data.approval" style="margin-top:14px;padding-left:4px;">
              <el-timeline-item v-for="(n, i) in data.approval.flow" :key="i"
                :type="n.action === '同意' ? 'success' : (n.action === '驳回' ? 'danger' : 'primary')"
                :hollow="n.action === '待处理'"
                :timestamp="n.time || '待处理'">
                <div style="font-size:13.5px;">
                  <b>{{ n.node }}</b>
                  <span v-if="n.action !== '待处理'" class="muted"> · {{ n.action }}</span>
                  <span v-else class="muted"> · 待处理</span>
                </div>
                <div class="muted" style="font-size:12.5px;margin-top:2px;">
                  {{ n.handler || '待指派' }}<span v-if="n.comment"> · {{ n.comment }}</span>
                </div>
                <div v-if="n.skipNote" class="skip">{{ n.skipNote }}</div>
              </el-timeline-item>
            </el-timeline>
            <EmptyState v-else type="empty" desc="还没提交审批" />
            <div class="muted" style="font-size:11.5px;padding-top:8px;">
              审核阶段运营管理部可以直接改指标与计划（不走驳回），改动会记在上面；
              改完直接下发进执行。
            </div>
          </div>

          <div class="panel">
            <div class="sec__hd"><h4>操作轨迹</h4><span class="desc">{{ data.logs.length }} 条 · 原型为内存态，刷新还原</span></div>
            <el-timeline style="margin-top:14px;padding-left:4px;">
              <el-timeline-item v-for="(l, i) in data.logs" :key="i" :timestamp="l.at"
                :type="logType(l.action)" :hollow="i !== 0">
                <div style="font-size:13.5px;"><b>{{ l.action }}</b> <span class="muted">· {{ l.by }}</span></div>
                <div v-if="l.note" class="muted" style="font-size:12.5px;margin-top:2px;">{{ l.note }}</div>
              </el-timeline-item>
            </el-timeline>
          </div>
        </div>

        <div v-if="data.status === '已结案'" class="panel" style="margin-top:16px;">
          <div class="sec__hd">
            <h4>复评结果</h4>
            <span class="desc">{{ data.evalBy }} · {{ data.evalAt }}</span>
          </div>
          <div class="score-bar">
            <div class="score-bar__v">{{ data.totalScore }}<span class="unit">分</span></div>
            <div>
              <div class="score-bar__g">{{ gradeLabel(data.grade) }}</div>
              <div class="muted" style="font-size:12px;">
                自评 {{ data.selfTotal }} × 20% + 复评 {{ data.reviewTotal }} × 80%
              </div>
            </div>
            <span class="spacer" />
            <div class="score-bar__n">完成率 {{ data.finishRate }}%</div>
          </div>
          <div class="perf-note">
            <b>本期只记录得分，不接入工资核算</b>：月度总得分 → 部门绩效工资系数的换算规则尚未定义。
            评分与品质评价是两张独立的表，不合并、不互相折算。
          </div>
        </div>

        <el-dialog v-model="reviewVisible" title="复评并归档" width="900px">
          <div class="muted" style="font-size:12.5px;margin-bottom:10px;">
            逐项打 1–5 分（监控指标填扣分）。提交后计划归档，不能再改。
            总分 = 自评加权合计 × 20% + 复评加权合计 × 80%。
          </div>
          <el-table :data="reviewRows" size="small" max-height="360">
            <el-table-column prop="name" label="考核项" min-width="200" />
            <el-table-column label="权重" width="64" align="right">
              <template #default="{ row }">{{ row.weight }}%</template>
            </el-table-column>
            <el-table-column label="自评" width="70" align="right">
              <template #default="{ row }">{{ row.section === 'm' ? row.selfWeighted : row.selfScore }}</template>
            </el-table-column>
            <el-table-column label="复评" width="130">
              <template #default="{ row }">
                <el-input-number v-if="row.section === 'm'" v-model="reviewForm.deductions[row.taskId]"
                  :step="0.05" :precision="2" size="small" controls-position="right" style="width:100%" />
                <el-input-number v-else v-model="reviewForm.scores[row.taskId]" :min="1" :max="5" :step="0.5"
                  size="small" controls-position="right" style="width:100%" />
              </template>
            </el-table-column>
          </el-table>
          <div class="eval-sum">
            复评合计 <b>{{ reviewPreview }}</b>
            <span class="muted">· 预计总得分 {{ previewTotal }}</span>
            <span v-if="missingReview" class="warn">（还有 {{ missingReview }} 项未打分）</span>
          </div>
          <el-input v-model="reviewForm.summary" type="textarea" :rows="2" maxlength="120" show-word-limit
            placeholder="整体评价（选填），如：收费任务超额完成，培训任务因人员流动未完成" style="margin-top:10px;" />
          <template #footer>
            <el-button @click="reviewVisible = false">取消</el-button>
            <el-button type="primary" :disabled="!!missingReview" :loading="reviewing" @click="doReview">确认归档</el-button>
          </template>
        </el-dialog>
      </template>
    </AsyncBlock>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PLAN_WEIGHT_STEP, approvePlanToRun, closeDeptPlan, getDeptPlanDetail, planGradeOf, planTargetOf,
  planWeightCheck, revisePlanItems, savePlanProgress, submitDeptPlan, submitPlanResult, withdrawDeptPlan
} from '@/api'
import { hasPerm } from '@/utils/auth'
import AsyncBlock from '@/components/AsyncBlock.vue'
import EmptyState from '@/components/EmptyState.vue'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id || '')

const data = ref(null)
const loading = ref(true)
const error = ref('')

/** 审核调整模式：只有「审批中」且有 eval 权限才开 */
const auditMode = ref(false)
const auditOrig = ref([])
const auditing = ref(false)
const approving = ref(false)
const canAudit = computed(() => data.value?.status === '审批中' && hasPerm('f.plans.eval'))
/** 权重只能按 5% 调（口径在数据层，这里只取来给输入框用） */
const WEIGHT_STEP = PLAN_WEIGHT_STEP

/** 权重实时校验：审核时改了权重，页面上要马上看到合计变成多少 —— 等保存后才变会让人以为没生效 */
const auditWc = computed(() => planWeightCheck(data.value?.items || []))

/** 改动逐项对比：审核人要能看到自己改了哪几处，避免改完忘了 */
const auditDiff = computed(() => {
  if (!auditMode.value) return []
  const out = []
  for (const it of (data.value?.items || [])) {
    const o = auditOrig.value.find(x => x.taskId === it.taskId)
    if (!o) continue
    if (o.name !== it.name) out.push({ item: o.name, field: '名称', before: o.name, after: it.name })
    if (it.section === 'q' && String(o.target) !== String(it.target)) {
      out.push({ item: it.name, field: '目标值', before: o.target, after: it.target })
    }
    if ((o.standard || '') !== (it.standard || '')) {
      out.push({ item: it.name, field: '评价标准', before: o.standard, after: it.standard })
    }
    if (it.section !== 'm' && Number(o.weight) !== Number(it.weight)) {
      out.push({ item: it.name, field: '权重', before: `${o.weight}%`, after: `${it.weight}%` })
    }
  }
  return out
})

const origOf = row => auditOrig.value.find(x => x.taskId === row.taskId) || {}
const changedName = row => !!auditOrig.value.length && origOf(row).name !== row.name
const changedTarget = row => !!auditOrig.value.length && String(origOf(row).target) !== String(row.target)
const changedStandard = row => !!auditOrig.value.length && (origOf(row).standard || '') !== (row.standard || '')
const changedWeight = row => !!auditOrig.value.length && Number(origOf(row).weight) !== Number(row.weight)

function startAudit() {
  auditOrig.value = JSON.parse(JSON.stringify(data.value.items))
  auditMode.value = true
}

function cancelAudit() {
  auditMode.value = false
  auditOrig.value = []
  load()
}

async function saveAudit() {
  auditing.value = true
  try {
    const r = revisePlanItems(id.value, data.value.items)
    data.value = r
    auditOrig.value = JSON.parse(JSON.stringify(r.items))
    ElMessage.success(`已保存调整${(r.reviseLog || []).length ? `（累计 ${r.reviseLog.length} 处）` : ''}`)
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    auditing.value = false
  }
}

async function approvePlan() {
  try {
    await ElMessageBox.confirm(
      auditDiff.value.length
        ? `本次调整了 ${auditDiff.value.length} 处，通过后进入执行，调整记录会留在操作轨迹里。确定下发？`
        : '没有调整，直接通过并下发到执行阶段？',
      '通过并下发', { type: 'warning', confirmButtonText: '下发', cancelButtonText: '再看看' }
    )
  } catch { return }
  approving.value = true
  try {
    const r = approvePlanToRun(id.value, { comment: auditDiff.value.length ? `审核调整 ${auditDiff.value.length} 处后下发` : '' })
    data.value = r
    auditMode.value = false
    auditOrig.value = []
    ElMessage.success('已下发，进入执行阶段')
  } catch (e) {
    ElMessage.error(e?.message || '下发失败')
  } finally {
    approving.value = false
  }
}

const reviewVisible = ref(false)
const reviewing = ref(false)
const reviewForm = reactive({ scores: {}, deductions: {}, summary: '' })

const sec = computed(() => {
  const items = data.value?.items || []
  return {
    q: items.filter(i => i.section === 'q'),
    m: items.filter(i => i.section === 'm'),
    k: items.filter(i => i.section === 'k')
  }
})

/** 否决/挑战是派生值，不落库（目标一改就变） */
const targets = computed(() => {
  const out = {}
  for (const it of (data.value?.items || [])) {
    if (it.section === 'q') out[it.taskId] = planTargetOf(it)
  }
  return out
})

const reviewRows = computed(() => data.value?.items || [])
const missingReview = computed(() =>
  (data.value?.items || []).filter(i => i.section !== 'm' && !reviewForm.scores[i.taskId]).length)

const reviewPreview = computed(() => {
  const items = data.value?.items || []
  let sum = 0
  for (const it of items) {
    if (it.section === 'm') sum += Number(reviewForm.deductions[it.taskId]) || 0
    else sum += (Number(reviewForm.scores[it.taskId]) || 0) * (Number(it.weight) || 0) / 100
  }
  return Math.round(sum * 100) / 100
})
const previewTotal = computed(() => {
  const s = Number(data.value?.selfTotal) || 0
  return Math.round((s * 0.2 + reviewPreview.value * 0.8) * 100) / 100
})

const fmt = n => (n === '' || n == null || !Number.isFinite(Number(n)))
  ? '—'
  : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const gradeLabel = g => ({ A: '优秀', B: '良好', C: '合格', D: '待改进' }[g] || '未评级')
const statusType = s => ({
  草稿: 'info', 审批中: 'warning', 已批准: 'primary', 已驳回: 'danger',
  执行中: 'success', 待复评: 'warning', 已结案: ''
}[s] || '')
const logType = a => (a === '复评完成' ? 'success' : (a === '审批驳回' ? 'danger' : (a === '审核修改' ? 'warning' : 'primary')))

/** 复评加权：页面临时算一下用于预览，归档后由服务端算并落库 */
function reviewWeighted(row) {
  if (row.section === 'm') return Number(row.reviewWeighted) || 0
  return Math.round((Number(row.reviewWeighted) || 0) * 100) / 100
}

function load() {
  loading.value = true
  try {
    const p = getDeptPlanDetail(id.value)
    if (!p) { error.value = '计划不存在'; data.value = null; return }
    data.value = p
    error.value = ''
  } catch (e) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function saveItem(row, patch) {
  try {
    const r = savePlanProgress(id.value, row.taskId, patch)
    data.value = r
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
    load()
  }
}

async function doSubmit() {
  try {
    await ElMessageBox.confirm(
      '提交后进入审批，审批期间不能修改考核项。确定提交？', '提报审批',
      { type: 'warning', confirmButtonText: '提交', cancelButtonText: '再检查一下' }
    )
  } catch { return }
  try {
    const r = submitDeptPlan(id.value)
    const next = r.approval?.flow?.find(n => n.action === '待处理')
    ElMessage.success(`已提交，下一节点「${next?.node || '审核'}」`)
    load()
  } catch (e) {
    ElMessage.error(e?.message || '提交失败')
  }
}

async function doWithdraw() {
  try {
    await ElMessageBox.confirm('撤回后退回草稿，可继续修改考核项。确定撤回？', '撤回',
      { type: 'warning', confirmButtonText: '撤回', cancelButtonText: '取消' })
  } catch { return }
  try {
    withdrawDeptPlan(id.value)
    ElMessage.success('已撤回，回到草稿')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '撤回失败')
  }
}

async function doResult() {
  try {
    await ElMessageBox.confirm(
      '提交后进入复评，填报内容不能再改。确定提交完成情况？', '提交完成情况',
      { type: 'warning', confirmButtonText: '提交', cancelButtonText: '再检查一下' }
    )
  } catch { return }
  try {
    submitPlanResult(id.value)
    ElMessage.success('已提交，等待运营管理部复评')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '提交失败')
  }
}

function openReview() {
  reviewForm.scores = {}
  reviewForm.deductions = {}
  reviewForm.summary = ''
  for (const it of (data.value?.items || [])) {
    if (it.section === 'm') {
      reviewForm.deductions[it.taskId] = Number(it.selfWeighted) || 0
    } else {
      reviewForm.scores[it.taskId] = Number(it.selfScore) || 3
    }
  }
  reviewVisible.value = true
}

async function doReview() {
  reviewing.value = true
  try {
    const r = closeDeptPlan(id.value, {
      scores: { ...reviewForm.scores },
      deductions: { ...reviewForm.deductions },
      summary: reviewForm.summary
    })
    reviewVisible.value = false
    data.value = r
    ElMessage.success(`已归档，月度总得分 ${r.totalScore}（${gradeLabel(r.grade)}）`)
  } catch (e) {
    ElMessage.error(e?.message || '复评失败')
  } finally {
    reviewing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.hd__t { font-size: 17px; font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hd__s { margin-top: 5px; font-size: 12px; color: var(--biz-text-3); }
.hd__r { display: flex; gap: 8px; flex-wrap: wrap; }
.reject-box {
  margin-top: 12px; padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.7;
  background: rgba(227, 77, 89, .08); color: var(--biz-text-1);
}
.sum-box {
  margin-top: 10px; padding: 9px 12px; border-radius: 8px; font-size: 12.5px;
  background: var(--biz-bg-fill); color: var(--biz-text-2);
}
.revise-box {
  margin-top: 10px; padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.9;
  background: rgba(217, 138, 31, .1); border: 1px solid rgba(217, 138, 31, .4);
}
.revise-box__h { font-weight: 600; color: var(--biz-warning, #d98a1f); margin-bottom: 2px; }
.revise-row .arrow { margin: 0 6px; color: var(--biz-text-3); }
.sec__hd h4 .wq {
  font-size: 12px; font-weight: 500; color: var(--biz-text-3);
  background: var(--biz-bg-fill); border-radius: 4px; padding: 0 5px; margin-left: 4px;
}
.num { font-family: var(--biz-font-num); font-size: 12.5px; }
.money { font-family: var(--biz-font-num); font-weight: 600; font-size: 13px; }
.money.neg { color: var(--biz-danger, #e34d59); }
.ps-sub { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; }
.ok { color: var(--biz-success, #12b98a); }
.warn { color: var(--biz-danger, #e34d59); }
.totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
.tot { background: var(--biz-bg-fill); border-radius: 10px; padding: 12px 14px; }
.tot.is-main { background: var(--biz-primary-bg, rgba(91, 108, 255, .1)); }
.tot__k { font-size: 12px; color: var(--biz-text-2); }
.tot__v { font-size: 24px; font-weight: 600; font-family: var(--biz-font-num); margin-top: 2px; }
.tot.is-main .tot__v { color: var(--biz-primary, #5b6cff); }
.tot__s { font-size: 11.5px; color: var(--biz-text-3); }
.score-bar {
  display: flex; align-items: center; gap: 16px; margin-top: 12px;
  padding: 14px 16px; border-radius: 10px; background: var(--biz-bg-fill);
}
.score-bar__v { font-size: 32px; font-weight: 600; font-family: var(--biz-font-num); color: var(--biz-primary, #5b6cff); }
.score-bar__v .unit { font-size: 13px; color: var(--biz-text-3); margin-left: 2px; }
.score-bar__g { font-size: 14px; font-weight: 600; }
.score-bar__n { font-size: 12px; color: var(--biz-text-2); }
.perf-note {
  margin-top: 12px; padding: 8px 11px; border-radius: 7px; font-size: 11.5px; line-height: 1.7;
  background: var(--biz-bg-fill); color: var(--biz-text-3);
}
.eval-sum { margin-top: 10px; font-size: 12.5px; }
.eval-sum b { font-family: var(--biz-font-num); font-size: 15px; color: var(--biz-primary, #5b6cff); }
.skip { margin-top: 3px; font-size: 11.5px; color: var(--biz-warning, #d98a1f); }
.audit-bar {
  margin-top: 12px; padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.7;
  background: rgba(217, 138, 31, .1); border: 1px solid rgba(217, 138, 31, .45);
}
.audit-bar__h { color: var(--biz-text-1); }
.audit-warn {
  margin-top: 6px; font-size: 12px; color: var(--biz-danger, #e34d59);
}
.audit-warn.is-ok { color: var(--biz-success, #12b98a); }
.audit-warn b { font-family: var(--biz-font-num); }
.audit-diff { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; }
.audit-diff__n { font-weight: 600; color: var(--biz-warning, #d98a1f); }
.audit-diff__i { font-size: 12px; color: var(--biz-text-2); }
.audit-diff .arrow { margin: 0 4px; color: var(--biz-text-3); }
.audit-foot {
  display: flex; align-items: center; gap: 8px; margin-top: 14px;
  padding: 10px 12px; border-radius: 8px; background: rgba(217, 138, 31, .1);
}
:deep(.is-chg .el-input__wrapper),
:deep(.is-chg.el-textarea .el-textarea__inner) {
  background: rgba(239, 159, 39, .16);
  box-shadow: inset 0 0 0 1px rgba(239, 159, 39, .5);
}
</style>
