<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>巡检任务列表 · L4 批量页</b>：与「巡检任务执行」页互补——执行页是单任务作业台，
        本页是全量任务的监管视图（状态 / 异常 / 转单）。取数走
        <code>api.queryInspectTasks / getInspectTaskDetail</code>。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">任务总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">已完成</div><div class="dstat__v">{{ summary.done }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">逾期</div><div class="dstat__v" :class="summary.overdue > 0 ? 'is-warn' : ''">{{ summary.overdue }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">异常项占比</div><div class="dstat__v">{{ pct(summary.issueRate) }}</div></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px">
            <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
          </el-select>
        </el-form-item>
        <el-form-item label="岗位">
          <el-select v-model="query.post" placeholder="全部" clearable style="width:110px">
            <el-option v-for="o in postOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width:120px">
            <el-option v-for="o in statusOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="任务号 / 计划 / 执行人" clearable style="width:190px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <el-button :icon="'Warning'" @click="quick('逾期')">只看逾期</el-button>
        <el-button :icon="'Refresh'" circle title="刷新" @click="load" style="margin-left:auto;" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 条</span>
      </div>

      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 400px)" @row-click="onRow">
        <el-table-column prop="taskId" label="任务号" width="95" />
        <el-table-column prop="planName" label="计划" min-width="130" show-overflow-tooltip />
        <el-table-column prop="post" label="岗位" width="70" />
        <el-table-column prop="communityName" label="项目" min-width="110" show-overflow-tooltip />
        <el-table-column prop="executor" label="执行人" width="90" />
        <el-table-column prop="scheduledDate" label="计划日期" width="105" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }"><StatusTag domain="inspect" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="进度" width="100">
          <template #default="{ row }">
            <span class="money">{{ row.normalCount || 0 }}</span>
            <span class="muted"> / {{ row.itemCount }}</span>
            <span v-if="row.issueCount" class="money money--out" style="margin-left:6px;">异 {{ row.issueCount }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="score" label="得分" width="70" align="right">
          <template #default="{ row }">
            <span class="money" :class="row.score && row.score < 80 ? 'money--out' : ''">{{ row.score || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="doneTime" label="完成时间" width="120" />
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
            <el-button link type="primary" @click.stop="goExec(row)">去执行</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="search" desc="换个筛选条件，或清除全部条件重新查看">
            <template #action><el-button @click="reset">清除筛选条件</el-button></template>
          </EmptyState>
        </template>
      </el-table>

      <div class="table-foot">
        <el-pagination v-model:current-page="pageNo" v-model:page-size="size"
          :page-sizes="PAGE_SIZES" :total="total" layout="total, sizes, prev, pager, next, jumper" />
      </div>
    </div>

    <DetailDrawer
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.task?.planName"
      :subtitle="detailData ? `${detailData.task.taskId} · ${detailData.community?.name || '-'} · ${detailData.task.executor}` : ''"
      :status="detailData?.task?.status" status-domain="inspect"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">检查项</div><div class="dstat__v">{{ detailData.task.itemCount }}<span class="unit">项</span></div></div>
          <div class="dstat"><div class="dstat__k">合格</div><div class="dstat__v">{{ detailData.task.normalCount || 0 }}<span class="unit">项</span></div></div>
          <div class="dstat"><div class="dstat__k">异常</div><div class="dstat__v" :class="detailData.task.issueCount > 0 ? 'is-warn' : ''">{{ detailData.task.issueCount || 0 }}<span class="unit">项</span></div></div>
          <div class="dstat"><div class="dstat__k">得分</div><div class="dstat__v">{{ detailData.task.score || '—' }}</div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>任务信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">任务号</span><span class="dl__v">{{ detailData.task.taskId }}</span></div>
          <div class="dl__i"><span class="dl__k">所属计划</span><span class="dl__v">{{ detailData.task.planName }}</span></div>
          <div class="dl__i"><span class="dl__k">岗位</span><span class="dl__v">{{ detailData.task.post }}</span></div>
          <div class="dl__i"><span class="dl__k">执行人</span><span class="dl__v">{{ detailData.task.executor }}</span></div>
          <div class="dl__i"><span class="dl__k">计划时间</span><span class="dl__v">{{ detailData.task.scheduledDate }} {{ detailData.task.scheduledTime }}</span></div>
          <div class="dl__i"><span class="dl__k">完成时间</span><span class="dl__v">{{ detailData.task.doneTime || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">耗时</span><span class="dl__v">{{ detailData.task.duration || '—' }} 分钟</span></div>
          <div class="dl__i"><span class="dl__k">打卡方式</span><span class="dl__v">{{ detailData.task.checkinType || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">现场照片</span><span class="dl__v">{{ detailData.task.photos || 0 }} 张</span></div>
          <div class="dl__i is-full"><span class="dl__k">GPS</span><span class="dl__v">{{ detailData.task.gps || '—' }}</span></div>
        </div>

        <template v-if="detailData.template">
          <div class="sec__hd" style="margin-top:18px;"><h4>检查模板</h4><span class="desc">{{ detailData.template.name }} {{ detailData.template.version }}</span></div>
          <el-table :data="detailData.template.fields || []" size="small">
            <el-table-column prop="label" label="检查项" min-width="160" show-overflow-tooltip />
            <el-table-column prop="type" label="采集方式" width="90" />
            <el-table-column prop="standard" label="合格标准" min-width="180" show-overflow-tooltip />
          </el-table>
        </template>

        <div v-if="detailData.workOrder" class="sec__hd" style="margin-top:18px;">
          <h4>已转工单</h4><span class="desc">{{ detailData.workOrder.woNo }} · {{ detailData.workOrder.status }}</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" @click="goExec(detailData?.task)">去执行</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, communities, getInspectTaskDetail, inspectSummary, queryInspectTasks,
  taskPostOpts, taskStatusOpts
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { pct } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()
const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryInspectTasks, { filters: { communityId: '', post: '', status: '', kw: '' } }
)
const summary = inspectSummary()
const postOpts = taskPostOpts()
const statusOpts = taskStatusOpts()
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getInspectTaskDetail)

function onRow(row) { openDetail(row.taskId) }
/** 一键只看逾期：把状态筛选落到「逾期」再查，避免页面另起一套过滤 */
function quick(status) { query.status = status; search() }
function goExec(row) { if (row) router.push('/f/inspect') }

/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'taskId', label: '任务号' }, { prop: 'planName', label: '计划' },
  { prop: 'post', label: '岗位' }, { prop: 'communityName', label: '项目' },
  { prop: 'executor', label: '执行人' }, { prop: 'scheduledDate', label: '计划日期' },
  { prop: 'status', label: '状态' }, { prop: 'score', label: '得分' },
  { prop: 'doneTime', label: '完成时间' }
]
function onExport() {
  exportList({ name: '巡检任务', source: '/f/inspect-tasks', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}
</script>
