<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>巡检计划 · L4 批量页</b>：继承列表模板。计划 = 巡检任务的生成器，
        列表同时给出「已生成任务 / 已完成 / 异常项」，便于判断计划是否真的在跑；
        取数走 <code>api.queryInspectPlans / getInspectPlanDetail</code>。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">计划总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">个</span></div></div>
        <div class="dstat"><div class="dstat__k">启用中</div><div class="dstat__v">{{ summary.enabled }}<span class="unit">个</span></div></div>
        <div class="dstat"><div class="dstat__k">累计生成任务</div><div class="dstat__v">{{ summary.taskTotal }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">已停用</div><div class="dstat__v">{{ summary.stopped }}<span class="unit">个</span></div></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px">
            <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="query.taskType" placeholder="全部" clearable style="width:110px">
            <el-option label="执行（一线作业）" value="执行" />
            <el-option label="监督（组长核验）" value="监督" />
          </el-select>
        </el-form-item>
        <el-form-item label="岗位">
          <el-select v-model="query.post" placeholder="全部" clearable style="width:110px">
            <el-option v-for="o in postOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="周期">
          <el-select v-model="query.cycle" placeholder="全部" clearable style="width:110px">
            <el-option v-for="o in cycleOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width:110px">
            <el-option label="启用" value="启用" /><el-option label="停用" value="停用" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="编号 / 名称 / 执行人" clearable style="width:180px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Plus'" @click="goNew">新建计划</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 个计划</span>
      </div>

      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 400px)" @row-click="onRow">
        <el-table-column prop="planId" label="编号" width="80" />
        <el-table-column prop="name" label="计划名称" min-width="135" show-overflow-tooltip />
        <el-table-column label="类型" width="82">
          <template #default="{ row }">
            <el-tag :type="row.taskType === '监督' ? 'warning' : 'info'" effect="plain" size="small">
              {{ row.taskType || '执行' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="post" label="岗位" width="75" />
        <el-table-column prop="cycle" label="周期" width="70" />
        <el-table-column prop="templateName" label="检查模板" min-width="120" show-overflow-tooltip />
        <el-table-column prop="communityName" label="项目" min-width="110" show-overflow-tooltip />
        <el-table-column prop="executor" label="默认执行人" width="95" />
        <el-table-column prop="items" label="检查项" width="70" align="right" />
        <el-table-column label="任务" width="70" align="right">
          <template #default="{ row }"><span class="money">{{ row.taskCount }}</span></template>
        </el-table-column>
        <el-table-column label="已完成" width="75" align="right">
          <template #default="{ row }"><span class="money">{{ row.doneCount }}</span></template>
        </el-table-column>
        <el-table-column label="异常项" width="80" align="right">
          <template #default="{ row }">
            <span class="money" :class="row.issueCount > 0 ? 'money--out' : ''">{{ row.issueCount }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }"><StatusTag domain="plan" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="操作" width="70" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
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
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.plan?.name"
      :subtitle="detailData ? `${detailData.plan.planId} · ${detailData.plan.cycle} · ${detailData.plan.communityName}` : ''"
      :status="detailData?.plan?.status" status-domain="plan"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">检查项</div><div class="dstat__v">{{ detailData.plan.items }}<span class="unit">项</span></div></div>
          <div class="dstat"><div class="dstat__k">生成任务</div><div class="dstat__v">{{ detailData.plan.taskCount }}<span class="unit">条</span></div></div>
          <div class="dstat"><div class="dstat__k">已完成</div><div class="dstat__v">{{ detailData.plan.doneCount }}<span class="unit">条</span></div></div>
          <div class="dstat"><div class="dstat__k">异常项</div><div class="dstat__v" :class="detailData.plan.issueCount > 0 ? 'is-warn' : ''">{{ detailData.plan.issueCount }}<span class="unit">项</span></div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>计划配置</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">计划编号</span><span class="dl__v">{{ detailData.plan.planId }}</span></div>
          <div class="dl__i"><span class="dl__k">岗位</span><span class="dl__v">{{ detailData.plan.post }}</span></div>
          <div class="dl__i"><span class="dl__k">执行周期</span><span class="dl__v">{{ detailData.plan.cycle }}</span></div>
          <div class="dl__i"><span class="dl__k">默认执行人</span><span class="dl__v">{{ detailData.plan.executor }}</span></div>
          <div class="dl__i"><span class="dl__k">检查模板</span><span class="dl__v">{{ detailData.plan.templateName }}</span></div>
          <div class="dl__i"><span class="dl__k">所属项目</span><span class="dl__v">{{ detailData.plan.communityName }}</span></div>
        </div>

        <template v-if="detailData.template">
          <div class="sec__hd" style="margin-top:18px;">
            <h4>模板检查项</h4>
            <span class="desc">{{ detailData.template.name }} {{ detailData.template.version }} · 共 {{ detailData.template.fields?.length || 0 }} 项</span>
          </div>
          <el-table :data="detailData.template.fields || []" size="small">
            <el-table-column type="index" label="#" width="50" />
            <el-table-column prop="label" label="检查项" min-width="160" show-overflow-tooltip />
            <el-table-column prop="type" label="采集方式" width="90" />
            <el-table-column label="必填" width="70">
              <template #default="{ row }">
                <el-tag size="small" :type="row.required ? 'danger' : 'info'" effect="plain">
                  {{ row.required ? '必填' : '选填' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="standard" label="合格标准" min-width="180" show-overflow-tooltip />
          </el-table>
        </template>

        <div class="sec__hd" style="margin-top:18px;"><h4>最近任务</h4><span class="desc">{{ detailData.tasks.length }} 条</span></div>
        <el-table :data="detailData.tasks" size="small">
          <el-table-column prop="taskId" label="任务号" width="100" />
          <el-table-column prop="scheduledDate" label="计划日期" width="110" />
          <el-table-column prop="executor" label="执行人" width="100" />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }"><StatusTag domain="inspect" :value="row.status" /></template>
          </el-table-column>
          <el-table-column prop="score" label="得分" width="80" align="right" />
        </el-table>
        <div v-if="!detailData.tasks.length" style="padding:8px 0;">
          <EmptyState type="empty" desc="该计划暂无生成任务" />
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" @click="$router.push('/f/inspect-plans/' + (detailData?.plan?.planId || '') + '/edit')">编辑计划</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, communities, getInspectPlanDetail, inspectPlanSummary, planCycleOpts,
  planPostOpts, queryInspectPlans
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

const router = useRouter()
const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryInspectPlans, { filters: { communityId: '', post: '', cycle: '', status: '', kw: '' } }
)
const summary = inspectPlanSummary()
const postOpts = planPostOpts()
const cycleOpts = planCycleOpts()
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getInspectPlanDetail)

function goNew() { router.push('/f/inspect-plans/new') }

function onRow(row) { openDetail(row.planId) }

/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'planId', label: '编号' }, { prop: 'name', label: '计划名称' },
  { prop: 'post', label: '岗位' }, { prop: 'cycle', label: '周期' },
  { prop: 'templateName', label: '检查模板' }, { prop: 'communityName', label: '项目' },
  { prop: 'executor', label: '默认执行人' }, { prop: 'items', label: '检查项' },
  { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '巡检计划', source: '/f/inspect-plans', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}
</script>
