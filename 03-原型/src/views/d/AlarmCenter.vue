<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>告警中心 · L4 批量页</b>：继承列表模板。告警是设备异常的唯一入口，
        未处理告警按等级排序；转工单属于 B 级写操作，原型阶段只提示。
        取数走 <code>api.queryAlarms / getAlarmDetail</code>。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">告警总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">未处理</div><div class="dstat__v" :class="summary.open > 0 ? 'is-warn' : ''">{{ summary.open }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">紧急告警</div><div class="dstat__v" :class="summary.urgent > 0 ? 'is-warn' : ''">{{ summary.urgent }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">已转工单</div><div class="dstat__v">{{ summary.toWo }}<span class="unit">条</span></div></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px">
            <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
          </el-select>
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="query.level" placeholder="全部" clearable style="width:110px">
            <el-option v-for="o in levelOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="query.type" placeholder="全部" clearable style="width:140px">
            <el-option v-for="o in typeOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width:110px">
            <el-option v-for="o in statusOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="编号 / 设备 / 内容" clearable style="width:180px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Warning'" @click="quick('未处理', '')">只看未处理</el-button>
        <el-button :icon="'WarningFilled'" @click="quick('', '紧急')">只看紧急</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 条</span>
      </div>

      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 400px)" @row-click="onRow">
        <el-table-column prop="alarmId" label="告警编号" width="95" />
        <el-table-column prop="level" label="等级" width="75">
          <template #default="{ row }"><StatusTag domain="alarmLevel" :value="row.level" /></template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="110" show-overflow-tooltip />
        <el-table-column prop="deviceName" label="设备" min-width="122" show-overflow-tooltip />
        <el-table-column prop="communityName" label="项目" min-width="105" show-overflow-tooltip />
        <el-table-column prop="content" label="告警内容" min-width="140" show-overflow-tooltip />
        <el-table-column prop="occurTime" label="发生时间" width="120" />
        <el-table-column prop="status" label="状态" width="85">
          <template #default="{ row }"><StatusTag domain="alarmStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column prop="handleBy" label="处理人" width="80">
          <template #default="{ row }">{{ row.handleBy || '—' }}</template>
        </el-table-column>
        <el-table-column label="工单" width="90">
          <template #default="{ row }">{{ row.dispatchWoId || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
            <el-button link type="primary" :disabled="!!row.dispatchWoId" @click.stop="toWo(row)">
              {{ row.dispatchWoId ? '已转单' : '转工单' }}
            </el-button>
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
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.alarm?.deviceName"
      :subtitle="detailData ? `${detailData.alarm.alarmId} · ${detailData.alarm.type} · ${detailData.alarm.occurTime}` : ''"
      :status="detailData?.alarm?.status" status-domain="alarmStatus"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">告警等级</div><div class="dstat__v" style="font-size:15px;">{{ detailData.alarm.level }}</div></div>
          <div class="dstat"><div class="dstat__k">告警类型</div><div class="dstat__v" style="font-size:15px;">{{ detailData.alarm.type }}</div></div>
          <div class="dstat"><div class="dstat__k">所属项目</div><div class="dstat__v" style="font-size:15px;">{{ detailData.community?.name || '-' }}</div></div>
          <div class="dstat"><div class="dstat__k">持续时长</div><div class="dstat__v">{{ detailData.alarm.duration || 0 }}<span class="unit">分钟</span></div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>告警信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">告警编号</span><span class="dl__v">{{ detailData.alarm.alarmId }}</span></div>
          <div class="dl__i"><span class="dl__k">发生时间</span><span class="dl__v">{{ detailData.alarm.occurTime }}</span></div>
          <div class="dl__i"><span class="dl__k">处理人</span><span class="dl__v">{{ detailData.alarm.handleBy || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">处理时间</span><span class="dl__v">{{ detailData.alarm.handleTime || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">关联工单</span><span class="dl__v">{{ detailData.alarm.dispatchWoId || '—' }}</span></div>
          <div class="dl__i is-full"><span class="dl__k">告警内容</span><span class="dl__v">{{ detailData.alarm.content }}</span></div>
        </div>

        <template v-if="detailData.device">
          <div class="sec__hd" style="margin-top:18px;"><h4>设备信息</h4><span class="desc">{{ detailData.device.deviceCode }}</span></div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">设备名称</span><span class="dl__v">{{ detailData.device.name }}</span></div>
            <div class="dl__i"><span class="dl__k">类型</span><span class="dl__v">{{ detailData.device.type }}</span></div>
            <div class="dl__i"><span class="dl__k">位置</span><span class="dl__v">{{ detailData.device.location }}</span></div>
            <div class="dl__i"><span class="dl__k">当前状态</span><span class="dl__v"><StatusTag domain="device" :value="detailData.device.status" /></span></div>
            <div class="dl__i"><span class="dl__k">最近心跳</span><span class="dl__v">{{ detailData.device.lastHeartbeat }}</span></div>
            <div class="dl__i"><span class="dl__k">供应商</span><span class="dl__v">{{ detailData.device.vendor }}</span></div>
          </div>
        </template>

        <div v-if="detailData.siblings.length" style="margin-top:18px;">
          <div class="sec__hd"><h4>该设备历史告警</h4><span class="desc">{{ detailData.siblings.length }} 条</span></div>
          <el-table :data="detailData.siblings" size="small">
            <el-table-column prop="occurTime" label="发生时间" width="130" />
            <el-table-column prop="level" label="等级" width="90">
              <template #default="{ row }"><StatusTag domain="alarmLevel" :value="row.level" /></template>
            </el-table-column>
            <el-table-column prop="type" label="类型" width="120" />
            <el-table-column prop="content" label="内容" min-width="160" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }"><StatusTag domain="alarmStatus" :value="row.status" /></template>
            </el-table-column>
          </el-table>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" :disabled="!!detailData?.alarm?.dispatchWoId" @click="toWo(detailData?.alarm)">
          {{ detailData?.alarm?.dispatchWoId ? '已转工单' : '转工单' }}
        </el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, alarmLevelOpts, alarmStatusOpts, alarmSummary, alarmTypeOpts, communities,
  createWoFromAlarm, getAlarmDetail, queryAlarms
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryAlarms, { filters: { communityId: '', level: '', type: '', status: '', kw: '' } }
)
const summary = ref(alarmSummary())
const levelOpts = alarmLevelOpts()
const typeOpts = alarmTypeOpts()
const statusOpts = alarmStatusOpts()
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getAlarmDetail)

function onRow(row) { openDetail(row.alarmId) }
/** F3 告警转工单：生成公共区域维修工单并回写关联（内存态，刷新还原） */
async function toWo(row) {
  if (!row || row.dispatchWoId) return
  try {
    const wo = createWoFromAlarm(row.alarmId)
    ElMessage.success(`已生成工单 ${wo.woNo}（${wo.status}）`)
    summary.value = alarmSummary()
    search()
    if (detailVisible.value) openDetail(row.alarmId)
  } catch (e) {
    ElMessage.error(e?.message || '转工单失败')
  }
}
/** 快捷筛选：直接改写筛选条件走同一条查询链，不在页面里另起过滤 */
function quick(status, level) { query.status = status; query.level = level; search() }

/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'alarmId', label: '告警编号' }, { prop: 'level', label: '等级' },
  { prop: 'type', label: '类型' }, { prop: 'deviceName', label: '设备' },
  { prop: 'communityName', label: '项目' }, { prop: 'content', label: '告警内容' },
  { prop: 'occurTime', label: '发生时间' }, { prop: 'status', label: '状态' },
  { prop: 'handleBy', label: '处理人' }
]
function onExport() {
  exportList({ name: '告警中心', source: '/d/alarms', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}
</script>
