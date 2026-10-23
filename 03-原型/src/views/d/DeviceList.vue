<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>设备台账 · L4 批量页</b>：继承列表模板。取数走 <code>api.queryDevices / getDeviceDetail</code>；
        维保到期用「到期文本」统一口径；详情抽屉带该设备的告警子表。
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
          <el-select v-model="query.type" placeholder="全部" clearable style="width:120px">
            <el-option v-for="t in typeOpts" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width:110px">
            <el-option v-for="s in statusOpts" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="编号 / 名称 / 位置" clearable style="width:160px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Plus'" @click="$router.push('/d/devices/new')">新增设备</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 台</span>
      </div>

      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 336px)" @row-click="onRow">
        <el-table-column prop="deviceCode" label="设备编号" width="130" />
        <el-table-column prop="name" label="名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="type" label="类型" width="110" />
        <el-table-column prop="location" label="位置" min-width="150" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }"><StatusTag domain="device" :value="row.status" /></template>
        </el-table-column>
        <el-table-column prop="lastHeartbeat" label="最近心跳" width="140" />
        <el-table-column label="维保" width="120">
          <template #default="{ row }">{{ expireText(row.nextMaintain) }}</template>
        </el-table-column>
        <el-table-column prop="alarmCount" label="告警" width="80" align="right" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
            <el-button link type="primary" @click.stop="goEdit(row)">编辑</el-button>
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
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.device?.name"
      :subtitle="detailData ? `${detailData.device.deviceCode} · ${detailData.community?.name || '-'}` : ''"
      :status="detailData?.device?.status" status-domain="device"
    >
      <template v-if="detailData">
        <div class="dl">
          <div class="dl__i"><span class="dl__k">编号</span><span class="dl__v">{{ detailData.device.deviceCode }}</span></div>
          <div class="dl__i"><span class="dl__k">类型</span><span class="dl__v">{{ detailData.device.type }}</span></div>
          <div class="dl__i"><span class="dl__k">品牌型号</span><span class="dl__v">{{ detailData.device.brand }} {{ detailData.device.model }}</span></div>
          <div class="dl__i"><span class="dl__k">位置</span><span class="dl__v">{{ detailData.device.location }}</span></div>
          <div class="dl__i"><span class="dl__k">IP</span><span class="dl__v">{{ detailData.device.ip }}</span></div>
          <div class="dl__i"><span class="dl__k">固件</span><span class="dl__v">{{ detailData.device.firmware }}</span></div>
          <div class="dl__i"><span class="dl__k">安装日期</span><span class="dl__v">{{ detailData.device.installDate }}</span></div>
          <div class="dl__i"><span class="dl__k">质保到期</span><span class="dl__v">{{ expireText(detailData.device.warrantyEnd) }}</span></div>
          <div class="dl__i"><span class="dl__k">维保周期</span><span class="dl__v">{{ detailData.device.maintainCycle }}</span></div>
          <div class="dl__i"><span class="dl__k">下次维保</span><span class="dl__v">{{ expireText(detailData.device.nextMaintain) }}</span></div>
          <div class="dl__i is-full"><span class="dl__k">供应商</span><span class="dl__v">{{ detailData.device.vendor }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>关联告警</h4><span class="desc">{{ detailData.alarms.length }} 条</span></div>
        <el-table :data="detailData.alarms" size="small">
          <el-table-column prop="occurTime" label="发生时间" width="150" />
          <el-table-column prop="type" label="类型" width="120" />
          <el-table-column prop="level" label="等级" width="90">
            <template #default="{ row }"><StatusTag domain="alarmLevel" :value="row.level" /></template>
          </el-table-column>
          <el-table-column prop="content" label="内容" min-width="180" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="90" />
        </el-table>
        <div v-if="!detailData.alarms.length" style="padding:8px 0;">
          <EmptyState type="empty" desc="该设备暂无告警记录" />
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>维保记录</h4>
          <span class="desc">
            {{ mSum.total }} 条 · 待派工 {{ mSum.todo }} · 进行中 {{ mSum.doing }} · 已完成 {{ mSum.done }} ·
            累计费用 ¥{{ money(mSum.cost) }}
          </span>
          <span class="spacer" />
          <el-button size="small" type="primary" :icon="'Plus'" @click="openMaintain">登记维保</el-button>
        </div>
        <el-table :data="mrRows" size="small" max-height="260">
          <el-table-column prop="recordId" label="单号" width="96" />
          <el-table-column prop="type" label="类型" width="92" />
          <el-table-column prop="planDate" label="计划日" width="104" />
          <el-table-column prop="actualDate" label="实际完成" width="104">
            <template #default="{ row }">{{ row.actualDate || '-' }}</template>
          </el-table-column>
          <el-table-column prop="engineer" label="工程师" width="86" />
          <el-table-column prop="vendor" label="供应商" width="100" show-overflow-tooltip />
          <el-table-column label="费用" width="86" align="right">
            <template #default="{ row }"><span class="money">¥ {{ money(row.cost) }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="86">
            <template #default="{ row }"><StatusTag domain="maintain" :value="row.status" /></template>
          </el-table-column>
          <el-table-column label="操作" width="76" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.status !== '已完成'" link type="primary" @click="finishMr(row)">完成</el-button>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <template #empty><EmptyState type="empty" desc="该设备暂无维保记录" /></template>
        </el-table>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" :icon="'EditPen'" @click="goEdit(detailData.device)">编辑档案</el-button>
      </template>
    </DetailDrawer>

    <!-- D1：维保登记 -->
    <el-dialog v-model="mrVisible" title="登记维保" width="520">
      <el-form ref="mrRef" :model="mrForm" :rules="mrRules" label-width="88px">
        <el-form-item label="维保类型" prop="type">
          <el-select v-model="mrForm.type" style="width:200px">
            <el-option v-for="t in MAINTAIN_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="计划日期" prop="planDate">
          <el-date-picker v-model="mrForm.planDate" type="date" value-format="YYYY-MM-DD" style="width:200px" />
        </el-form-item>
        <el-form-item label="供应商">
          <el-input v-model="mrForm.vendor" placeholder="如 大华股份" style="width:200px" />
        </el-form-item>
        <el-form-item label="工程师">
          <el-input v-model="mrForm.engineer" placeholder="如 钟建国" style="width:200px" />
        </el-form-item>
        <el-form-item label="预计费用">
          <el-input-number v-model="mrForm.cost" :min="0" :precision="2" :controls="false" style="width:200px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="mrForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mrVisible = false">取消</el-button>
        <el-button type="primary" @click="saveMr">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  MAINTAIN_TYPES, PAGE_SIZES, addMaintenance, communities, finishMaintenance, getDeviceDetail,
  maintenanceOfDevice, maintenanceSummary, queryDevices
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { ElMessage } from 'element-plus'
import { expireText, money } from '@/utils/format'
import { exportList } from '@/utils/export'

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryDevices, { filters: { communityId: '', type: '', status: '', kw: '' } }
)

const typeOpts = ['门禁', '车行', '监控', '电梯', '消防', '能耗']
const statusOpts = ['在线', '离线', '故障', '告警']

const {
  data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail
} = useDetail(getDeviceDetail)

const router = useRouter()
function onRow(row) { openDetail(row.deviceId) }
function goEdit(row) {
  if (!row?.deviceId) return
  detailVisible.value = false
  router.push(`/d/devices/${row.deviceId}/edit`)
}
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }

/* ---------- D1 维保记录 ---------- */
const mrRows = ref([])
const mSum = ref({ total: 0, todo: 0, doing: 0, done: 0, cost: 0 })
watch(detailData, d => {
  const id = d?.device?.deviceId
  mrRows.value = id ? maintenanceOfDevice(id) : []
  mSum.value = id ? maintenanceSummary(id) : { total: 0, todo: 0, doing: 0, done: 0, cost: 0 }
})
const mrVisible = ref(false)
const mrRef = ref(null)
const mrForm = ref({ type: '日常保养', planDate: '', vendor: '', engineer: '', cost: 0, remark: '' })
const mrRules = {
  type: [{ required: true, message: '请选择维保类型', trigger: 'change' }],
  planDate: [{ required: true, message: '请选择计划日期', trigger: 'change' }]
}
function openMaintain() { mrForm.value = { type: '日常保养', planDate: '', vendor: '', engineer: '', cost: 0, remark: '' }; mrVisible.value = true }
async function saveMr() {
  try {
    await mrRef.value.validate()
    const id = detailData.value?.device?.deviceId
    addMaintenance({ ...mrForm.value, deviceId: id })
    ElMessage.success('维保已登记，状态：待派工')
    mrVisible.value = false
    mrRows.value = maintenanceOfDevice(id)
    mSum.value = maintenanceSummary(id)
  } catch (e) { if (e?.message) ElMessage.error(e.message) }
}
function finishMr(row) {
  try {
    finishMaintenance(row.recordId, { cost: row.cost || 0 })
    ElMessage.success(`${row.recordId} 已完成，费用 ¥${money(row.cost || 0)}`)
    const id = detailData.value?.device?.deviceId
    mrRows.value = maintenanceOfDevice(id)
    mSum.value = maintenanceSummary(id)
    load()
  } catch (e) { ElMessage.error(e?.message || '操作失败') }
}

/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'deviceCode', label: '设备编号' }, { prop: 'name', label: '名称' },
  { prop: 'type', label: '类型' }, { prop: 'location', label: '位置' },
  { prop: 'status', label: '状态' }, { prop: 'lastHeartbeat', label: '最近心跳' },
  { prop: 'maintainDue', label: '维保到期' }, { prop: 'alarmCount', label: '告警数' }
]
function onExport() {
  exportList({ name: '设备台账', source: '/d/devices', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}
</script>
