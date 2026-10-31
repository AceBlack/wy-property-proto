<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>合同管理 · 统一合同台账</b>：物业服务 / 外包 / 采购 / 租赁 / 劳动五类合同共用一张表和一套状态机，差异只在「类型 → 子类型」与关联对象上；
        树轴按<b>合同类型</b>切（不是空间树），因为合同的第一诉求是「按类找、按到期盯」。
        <b>{{ summary.expiring }} 份 90 天内到期</b>、<b>{{ summary.expired }} 份已到期</b>进常用视图。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">合同总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">份</span></div></div>
        <div class="dstat"><div class="dstat__k">合同总金额</div><div class="dstat__v">{{ wan(summary.amount) }}<span class="unit">元</span></div></div>
        <div class="dstat"><div class="dstat__k">90 天内到期</div><div class="dstat__v" :class="summary.expiring > 0 ? 'is-warn' : ''">{{ summary.expiring }}<span class="unit">份</span></div></div>
        <div class="dstat"><div class="dstat__k">已到期 / 待审批</div><div class="dstat__v" :class="summary.expired > 0 ? 'is-warn' : ''">{{ summary.expired }} / {{ summary.pending }}<span class="unit">份</span></div></div>
      </div>
      <div class="sum-note">
        口径：履行中 {{ summary.running }} 份；「集团级合同」指未绑定具体项目（communityId 为空）的合同，走常用视图单独筛。
      </div>
    </div>

    <div class="ia is-flat" style="margin-top:16px;">
      <div class="ia__main">
        <div class="panel">
          <div class="qvwrap">
            <QuickViews v-model="query.vf" :items="quickViews" hint="快捷视图与下方筛选可叠加" @change="run" />
          </div>

          <el-form :model="query" class="filter-bar" label-width="56px" @submit.prevent>
            <el-form-item label="类型">
              <el-select v-model="query.ctype" placeholder="全部" clearable style="width:118px" @change="onType">
                <el-option v-for="o in typeOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="子类型">
              <el-select v-model="query.csub" placeholder="全部" clearable :disabled="!query.ctype" style="width:126px">
                <el-option v-for="o in subOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width:92px">
                <el-option v-for="o in statusOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="项目">
              <el-select v-model="query.communityId" placeholder="全部" clearable style="width:110px">
                <el-option v-for="o in communities" :key="o.id" :label="o.name" :value="o.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="合同号 / 名称 / 相对方" clearable style="width:150px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="run">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="scopebar">
            <span class="scopebar__i is-last">{{ scopeText }}</span>
            <span v-if="vnLabel" class="scopebar__vf">{{ vnLabel }}</span>
            <span v-if="query.kw" class="scopebar__vf">关键字 {{ query.kw }}</span>
            <span class="spacer" />
            <span class="scopebar__sum">
              本范围 <b>{{ total }}</b> 份
            </span>
            <el-button link type="primary" :disabled="!hasScope" @click="clearScope">清除范围</el-button>
          </div>

          <div class="toolbar">
            <el-button type="primary" :icon="'Plus'" @click="$router.push('/c/contracts/new')">新建合同</el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 份合同</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 500px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column label="合同" min-width="220">
              <template #default="{ row }">
                <div class="nowrap">{{ row.name }}</div>
                <div class="ps-sub">{{ row.contractNo }}</div>
              </template>
            </el-table-column>
            <el-table-column label="类型 / 子类型" min-width="104">
              <template #default="{ row }">
                <div class="nowrap">{{ row.type }}</div>
                <div class="ps-sub">{{ row.subtype }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="partyB" label="相对方" min-width="120" show-overflow-tooltip />
            <el-table-column prop="communityName" label="项目" min-width="104" show-overflow-tooltip />
            <el-table-column label="金额" min-width="96" align="right">
              <template #default="{ row }"><span class="num">¥{{ wan(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column label="履行期" min-width="92">
              <template #default="{ row }">
                <div class="nowrap">{{ row.startDate }}</div>
                <div class="ps-sub">{{ row.endDate }}</div>
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="96">
              <template #default="{ row }">
                <StatusTag domain="contract" :value="row.status" />
                <div class="ps-sub" :class="{ 'is-expire': row.status === '即将到期' || row.status === '已到期' }">{{ restText(row) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
                <el-button link type="primary" v-if="canChange(row)" @click.stop="openChange(row)">变更</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <EmptyState type="search" desc="换个筛选条件，或清除范围重新查看">
                <template #action><el-button @click="reset">清除筛选条件</el-button></template>
              </EmptyState>
            </template>
          </el-table>

          <div class="table-foot">
            <el-pagination v-model:current-page="pageNo" v-model:page-size="size"
              :page-sizes="PAGE_SIZES" :total="total" layout="total, sizes, prev, pager, next, jumper" />
          </div>
        </div>
      </div>
    </div>

    <DetailDrawer
      v-model="detailVisible" :loading="detailLoading"
      :title="detailData ? detailData.contract.name : ''"
      :subtitle="detailData ? `${detailData.contract.contractNo} · ${detailData.contract.type} / ${detailData.contract.subtype} · ${detailData.contract.communityName}` : ''"
      :status="detailData?.contract?.status" status-domain="contract"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">合同金额</div><div class="dstat__v">¥{{ wan(detailData.contract.amount) }}</div></div>
          <div class="dstat"><div class="dstat__k">付款周期</div><div class="dstat__v">{{ detailData.contract.payCycle }}</div></div>
          <div class="dstat"><div class="dstat__k">附件</div><div class="dstat__v">{{ detailData.contract.attachments }}<span class="unit">份</span></div></div>
          <div class="dstat">
            <div class="dstat__k">剩余期限</div>
            <div class="dstat__v" :class="detailData.contract.status === '即将到期' || detailData.contract.status === '已到期' ? 'is-warn' : ''">
              {{ restText(detailData.contract) }}
            </div>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>合同信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">合同编号</span><span class="dl__v">{{ detailData.contract.contractNo }}</span></div>
          <div class="dl__i"><span class="dl__k">合同类型</span><span class="dl__v">{{ detailData.contract.type }} / {{ detailData.contract.subtype }}</span></div>
          <div class="dl__i"><span class="dl__k">所属项目</span><span class="dl__v">{{ detailData.contract.communityName }}</span></div>
          <div class="dl__i"><span class="dl__k">相对方</span><span class="dl__v">{{ detailData.contract.partyB }}</span></div>
          <div class="dl__i"><span class="dl__k">联系人</span><span class="dl__v">{{ detailData.contract.contact }} · {{ maskPhone(detailData.contract.phone) }}</span></div>
          <div class="dl__i"><span class="dl__k">签订日期</span><span class="dl__v">{{ detailData.contract.signDate }}</span></div>
          <div class="dl__i"><span class="dl__k">生效日期</span><span class="dl__v">{{ detailData.contract.startDate }}</span></div>
          <div class="dl__i"><span class="dl__k">到期日期</span><span class="dl__v">{{ detailData.contract.endDate }}</span></div>
          <div class="dl__i"><span class="dl__k">合同责任人</span><span class="dl__v">{{ detailData.contract.owner }}</span></div>
          <div class="dl__i is-full"><span class="dl__k">备注</span><span class="dl__v">{{ detailData.contract.remark || '—' }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>变更留痕</h4>
          <span class="desc">共 {{ changeRows.length }} 条 · 审批通过才回写合同</span>
        </div>
        <div v-if="changeRows.length" class="tl">
          <div v-for="c in changeRows" :key="c.changeId" class="tl__i" :class="{ 'is-done': c.status === '已生效' }">
            <div class="tl__t">
              {{ c.type }} · {{ c.changeNo }}
              <span class="ps-sub" style="display:inline;margin-left:6px;">{{ c.status }}</span>
            </div>
            <div class="tl__m">{{ c.reason }} · {{ c.applicant }} 申请 · {{ c.applyTime }}</div>
          </div>
        </div>
        <div v-else class="rel"><span class="rel__note">该合同暂无变更记录；续签、调价、延期都要走这里的变更审批</span></div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>关联对象</h4><span class="desc">{{ refTypeLabel(detailData.contract.refType) }}</span>
        </div>
        <div class="dl" v-if="detailData.ref">
          <div class="dl__i"><span class="dl__k">对象编号</span><span class="dl__v">{{ detailData.contract.refId }}</span></div>
          <div class="dl__i"><span class="dl__k">对象名称</span><span class="dl__v">{{ refName(detailData) }}</span></div>
          <div class="dl__i"><span class="dl__k">所在项目</span><span class="dl__v">{{ detailData.ref.communityName || detailData.contract.communityName }}</span></div>
        </div>
        <div v-else class="rel">
          <span class="rel__note">该合同未绑定具体对象（多为集团级框架协议），履约跟踪以合同履行记录为准</span>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>履约节点</h4><span class="desc">签订 → 生效 → 到期</span></div>
        <div class="tl">
          <div v-for="(l, i) in detailData.timeline" :key="i" class="tl__i" :class="{ 'is-done': l.done }">
            <div class="tl__t">{{ l.title }}</div>
            <div class="tl__m">{{ l.memo }}</div>
          </div>
        </div>

        <div class="rel">
          <el-button v-if="detailData.contract.refType === 'house'" size="small" @click="jump('/a/houses', 'house:' + detailData.contract.refId)">房屋台账</el-button>
          <el-button v-if="detailData.contract.refType === 'parking'" size="small" @click="jump('/a/vehicles', 'park:' + detailData.contract.refId)">车位与车辆</el-button>
          <el-button v-if="detailData.contract.refType === 'employee'" size="small" @click="jump('/c/employee', 'employee:' + detailData.contract.refId)">员工档案</el-button>
          <span class="rel__note">五类合同共用状态机，差异只在类型与关联对象上；续签必须发起审批，不允许在原合同上改期限</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button @click="doDownloadAttachments(detailData.contract)">下载附件</el-button>
        <el-button
          v-if="detailData?.contract?.status === '履行中'"
          @click="openChange(detailData.contract, '提前终止')"
        >终止合同</el-button>
        <el-button type="primary" :disabled="!!detailData?.contract?.changePending" @click="openChange(detailData.contract, '续签')">发起续签</el-button>
      </template>
    </DetailDrawer>

    <!-- C4 合同变更：变更单 + 审批单，通过后才回写合同 -->
    <el-dialog v-model="changeVisible" title="发起合同变更" width="560">
      <el-form ref="chRef" :model="chForm" :rules="chRules" label-width="96px">
        <el-form-item label="合同">
          <span>{{ chContract?.name }}</span>
          <span class="ps-sub" style="margin-left:8px;">{{ chContract?.contractNo }}</span>
        </el-form-item>
        <el-form-item label="变更类型" prop="type">
          <el-select v-model="chForm.type" style="width:100%">
            <el-option v-for="t in CONTRACT_CHANGE_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="chForm.type !== '提前终止'" label="新合同金额">
          <el-input v-model.number="chForm.amount" placeholder="留空表示不变"><template #append>元</template></el-input>
        </el-form-item>
        <el-form-item v-if="chForm.type === '期限变更' || chForm.type === '续签'" label="新到期日">
          <el-date-picker v-model="chForm.endDate" type="date" value-format="YYYY-MM-DD" style="width:100%"
            placeholder="留空表示不变" />
        </el-form-item>
        <el-form-item v-if="chForm.type === '主体变更'" label="新乙方">
          <el-input v-model="chForm.partyB" placeholder="留空表示不变" />
        </el-form-item>
        <el-form-item label="变更原因" prop="reason">
          <el-input v-model="chForm.reason" type="textarea" :rows="3" placeholder="必填，会写进变更留痕" />
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon
          title="提交后生成变更单与审批单，审批通过才回写合同；原合同不允许直接改。" />
      </el-form>
      <template #footer>
        <el-button @click="changeVisible = false">取消</el-button>
        <el-button type="primary" @click="submitChange">提交变更审批</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  CONTRACT_CHANGE_TYPES, PAGE_SIZES, communityOpts, contractAttachmentRows, contractChanges,
  contractStatusOpts, contractSubtypeOpts, contractSummary, contractTypeOpts, contractVirtualNodes,
  getContractDetail, queryContracts, submitContractChange
} from '@/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { useFocusLanding } from '@/composables/useFocus'
import QuickViews from '@/components/QuickViews.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { maskPhone, wan } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()
const route = useRoute()
const BLANK = { ctype: '', csub: '', vf: '' }
const BLANK_ALL = { ...BLANK, communityId: '', status: '', kw: '' }


/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'contractId', label: '合同编号' },
  { prop: 'name', label: '合同名称' },
  { prop: 'type', label: '类型' },
  { prop: 'partyB', label: '相对方' },
  { prop: 'communityName', label: '项目' },
  { prop: 'amount', label: '金额' },
  { prop: 'startDate', label: '生效日' },
  { prop: 'endDate', label: '到期日' },
  { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '合同管理', source: '/c/contracts', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const { rows, total, pageNo, size, loading, query, load, search } = useListQuery(
  queryContracts, { immediate: false, filters: { ...BLANK_ALL } }
)

const vnodes = contractVirtualNodes()
/* KPI 汇总：mock 同步、http 异步，统一 await；失败保留旧值 */
const summary = ref({ total: 0, amount: 0, running: 0, expiring: 0, expired: 0, pending: 0 })
async function syncSummary() {
  try { summary.value = await contractSummary() } catch { /* 保留旧值 */ }
}
syncSummary()
/* 快捷视图：原左树的虚拟视图节点搬到这里（6 个状态视图 + 全部） */
const quickViews = [{ key: '', label: '全部', n: summary.value.total }, ...vnodes]
const expiringN = vnodes.find(v => v.key === 'expiring')?.n || 0
const statusOpts = contractStatusOpts()
const typeOpts = contractTypeOpts()
const communities = communityOpts()
/* 子类型随类型联动 */
const subOpts = computed(() => (query.ctype ? contractSubtypeOpts(query.ctype) : []))
function onType() { query.csub = ''; run() }

const highlightId = ref('')
const vnLabel = computed(() => (query.vf ? (quickViews.find(v => v.key === query.vf)?.label || '') : ''))
function run() { search() }

const hasScope = computed(() => !!(query.ctype || query.csub || query.vf || query.communityId || query.status || query.kw))
const scopeText = computed(() => {
  const parts = []
  if (query.ctype) parts.push(query.ctype)
  if (query.csub) parts.push(query.csub)
  if (query.communityId) parts.push((communities.find(c => c.id === query.communityId) || {}).name || '')
  return parts.filter(Boolean).join(' · ') || '全部合同'
})
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getContractDetail)

/* B 级补齐：下载合同附件 —— 原型无真实文件，按附件份数生成「附件清单」走下载中心 */
function doDownloadAttachments(c) {
  try {
    const rows = contractAttachmentRows(c.contractId)
    exportList({
      name: `${c.contractNo} 附件清单`, source: '/c/contracts',
      columns: [
        { prop: 'no', label: '序号' }, { prop: 'name', label: '附件名称' },
        { prop: 'file', label: '文件名' }, { prop: 'size', label: '大小' },
        { prop: 'uploadAt', label: '上传日期' }
      ],
      rows, filters: { contractId: c.contractId }
    })
  } catch (e) { ElMessage.error(e?.message || '下载失败') }
}

const REF_LABEL = { house: '房屋', parking: '车位', employee: '员工' }
function refTypeLabel(t) { return REF_LABEL[t] || '未绑定' }
function refName(d) {
  const r = d.ref
  if (!r) return '—'
  return r.fullName || r.parkNo || r.name || '—'
}
function restText(c) {
  if (c.restDays === null) return '—'
  if (c.restDays < 0) return `已过期 ${Math.abs(c.restDays)} 天`
  if (c.restDays === 0) return '今天到期'
  return `剩余 ${c.restDays} 天`
}

function clearScope() {
  Object.assign(query, BLANK_ALL)
  run()
}
function reset() { clearScope() }

function onRow(row) { openDetail(row.contractId) }
function rowClass({ row }) { return row.contractId === highlightId.value ? 'row--focus' : '' }
function jump(path, focus) { router.push(`${path}?focus=${focus}`) }
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }

/* ---------- C4 合同变更 ---------- */
const changeVisible = ref(false)
const chRef = ref()
const chContract = ref(null)
const chForm = ref({ type: '金额变更', amount: null, endDate: '', partyB: '', reason: '' })
const chRules = {
  type: [{ required: true, message: '请选择变更类型', trigger: 'change' }],
  reason: [{ required: true, message: '请填写变更原因', trigger: 'blur' }]
}
const changeRows = ref([])
watch(detailData, d => { changeRows.value = d?.contract ? contractChanges(d.contract.contractId) : [] })

function canChange(row) {
  return ['履行中', '即将到期', '待生效'].includes(row.status) && !row.changePending
}
function openChange(c, type = '金额变更') {
  if (!c) return
  if (['已到期', '已终止'].includes(c.status)) { ElMessage.warning(`合同状态「${c.status}」，不能再发起变更`); return }
  chContract.value = c
  chForm.value = { type: type || '金额变更', amount: null, endDate: '', partyB: '', reason: '' }
  changeVisible.value = true
}
async function submitChange() {
  try { await chRef.value?.validate() } catch { return }
  try {
    const res = submitContractChange(chContract.value.contractId, {
      type: chForm.value.type,
      patch: { amount: chForm.value.amount, endDate: chForm.value.endDate, partyB: chForm.value.partyB },
      reason: chForm.value.reason
    })
    ElMessage.success(`已生成变更单 ${res.change.changeNo}，审批单 ${res.approval.approvalNo}（待审批）`)
    changeVisible.value = false
    await syncSummary()
    load()
    if (detailVisible.value) openDetail(chContract.value.contractId)
  } catch (e) { ElMessage.error(e?.message || '提交失败') }
}

/* ---------- 落地：focus 锚点 + vf 虚拟节点 ---------- */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  const vf = String(route.query.vf || '')
  if (vf && vnodes.some(v => v.key === vf)) {
    Object.assign(query, BLANK_ALL)
    Object.assign(query, { vf })
    await load()
    return
  }
  if (focus && location && focus.type === 'contract') {
    Object.assign(query, BLANK_ALL)
    Object.assign(query, {
      ctype: location.ctype || '',
      csub: location.csub || '',
      communityId: location.communityId || ''
    })
    await load()
    highlightId.value = focus.id
    if (open) openDetail(focus.id)
    return
  }
  Object.assign(query, BLANK_ALL)
  await load()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-sub.is-expire { color: var(--biz-danger); }
.num { font-family: var(--biz-font-num); }
</style>
