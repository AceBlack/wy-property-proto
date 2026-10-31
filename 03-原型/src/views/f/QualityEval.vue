<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>品质评价 · 按部门 × 周期</b>：数据来自巡检执行结果（完成率 / 合格率 / 组长查出问题 / 申报冲突），
        再加上本期「品质抽查发现问题」按重档扣分，算出一条可追溯的品质检查记录。
        <template v-if="!canEdit">当前角色只读（评价由品质督导执行）。</template>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat">
          <div class="dstat__k">应评部门</div>
          <div class="dstat__v">{{ summary.total }}<span class="unit">个</span></div>
          <div v-if="summary.noData" class="dstat__k" style="margin-top:2px;">另有 {{ summary.noData }} 个本期无任务，不参与评价</div>
        </div>
        <div class="dstat"><div class="dstat__k">已评 / 待评</div><div class="dstat__v">{{ summary.done }}<span class="unit">/ {{ summary.pending }}</span></div></div>
        <div class="dstat"><div class="dstat__k">平均分</div><div class="dstat__v">{{ summary.done ? summary.avgScore : '—' }}</div></div>
        <div class="dstat">
          <div class="dstat__k">发现问题 / 冲突</div>
          <div class="dstat__v" :class="summary.conflicts ? 'is-warn' : ''">{{ summary.issues }}<span class="unit">/ {{ summary.conflicts }}</span></div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
        <el-form-item label="周期">
          <el-select v-model="query.period" style="width:130px" @change="reload">
            <el-option v-for="p in periodOpts" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:140px" @change="reload">
            <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
          </el-select>
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Refresh'" @click="reload">刷新</el-button>
          <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        </el-form-item>
        <el-form-item label="口径">
          <span class="muted" style="font-size:12px;">
            达标率 = 合格率 × 权重 + 完成率 × 权重（按岗位可配）；
            问题扣分：自查 ×0.5 / 抽查 ×1.5
          </span>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <span class="muted" style="font-size:12.5px;">
          共 {{ rows.length }} 个部门 · {{ summary.period }} · 按分数升序（先看问题部门）
        </span>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="reload" />
      </div>

      <el-table :data="rows" style="width:100%" max-height="calc(100vh - 470px)" @row-click="openDetail">
        <el-table-column label="#" width="56" align="center">
          <template #default="{ $index }"><span class="rk">{{ $index + 1 }}</span></template>
        </el-table-column>
        <el-table-column prop="deptName" label="部门" min-width="110" />
        <el-table-column prop="post" label="岗位" width="80" />
        <el-table-column prop="communityName" label="项目" min-width="110" show-overflow-tooltip />
        <el-table-column label="完成率" width="92" align="right">
          <template #default="{ row }">{{ fp(row.doneRate) }}</template>
        </el-table-column>
        <el-table-column label="合格率" width="92" align="right">
          <template #default="{ row }">{{ fp(row.passRate) }}</template>
        </el-table-column>
        <el-table-column label="加权达标率" width="110" align="right">
          <template #default="{ row }"><span class="money">{{ fp(row.weighted) }}</span></template>
        </el-table-column>
        <el-table-column label="自查问题" width="95" align="right">
          <template #default="{ row }">{{ row.selfIssues }}</template>
        </el-table-column>
        <el-table-column label="抽查问题" width="95" align="right">
          <template #default="{ row }">
            <span :class="row.crossIssues > 0 ? 'money money--out' : ''">{{ row.crossIssues }}</span>
          </template>
        </el-table-column>
        <el-table-column label="冲突" width="76" align="right">
          <template #default="{ row }">
            <span :class="row.conflicts ? 'money money--out' : ''">{{ row.conflicts }}</span>
          </template>
        </el-table-column>
        <el-table-column label="得分" width="86" align="right">
          <template #default="{ row }">
            <span v-if="!row.evaluable" class="muted">—</span>
            <span v-else class="money" :class="row.score < 70 ? 'money--out' : ''">{{ row.score }}</span>
          </template>
        </el-table-column>
        <el-table-column label="等级" width="86">
          <template #default="{ row }">
            <el-tag v-if="row.evaluable" size="small" effect="plain" :type="gradeType(row.grade)">{{ row.grade }}</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="122">
          <template #default="{ row }">
            <el-tag v-if="row.evaluated" size="small" type="success" effect="plain">{{ row.record.checkNo }}</el-tag>
            <span v-else-if="!row.evaluable" class="muted" style="font-size:12px;">本期无任务</span>
            <span v-else class="muted" style="font-size:12px;">待评价</span>
          </template>
        </el-table-column>
        <el-table-column label="整改" width="108">
          <template #default="{ row }">
            <template v-if="row.evaluated">
              <span :class="rp(row).closed === rp(row).total ? 'money' : 'money money--out'">{{ rp(row).closed }} / {{ rp(row).total }}</span>
              <div class="ps-sub">已闭环 / 整改单</div>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="!canEdit || !row.evaluable" @click.stop="openEval(row)">
              {{ row.evaluated ? '重评' : '评价' }}
            </el-button>
            <el-button link type="primary" @click.stop="openDetail(row)">依据</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="empty" desc="该周期没有巡检任务数据，换个周期或项目看看" />
        </template>
      </el-table>
    </div>

    <!-- 评价依据 -->
    <DetailDrawer
      v-model="detailVisible" :title="detailData?.deptName" :subtitle="detailData ? `${detailData.orgId} · ${detailData.post} · ${summary.period}` : ''"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">加权达标率</div><div class="dstat__v">{{ fp(detailData.weighted) }}</div></div>
          <div class="dstat"><div class="dstat__k">得分</div><div class="dstat__v">{{ detailData.score }}</div></div>
          <div class="dstat"><div class="dstat__k">等级</div><div class="dstat__v" style="font-size:16px;">{{ detailData.grade }}</div></div>
          <div class="dstat"><div class="dstat__k">状态</div><div class="dstat__v" style="font-size:15px;">{{ detailData.evaluated ? '已评价' : '待评价' }}</div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>计算过程</h4><span class="desc">可逐项核对</span></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">任务完成</span><span class="dl__v">{{ detailData.finished }} / {{ detailData.planned }}（{{ fp(detailData.doneRate) }}）</span></div>
          <div class="dl__i"><span class="dl__k">检查项合格</span><span class="dl__v">{{ detailData.itemOk }} / {{ detailData.itemTotal }}（{{ fp(detailData.passRate) }}）</span></div>
          <div class="dl__i"><span class="dl__k">权重</span><span class="dl__v">合格率 {{ Math.round(detailData.weight.pass * 100) }}% + 完成率 {{ Math.round(detailData.weight.done * 100) }}%</span></div>
          <div class="dl__i"><span class="dl__k">加权达标率</span><span class="dl__v">{{ fp(detailData.weighted) }}（{{ detailData.rawScore }} 分）</span></div>
          <div class="dl__i"><span class="dl__k">自查扣分</span><span class="dl__v">-{{ detailData.selfDeduct }}（{{ detailData.selfIssues }} 项 × 2 × 0.5）</span></div>
          <div class="dl__i"><span class="dl__k">抽查扣分</span><span class="dl__v">-{{ detailData.crossDeduct }}（{{ detailData.crossIssues }} 项 × 2 × 1.5）</span></div>
          <div class="dl__i"><span class="dl__k">最终得分</span><span class="dl__v">{{ detailData.score }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>主管侧</h4></div>
        <div class="chk">
          <div>发现问题数（自查，正向）：{{ detailData.supervisor.found }} 项</div>
          <div>查出申报冲突：{{ detailData.supervisor.conflict }} 次</div>
          <div class="muted">抽查未发现问题：{{ detailData.supervisor.crossMissed }} 项（计入主管减分）</div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>整改闭环</h4><span class="desc">不合格自动开单</span></div>
        <template v-if="detailData.evaluated">
          <div class="dl">
            <div class="dl__i"><span class="dl__k">整改单</span><span class="dl__v">{{ rp(detailData).total }} 张（已闭环 {{ rp(detailData).closed }} 张）</span></div>
            <div class="dl__i"><span class="dl__k">触发规则</span><span class="dl__v">{{ detailData.score < 70 ? '不合格，自动开单' : '合格及以上，未自动开单' }}</span></div>
          </div>
          <div class="rel">
            <el-button size="small" @click="gotoRectify">查看整改单</el-button>
            <span class="rel__note">整改项进度会实时回写到本记录，闭环后记录状态自动转「已闭环」</span>
          </div>
        </template>
        <div v-else class="chk"><div class="muted">评价后若触发开单，整改单会在这里列出。</div></div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!canEdit" @click="evalFromDetail">去评价</el-button>
      </template>
    </DetailDrawer>

    <!-- 评价 -->
    <el-dialog v-model="evalVisible" title="品质评价" width="620" top="8vh">
      <el-form label-width="120px">
        <el-form-item label="部门">
          <span>{{ cur?.deptName }}（{{ cur?.post }} · {{ cur?.communityName }}）</span>
        </el-form-item>
        <el-form-item label="评价周期">
          <span>{{ summary.period }}</span>
        </el-form-item>
        <el-form-item label="加权达标率">
          <span class="money">{{ fp(cur?.weighted || 0) }}</span>
          <span class="muted" style="font-size:12px;margin-left:8px;">
            完成 {{ cur?.finished }}/{{ cur?.planned }} · 检查项 {{ cur?.itemOk }}/{{ cur?.itemTotal }}
          </span>
        </el-form-item>
        <el-form-item label="自查问题">
          <span>{{ cur?.selfIssues }} 项</span>
          <span class="muted" style="font-size:12px;margin-left:8px;">扣 {{ cur?.selfDeduct }} 分（×0.5，轻档）</span>
        </el-form-item>
        <el-form-item label="抽查发现问题" required>
          <el-input-number v-model="evalForm.crossIssues" :min="0" :max="50" controls-position="right" style="width:110px;" />
          <span class="muted" style="font-size:12px;margin-left:8px;">每项扣 3 分（×1.5，重档）</span>
        </el-form-item>
        <el-form-item label="预计得分">
          <span class="money" style="font-size:18px;">{{ previewScore }}</span>
          <el-tag size="small" effect="plain" :type="gradeType(gradeOfScore(previewScore))" style="margin-left:8px;">
            {{ gradeOfScore(previewScore) }}
          </el-tag>
        </el-form-item>
        <el-form-item label="评价人">
          <el-input v-model="evalForm.checker" style="width:180px;" />
        </el-form-item>
        <el-form-item label="评价说明">
          <el-input v-model="evalForm.remark" type="textarea" :rows="2" placeholder="本期整体评价（选填）" />
        </el-form-item>
        <el-alert v-if="cur?.evaluated" type="warning" :closable="false" show-icon
          :title="`该部门本期已评价（${cur.record.checkNo}），重评会先删除旧记录再生成新记录。`" />
      </el-form>
      <template #footer>
        <el-button @click="evalVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doEval">{{ cur?.evaluated ? '重评并生成' : '生成评价记录' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  communities, createQualityEvaluation, gradeOfScore, qualityEvalRows, qualityEvalSummary,
  qualityPeriodOpts, rectifyOfCheck, removeQualityEvaluation
} from '@/utils/api'
import { currentRoleId } from '@/utils/auth'
import { permCodesOfRole } from '@/utils/rbac'
import { pct } from '@/utils/format'
import DetailDrawer from '@/components/DetailDrawer.vue'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

const canEdit = computed(() => permCodesOfRole(currentRoleId.value).has('f.qualityEval.edit'))
const router = useRouter()
const periodOpts = qualityPeriodOpts()
const query = reactive({ period: periodOpts[0] || '', communityId: '' })
const ver = ref(0)

const rows = computed(() => {
  void ver.value
  return qualityEvalRows({ period: query.period, communityId: query.communityId })
})
const summary = computed(() => {
  void ver.value
  return qualityEvalSummary(query.period)
})
const fp = v => pct((Number(v) || 0) * 100)
const gradeType = g => ({ 优秀: 'success', 良好: 'primary', 合格: 'info', 不合格: 'danger' }[g] || 'info')
function reload() { ver.value++ }

/** 该部门本期评价记录关联的整改单（P3 联动：评价不合格会自动开单） */
const rp = row => {
  const list = row?.evaluated ? rectifyOfCheck(row.record.checkId) : []
  return { total: list.length, closed: list.filter(r => r.status === '已闭环').length }
}

/* 详情直接用行数据（依据都在行里），不再单独查接口 */
const detailData = ref(null)
const detailVisible = ref(false)
function openDetail(row) { detailData.value = row; detailVisible.value = true }

/* ---------- 评价 ---------- */
const evalVisible = ref(false)
const saving = ref(false)
const cur = ref(null)
const evalForm = reactive({ crossIssues: 0, checker: '品质督导', remark: '' })

function openEval(row) {
  if (!canEdit.value) { ElMessage.warning('评价由品质督导执行'); return }
  if (!row.evaluable) { ElMessage.warning('该部门本期没有巡检任务，无法评价'); return }
  cur.value = row
  evalForm.crossIssues = row.crossIssues || 0
  evalForm.checker = '品质督导'
  evalForm.remark = ''
  evalVisible.value = true
}
function evalFromDetail() {
  const row = detailData.value
  if (!row) return
  detailVisible.value = false
  openEval(row)
}

const previewScore = computed(() => {
  const base = Number(cur.value?.rawScore || 0)
  const cross = -Math.round((Number(evalForm.crossIssues) || 0) * 2 * 1.5 * 10) / 10
  return Math.max(0, Math.round((base - Number(cur.value?.selfDeduct || 0) + cross) * 10) / 10)
})

async function doEval() {
  if (!cur.value) return
  saving.value = true
  try {
    let removed = 0
    if (cur.value.evaluated) {
      const r = removeQualityEvaluation(cur.value.record.checkId)
      removed = r.removedRectify || 0
    }
    const rec = createQualityEvaluation({
      orgId: cur.value.orgId, period: query.period,
      crossIssues: evalForm.crossIssues, checker: evalForm.checker, remark: evalForm.remark
    })
    /* 联动（P3）：不合格自动开单，提示里直接给出整改单号与期限，避免「评完不知道下一步」 */
    if (rec.autoRectify) {
      ElMessage.success(
        `已生成 ${rec.checkNo}：${rec.score} 分（不合格）→ 自动开整改单 ${rec.autoRectify.rectifyNo}，期限 ${rec.autoRectify.dueDate}`
      )
    } else if (rec.autoRectifyError) {
      ElMessage.warning(`已生成 ${rec.checkNo}，但自动开单失败：${rec.autoRectifyError}`)
    } else {
      ElMessage.success(`已生成品质记录 ${rec.checkNo}：${rec.score} 分（${rec.grade}）${removed ? `，已清理旧整改单 ${removed} 张` : ''}`)
    }
    evalVisible.value = false
    reload()
  } catch (e) {
    ElMessage.error(e?.message || '生成失败')
  } finally { saving.value = false }
}

/** 跳到整改工作台并按检查单过滤（P3 联动入口） */
function gotoRectify() {
  const no = detailData.value?.record?.checkNo
  if (!no) return
  detailVisible.value = false
  router.push({ path: '/f/rectify', query: { check: no } })
}

/* ---------- 导出 ---------- */const EXPORT_COLS = [
  { prop: 'deptName', label: '部门' }, { prop: 'post', label: '岗位' },
  { prop: 'communityName', label: '项目' }, { prop: 'doneRate', label: '完成率' },
  { prop: 'passRate', label: '合格率' }, { prop: 'weighted', label: '加权达标率' },
  { prop: 'selfIssues', label: '自查问题' }, { prop: 'crossIssues', label: '抽查问题' },
  { prop: 'conflicts', label: '冲突' }, { prop: 'score', label: '得分' }, { prop: 'grade', label: '等级' }
]
function onExport() {
  exportList({ name: `品质评价_${query.period}`, source: '/f/quality-eval', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}
</script>

<style scoped>
.rk { font-family: var(--biz-font-num); color: var(--biz-text-3); }
.chk { font-size: 12px; color: var(--biz-text-2); display: flex; flex-direction: column; gap: 5px; }
</style>
