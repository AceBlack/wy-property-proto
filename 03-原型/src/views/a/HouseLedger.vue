<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>房屋台账 · IA 骨架（左树定范围）</b>：树只管「范围」（项目 → 楼栋 → 单元），筛选栏只管「属性」，两者 AND。
        房间不进树（736 个叶子会让滚动条失控），楼层改由列表上方的楼层热力条承载。
        取数走 <code>api.queryHouseLedger / getHouseDetail / houseTree</code>。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">房屋总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">套</span></div></div>
        <div class="dstat"><div class="dstat__k">自住</div><div class="dstat__v">{{ summary.selfUse }}<span class="unit">套</span></div></div>
        <div class="dstat"><div class="dstat__k">出租 / 空置</div><div class="dstat__v">{{ summary.rent }}<span class="unit">/</span> {{ summary.empty }}<span class="unit">套</span></div></div>
        <div class="dstat"><div class="dstat__k">欠费房屋</div><div class="dstat__v" :class="summary.debtHouses > 0 ? 'is-warn' : ''">{{ summary.debtHouses }}<span class="unit">套</span></div></div>
      </div>
    </div>

    <div class="ia" :class="{ 'is-collapsed': treeCollapsed }" style="margin-top:16px;">
      <div class="ia__tree">
        <SpaceTree
          title="空间范围" tree-title="项目 / 楼栋 / 单元"
          :nodes="tree" :virtual="vnodes" :extra-keys="searchKeys"
          placeholder="搜项目 / 楼栋 / 单元 / 业主" :active-id="activeId" :active-vn="activeVn"
          @pick="onPick" @collapse="treeCollapsed = true"
        />
      </div>

      <div class="ia__main">
        <el-button v-if="treeCollapsed" class="ia__handle" size="small" :icon="'Expand'" @click="treeCollapsed = false">
          展开空间树
        </el-button>

        <div class="panel">
          <div class="scopebar">
            <template v-if="scopePath.length">
              <span v-for="(p, i) in scopePath" :key="p">
                <span class="scopebar__i" :class="{ 'is-last': i === scopePath.length - 1 }"
                  @click="onCrumb(i)">{{ p }}</span>
                <span v-if="i < scopePath.length - 1" class="scopebar__sep">/</span>
              </span>
            </template>
            <span v-else class="scopebar__i is-last">全部项目</span>
            <span v-if="activeVn" class="scopebar__vf">{{ vnLabel }}</span>
            <span class="spacer" />
            <span class="scopebar__hint">树定范围 · 筛选定属性</span>
            <el-button link type="primary" @click="clearScope">清除范围</el-button>
          </div>

          <div v-if="floors.length" class="floorrail">
            <span class="floorrail__hd">楼层</span>
            <button v-for="f in floors" :key="f.floor" class="floorrail__c"
              :class="{ 'is-on': query.floor === f.floor, 'is-empty': f.ratio >= 0.5 }"
              @click="pickFloor(f.floor)">
              <span>{{ f.floor }}F</span>
              <span v-if="f.empty" class="dot" :title="`空置 ${f.empty} / ${f.n}`" />
            </button>
            <span class="floorrail__foot">圆点 = 该层有空置，深色 = 空置过半</span>
          </div>

          <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
            <el-form-item label="用途">
              <el-select v-model="query.usage" placeholder="全部" clearable style="width:100px">
                <el-option v-for="o in usageOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="户型">
              <el-select v-model="query.houseType" placeholder="全部" clearable style="width:120px">
                <el-option v-for="o in typeOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="使用状态">
              <el-select v-model="query.useStatus" placeholder="全部" clearable style="width:110px">
                <el-option v-for="o in useStatusOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="责任楼管">
              <el-select v-model="query.stewardEmpId" placeholder="全部" clearable style="width:132px">
                <el-option v-for="s in stewardOpts" :key="s.empId" :label="s.name" :value="s.empId" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="房号 / 业主 / 房屋编号" clearable style="width:180px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Plus'" @click="$router.push('/a/houses/new')">新增房屋</el-button>
            <el-button :icon="'Printer'" :disabled="!rows.length" @click="onPrint">打印台账</el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 套</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 470px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column prop="fullName" label="房屋" min-width="170" show-overflow-tooltip />
            <el-table-column prop="houseType" label="户型" width="100" />
            <el-table-column label="建筑面积" width="100" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.area) }}</span> ㎡</template>
            </el-table-column>
            <el-table-column prop="useStatus" label="使用状态" width="95">
              <template #default="{ row }"><StatusTag domain="house" :value="row.useStatus" /></template>
            </el-table-column>
            <el-table-column prop="ownerName" label="业主" width="95" />
            <el-table-column label="责任楼管" width="96">
              <template #default="{ row }">
                <span v-if="row.stewardEmpId">{{ stewardNameOf(row.stewardEmpId) }}</span>
                <span v-else class="muted">未分配</span>
              </template>
            </el-table-column>
            <el-table-column label="欠费" width="105" align="right">
              <template #default="{ row }">
                <span class="money" :class="row.debt > 0 ? 'money--out' : ''">¥ {{ money(row.debt) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="未结账单" width="90" align="right">
              <template #default="{ row }"><span class="money">{{ row.openBills }}</span></template>
            </el-table-column>
            <el-table-column label="操作" width="110" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
                <el-button link type="primary" @click.stop="jump('/a/owners', 'owner:' + row.ownerId)">业主</el-button>
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
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.house?.fullName"
      :subtitle="detailData ? `${detailData.house.houseId} · ${detailData.building?.name || '-'} · ${detailData.community?.name || '-'}` : ''"
      :status="detailData?.house?.useStatus" status-domain="house"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">建筑面积</div><div class="dstat__v">{{ money(detailData.house.area) }}<span class="unit">㎡</span></div></div>
          <div class="dstat"><div class="dstat__k">套内面积</div><div class="dstat__v">{{ money(detailData.house.innerArea) }}<span class="unit">㎡</span></div></div>
          <div class="dstat"><div class="dstat__k">未结账单</div><div class="dstat__v">{{ detailData.bills.filter(b => b.unpaid > 0).length }}<span class="unit">条</span></div></div>
          <div class="dstat"><div class="dstat__k">欠费合计</div><div class="dstat__v" :class="debtOfRow > 0 ? 'is-warn' : ''">¥ {{ money(debtOfRow) }}</div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>房屋信息</h4><span class="desc">虚线字段可点击直接改（X2 内联编辑），不进编辑页</span>
        </div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">房屋编号</span><span class="dl__v">{{ detailData.house.houseId }}</span></div>
          <div class="dl__i"><span class="dl__k">户型</span><span class="dl__v">{{ detailData.house.houseType }}</span></div>
          <div class="dl__i"><span class="dl__k">用途</span><span class="dl__v">{{ detailData.house.usage }}</span></div>
          <div class="dl__i"><span class="dl__k">使用状态</span><span class="dl__v">
            <InlineField :model-value="detailData.house.useStatus" type="select" :options="HOUSE_USE_OPTS"
              :save="v => saveHouseField('useStatus', v)" @update:model-value="v => detailData.house.useStatus = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">朝向</span><span class="dl__v">
            <InlineField :model-value="detailData.house.orientation" :save="v => saveHouseField('orientation', v)"
              @update:model-value="v => detailData.house.orientation = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">装修</span><span class="dl__v">
            <InlineField :model-value="detailData.house.decoration" :save="v => saveHouseField('decoration', v)"
              @update:model-value="v => detailData.house.decoration = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">交付状态</span><span class="dl__v">{{ detailData.house.deliverStatus }}</span></div>
          <div class="dl__i"><span class="dl__k">产权状态</span><span class="dl__v">
            <InlineField :model-value="detailData.house.propertyStatus" type="select" :options="HOUSE_PROPERTY_OPTS"
              :save="v => saveHouseField('propertyStatus', v)" @update:model-value="v => detailData.house.propertyStatus = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">入住日期</span><span class="dl__v">{{ detailData.house.checkinDate || '—' }}</span></div>
          <div class="dl__i is-full"><span class="dl__k">权证号</span><span class="dl__v">
            <InlineField :model-value="detailData.house.certNo" placeholder="请输入产权证号"
              :save="v => saveHouseField('certNo', v)" @update:model-value="v => detailData.house.certNo = v" />
          </span></div>
        </div>

        <template v-if="detailData.owner">
          <div class="sec__hd" style="margin-top:18px;"><h4>业主 / 居住人</h4></div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">业主</span><span class="dl__v">{{ detailData.owner.name }}</span></div>
            <div class="dl__i"><span class="dl__k">手机号</span><span class="dl__v">
              <SensitiveText :value="detailData.owner.phone" field="phone" entity-type="业主"
                :entity-id="detailData.owner.ownerId" :entity-name="detailData.owner.name" source="/a/houses" />
            </span></div>
            <div class="dl__i"><span class="dl__k">家庭成员</span><span class="dl__v">{{ detailData.members.length }} 人</span></div>
            <div class="dl__i"><span class="dl__k">租客</span><span class="dl__v">{{ detailData.tenants[0]?.name || '—' }}</span></div>
          </div>
        </template>

        <div class="sec__hd" style="margin-top:18px;"><h4>账单</h4><span class="desc">{{ detailData.bills.length }} 条</span></div>
        <el-table :data="detailData.bills" size="small" max-height="220">
          <el-table-column prop="billId" label="账单号" width="110" />
          <el-table-column prop="period" label="账期" width="90" />
          <el-table-column prop="itemName" label="科目" min-width="130" show-overflow-tooltip />
          <el-table-column label="应收" width="100" align="right">
            <template #default="{ row }"><span class="money">¥ {{ money(row.payable) }}</span></template>
          </el-table-column>
          <el-table-column label="未收" width="100" align="right">
            <template #default="{ row }"><span class="money">¥ {{ money(row.unpaid) }}</span></template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }"><StatusTag domain="bill" :value="row.status" /></template>
          </el-table-column>
        </el-table>
        <div v-if="!detailData.bills.length" style="padding:8px 0;">
          <EmptyState type="empty" desc="该房屋暂无账单" />
        </div>

        <div v-if="detailData.parkings.length" style="margin-top:18px;">
          <div class="sec__hd"><h4>关联车位</h4><span class="desc">{{ detailData.parkings.length }} 个</span></div>
          <el-table :data="detailData.parkings" size="small">
            <el-table-column prop="parkNo" label="车位号" width="100" />
            <el-table-column prop="parkType" label="类型" width="100" />
            <el-table-column prop="status" label="产权" width="90">
              <template #default="{ row }"><StatusTag domain="parking" :value="row.status" /></template>
            </el-table-column>
            <el-table-column label="管理费到期" min-width="130">
              <template #default="{ row }">{{ expireText(row.expireDate) }}</template>
            </el-table-column>
          </el-table>
        </div>

        <div class="rel">
          <el-button size="small" @click="jump('/a/owners', 'owner:' + detailData.house.ownerId)">业主档案</el-button>
          <el-button size="small" @click="jump('/a/vehicles', 'owner:' + detailData.house.ownerId)">车位与车辆</el-button>
          <el-button size="small" @click="jump('/b/bills', 'house:' + detailData.house.houseId)">账单查询</el-button>
          <el-button size="small" @click="jump('/f/workorders', 'house:' + detailData.house.houseId)">工单列表</el-button>
          <span class="rel__note">车位经业主关联，非房屋产权绑定（数据模型 houses 无 parkIds，一人多房时无法判定归属哪套）</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button @click="$router.push('/a/houses/' + (detailData?.house?.houseId || '') + '/edit')">编辑房屋</el-button>
        <el-button type="primary" @click="jump('/a/owners', 'owner:' + detailData?.house?.ownerId)">业主档案</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  HOUSE_PROPERTY_OPTS, HOUSE_USE_OPTS, PAGE_SIZES, getHouseDetail, houseFloorStats,
  houseLedgerSummary, houseTree, houseTreeSearchKeys, houseTypeOpts, houseUsageOpts,
  houseUseStatusOpts, houseVirtualNodes, queryHouseLedger, stewardNameOf, stewardOptions,
  updateHouseField
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { pathOf, useFocusLanding } from '@/composables/useFocus'
import SpaceTree from '@/components/SpaceTree.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import InlineField from '@/components/InlineField.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { expireText, money } from '@/utils/format'
import SensitiveText from '@/components/SensitiveText.vue'
import { exportList } from '@/utils/export'
import { docFoot, docHead, docTable, printHtml } from '@/utils/print'

const router = useRouter()
const SCOPE_KEYS = ['communityId', 'buildingId', 'unitId', 'floor', 'vf']
const BLANK = { communityId: '', buildingId: '', unitId: '', floor: '', vf: '' }


/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'fullName', label: '房屋' },
  { prop: 'houseType', label: '户型' },
  { prop: 'area', label: '建筑面积' },
  { prop: 'usage', label: '用途' },
  { prop: 'useStatus', label: '使用状态' },
  { prop: 'ownerName', label: '业主' },
  { prop: 'debt', label: '欠费' },
  { prop: 'deliverStatus', label: '交付' }
]
function onExport() {
  exportList({ name: '房屋台账', source: '/a/houses', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

/* X4 打印台账：按当前筛选结果打印本页，欠费口径与报表同源 */
function onPrint() {
  const scope = scopePath.value.length ? scopePath.value.join(' / ') : (vnLabel.value || '全部项目')
  const sub = `范围：${scope} · 共 ${total.value} 套（本页 ${rows.value.length} 套）· 打印时间 ${new Date().toLocaleDateString('zh-CN')}`
  const list = rows.value.map(r => ({ ...r, areaText: money(r.area), debtText: money(r.debt || 0) }))
  const cols = [
    { label: '房屋', prop: 'fullName' },
    { label: '户型', prop: 'houseType' },
    { label: '建筑面积㎡', prop: 'areaText', right: true },
    { label: '使用状态', prop: 'useStatus' },
    { label: '业主', prop: 'ownerName' },
    { label: '欠费(元)', prop: 'debtText', right: true }
  ]
  const html = docHead('房屋台账', sub) +
    docTable(cols, list, ['合计（本页）', '', '', '', '', money(rows.value.reduce((s, r) => s + (r.debt || 0), 0))]) +
    docFoot('台账数据取自当前查询条件；欠费口径与报表「未收费房屋」同源（未结且未收金额 > 0）。', ['制表人：', '审核人：'])
  if (!printHtml('房屋台账', html)) ElMessage.warning('打印窗口被浏览器拦截，请允许弹窗后重试')
  else ElMessage.success(`已生成台账打印页（本页 ${rows.value.length} 套）`)
}

const stewardOpts = stewardOptions()

const { rows, total, pageNo, size, loading, query, load, search } = useListQuery(
  queryHouseLedger,
  {
    immediate: false,
    filters: { ...BLANK, usage: '', houseType: '', useStatus: '', stewardEmpId: '', kw: '' }
  }
)
const tree = houseTree()
const vnodes = houseVirtualNodes()
const searchKeys = houseTreeSearchKeys()
const summary = houseLedgerSummary()
const usageOpts = houseUsageOpts()
const typeOpts = houseTypeOpts()
const useStatusOpts = houseUseStatusOpts()

const treeCollapsed = ref(false)
const activeId = ref('')
const activeChain = ref([])
const activeVn = ref('')
const scopePath = ref([])
const floors = ref([])
const highlightId = ref('')

/** 节点 id → 节点（面包屑回退用） */
const flatNode = new Map()
;(function flatten(list) {
  list.forEach(n => {
    flatNode.set(n.id, n)
    if (n.children?.length) flatten(n.children)
  })
})(tree)

const vnLabel = computed(() => vnodes.find(v => v.key === activeVn.value)?.label || '')

const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getHouseDetail)
const debtOfRow = computed(() => (detailData.value?.bills || []).reduce((s, b) => s + (b.unpaid || 0), 0))

/* X2 内联编辑：改单字段后同步列表（派生行已在 api 内同步） */
async function saveHouseField(field, v) {
  const r = await updateHouseField(detailData.value.house.houseId, field, v)
  Object.assign(detailData.value.house, r)
  search()
  ElMessage.success(`已更新${field === 'useStatus' ? '使用状态' : field === 'propertyStatus' ? '产权状态' : field === 'certNo' ? '权证号' : field === 'orientation' ? '朝向' : '装修情况'}`)
}

function refreshFloors() {
  floors.value = houseFloorStats({
    communityId: query.communityId, buildingId: query.buildingId, unitId: query.unitId
  })
}
function onPick(node) {
  Object.assign(query, BLANK)
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
  refreshFloors()
  search()
}
/** 面包屑回退：直接拿链上对应节点的 patch 覆盖范围 */
function onCrumb(index) {
  if (index >= activeChain.value.length - 1) return
  const id = activeChain.value[index]
  const node = flatNode.get(id)
  if (!node) return
  Object.assign(query, BLANK)
  Object.assign(query, node.patch)
  activeId.value = id
  activeChain.value = activeChain.value.slice(0, index + 1)
  scopePath.value = scopePath.value.slice(0, index + 1)
  activeVn.value = ''
  refreshFloors()
  search()
}
function clearScope() {
  Object.assign(query, BLANK)
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  refreshFloors()
  search()
}
function pickFloor(f) {
  query.floor = query.floor === f ? '' : f
  search()
}
function reset() {
  Object.assign(query, { ...BLANK, usage: '', houseType: '', useStatus: '', kw: '' })
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  refreshFloors()
  search()
}

function onRow(row) { openDetail(row.houseId) }
function rowClass({ row }) { return row.houseId === highlightId.value ? 'row--focus' : '' }
function jump(path, focus) { router.push(`${path}?focus=${focus}`) }
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }

/* 跨页锚点落地：URL focus 优先于默认状态 */
useFocusLanding(async ({ focus, open, location }) => {
  const landByHouse = async () => {
    Object.assign(query, BLANK)
    Object.assign(query, {
      communityId: location.communityId, buildingId: location.buildingId, unitId: location.unitId
    })
    activeId.value = location.unitId || location.buildingId || location.communityId
    activeChain.value = [location.communityId, location.buildingId, location.unitId].filter(Boolean)
    scopePath.value = pathOf(tree, activeId.value)
    refreshFloors()
    await load()
  }
  highlightId.value = ''
  if (focus && location && (focus.type === 'house' || focus.type === 'owner')) {
    await landByHouse()
    if (focus.type === 'house') {
      highlightId.value = focus.id
      if (open) openDetail(focus.id)
    }
    return
  }
  clearScope()
})
</script>
