<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>品质整改闭环 · 以「一张整改单」为行</b>：
        开单 → 待整改 →（责任部门提交）→ 待复核 →（品质督导复核）→ 已闭环 / 已退回。
        <b>品质评价不合格（&lt;70 分）会自动开单</b>，问题项直接取该部门本期监督任务查出的问题；
        整改项进度实时回写品质记录，所以「品质台账」与「评价工作台」看到的进度是同一份。
        <template v-if="!canEdit">当前角色只读（整改由责任部门提交、品质督导复核）。</template>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat">
          <div class="dstat__k">待整改</div>
          <div class="dstat__v">{{ summary.pending }}<span class="unit">单</span></div>
          <div class="dstat__k" style="margin-top:2px;">其中退回重做 {{ summary.returned }} 单</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">待复核</div>
          <div class="dstat__v">{{ summary.recheck }}<span class="unit">单</span></div>
          <div class="dstat__k" style="margin-top:2px;">复核超时 {{ summary.recheckOverdue }} 单（提交 &gt;3 天）</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">已闭环</div>
          <div class="dstat__v">{{ summary.closed }}<span class="unit">单 · {{ summary.closeRate }}%</span></div>
          <div class="dstat__k" style="margin-top:2px;">整改项完成 {{ summary.doneItems }} / {{ summary.items }}</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">超期未整改</div>
          <div class="dstat__v" :class="summary.overdue > 0 ? 'is-warn' : ''">{{ summary.overdue }}<span class="unit">单</span></div>
          <div class="dstat__k" style="margin-top:2px;">自动开单 {{ summary.auto }} 单（评价不合格）</div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar" style="border-bottom:1px solid var(--biz-border-light);padding-bottom:10px;">
        <el-radio-group v-model="query.vf" size="small" @change="search">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="pending">待整改</el-radio-button>
          <el-radio-button value="overdue">超期</el-radio-button>
          <el-radio-button value="recheck">待复核</el-radio-button>
          <el-radio-button value="closed">已闭环</el-radio-button>
          <el-radio-button value="auto">自动开单</el-radio-button>
        </el-radio-group>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">口径：超期 = 过整改期限仍未提交；复核超时 = 提交后 {{ RECHECK_LIMIT_DAYS }} 天未复核</span>
      </div>

      <el-form :model="query" class="filter-bar" label-width="60px" @submit.prevent>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:132px">
            <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
          </el-select>
        </el-form-item>
        <el-form-item label="来源">
          <el-select v-model="query.sourceType" placeholder="全部" clearable style="width:110px">
            <el-option v-for="o in RECTIFY_SOURCES" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="query.level" placeholder="全部" clearable style="width:92px">
            <el-option v-for="o in RECTIFY_LEVELS" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="整改单 / 检查单 / 部门 / 责任人" clearable style="width:200px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
          <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 张整改单 · {{ todayText }}</span>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="refresh" />
      </div>

      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 470px)"
        :row-class-name="rowClass" @row-click="onRow">
        <el-table-column label="整改单" min-width="150">
          <template #default="{ row }">
            <div class="nowrap">{{ row.rectifyNo }}</div>
            <div class="ps-sub">{{ row.createdAt }}</div>
          </template>
        </el-table-column>
        <el-table-column label="来源" min-width="128">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.sourceType === '任务评价' ? 'warning' : 'info'">
              {{ row.sourceType }}
            </el-tag>
            <div class="ps-sub">{{ row.checkNo || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="communityName" label="项目" min-width="92" show-overflow-tooltip />
        <el-table-column prop="deptName" label="责任部门" min-width="96" show-overflow-tooltip />
        <el-table-column prop="owner" label="责任人" min-width="76" />
        <el-table-column label="问题" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.issueDesc || '—' }}</span>
            <span v-if="row.totalItems > 2" class="muted">等 {{ row.totalItems }} 项</span>
          </template>
        </el-table-column>
        <el-table-column label="等级" width="82">
          <template #default="{ row }"><StatusTag domain="rectifyLevel" :value="row.level" /></template>
        </el-table-column>
        <el-table-column label="整改期限" min-width="112">
          <template #default="{ row }">
            <div class="nowrap">{{ row.dueDate }}</div>
            <div class="ps-sub" :class="{ 'is-expire': row.overdue }">
              {{ row.closed ? '已闭环' : row.overdue ? `已超期 ${row.overdueDays} 天` : `剩余 ${Math.max(0, row.remainDays)} 天` }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="整改项" min-width="118">
          <template #default="{ row }">
            <div class="pg">
              <div class="pg__bar"><i :style="{ width: row.progress + '%' }" :class="{ 'is-done': row.progress === 100 }" /></div>
              <span class="pg__t">{{ row.doneItems }}/{{ row.totalItems }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }"><StatusTag domain="rectify" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="操作" width="118" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canEdit && ['待整改', '已退回'].includes(row.status)" link type="primary" @click.stop="openSubmit(row)">提交整改</el-button>
            <el-button v-else-if="canEdit && row.status === '待复核'" link type="primary" @click.stop="openRecheck(row)">复核</el-button>
            <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="search" desc="当前筛选没有整改单，换个条件看看">
            <template #action><el-button @click="reset">清除筛选条件</el-button></template>
          </EmptyState>
        </template>
      </el-table>

      <div class="table-foot">
        <el-pagination v-model:current-page="pageNo" v-model:page-size="size"
          :page-sizes="PAGE_SIZES" :total="total" layout="total, sizes, prev, pager, next, jumper" />
      </div>
    </div>

    <!-- 详情 -->
    <DetailDrawer
      v-model="detailVisible" :loading="detailLoading"
      :title="detail?.row?.rectifyNo" :subtitle="detailSub"
      :status="detail?.row?.status" status-domain="rectify"
      :tag="detail?.row?.autoCreated ? '评价自动生成' : ''"
    >
      <template v-if="detail">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">整改项</div><div class="dstat__v">{{ detail.row.doneItems }}<span class="unit">/ {{ detail.row.totalItems }}</span></div></div>
          <div class="dstat"><div class="dstat__k">整改期限</div><div class="dstat__v" style="font-size:16px;" :class="detail.row.overdue ? 'is-warn' : ''">{{ detail.row.dueDate }}</div></div>
          <div class="dstat">
            <div class="dstat__k">超期</div>
            <div class="dstat__v" :class="detail.row.overdue ? 'is-warn' : ''">
              {{ detail.row.overdue ? detail.row.overdueDays + ' 天' : '—' }}
            </div>
          </div>
          <div class="dstat"><div class="dstat__k">严重度</div><div class="dstat__v" style="font-size:16px;"><StatusTag domain="rectifyLevel" :value="detail.row.level" /></div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>整改信息</h4><span class="desc">来源可追溯到检查单</span></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">整改单号</span><span class="dl__v">{{ detail.row.rectifyNo }}</span></div>
          <div class="dl__i"><span class="dl__k">来源</span><span class="dl__v">{{ detail.row.sourceType }}<template v-if="detail.row.checkNo"> · {{ detail.row.checkNo }}</template></span></div>
          <div class="dl__i"><span class="dl__k">项目</span><span class="dl__v">{{ detail.row.communityName }}</span></div>
          <div class="dl__i"><span class="dl__k">责任部门</span><span class="dl__v">{{ detail.row.deptName }}</span></div>
          <div class="dl__i"><span class="dl__k">责任人</span><span class="dl__v">{{ detail.row.owner }}</span></div>
          <div class="dl__i"><span class="dl__k">开单人</span><span class="dl__v">{{ detail.row.createdBy }}</span></div>
          <div class="dl__i"><span class="dl__k">开单时间</span><span class="dl__v">{{ detail.row.createdAt }}</span></div>
          <div class="dl__i"><span class="dl__k">整改周期</span><span class="dl__v">{{ detail.row.period }}</span></div>
          <div class="dl__i is-full"><span class="dl__k">开单说明</span><span class="dl__v">{{ detail.row.remark || '—' }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>整改项</h4>
          <span class="desc">{{ detail.row.doneItems }} / {{ detail.row.totalItems }} 已处理</span>
        </div>
        <el-table :data="detail.row.items" size="small" max-height="320">
          <el-table-column prop="no" label="#" width="46" align="center" />
          <el-table-column label="问题" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <div>{{ row.desc }}</div>
              <div class="ps-sub">{{ row.require }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="86">
            <template #default="{ row }">
              <el-tag size="small" :type="row.done ? 'success' : 'warning'" effect="plain">{{ row.done ? '已处理' : '待处理' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>

        <div class="sec__hd" style="margin-top:18px;"><h4>闭环流程</h4><span class="desc">开单 → 整改 → 复核 → 闭环</span></div>
        <div class="tl">
          <div v-for="(l, i) in detail.timeline" :key="i" class="tl__i" :class="{ 'is-done': l.done }">
            <div class="tl__t">{{ l.title }}</div>
            <div class="tl__m">{{ l.memo }}<template v-if="l.at"> · {{ l.at }}</template></div>
          </div>
        </div>

        <div v-if="detail.row.recheckRemark || detail.row.returnReason" class="rv">
          <div v-if="detail.row.recheckRemark"><b>复核意见：</b>{{ detail.row.recheckRemark }}</div>
          <div v-if="detail.row.returnReason" class="is-expire"><b>退回原因：</b>{{ detail.row.returnReason }}</div>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="canEdit && detail && detail.row.status !== '已闭环'" @click="openReassign(detail.row)">改派 / 延期</el-button>
        <el-button v-if="canEdit && detail && ['待整改', '已退回'].includes(detail.row.status)" type="primary" @click="openSubmit(detail.row)">提交整改</el-button>
        <el-button v-if="canEdit && detail && detail.row.status === '待复核'" type="primary" @click="openRecheck(detail.row)">复核</el-button>
      </template>
    </DetailDrawer>

    <!-- 提交整改 -->
    <el-dialog v-model="submitVisible" title="提交整改" width="560" top="10vh">
      <el-form label-width="96px">
        <el-form-item label="整改单">
          <span>{{ cur?.rectifyNo }}</span>
          <span class="muted" style="font-size:12px;margin-left:8px;">{{ cur?.deptName }} · {{ cur?.owner }}</span>
        </el-form-item>
        <el-form-item label="整改项">
          <div class="chk">
            <div v-for="it in cur?.items || []" :key="it.no" class="chk__i">
              <el-icon class="ico-ok"><CircleCheck /></el-icon><span>{{ it.desc }}</span>
            </div>
            <div class="muted" style="font-size:12px;">提交后全部整改项标记为「已处理」，并转入品质督导复核</div>
          </div>
        </el-form-item>
        <el-form-item label="整改人" required>
          <el-input v-model="submitForm.applicant" style="width:180px;" />
        </el-form-item>
        <el-form-item label="现场照片">
          <el-input-number v-model="submitForm.photos" :min="0" :max="9" controls-position="right" style="width:110px;" />
          <span class="muted" style="font-size:12px;margin-left:8px;">张（原型不传真实文件）</span>
        </el-form-item>
        <el-form-item label="整改说明">
          <el-input v-model="submitForm.remark" type="textarea" :rows="2" placeholder="整改措施、完成情况（选填）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="submitVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSubmit">提交复核</el-button>
      </template>
    </el-dialog>

    <!-- 复核 -->
    <el-dialog v-model="recheckVisible" title="整改复核" width="560" top="10vh">
      <el-form label-width="96px">
        <el-form-item label="整改单">
          <span>{{ cur?.rectifyNo }}</span>
          <span class="muted" style="font-size:12px;margin-left:8px;">{{ cur?.deptName }} · 提交人 {{ cur?.submitBy || cur?.owner }}</span>
        </el-form-item>
        <el-form-item label="复核结论" required>
          <el-radio-group v-model="recheckForm.pass">
            <el-radio :value="true">通过并闭环</el-radio>
            <el-radio :value="false">退回重做</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="复核人">
          <el-input v-model="recheckForm.checker" style="width:180px;" />
        </el-form-item>
        <el-form-item :label="recheckForm.pass ? '复核意见' : '退回原因'" :required="!recheckForm.pass">
          <el-input v-model="recheckForm.remark" type="textarea" :rows="3"
            :placeholder="recheckForm.pass ? '现场复核情况（选填）' : '必须写明未通过的原因与整改要求'" />
        </el-form-item>
        <el-alert v-if="!recheckForm.pass" type="warning" :closable="false" show-icon
          title="退回后整改进度归零，责任部门需重新逐项整改并再次提交。" />
      </el-form>
      <template #footer>
        <el-button @click="recheckVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doRecheck">{{ recheckForm.pass ? '通过并闭环' : '退回重做' }}</el-button>
      </template>
    </el-dialog>

    <!-- 改派 / 延期 -->
    <el-dialog v-model="reassignVisible" title="改派 / 延期" width="520" top="12vh">
      <el-form label-width="96px">
        <el-form-item label="整改单"><span>{{ cur?.rectifyNo }}</span></el-form-item>
        <el-form-item label="责任部门">
          <el-select v-model="reassignForm.deptId" clearable placeholder="不改派" style="width:260px;">
            <el-option v-for="o in deptOpts" :key="o.id" :label="o.name" :value="o.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="责任人">
          <el-input v-model="reassignForm.owner" placeholder="留空则改派时按部门默认责任人" style="width:220px;" />
        </el-form-item>
        <el-form-item label="整改期限">
          <el-date-picker v-model="reassignForm.dueDate" type="date" value-format="YYYY-MM-DD" placeholder="选择新期限" style="width:200px;" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reassignVisible = false">取消</el-button>
        <el-button type="primary" @click="doReassign">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, RECTIFY_LEVELS, RECTIFY_SOURCES, RECHECK_LIMIT_DAYS,
  achievementDeptOpts, communities, getRectifyDetail, queryRectifyOrders, reassignRectify,
  recheckRectify, rectifySummary, submitRectify
} from '@/api'
import { currentRoleId } from '@/utils/auth'
import { permCodesOfRole } from '@/utils/rbac'
import { useDetail, useListQuery } from '@/composables/useQuery'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

const canEdit = computed(() => permCodesOfRole(currentRoleId.value).has('f.rectify.edit'))
const route = useRoute()

const BLANK = { vf: '', communityId: '', sourceType: '', level: '', kw: '', checkId: '' }
const { rows, total, pageNo, size, loading, query, load, search, reset } =
  useListQuery(queryRectifyOrders, { filters: { ...BLANK }, size: 20 })

const summary = ref(rectifySummary())
const deptOpts = achievementDeptOpts()
const todayText = `今天 ${new Date().toISOString().slice(0, 10)}`

const { data: detail, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getRectifyDetail)
const detailSub = computed(() => detail.value
  ? `${detail.value.row.communityName} · ${detail.value.row.deptName} · 责任人 ${detail.value.row.owner} · 期限 ${detail.value.row.dueDate}`
  : '')

function refresh() {
  summary.value = rectifySummary()
  load()
}
function onRow(row) { openDetail(row.rectifyId) }
function rowClass({ row }) { return row.overdue ? 'row--overdue' : '' }

/* ---------- 提交整改 ---------- */
const submitVisible = ref(false)
const saving = ref(false)
const cur = ref(null)
const submitForm = reactive({ applicant: '', photos: 0, remark: '' })

function openSubmit(row) {
  cur.value = row
  submitForm.applicant = row.owner === '待指派' ? '' : row.owner
  submitForm.photos = row.totalItems
  submitForm.remark = ''
  submitVisible.value = true
}
function doSubmit() {
  saving.value = true
  try {
    const r = submitRectify(cur.value.rectifyId, { ...submitForm })
    ElMessage.success(`${r.rectifyNo} 已提交复核（${r.doneItems}/${r.totalItems} 项）`)
    submitVisible.value = false
    refresh()
    if (detailVisible.value) openDetail(cur.value.rectifyId)
  } catch (e) {
    ElMessage.error(e?.message || '提交失败')
  } finally { saving.value = false }
}

/* ---------- 复核 ---------- */
const recheckVisible = ref(false)
const recheckForm = reactive({ pass: true, checker: '品质督导', remark: '' })

function openRecheck(row) {
  cur.value = row
  recheckForm.pass = true
  recheckForm.checker = '品质督导'
  recheckForm.remark = ''
  recheckVisible.value = true
}
function doRecheck() {
  saving.value = true
  try {
    const r = recheckRectify(cur.value.rectifyId, { ...recheckForm })
    ElMessage.success(recheckForm.pass ? `${r.rectifyNo} 已闭环` : `${r.rectifyNo} 已退回，进度归零`)
    recheckVisible.value = false
    refresh()
    if (detailVisible.value) openDetail(cur.value.rectifyId)
  } catch (e) {
    ElMessage.error(e?.message || '复核失败')
  } finally { saving.value = false }
}

/* ---------- 改派 / 延期 ---------- */
const reassignVisible = ref(false)
const reassignForm = reactive({ deptId: '', owner: '', dueDate: '' })
function openReassign(row) {
  cur.value = row
  reassignForm.deptId = ''
  reassignForm.owner = ''
  reassignForm.dueDate = ''
  reassignVisible.value = true
}
function doReassign() {
  try {
    const r = reassignRectify(cur.value.rectifyId, { ...reassignForm })
    ElMessage.success(`已更新：${r.deptName} · ${r.owner} · 期限 ${r.dueDate}`)
    reassignVisible.value = false
    refresh()
    if (detailVisible.value) openDetail(cur.value.rectifyId)
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}

/* ---------- 导出 ---------- */
const EXPORT_COLS = [
  { prop: 'rectifyNo', label: '整改单号' }, { prop: 'sourceType', label: '来源' },
  { prop: 'checkNo', label: '关联检查单' }, { prop: 'communityName', label: '项目' },
  { prop: 'deptName', label: '责任部门' }, { prop: 'owner', label: '责任人' },
  { prop: 'level', label: '等级' }, { prop: 'dueDate', label: '整改期限' },
  { prop: 'doneItems', label: '已处理项' }, { prop: 'totalItems', label: '整改项' },
  { prop: 'status', label: '状态' }, { prop: 'issueDesc', label: '问题摘要' }
]
function onExport() {
  exportList({ name: `整改闭环_${new Date().toISOString().slice(0, 10)}`, source: '/f/rectify', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

/* ---------- 落地：?check= / ?id= 直达 ---------- */
async function landFromQuery() {
  await load()
  const rid = String(route.query.id || '')
  const check = String(route.query.check || '')
  if (rid) { openDetail(rid); return }
  if (check) {
    const hit = rows.value.find(r => r.checkNo === check || r.checkId === check)
    if (hit) openDetail(hit.rectifyId)
  }
}
landFromQuery()

defineExpose({ refresh })
</script>

<style scoped>
.nowrap { white-space: nowrap; }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-sub.is-expire, .is-expire { color: var(--biz-danger); }
.pg { display: flex; align-items: center; gap: 6px; }
.pg__bar { flex: 1; height: 6px; border-radius: 3px; background: var(--biz-fill-2, #eef0f6); overflow: hidden; }
.pg__bar i { display: block; height: 100%; background: var(--biz-warning, #d98a1f); border-radius: 3px; }
.pg__bar i.is-done { background: var(--biz-success, #12b98a); }
.pg__t { font-size: 11.5px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.chk { display: flex; flex-direction: column; gap: 6px; }
.chk__i { display: flex; align-items: flex-start; gap: 6px; font-size: 12.5px; color: var(--biz-text-2); }
.ico-ok { color: var(--biz-success, #12b98a); margin-top: 2px; }
.rv { margin-top: 16px; padding: 10px 12px; border-radius: 6px; background: var(--biz-fill-1, #f7f8fb); font-size: 12.5px; color: var(--biz-text-2); display: flex; flex-direction: column; gap: 6px; }
:deep(.el-table__body tr.row--overdue > td.el-table__cell) { background: rgba(236, 77, 99, 0.04); }
</style>
