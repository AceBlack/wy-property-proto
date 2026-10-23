<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>收费科目 · L4 批量页</b>：继承列表模板。科目本身只有 10 条，取数仍走
        <code>api.queryFeeItems</code>，以便换真接口时页面零改动；
        应收 / 实收 / 收缴率由数据层按账单聚合，口径与费用驾驶舱一致。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">科目总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">项</span></div></div>
        <div class="dstat"><div class="dstat__k">启用中</div><div class="dstat__v">{{ summary.enabled }}<span class="unit">项</span></div></div>
        <div class="dstat"><div class="dstat__k">关联账单</div><div class="dstat__v">{{ summary.billCount }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">整体收缴率</div><div class="dstat__v">{{ pct(summary.rate) }}</div></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
        <el-form-item label="分类">
          <el-select v-model="query.category" placeholder="全部" clearable style="width:130px">
            <el-option v-for="o in categoryOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="计费方式">
          <el-select v-model="query.calcType" placeholder="全部" clearable style="width:120px">
            <el-option v-for="o in calcOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width:110px">
            <el-option label="启用" value="启用" /><el-option label="停用" value="停用" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="编号 / 名称 / 说明" clearable style="width:180px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Plus'" @click="$router.push('/b/fee-items/new')">新增科目</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 项</span>
      </div>

      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 400px)" @row-click="onRow">
        <el-table-column prop="itemId" label="编号" width="72" />
        <el-table-column prop="name" label="科目名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="category" label="分类" width="100" />
        <el-table-column prop="calcType" label="计费方式" width="95" />
        <el-table-column label="单价" width="120" align="right">
          <template #default="{ row }">
            <span class="money">{{ money(row.price) }}</span>
            <span class="muted" style="font-size:12px;"> {{ row.unit }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="cycle" label="周期" width="70" />
        <el-table-column prop="bizType" label="业态" width="90" />
        <el-table-column label="税率" width="80" align="right">
          <template #default="{ row }">{{ row.taxRate }}%</template>
        </el-table-column>
        <el-table-column label="账单" width="80" align="right">
          <template #default="{ row }"><span class="money">{{ row.billCount }}</span></template>
        </el-table-column>
        <el-table-column label="收缴率" width="85" align="right">
          <template #default="{ row }"><span class="money">{{ pct(row.rate) }}</span></template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === '启用' ? 'success' : 'info'" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
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
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.item?.name"
      :subtitle="detailData ? `${detailData.item.itemId} · ${detailData.item.category} · ${detailData.item.calcType}` : ''"
      :tag="detailData?.item?.status"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">应收</div><div class="dstat__v">¥ {{ wan(detailData.stat.receivable) }}</div></div>
          <div class="dstat"><div class="dstat__k">实收</div><div class="dstat__v">¥ {{ wan(detailData.stat.received) }}</div></div>
          <div class="dstat"><div class="dstat__k">欠费</div><div class="dstat__v" :class="detailData.stat.debt > 0 ? 'is-warn' : ''">¥ {{ wan(detailData.stat.debt) }}</div></div>
          <div class="dstat"><div class="dstat__k">收缴率</div><div class="dstat__v">{{ pct(detailData.stat.rate) }}</div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>计费规则</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">单价</span><span class="dl__v money">{{ money(detailData.item.price) }} {{ detailData.item.unit }}</span></div>
          <div class="dl__i"><span class="dl__k">计费方式</span><span class="dl__v">{{ detailData.item.calcType }}</span></div>
          <div class="dl__i"><span class="dl__k">收费周期</span><span class="dl__v">{{ detailData.item.cycle }}</span></div>
          <div class="dl__i"><span class="dl__k">适用业态</span><span class="dl__v">{{ detailData.item.bizType }}</span></div>
          <div class="dl__i"><span class="dl__k">税率</span><span class="dl__v">{{ detailData.item.taxRate }}%</span></div>
          <div class="dl__i"><span class="dl__k">关联账单</span><span class="dl__v money">{{ detailData.stat.billCount }} 条</span></div>
          <div class="dl__i is-full"><span class="dl__k">规则说明</span><span class="dl__v">{{ detailData.item.remark || '—' }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>分项目收缴情况</h4><span class="desc">{{ detailData.byCommunity.length }} 个项目</span></div>
        <el-table :data="detailData.byCommunity" size="small">
          <el-table-column prop="name" label="项目" min-width="150" show-overflow-tooltip />
          <el-table-column label="应收" width="120" align="right">
            <template #default="{ row }"><span class="money">¥ {{ money(row.receivable) }}</span></template>
          </el-table-column>
          <el-table-column label="实收" width="120" align="right">
            <template #default="{ row }"><span class="money">¥ {{ money(row.received) }}</span></template>
          </el-table-column>
          <el-table-column label="收缴率" width="100" align="right">
            <template #default="{ row }"><span class="money">{{ pct(row.rate) }}</span></template>
          </el-table-column>
        </el-table>

        <div class="sec__hd" style="margin-top:18px;"><h4>最近账单</h4><span class="desc">{{ detailData.recentBills.length }} 条</span></div>
        <el-table :data="detailData.recentBills" size="small">
          <el-table-column prop="billId" label="账单号" width="110" />
          <el-table-column prop="period" label="账期" width="90" />
          <el-table-column label="房屋 / 车位" min-width="170" show-overflow-tooltip>
            <template #default="{ row }">{{ subjectLabel(row.houseId, row.parkId) }}</template>
          </el-table-column>
          <el-table-column label="应收" width="110" align="right">
            <template #default="{ row }"><span class="money">¥ {{ money(row.payable) }}</span></template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }"><StatusTag domain="bill" :value="row.status" /></template>
          </el-table-column>
        </el-table>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button type="primary" @click="$router.push('/b/fee-items/' + (detailData?.item?.itemId || '') + '/edit')">编辑科目</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, feeCalcTypeOpts, feeCategoryOpts, feeItemRows, getFeeItemDetail, queryFeeItems, subjectLabel
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money, pct, wan } from '@/utils/format'
import { exportList } from '@/utils/export'

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(
  queryFeeItems, { filters: { category: '', calcType: '', status: '', kw: '' } }
)
const categoryOpts = feeCategoryOpts()
const calcOpts = feeCalcTypeOpts()

/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'itemId', label: '编号' }, { prop: 'name', label: '科目名称' },
  { prop: 'category', label: '分类' }, { prop: 'calcType', label: '计费方式' },
  { prop: 'price', label: '单价' }, { prop: 'cycle', label: '周期' },
  { prop: 'bizType', label: '业态' }, { prop: 'taxRate', label: '税率' },
  { prop: 'billCount', label: '账单数' }, { prop: 'collectRate', label: '收缴率' }
]
function onExport() {
  exportList({ name: '收费科目', source: '/b/fee-items', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}
const all = feeItemRows()
const summary = {
  total: all.length,
  enabled: all.filter(i => i.status === '启用').length,
  billCount: all.reduce((s, i) => s + i.billCount, 0),
  rate: (() => {
    const r = all.reduce((s, i) => s + i.receivable, 0)
    return r ? (all.reduce((s, i) => s + i.received, 0) / r) * 100 : 0
  })()
}
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getFeeItemDetail)

function onRow(row) { openDetail(row.itemId) }
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }
</script>
