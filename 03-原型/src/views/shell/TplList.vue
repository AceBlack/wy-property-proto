<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>列表页模板 · A 级交互</b>：筛选区（≤2 行）→ 工具栏（一屏一个实心主按钮）→ 表格（真分页，行高 48，无竖线）→ 分页。
        ①「查询 / 重置」走 <code>api.queryHouses</code> 真分页；②行点击或「详情」打开<b>详情抽屉</b>（含关联子表）；
        ③「删除」二次确认后刷新；④「新增房屋」跳表单页；⑤「导出」提交异步任务，在<b>下载中心</b>下载。
      </div>
    </div>

    <!-- 筛选区 -->
    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px" @change="query.buildingId=''">
            <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
          </el-select>
        </el-form-item>
        <el-form-item label="楼栋">
          <el-select v-model="query.buildingId" placeholder="全部" clearable style="width:120px">
            <el-option v-for="b in buildingOpts" :key="b.buildingId" :label="b.name" :value="b.buildingId" />
          </el-select>
        </el-form-item>
        <el-form-item label="用途">
          <el-select v-model="query.usage" placeholder="全部" clearable style="width:100px">
            <el-option v-for="u in usageOpts" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="使用状态">
          <el-select v-model="query.useStatus" placeholder="全部" clearable style="width:100px">
            <el-option v-for="u in useStatusOpts" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="房号 / 业主 / 编号" clearable style="width:150px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 列表 -->
    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Plus'" @click="onCreate">新增房屋</el-button>
        <el-button :icon="'Upload'" @click="soon('导入')">导入</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
        <el-button :icon="'Operation'" circle title="列设置" @click="soon('列设置')" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 条</span>
      </div>

      <el-table
        v-loading="loading" :data="rows" style="width:100%"
        max-height="calc(100vh - 336px)" @row-click="onRow"
      >
        <el-table-column type="selection" width="46" />
        <el-table-column prop="fullName" label="房屋" min-width="180" show-overflow-tooltip />
        <el-table-column prop="usage" label="用途" width="90" />
        <el-table-column prop="houseType" label="户型" width="110" />
        <el-table-column prop="area" label="建筑面积" width="110" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.area) }}</span> ㎡</template>
        </el-table-column>
        <el-table-column label="业主" width="120">
          <template #default="{ row }">{{ ownerName(row.ownerId) }}</template>
        </el-table-column>
        <el-table-column prop="useStatus" label="使用状态" width="110">
          <template #default="{ row }"><StatusTag domain="house" :value="row.useStatus" /></template>
        </el-table-column>
        <el-table-column prop="deliverStatus" label="交付" width="100" />
        <el-table-column prop="checkinDate" label="入住日期" width="120" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
            <el-button link type="primary" @click.stop="onEdit(row)">编辑</el-button>
            <el-button link type="danger" @click.stop="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="search" desc="换个筛选条件，或清除全部条件重新查看">
            <template #action>
              <el-button @click="reset">清除筛选条件</el-button>
            </template>
          </EmptyState>
        </template>
      </el-table>

      <div class="table-foot">
        <el-pagination
          v-model:current-page="pageNo" v-model:page-size="size"
          :page-sizes="PAGE_SIZES" :total="total"
          layout="total, sizes, prev, pager, next, jumper"
        />
      </div>
    </div>

    <!-- 详情抽屉 -->
    <DetailDrawer
      v-model="detailVisible" :loading="detailLoading"
      :title="detailData?.house?.fullName"
      :subtitle="detailSubtitle"
      :status="detailData?.house?.useStatus" status-domain="house"
      :tag="detailData?.house?.usage"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat">
            <div class="dstat__k">建筑面积</div>
            <div class="dstat__v">{{ money(detailData.house.area) }}<span class="unit">㎡</span></div>
          </div>
          <div class="dstat">
            <div class="dstat__k">当前欠费</div>
            <div class="dstat__v" :class="detailDebt > 0 ? 'is-warn' : ''">¥ {{ money(detailDebt) }}</div>
          </div>
          <div class="dstat">
            <div class="dstat__k">在途工单</div>
            <div class="dstat__v">{{ detailOpenWo }}<span class="unit">单</span></div>
          </div>
          <div class="dstat">
            <div class="dstat__k">车位</div>
            <div class="dstat__v">{{ detailData.parkings.length }}<span class="unit">个</span></div>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>房屋信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">项目</span><span class="dl__v">{{ detailData.community?.name || '-' }}</span></div>
          <div class="dl__i"><span class="dl__k">楼栋</span><span class="dl__v">{{ detailData.building?.name || '-' }}</span></div>
          <div class="dl__i"><span class="dl__k">房号</span><span class="dl__v">{{ detailData.house.room }}</span></div>
          <div class="dl__i"><span class="dl__k">楼层</span><span class="dl__v">{{ detailData.house.floor }} 层</span></div>
          <div class="dl__i"><span class="dl__k">户型</span><span class="dl__v">{{ detailData.house.houseType }}</span></div>
          <div class="dl__i"><span class="dl__k">朝向</span><span class="dl__v">{{ detailData.house.orientation }}</span></div>
          <div class="dl__i"><span class="dl__k">装修</span><span class="dl__v">{{ detailData.house.decoration }}</span></div>
          <div class="dl__i"><span class="dl__k">交付</span><span class="dl__v">{{ detailData.house.deliverStatus }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>业主</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">姓名</span><span class="dl__v strong">{{ detailData.owner?.name || '-' }}</span></div>
          <div class="dl__i"><span class="dl__k">手机</span><span class="dl__v">{{ detailData.owner?.phone || '-' }}</span></div>
          <div class="dl__i"><span class="dl__k">类型</span><span class="dl__v">{{ detailData.owner?.ownerType || '-' }}</span></div>
          <div class="dl__i"><span class="dl__k">信用</span><span class="dl__v">{{ detailData.owner?.creditLevel }} 级</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>账单记录</h4><span class="desc">共 {{ detailData.bills.length }} 笔</span>
        </div>
        <el-table :data="detailData.bills.slice(0, 8)" size="small">
          <el-table-column prop="period" label="账期" width="90" />
          <el-table-column prop="itemName" label="科目" min-width="110" />
          <el-table-column prop="payable" label="应收" width="100" align="right">
            <template #default="{ row }"><span class="money">{{ money(row.payable) }}</span></template>
          </el-table-column>
          <el-table-column prop="unpaid" label="欠费" width="100" align="right">
            <template #default="{ row }">
              <span class="money" :class="{ 'money--out': row.unpaid > 0 }">{{ money(row.unpaid) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }"><StatusTag domain="bill" :value="row.status" /></template>
          </el-table-column>
        </el-table>
      </template>

      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button @click="goCashier">去收银台</el-button>
        <el-button type="primary" @click="onEdit(detailData?.house)">编辑房屋</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PAGE_SIZES, buildingsOf, communities, getHouseDetail,
  houseUsageOpts, houseUseStatusOpts, ownerName, queryHouses
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()

/* ---- 列表查询：全部状态由 useListQuery 托管 ---- */
const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryHouses,
  { filters: { communityId: '', buildingId: '', usage: '', useStatus: '', kw: '' } }
)

/* 导出：只提交任务，文件在下载中心生成与下载（模板页同样走这条链路） */
const EXPORT_COLS = [
  { prop: 'fullName', label: '房屋' }, { prop: 'usage', label: '用途' },
  { prop: 'houseType', label: '户型' }, { prop: 'area', label: '建筑面积' },
  { prop: 'ownerName', label: '业主' }, { prop: 'useStatus', label: '使用状态' },
  { prop: 'deliverStatus', label: '交付' }, { prop: 'checkinDate', label: '入住日期' }
]
function onExport() {
  exportList({ name: '列表页模板', source: '/shell/list', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const buildingOpts = computed(() => buildingsOf(query.communityId))
const usageOpts = houseUsageOpts()
const useStatusOpts = houseUseStatusOpts()

/* ---- 详情抽屉 ---- */
/* useDetail 返回的是含 ref 的对象：解构成顶层 ref，模板自动解包、脚本用 .value */
const {
  data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail
} = useDetail(getHouseDetail)

const detailDebt = computed(() =>
  (detailData.value?.bills || []).reduce((s, b) => s + (b.unpaid || 0), 0)
)
const detailOpenWo = computed(() =>
  (detailData.value?.workOrders || []).filter(w => !['已关闭', '已评价', '已取消'].includes(w.status)).length
)
const detailSubtitle = computed(() => {
  const d = detailData.value
  if (!d) return ''
  return `房屋编号 ${d.house.houseId} · ${d.house.houseType} · 业主 ${d.owner?.name || '-'}`
})

function onRow(row) { openDetail(row.houseId) }
function onEdit(row) {
  if (!row) return
  router.push({ path: '/shell/form', query: { id: row.houseId } })
}
function onCreate() { router.push('/shell/form') }
function goCashier() { router.push('/b/cashier') }

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(
      `删除后该房屋的收费台账将一并停用，确认删除「${row.fullName}」？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch { return }
  ElMessage.success(`已删除 ${row.fullName}（原型阶段不写库，仅演示交互）`)
  load()
}

function soon(name) { ElMessage(`${name}属于 B 级能力，原型阶段仅提示`) }
</script>
