<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>我的申请</b>：我提交过的 OA 单据与当前进度。
        <br />
        <b>只有「待审批」（还没人处理）能撤回</b> —— 一旦有人受理（审批中）就撤不回了，
        要作废只能让审批人驳回，否则"批到一半申请人抽单"会让流程和数据都失真。
        <br />
        审批人处理入口在 <b>待办中心 → 审批单</b>，与合同审批共用同一个处理页。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">合计</div><div class="dstat__v">{{ sum.total }}<span class="unit">张</span></div></div>
        <div class="dstat"><div class="dstat__k">在途</div><div class="dstat__v" :class="sum.live ? 'is-warn' : ''">{{ sum.live }}<span class="unit">张</span></div></div>
        <div class="dstat"><div class="dstat__k">已办结</div><div class="dstat__v">{{ sum.done }}<span class="unit">张</span></div></div>
        <div class="dstat"><div class="dstat__k">涉及类型</div><div class="dstat__v">{{ sum.types }}<span class="unit">类</span></div></div>
      </div>
      <div class="sum-note">
        提报人：{{ me.name }} · {{ me.position }} · {{ me.orgName }}（按当前角色自动带出，切换角色会看到对应人的申请）
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="56px" @submit.prevent>
        <el-form-item label="类型">
          <el-select v-model="query.bizType" placeholder="全部" clearable style="width:130px">
            <el-option v-for="t in OA_BIZ_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width:110px">
            <el-option v-for="s in STATUS_OPTS" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="单号 / 标题" clearable style="width:170px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>

      <div class="toolbar">
        <el-button type="primary" :icon="'Plus'" @click="$router.push('/c/oa-apply')">发起申请</el-button>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 张</span>
      </div>

      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 520px)"
        :row-class-name="rowClass" @row-click="onRow">
        <el-table-column label="单据" min-width="240">
          <template #default="{ row }">
            <div class="nowrap">{{ row.title }}</div>
            <div class="ps-sub">{{ row.approvalNo }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="bizType" label="类型" width="104" />
        <el-table-column label="金额" width="104" align="right">
          <template #default="{ row }">
            <span v-if="row.amount" class="num">¥{{ row.amount.toLocaleString('zh-CN') }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="applyTime" label="提交时间" width="136" />
        <el-table-column label="当前节点" min-width="132">
          <template #default="{ row }">
            <span :class="{ 'is-live': isLive(row) }">{{ isLive(row) ? row.currentNode : '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <span class="tag" :class="toneOf(row.status)">{{ row.status }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="112" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
            <el-button v-if="row.status === '待审批'" link type="danger" @click.stop="onWithdraw(row)">撤回</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="empty" desc="还没有提交过申请">
            <template #action>
              <el-button type="primary" @click="$router.push('/c/oa-apply')">去发起</el-button>
            </template>
          </EmptyState>
        </template>
      </el-table>

      <div class="table-foot">
        <el-pagination v-model:current-page="pageNo" v-model:page-size="size"
          :page-sizes="PAGE_SIZES" :total="total" layout="total, sizes, prev, pager, next, jumper" />
      </div>
    </div>

    <DetailDrawer
      v-model="detailVisible" :loading="detailLoading"
      :title="detailData ? detailData.title : ''"
      :subtitle="detailData ? `${detailData.approvalNo} · ${detailData.bizType} · ${detailData.applyTime} 提交` : ''"
      :status="detailData?.status" status-domain="approval"
    >
      <template v-if="detailData">
        <!-- 审批单没有业务实体，内容全在 formData 里，按表单定义还原 -->
        <div class="sec__hd"><h4>申请内容</h4><span class="desc">{{ fieldRows.length }} 项</span></div>
        <div class="dl">
          <div v-for="f in fieldRows" :key="f.key" class="dl__i">
            <span class="dl__k">{{ f.label }}</span>
            <span class="dl__v">
              {{ f.type === 'money' ? '¥' + Number(f.value).toLocaleString('zh-CN') : f.value }}{{ f.unit ? ' ' + f.unit : '' }}
            </span>
          </div>
          <div class="dl__i is-full">
            <span class="dl__k">提报人</span>
            <span class="dl__v">{{ detailData.applicant }} · {{ detailData.applicantRole }} · {{ detailData.applicantOrgName || '—' }}</span>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>审批流程</h4>
          <span class="desc">{{ flowNodes.length }} 级</span>
        </div>
        <div class="ap-flow">
          <div v-for="(n, i) in flowNodes" :key="i" class="ap-flow__i" :class="'is-' + n.st">
            <span class="ap-flow__dot" />
            <div>
              <div class="ap-flow__n">
                {{ n.node }}
                <span class="ap-flow__act">{{ n.action }}</span>
              </div>
              <div class="ap-flow__m">{{ n.handler || '待指派' }}<template v-if="n.time"> · {{ n.time }}</template></div>
              <div v-if="n.comment" class="ap-flow__c">{{ n.comment }}</div>
            </div>
          </div>
        </div>

        <div class="oa-note">
          本期审批<b>通过即结束</b>，不会自动生成付款单 / 写入考勤 / 生成采购单。
          需要落业务结果的，后续单独排批。
        </div>
      </template>

      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button
          v-if="detailData?.status === '待审批'" type="danger" plain
          @click="onWithdraw(detailData)"
        >撤回申请</el-button>
        <el-button
          v-if="isLive(detailData)" type="primary"
          @click="$router.push(`/c/approval/${detailData.approvalId}`)"
        >去处理</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  OA_BIZ_TYPES, PAGE_SIZES, currentOperator, getApproval, oaFieldRows, oaSummary,
  queryOaRequests, withdrawOaRequest
} from '@/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import DetailDrawer from '@/components/DetailDrawer.vue'
import EmptyState from '@/components/EmptyState.vue'

const STATUS_OPTS = ['待审批', '审批中', '已通过', '已驳回', '已撤回']
const me = currentOperator()
const sum = oaSummary()

const { rows, total, pageNo, size, loading, query, load, search } = useListQuery(
  queryOaRequests, { filters: { bizType: '', status: '', kw: '' } }
)
const { data: detailData, visible: detailVisible, loading: detailLoading, open } = useDetail(getApproval)

const isLive = r => r && ['待审批', '审批中'].includes(r.status)
const TONE = { 待审批: 'tag--warning', 审批中: 'tag--warning', 已通过: 'tag--success', 已驳回: 'tag--danger', 已撤回: 'tag--muted' }
const toneOf = s => TONE[s] || 'tag--muted'
const rowClass = ({ row }) => (isLive(row) ? 'is-live-row' : '')

function onRow(row) { open(row.approvalId) }

const fieldRows = computed(() => (detailData.value ? oaFieldRows(detailData.value) : []))
const flowNodes = computed(() => {
  const a = detailData.value
  if (!a) return []
  let hit = false
  return (a.flow || []).map(n => {
    let st = 'done'
    if (n.action === '驳回') st = 'reject'
    else if (n.action === '撤回') st = 'void'
    else if (n.action === '待处理') { if (!hit) { st = 'now'; hit = true } else st = 'wait' }
    return { ...n, st }
  })
})

async function onWithdraw(row) {
  try {
    await ElMessageBox.confirm(
      `撤回后该单作废，需要重新发起。单号 ${row.approvalNo}。`,
      '撤回申请', { confirmButtonText: '确认撤回', cancelButtonText: '再想想', type: 'warning' }
    )
  } catch { return }
  try {
    withdrawOaRequest(row.approvalId, '申请人主动撤回')
    ElMessage.success('已撤回')
    detailVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function reset() {
  query.bizType = ''
  query.status = ''
  query.kw = ''
  search()
}
</script>

<style scoped>
.is-live { color: var(--biz-warning, #d98a1f); }
:deep(.el-table .is-live-row) { background: rgba(217, 138, 31, .035); }

.ap-flow { padding: 4px 0 2px; }
.ap-flow__i { position: relative; display: flex; gap: 12px; padding: 0 0 14px 14px; }
.ap-flow__i:last-child { padding-bottom: 0; }
.ap-flow__i::before {
  content: ''; position: absolute; left: 3px; top: 13px; bottom: 0; width: 1px;
  background: var(--biz-border, #eef0f6);
}
.ap-flow__i:last-child::before { display: none; }
.ap-flow__dot {
  position: absolute; left: 0; top: 4px; width: 7px; height: 7px; border-radius: 50%;
  background: #dfe3ee;
}
.ap-flow__i.is-done .ap-flow__dot { background: #12b98a; }
.ap-flow__i.is-now .ap-flow__dot { background: var(--biz-warning, #d98a1f); box-shadow: 0 0 0 3px rgba(217, 138, 31, .18); }
.ap-flow__i.is-reject .ap-flow__dot { background: var(--biz-danger, #e34d59); }
.ap-flow__n { font-size: 12.5px; display: flex; align-items: center; gap: 6px; }
.ap-flow__i.is-wait .ap-flow__n { color: var(--biz-text-3); }
.ap-flow__act {
  padding: 0 5px; border-radius: 3px; font-size: 10.5px;
  background: var(--biz-bg-fill); color: var(--biz-text-3);
}
.ap-flow__i.is-done .ap-flow__act { background: rgba(18, 185, 138, .1); color: #12b98a; }
.ap-flow__i.is-now .ap-flow__act { background: rgba(217, 138, 31, .12); color: var(--biz-warning, #d98a1f); }
.ap-flow__m { margin-top: 1px; font-size: 11.5px; color: var(--biz-text-3); }
.ap-flow__c { margin-top: 2px; font-size: 11.5px; color: var(--biz-text-2); }
.oa-note {
  margin-top: 14px; padding: 9px 12px; border-radius: 7px; font-size: 12px; line-height: 1.8;
  background: var(--biz-bg-fill); color: var(--biz-text-3);
}
</style>
