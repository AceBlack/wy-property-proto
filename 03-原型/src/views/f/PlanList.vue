<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>部门计划 · 一个部门一个月一份</b>：考核项由<b>模板带出</b>（项目经理 + 四个班组各一套），
        填报人不编条目，只填<b>目标值、完成情况和各项权重</b> —— 权重是提报时自己分的，模板里没有。
        <br />
        <b>权重合计必须正好 100%</b>：大于或小于都提交不了，列表里可以直接看到每份计划的合计对不对。
        <br />
        <b>流程</b>：提报 → 运营管理部审核下发（可直接改指标与权重，改动留痕）→ 执行 →
        月底报完成情况 → 复评归档。<b>复评必须等填报人提交完成情况之后</b>，状态卡住，不靠人自觉。
        <br />
        <b>算分</b>：量化按「目标 ±5%」换算成 1–5 分，自评加权 = 自评分 × 权重%；
        <b>月度总得分 = 自评加权合计 × 20% + 复评加权合计 × 80%</b>。
        评分与品质评价完全独立，<b>本期只记录、不接入工资核算</b>。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel dstat">
        <div class="dstat__k">{{ month }} 计划</div>
        <div class="dstat__v">{{ st.planCount }}<span class="unit">份</span></div>
        <div class="dstat__s">{{ st.taskCount }} 项考核 · 已归档 {{ st.closedCount }} 份</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">在途</div>
        <div class="dstat__v">{{ st.pendingCount }}<span class="unit">份</span></div>
        <div class="dstat__s">草稿 {{ st.draftCount }} · 待复评 {{ st.pendingReview }} · 被驳回 {{ st.rejectedCount }}</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">平均完成率</div>
        <div class="dstat__v">{{ st.avgFinish }}<span class="unit">%</span></div>
        <div class="dstat__s">按自评加权折算 · 延期 {{ st.lateTasks }} 项</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">平均得分</div>
        <div class="dstat__v">{{ st.avgScore || '—' }}<span class="unit">/ 5</span></div>
        <div class="dstat__s">只算已归档的 {{ st.closedCount }} 份 · 未接入工资</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-select v-model="query.planMonth" style="width:132px" @change="reload">
          <el-option v-for="m in months" :key="m" :label="`${m}${m === curMonth ? '（本月）' : ''}`" :value="m" />
        </el-select>
        <el-select v-model="query.projectId" placeholder="全部项目" clearable style="width:150px" @change="reload">
          <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-select v-model="query.status" placeholder="全部状态" clearable style="width:118px" @change="reload">
          <el-option v-for="s in PLAN_STATUS" :key="s" :label="s" :value="s" />
        </el-select>
        <el-input v-model="query.kw" placeholder="搜部门 / 提报人 / 任务" clearable style="width:210px"
          :prefix-icon="'Search'" @keyup.enter="reload" @clear="reload" />
        <el-button @click="reload">查询</el-button>
        <span class="spacer" />
        <el-button type="primary" :icon="'Plus'" @click="openCreate">提报计划</el-button>
      </div>

      <div class="id-bar">
        <span class="id-bar__who">
          当前身份：<b>{{ me.name }}</b> · {{ me.position }} · 角色 {{ me.roleName }}
        </span>
        <span v-if="me.leadCount" class="id-bar__lead">
          负责 <b>{{ me.leadCount }}</b> 个部门：
          <el-tag v-for="l in me.leads" :key="l.orgId" size="small" effect="plain"
            :type="l.isPrimary ? 'primary' : 'info'" style="margin-right:6px;">
            {{ shortPath(l) }}<span class="duty"> · {{ l.duty }}{{ l.duty === '代理' && l.endDate ? '至 ' + l.endDate : '' }}{{ !l.isPrimary ? '，兼管' : '' }}</span>
          </el-tag>
        </span>
        <span v-else class="id-bar__none">
          你没有负责任何部门，无法提报计划 —— 计划由部门负责人提报；如果你是部门负责人但这里为空，
          请先到组织架构里把你设为该部门负责人。
        </span>
      </div>

      <el-table :data="rows" size="small" style="width:100%" row-key="planId"
        @row-click="row => $router.push(`/f/plans/${row.planId}`)">
        <el-table-column label="计划" min-width="250">
          <template #default="{ row }">
            <div class="pl-t">
              <span class="pl-t__n">{{ row.orgName }}</span>
              <el-tag size="small" effect="plain" type="info">{{ row.planMonth }}</el-tag>
              <el-tag v-if="row.submitterOrgId !== row.orgId" size="small" effect="plain" type="warning">兼管提报</el-tag>
              <el-tag v-if="row.submitterDuty && row.submitterDuty !== '正职'" size="small" effect="plain" type="info">
                {{ row.submitterDuty }}身份
              </el-tag>
            </div>
            <div class="ps-sub">{{ row.orgPath }} · {{ row.planId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="提报人" width="132">
          <template #default="{ row }">
            <div>{{ row.submitterName }}</div>
            <div class="ps-sub">{{ row.submitterPosition }}</div>
          </template>
        </el-table-column>
        <el-table-column label="考核项" width="118" align="right">
          <template #default="{ row }">
            <div>{{ row.taskCount }} 项</div>
            <div class="ps-sub">计分 {{ row.qCount + row.kCount }} · 监控 {{ row.mCount }}</div>
          </template>
        </el-table-column>
        <el-table-column label="权重合计" width="104" align="right">
          <template #default="{ row }">
            <span class="wsum" :class="row.weightOk ? 'is-ok' : 'is-warn'">{{ row.weightTotal }}%</span>
            <div class="ps-sub" :class="row.weightOk ? '' : 'is-warn'">{{ weightNote(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="执行情况" width="150">
          <template #default="{ row }">
            <el-progress :percentage="row.finishRate" :stroke-width="6"
              :status="row.finishRate >= 100 ? 'success' : (row.lateCount ? 'warning' : '')" />
            <div class="ps-sub">已填 {{ row.doneCount }}/{{ row.taskCount }}<span v-if="row.lateCount"> · 延期 {{ row.lateCount }}</span></div>
          </template>
        </el-table-column>
        <el-table-column label="评分" width="88" align="right">
          <template #default="{ row }">
            <template v-if="row.score">
              <div class="money">{{ row.score }}</div>
              <div class="ps-sub">{{ gradeLabel(row.grade) }}</div>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="92">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="statusType(row.status)">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="132" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="$router.push(`/f/plans/${row.planId}`)">查看</el-button>
            <el-button v-if="row.canEdit" link type="primary" :disabled="!canEdit"
              @click.stop="$router.push(`/f/plans/${row.planId}/edit`)">编辑</el-button>
            <el-button v-if="row.canProgress" link type="success"
              @click.stop="$router.push(`/f/plans/${row.planId}`)">报完成</el-button>
            <el-button v-if="row.canReview" link type="warning"
              @click.stop="$router.push(`/f/plans/${row.planId}`)">复评</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="search" desc="这个月还没有符合条件的计划" />
        </template>
      </el-table>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1.4fr 1fr;">
      <div class="panel">
        <div class="sec__hd"><h4>按项目部门</h4><span class="desc">计划数 · 完成率 · 平均评分（只算已结案）</span></div>
        <el-table :data="st.byOrg" size="small" style="width:100%">
          <el-table-column prop="name" label="部门" min-width="120" />
          <el-table-column prop="plans" label="计划" width="60" align="right" />
          <el-table-column prop="tasks" label="任务" width="60" align="right" />
          <el-table-column label="完成率" width="88" align="right">
            <template #default="{ row }">{{ row.avgFinish }}%</template>
          </el-table-column>
          <el-table-column label="平均评分" width="92" align="right">
            <template #default="{ row }">
              <span v-if="row.avgScore" class="money">{{ row.avgScore }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="延期" width="60" align="right">
            <template #default="{ row }">
              <span :class="row.lateTasks ? 'is-warn' : 'muted'">{{ row.lateTasks || 0 }}</span>
            </template>
          </el-table-column>
          <template #empty><EmptyState type="empty" desc="本月暂无计划" /></template>
        </el-table>
      </div>

      <div class="panel">
        <div class="sec__hd"><h4>按执行情况</h4><span class="desc">{{ st.taskCount }} 项考核</span></div>
        <div class="bar-list">
          <div v-for="e in st.byExec" :key="e.status" class="bar">
            <span class="bar__k">{{ e.status }}</span>
            <div class="bar__track">
              <div class="bar__fill" :class="`is-${e.status}`"
                :style="{ width: pct(e.count, st.taskCount) + '%' }" />
            </div>
            <span class="bar__v">{{ e.count }}<span class="muted"> · {{ pct(e.count, st.taskCount) }}%</span></span>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>按评分分布</h4><span class="desc">已结案 {{ st.closedCount }} 份</span></div>
        <div class="bar-list">
          <div v-for="g in st.byGrade" :key="g.grade" class="bar">
            <span class="bar__k">{{ g.grade }} {{ g.label }}</span>
            <div class="bar__track">
              <div class="bar__fill" :class="`is-grade-${g.grade}`"
                :style="{ width: pct(g.count, st.closedCount) + '%' }" />
            </div>
            <span class="bar__v">{{ g.count }}</span>
          </div>
        </div>
        <div class="perf-note">
          评分档位（5 分制）：A ≥ 4.5 优秀 / B ≥ 3.75 良好 / C ≥ 3.0 合格 / D &lt; 3.0 待改进。
          <b>本期只记录，未接入工资核算</b>。
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PLAN_STATUS, canEditDeptPlans, deptPlanStats, planCurrentMonth, planIdentity,
  planMonthOpts, planProjectOpts, queryDeptPlans
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'

const router = useRouter()
const months = planMonthOpts()
const curMonth = planCurrentMonth()
const me = ref({ name: '', position: '', roleName: '', leadCount: 0, leads: [] })
const canEdit = computed(() => canEditDeptPlans())
const projects = planProjectOpts()

const rows = ref([])
const st = ref({
  planCount: 0, taskCount: 0, closedCount: 0, pendingCount: 0, draftCount: 0,
  rejectedCount: 0, avgScore: 0, avgFinish: 0, lateTasks: 0,
  byOrg: [], byExec: [], byGrade: []
})
const query = reactive({ planMonth: curMonth, projectId: '', status: '', kw: '' })

/** 组织路径取末两段：管两个同名班组的人要能分清是哪个项目的 */
const shortPath = l => String(l.orgPath || l.orgName).split(' / ').slice(-2).join(' / ')
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)
const month = computed(() => query.planMonth || '全部月份')
/**
 * 权重那一列的副行。三种情况要分开：
 *   ① 合规 → 正好 100%
 *   ② 合计不对 → 还差 / 超出多少
 *   ③ 合计 100 但有项不是 5 的倍数 → 不能说"超出 0%"，那是看不懂的话
 * 第三种只有接口直调才造得出来（页面输入框有 step-strictly），但列表不能因此显示错话。
 */
const weightNote = row => {
  if (row.weightOk) return '正好 100%'
  if (Math.abs(Number(row.weightDiff) || 0) > 0.01) {
    return row.weightDiff > 0 ? `还差 ${row.weightDiff}%` : `超出 ${-row.weightDiff}%`
  }
  return '有项不是 5 的倍数'
}
const gradeLabel = g => ({ A: '优秀', B: '良好', C: '合格', D: '待改进' }[g] || '')
const statusType = s => ({
  草稿: 'info', 审批中: 'warning', 已批准: 'primary', 已驳回: 'danger',
  执行中: 'success', 待复评: 'warning', 已结案: ''
}[s] || '')

function reload() {
  rows.value = queryDeptPlans({ ...query })
  st.value = deptPlanStats({ planMonth: query.planMonth, projectId: query.projectId })
}

onMounted(() => {
  me.value = planIdentity()
  if (!me.value.leadCount) {
    ElMessage.info('当前身份不负责任何部门，只能查看计划，不能提报')
  }
  reload()
})

function openCreate() {
  if (!me.value.leadCount) {
    ElMessage.warning('你不是任何部门的负责人，不能提报计划')
    return
  }
  router.push('/f/plans/new')
}
</script>

<style scoped>
.id-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 9px 12px; margin-bottom: 12px; border-radius: 8px;
  background: var(--biz-bg-fill); font-size: 12.5px; color: var(--biz-text-2);
}
.id-bar__who { color: var(--biz-text-1); }
.id-bar__none { color: var(--biz-warning, #d98a1f); }
.duty { color: var(--biz-text-3); }
.pl-t { display: flex; align-items: center; gap: 6px; }
.pl-t__n { font-weight: 600; }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; }
.ps-sub.is-warn { color: var(--biz-warning, #d98a1f); }
.is-warn { color: var(--biz-warning, #d98a1f); }
.is-ok { color: var(--biz-success, #12b98a); }
.wsum { font-family: var(--biz-font-num); font-weight: 600; font-size: 13px; }
.money { font-family: var(--biz-font-num); font-weight: 600; }

.bar-list { margin-top: 12px; }
.bar { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; font-size: 12.5px; }
.bar__k { width: 92px; color: var(--biz-text-2); flex-shrink: 0; }
.bar__track { flex: 1; height: 8px; border-radius: 4px; background: var(--biz-bg-fill); overflow: hidden; }
.bar__fill { height: 100%; border-radius: 4px; background: var(--biz-primary, #5b6cff); transition: width .3s; }
.bar__fill.is-已完成, .bar__fill.is-grade-A { background: var(--biz-success, #12b98a); }
.bar__fill.is-进行中, .bar__fill.is-grade-B { background: var(--biz-primary, #5b6cff); }
.bar__fill.is-未开始, .bar__fill.is-grade-C { background: var(--biz-text-3, #8a94b0); }
.bar__fill.is-延期, .bar__fill.is-grade-D { background: var(--biz-danger, #e34d59); }
.bar__v { width: 76px; text-align: right; color: var(--biz-text-2); flex-shrink: 0; }
.perf-note {
  margin-top: 14px; padding: 8px 11px; border-radius: 7px; font-size: 11.5px; line-height: 1.7;
  background: var(--biz-bg-fill); color: var(--biz-text-3);
}
</style>
