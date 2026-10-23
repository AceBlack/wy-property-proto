<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>公告通知 · 以「发布」为行</b>：一条公告 = 一次对业主的触达动作，所以要盯的不是「写了没写」，而是<b>触达率</b>——
        <b>{{ summary.lowRead }} 条已发布公告触达率低于 60%</b>，进常用视图可直接筛出来补推。
        树轴按<b>公告类型 → 项目</b>切，与业主视角的「按类找公告」一致。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">公告总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">已发布</div><div class="dstat__v">{{ summary.published }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">平均触达率</div><div class="dstat__v">{{ summary.avgReadRate }}<span class="unit">%</span></div></div>
        <div class="dstat"><div class="dstat__k">低触达 / 待审</div><div class="dstat__v" :class="summary.lowRead > 0 ? 'is-warn' : ''">{{ summary.lowRead }} / {{ summary.pending }}<span class="unit">条</span></div></div>
      </div>
      <div class="sum-note">
        口径：触达率 = 已读户数 / 覆盖户数，只统计已发布公告；草稿与待审核不计入。已过期 {{ summary.expired }} 条仍可查看，但不参与触达统计。
      </div>
    </div>

    <div class="ia" :class="{ 'is-collapsed': treeCollapsed }" style="margin-top:16px;">
      <div class="ia__tree">
        <SpaceTree
          title="公告范围" tree-title="公告类型 / 项目"
          :nodes="tree" :virtual="vnodes"
          placeholder="搜类型 / 项目"
          :active-id="activeId" :active-vn="activeVn"
          @pick="onPick" @collapse="treeCollapsed = true"
        />
      </div>

      <div class="ia__main">
        <el-button v-if="treeCollapsed" class="ia__handle" size="small" :icon="'Expand'" @click="treeCollapsed = false">
          展开公告树
        </el-button>

        <div class="panel">
          <div class="scopebar">
            <template v-if="scopePath.length">
              <span v-for="(p, i) in scopePath" :key="p">
                <span class="scopebar__i" :class="{ 'is-last': i === scopePath.length - 1 }" @click="onCrumb(i)">{{ p }}</span>
                <span v-if="i < scopePath.length - 1" class="scopebar__sep">/</span>
              </span>
            </template>
            <span v-else class="scopebar__i is-last">全部公告</span>
            <span v-if="activeVn" class="scopebar__vf">{{ vnLabel }}</span>
            <span class="spacer" />
            <span class="scopebar__hint">树定范围 · 筛选定属性</span>
            <el-button link type="primary" @click="clearScope">清除范围</el-button>
          </div>

          <el-form :model="query" class="filter-bar" label-width="56px" @submit.prevent>
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
              <el-input v-model="query.kw" placeholder="标题 / 编号 / 发布人" clearable style="width:150px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Plus'" @click="openNotice(null)">新建公告</el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 条公告</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 500px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column label="公告标题" min-min-width="220">
              <template #default="{ row }">
                <div class="nowrap">{{ row.title }}</div>
                <div class="ps-sub">{{ row.noticeId }}</div>
              </template>
            </el-table-column>
            <el-table-column label="类型" min-width="84">
              <template #default="{ row }">
                <div class="nowrap">{{ row.type }}</div>
                <el-tag v-if="row.top" size="small" type="danger" effect="plain" style="margin-top:2px">置顶</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="communityName" label="项目" min-width="92" show-overflow-tooltip />
            <el-table-column prop="channelText" label="发布渠道" min-min-width="120" show-overflow-tooltip />
            <el-table-column label="发布" min-width="112">
              <template #default="{ row }">
                <div class="nowrap">{{ row.publisher }}</div>
                <div class="ps-sub">{{ row.publishTime }}</div>
              </template>
            </el-table-column>
            <el-table-column label="触达" min-width="96">
              <template #default="{ row }">
                <span class="num" :class="{ 'is-low': row.status === '已发布' && row.readRate < 60 }">{{ row.readRate }}%</span>
                <div class="ps-sub">{{ row.readCount }} / {{ row.targetHouses }} 户</div>
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="92">
              <template #default="{ row }"><StatusTag domain="notice" :value="row.status" /></template>
            </el-table-column>
            <el-table-column label="操作" width="176" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
                <el-button v-if="canEdit(row)" link type="primary" @click.stop="openNotice(row)">编辑</el-button>
                <el-button v-if="row.status === '已发布'" link type="warning" @click.stop="doWithdraw(row)">撤回</el-button>
                <el-button v-if="['已撤回', '草稿'].includes(row.status)" link type="success" @click.stop="doRepublish(row)">重发</el-button>
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
      :title="detailData ? detailData.notice.title : ''"
      :subtitle="detailData ? `${detailData.notice.noticeId} · ${detailData.notice.type} · ${detailData.notice.communityName}` : ''"
      :status="detailData?.notice?.status" status-domain="notice"
      :tag="detailData?.notice?.top ? '置顶' : ''"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">覆盖户数</div><div class="dstat__v">{{ detailData.notice.targetHouses }}<span class="unit">户</span></div></div>
          <div class="dstat"><div class="dstat__k">已读</div><div class="dstat__v">{{ detailData.notice.readCount }}<span class="unit">户</span></div></div>
          <div class="dstat"><div class="dstat__k">触达率</div><div class="dstat__v" :class="detailData.notice.readRate < 60 ? 'is-warn' : ''">{{ detailData.notice.readRate }}<span class="unit">%</span></div></div>
          <div class="dstat"><div class="dstat__k">未读</div><div class="dstat__v">{{ detailData.unreached }}<span class="unit">户</span></div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>公告信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">公告编号</span><span class="dl__v">{{ detailData.notice.noticeId }}</span></div>
          <div class="dl__i"><span class="dl__k">公告类型</span><span class="dl__v">{{ detailData.notice.type }}</span></div>
          <div class="dl__i"><span class="dl__k">发布项目</span><span class="dl__v">{{ detailData.notice.communityName }}</span></div>
          <div class="dl__i"><span class="dl__k">发布渠道</span><span class="dl__v">{{ detailData.notice.channelText }}</span></div>
          <div class="dl__i"><span class="dl__k">起草人</span><span class="dl__v">{{ detailData.notice.publisher }}</span></div>
          <div class="dl__i"><span class="dl__k">发布时间</span><span class="dl__v">{{ detailData.notice.publishTime }}</span></div>
          <div class="dl__i"><span class="dl__k">审核人</span><span class="dl__v">{{ detailData.notice.auditBy || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">审核时间</span><span class="dl__v">{{ detailData.notice.auditTime || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">附件</span><span class="dl__v">{{ detailData.notice.attachments }} 个</span></div>
          <div class="dl__i is-full"><span class="dl__k">正文</span><span class="dl__v">{{ detailData.notice.content }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>触达进度</h4><span class="desc">起草 → 审核 → 发布 → 触达</span></div>
        <div class="tl">
          <div v-for="(l, i) in detailData.timeline" :key="i" class="tl__i" :class="{ 'is-done': l.done }">
            <div class="tl__t">{{ l.title }}</div>
            <div class="tl__m">{{ l.memo }}</div>
          </div>
        </div>

        <div class="rel">
          <el-button v-if="detailData.notice.type === '收费通知' && detailData.notice.communityId" size="small"
            @click="jump('/b/bills', 'community:' + detailData.notice.communityId)">查看该项目账单</el-button>
          <span class="rel__note">未读户数由「覆盖户数 - 已读数」派生；停水停电、安全提示类公告触达率低于 60% 应触发短信补推</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button @click="doRepush(detailData.notice)">补推未读</el-button>
        <el-button v-if="detailData?.notice?.status === '已发布'" type="warning" @click="doWithdraw(detailData.notice)">撤回</el-button>
        <el-button v-if="canEdit(detailData?.notice)" type="primary" @click="openNotice(detailData.notice)">编辑</el-button>
        <el-button v-if="['已撤回', '草稿'].includes(detailData?.notice?.status)" type="success" @click="doRepublish(detailData.notice)">重新发布</el-button>
      </template>
    </DetailDrawer>

    <!-- C2：公告新建 / 编辑重发（发布范围 · 渠道 · 定时发布） -->
    <el-dialog v-model="nVisible" :title="nForm.noticeId ? `编辑公告 · ${nForm.noticeId}` : '新建公告'" width="640">
      <el-form ref="nRef" :model="nForm" :rules="nRules" label-width="88px">
        <el-form-item label="公告标题" prop="title">
          <el-input v-model="nForm.title" placeholder="如：10 月物业费收缴通知" maxlength="40" show-word-limit />
        </el-form-item>
        <el-form-item label="公告类型" prop="type">
          <el-select v-model="nForm.type" style="width:180px">
            <el-option v-for="t in NOTICE_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="发布范围" prop="communityId">
          <el-select v-model="nForm.communityId" style="width:180px">
            <el-option v-for="s in NOTICE_SCOPES" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
          <span class="muted" style="font-size:12px;margin-left:10px;">覆盖 {{ coverHouses }} 户</span>
        </el-form-item>
        <el-form-item label="发布渠道" prop="channels">
          <el-checkbox-group v-model="nForm.channels">
            <el-checkbox v-for="c in NOTICE_CHANNELS" :key="c" :label="c">{{ c }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="正文" prop="content">
          <el-input v-model="nForm.content" type="textarea" :rows="4" placeholder="公告正文，不少于 10 个字" maxlength="500" show-word-limit />
        </el-form-item>
        <el-form-item label="发布方式">
          <el-radio-group v-model="nMode">
            <el-radio label="audit">提交审核后发布</el-radio>
            <el-radio label="now">审核通过后立即发布</el-radio>
            <el-radio label="schedule">定时发布</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="nMode === 'schedule'" label="计划时间" prop="scheduledAt">
          <el-date-picker v-model="nForm.scheduledAt" type="datetime" value-format="YYYY-MM-DD HH:mm"
            placeholder="选择计划发布时间" style="width:220px" />
        </el-form-item>
        <el-form-item label="其他">
          <el-checkbox v-model="nForm.top" label="置顶公告" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="nVisible = false">取消</el-button>
        <el-button type="primary" @click="saveNotice">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  NOTICE_CHANNELS, NOTICE_SCOPES, NOTICE_TYPES, PAGE_SIZES, communityOpts,
  createNotice, getNoticeDetail, noticeStatusOpts, noticeSummary, noticeTree,
  noticeVirtualNodes, queryNotices, republishNotice, repushNotice, updateNotice, withdrawNotice
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { pathOf, useFocusLanding } from '@/composables/useFocus'
import SpaceTree from '@/components/SpaceTree.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

const router = useRouter()
const route = useRoute()
const BLANK = { ntype: '', vf: '' }
const BLANK_ALL = { ...BLANK, communityId: '', status: '', kw: '' }


/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'noticeId', label: '公告编号' },
  { prop: 'title', label: '标题' },
  { prop: 'communityName', label: '项目' },
  { prop: 'channelText', label: '发布渠道' },
  { prop: 'publishTime', label: '发布时间' },
  { prop: 'readRate', label: '阅读率' },
  { prop: 'status', label: '状态' },
  { prop: 'publisher', label: '发布人' }
]
function onExport() {
  exportList({ name: '公告通知', source: '/c/notices', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const { rows, total, pageNo, size, loading, query, load, search } = useListQuery(
  queryNotices, { immediate: false, filters: { ...BLANK_ALL } }
)

const tree = noticeTree()
const vnodes = noticeVirtualNodes()
const summary = ref(noticeSummary())   // 写操作后需刷新，故用 ref
const statusOpts = noticeStatusOpts()
const communities = communityOpts()

const treeCollapsed = ref(false)
const activeId = ref('')
const activeChain = ref([])
const activeVn = ref('')
const scopePath = ref([])
const highlightId = ref('')

const vnLabel = computed(() => vnodes.find(v => v.key === activeVn.value)?.label || '')
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getNoticeDetail)

/* B 级补齐：短信补推未读业主（覆盖户数 - 已读），累计记录 */
async function doRepush(n) {
  try {
    const r = repushNotice(n.noticeId)
    summary.value = noticeSummary()
    await load()
    openDetail(n.noticeId)
    ElMessage.success(`已补推 ${r.unread} 户未读业主（${r.channels.join(' / ')}），累计补推 ${r.total} 户`)
  } catch (e) { ElMessage.error(e?.message || '补推失败') }
}

const flatNode = new Map()
;(function flatten(list) {
  list.forEach(n => {
    flatNode.set(n.id, n)
    if (n.children?.length) flatten(n.children)
  })
})(tree)

function onPick(node) {
  Object.assign(query, BLANK_ALL)
  Object.assign(query, node.patch || {})
  if (node.kind === 'virtual') {
    activeId.value = ''
    activeChain.value = []
    activeVn.value = node.key
    scopePath.value = []
  } else {
    activeId.value = node.id
    activeChain.value = node.chain || [node.id]
    activeVn.value = ''
    scopePath.value = node.path || []
  }
  search()
}
function onCrumb(index) {
  if (index >= activeChain.value.length - 1) return
  const node = flatNode.get(activeChain.value[index])
  if (!node) return
  Object.assign(query, BLANK_ALL)
  Object.assign(query, node.patch)
  activeId.value = node.id
  activeChain.value = activeChain.value.slice(0, index + 1)
  scopePath.value = scopePath.value.slice(0, index + 1)
  activeVn.value = ''
  search()
}
function clearScope() {
  Object.assign(query, BLANK_ALL)
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  search()
}
function reset() { clearScope() }

function onRow(row) { openDetail(row.noticeId) }
function rowClass({ row }) { return row.noticeId === highlightId.value ? 'row--focus' : '' }
function jump(path, focus) { router.push(`${path}?focus=${focus}`) }
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }

/* ---------- C2 公告：新建 / 编辑 / 撤回 / 重发（内存态） ---------- */
/** 可编辑状态：草稿、已撤回、待审核；已发布与已过期须先撤回 */
function canEdit(row) { return !!row && ['草稿', '已撤回', '待审核'].includes(row.status) }

const nVisible = ref(false)
const nRef = ref(null)
const nMode = ref('audit')
const blankNotice = () => ({
  noticeId: '', title: '', type: '政策公告', communityId: 'P01',
  channels: ['App 推送'], content: '', top: false, scheduledAt: ''
})
const nForm = ref(blankNotice())
const nRules = {
  title: [{ required: true, message: '请输入公告标题', trigger: 'blur' }],
  type: [{ required: true, message: '请选择公告类型', trigger: 'change' }],
  communityId: [{ required: true, message: '请选择发布范围', trigger: 'change' }],
  channels: [{ required: true, message: '请至少选择一个发布渠道', trigger: 'change' }],
  content: [{ required: true, min: 10, message: '公告正文不少于 10 个字', trigger: 'blur' }],
  scheduledAt: [{ required: true, message: '请选择计划发布时间', trigger: 'change' }]
}
const coverHouses = computed(() => {
  const s = NOTICE_SCOPES.find(x => x.value === nForm.value.communityId)
  return s ? (s.value === 'ALL' ? 736 : { P01: 264, P02: 236, P03: 236 }[s.value] || 0) : 0
})
function openNotice(row) {
  if (row) {
    nForm.value = {
      noticeId: row.noticeId, title: row.title, type: row.type,
      communityId: row.communityId, channels: [...(row.channels || [])],
      content: row.content || '', top: !!row.top, scheduledAt: row.scheduledAt || ''
    }
    nMode.value = row.scheduledAt ? 'schedule' : (row.status === '已撤回' ? 'audit' : 'audit')
  } else {
    nForm.value = blankNotice()
    nMode.value = 'audit'
  }
  nVisible.value = true
}
async function saveNotice() {
  try {
    await nRef.value.validate()
    const payload = { ...nForm.value }
    if (nMode.value !== 'schedule') payload.scheduledAt = ''
    payload.submitAudit = nMode.value !== 'now'
    if (payload.noticeId) {
      updateNotice(payload.noticeId, payload)
      ElMessage.success(`公告「${payload.title}」已更新`)
    } else {
      const r = createNotice(payload)
      ElMessage.success(r.scheduledAt ? `公告已创建，将在 ${r.scheduledAt} 发布` : `公告已创建，状态：${r.status}`)
    }
    nVisible.value = false
    summary.value = noticeSummary()
    search()
  } catch (e) {
    if (e?.message) ElMessage.error(e.message)
  }
}
async function doWithdraw(row) {
  try {
    const { value } = await ElMessageBox.prompt('撤回后公告对所有业主不可见，可编辑后重新发布。', '撤回公告', {
      inputPlaceholder: '撤回原因', inputValue: '内容有误，撤回修改', type: 'warning'
    })
    withdrawNotice(row.noticeId, value || '')
    ElMessage.success(`已撤回「${row.title}」，可编辑后重发`)
    detailVisible.value = false
    summary.value = noticeSummary()
    search()
  } catch (e) {
    if (e?.message && e !== 'cancel') ElMessage.error(e.message)
  }
}
function doRepublish(row) {
  try {
    republishNotice(row.noticeId, { submitAudit: true })
    ElMessage.success(`「${row.title}」已提交审核，审核通过后发布`)
    detailVisible.value = false
    summary.value = noticeSummary()
    search()
  } catch (e) { ElMessage.error(e?.message || '重发失败') }
}

/* ---------- 落地：focus 锚点 + vf 虚拟节点 ---------- */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  const vf = String(route.query.vf || '')
  if (vf && vnodes.some(v => v.key === vf)) {
    Object.assign(query, { ...BLANK_ALL, vf })
    activeId.value = ''
    activeChain.value = []
    activeVn.value = vf
    scopePath.value = []
    await load()
    return
  }
  if (focus && location && focus.type === 'notice') {
    const ckey = location.communityId || 'ALL'
    Object.assign(query, { ...BLANK_ALL, ntype: location.ntype || '', communityId: location.communityId || '' })
    if (location.ntype) {
      activeId.value = ckey === 'ALL' ? `N:${location.ntype}` : `N:${location.ntype}:${ckey}`
      activeChain.value = [`N:${location.ntype}`, activeId.value]
      scopePath.value = pathOf(tree, activeId.value)
    } else {
      activeId.value = ''
      activeChain.value = []
      scopePath.value = []
    }
    activeVn.value = ''
    await load()
    highlightId.value = focus.id
    if (open) openDetail(focus.id)
    return
  }
  clearScope()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num { font-family: var(--biz-font-num); }
.num.is-low { color: var(--biz-danger); }
</style>
