<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>车位与车辆 · 以「车位」为行</b>：车与位严格 1:1，这一页本质是车位视图，<b>{{ summary.idle }} 个闲置车位</b>进树即可见；
        车位号不进树，改走关键字。<b>原「车位车牌绑定」页已并入本页</b>，换绑 / 解绑移入详情抽屉底部——
        换绑必须留痕（原因 + 凭证 + 生效时间），下行指令要求厂商回执，失败即回滚。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">车位总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">个</span></div></div>
        <div class="dstat"><div class="dstat__k">已绑定车辆</div><div class="dstat__v">{{ summary.bound }}<span class="unit">个</span></div></div>
        <div class="dstat"><div class="dstat__k">闲置</div><div class="dstat__v" :class="summary.idle > 0 ? 'is-warn' : ''">{{ summary.idle }}<span class="unit">个</span></div></div>
        <div class="dstat"><div class="dstat__k">30 天内到期</div><div class="dstat__v" :class="summary.expiring > 0 ? 'is-warn' : ''">{{ summary.expiring }}<span class="unit">个</span></div></div>
      </div>
      <div class="sum-note">
        口径：已绑定 / 未绑定（{{ summary.unbound }}）按「有没有车」；闲置（{{ summary.idle }}）按产权状态，另含不可用 {{ summary.disabled }}。
      </div>
    </div>

    <div class="ia" :class="{ 'is-collapsed': treeCollapsed }" style="margin-top:16px;">
      <div class="ia__tree">
        <SpaceTree
          title="车位范围" tree-title="项目 / 区域 / 产权状态"
          :nodes="tree" :virtual="vnodes"
          placeholder="搜项目 / 区域 / 状态"
          :active-id="activeId" :active-vn="activeVn"
          @pick="onPick" @collapse="treeCollapsed = true"
        />
      </div>

      <div class="ia__main">
        <el-button v-if="treeCollapsed" class="ia__handle" size="small" :icon="'Expand'" @click="treeCollapsed = false">
          展开车位树
        </el-button>

        <div class="panel">
          <div class="scopebar">
            <template v-if="scopePath.length">
              <span v-for="(p, i) in scopePath" :key="p">
                <span class="scopebar__i" :class="{ 'is-last': i === scopePath.length - 1 }" @click="onCrumb(i)">{{ p }}</span>
                <span v-if="i < scopePath.length - 1" class="scopebar__sep">/</span>
              </span>
            </template>
            <span v-else class="scopebar__i is-last">全部车位</span>
            <span v-if="activeVn" class="scopebar__vf">{{ vnLabel }}</span>
            <span v-if="query.ownerId" class="scopebar__vf">业主 {{ ownerLabel }}</span>
            <span class="spacer" />
            <span class="scopebar__hint">树定范围 · 筛选定属性</span>
            <el-button link type="primary" @click="clearScope">清除范围</el-button>
          </div>

          <el-form :model="query" class="filter-bar" label-width="56px" @submit.prevent>
            <el-form-item label="授权">
              <el-select v-model="query.authStatus" placeholder="全部" clearable style="width:76px">
                <el-option v-for="o in authStatusOptsData" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="query.vehicleType" placeholder="全部" clearable style="width:76px">
                <el-option v-for="o in vehicleTypeOptsData" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="绑定">
              <el-select v-model="query.bindStatus" placeholder="全部" clearable style="width:76px">
                <el-option v-for="o in bindStatusOptsData" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="车位号 / 车牌 / 业主" clearable style="width:120px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Plus'" @click="$router.push('/a/vehicles/new')">新增车辆</el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 个车位</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 500px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column label="车位号" min-min-width="140">
              <template #default="{ row }">
                <div class="nowrap">{{ row.parkNo }}</div>
                <div class="ps-sub">{{ row.communityName }} · {{ row.zone }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="产权" min-width="90">
              <template #default="{ row }"><StatusTag domain="parking" :value="row.status" /></template>
            </el-table-column>
            <el-table-column label="绑定" min-min-width="120">
              <template #default="{ row }">
                <el-tag size="small" :type="row.bound ? 'success' : 'info'" effect="plain">
                  {{ row.bound ? '已绑定' : '闲置' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="plateNo" label="车牌" min-width="120">
              <template #default="{ row }">{{ row.plateNo || '—' }}</template>
            </el-table-column>
            <el-table-column prop="ownerName" label="业主" min-width="90" />
            <el-table-column prop="authStatus" label="授权" min-width="90">
              <template #default="{ row }"><StatusTag domain="vehicle" :value="row.authStatus" /></template>
            </el-table-column>
            <el-table-column label="管理费到期" min-width="128">
              <template #default="{ row }">
                <template v-if="row.expireDate">
                  <div class="nowrap">{{ row.expireDate }}</div>
                  <div class="ps-exp" :class="{ 'is-expire': row.expiring }">{{ expireText(row.expireDate) }}</div>
                </template>
                <span v-else class="ps-exp">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="110" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
                <el-button v-if="row.ownerId" link type="primary" @click.stop="jump('/a/owners', 'owner:' + row.ownerId)">业主</el-button>
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
      :title="detailData ? `${detailData.parking.parkNo} · ${detailData.parking.zoneLabel}` : ''"
      :subtitle="detailData ? `${detailData.parking.parkId} · ${detailData.parking.communityName} · ${detailData.parking.status}` : ''"
      :status="detailData?.parking?.status" status-domain="parking"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">车位面积</div><div class="dstat__v">{{ money(detailData.parking.area) }}<span class="unit">㎡</span></div></div>
          <div class="dstat"><div class="dstat__k">管理费标准</div><div class="dstat__v">{{ detailData.parking.feeStandard }}<span class="unit">元/月</span></div></div>
          <div class="dstat"><div class="dstat__k">绑定状态</div><div class="dstat__v">{{ detailData.parking.bound ? '已绑定' : '闲置' }}</div></div>
          <div class="dstat"><div class="dstat__k">充电车位</div><div class="dstat__v">{{ detailData.parking.chargePile ? '是' : '否' }}</div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>车位信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">车位编号</span><span class="dl__v">{{ detailData.parking.parkId }}</span></div>
          <div class="dl__i"><span class="dl__k">所属项目</span><span class="dl__v">{{ detailData.parking.communityName }}</span></div>
          <div class="dl__i"><span class="dl__k">车位号</span><span class="dl__v">{{ detailData.parking.parkNo }}</span></div>
          <div class="dl__i"><span class="dl__k">区域</span><span class="dl__v">{{ detailData.parking.zoneLabel }}</span></div>
          <div class="dl__i"><span class="dl__k">类型</span><span class="dl__v">{{ detailData.parking.parkType }}</span></div>
          <div class="dl__i"><span class="dl__k">类别</span><span class="dl__v">{{ detailData.parking.category }}</span></div>
          <div class="dl__i"><span class="dl__k">产权人</span><span class="dl__v">{{ ownerName(detailData.parking.ownerId) }}</span></div>
          <div class="dl__i"><span class="dl__k">管理费到期</span>
            <span class="dl__v" :class="{ 'is-expire': detailData.parking.expiring }">
              {{ detailData.parking.expireDate }}（{{ expireText(detailData.parking.expireDate) }}）
            </span>
          </div>
        </div>

        <template v-if="detailData.vehicle">
          <div class="sec__hd" style="margin-top:18px;"><h4>绑定车辆</h4></div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">车牌号</span><span class="dl__v">{{ detailData.vehicle.plateNo }}</span></div>
            <div class="dl__i"><span class="dl__k">车辆类型</span><span class="dl__v">{{ detailData.vehicle.vehicleType }}</span></div>
            <div class="dl__i"><span class="dl__k">品牌 / 颜色</span><span class="dl__v">{{ detailData.vehicle.brand }} · {{ detailData.vehicle.color }}</span></div>
            <div class="dl__i"><span class="dl__k">授权状态</span>
              <span class="dl__v"><StatusTag domain="vehicle" :value="detailData.vehicle.authStatus" /></span>
            </div>
            <div class="dl__i"><span class="dl__k">进出类型</span><span class="dl__v">{{ detailData.vehicle.inOutType }}</span></div>
            <div class="dl__i"><span class="dl__k">卡号</span><span class="dl__v">{{ detailData.vehicle.cardNo }}</span></div>
          </div>
        </template>
        <div v-else class="rel">
          <span class="rel__note">该车位当前未绑定车辆（闲置），可直接用于新业主 / 租户分配</span>
        </div>

        <template v-if="detailData.owner">
          <div class="sec__hd" style="margin-top:18px;"><h4>业主</h4></div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">姓名</span><span class="dl__v">{{ detailData.owner.name }}</span></div>
            <div class="dl__i"><span class="dl__k">手机号</span><span class="dl__v">{{ maskPhone(detailData.owner.phone) }}</span></div>
            <div class="dl__i"><span class="dl__k">名下房屋</span><span class="dl__v">{{ detailData.owner.houseIds.length }} 套</span></div>
            <div class="dl__i"><span class="dl__k">名下车位</span><span class="dl__v">{{ detailData.owner.parkIds.length }} 个</span></div>
          </div>
        </template>

        <div v-if="detailData.passes.length" style="margin-top:18px;">
          <div class="sec__hd"><h4>最近通行</h4><span class="desc">{{ detailData.passes.length }} 条</span></div>
          <el-table :data="detailData.passes" size="small" max-height="200">
            <el-table-column prop="passTime" label="通行时间" width="130" />
            <el-table-column prop="direction" label="方向" width="80" />
            <el-table-column prop="gate" label="道闸" min-width="130" show-overflow-tooltip />
            <el-table-column prop="channel" label="识别" width="100" />
          </el-table>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>换绑记录</h4><span class="desc">留痕 · 厂商回执</span></div>
        <div class="tl">
          <div v-for="(l, i) in detailData.bindLogs || []" :key="i" class="tl__i" :class="{ 'is-done': l.done }">
            <div class="tl__t">{{ l.title }}</div>
            <div class="tl__m">{{ l.memo }}</div>
          </div>
        </div>

        <div class="rel">
          <el-button v-if="detailData.owner" size="small" @click="jump('/a/owners', 'owner:' + detailData.owner.ownerId)">业主档案</el-button>
          <el-button v-if="detailData.owner" size="small" @click="jump('/a/houses', 'owner:' + detailData.owner.ownerId)">房屋台账</el-button>
          <el-button v-if="detailData.vehicle" size="small" @click="jump('/d/pass-records', 'plate:' + detailData.vehicle.plateNo)">通行记录</el-button>
          <span class="rel__note">车位与房屋之间没有直接外键，房屋侧的车位只能经业主关联</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="detailData?.parking?.bound" @click="openBind('unbind')">解除绑定</el-button>
        <el-button v-if="detailData?.owner" @click="jump('/a/owners', 'owner:' + detailData.owner.ownerId)">业主档案</el-button>
        <el-button type="primary" @click="openBind('bind')">
          {{ detailData?.parking?.bound ? '换绑车牌' : '绑定车辆' }}
        </el-button>
      </template>
    </DetailDrawer>

    <!-- 换绑 / 解绑：必须留痕，且下行指令要求厂商回执 -->
    <el-dialog v-model="dlg" :title="dlgMode === 'bind' ? '换绑车牌' : '解除绑定'" width="560px">
      <el-form :model="form" label-width="96px">
        <el-form-item label="车位">
          <el-input :model-value="detailData ? `${detailData.parking.parkNo}（${detailData.parking.zoneLabel} · ${detailData.parking.communityName}）` : '-'" disabled />
        </el-form-item>
        <el-form-item label="原车牌">
          <el-input :model-value="detailData?.parking?.plateNo || '未绑定'" disabled />
        </el-form-item>
        <template v-if="dlgMode === 'bind'">
          <el-form-item label="新车牌" required>
            <el-input v-model="form.plateNo" placeholder="如 川A·88888" />
          </el-form-item>
          <el-form-item label="车主">
            <el-input v-model="form.owner" placeholder="与车位产权人一致可留空" />
          </el-form-item>
        </template>
        <el-form-item :label="dlgMode === 'bind' ? '换绑原因' : '解绑原因'" required>
          <el-select v-model="form.reason" placeholder="请选择" style="width:100%">
            <el-option v-for="r in curReasonOpts" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="生效时间">
          <el-date-picker v-model="form.effectDate" type="date" value-format="YYYY-MM-DD" style="width:100%" />
        </el-form-item>
        <el-form-item label="凭证">
          <el-upload action="#" :auto-upload="false">
            <el-button :icon="'Upload'">{{ dlgMode === 'bind' ? '上传行驶证 / 过户证明' : '上传业主申请 / 交接单' }}</el-button>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button style="width:100px;" @click="dlg = false">取消</el-button>
        <el-button type="primary" style="width:100px;" :loading="saving" @click="submitBind">
          {{ dlgMode === 'bind' ? '确认换绑' : '确认解绑' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, authStatusOpts, getParkingDetail, ownerName, parkBindStatusOpts, parkTree,
  parkVirtualNodes, parkingSummary, queryParkingVehicles, vehicleTypeOpts
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { pathOf, useFocusLanding } from '@/composables/useFocus'
import SpaceTree from '@/components/SpaceTree.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { expireText, maskPhone, money } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()
const route = useRoute()
const BLANK = { communityId: '', zone: '', status: '', vf: '', ownerId: '' }


/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'parkNo', label: '车位号' },
  { prop: 'plateNo', label: '车牌' },
  { prop: 'ownerName', label: '业主' },
  { prop: 'status', label: '产权' },
  { prop: 'authStatus', label: '授权' },
  { prop: 'bindStatus', label: '绑定' },
  { prop: 'expireDate', label: '到期日' },
  { prop: 'parkType', label: '类型' }
]
function onExport() {
  exportList({ name: '车位与车辆', source: '/a/vehicles', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const { rows, total, pageNo, size, loading, query, load, search } = useListQuery(
  queryParkingVehicles,
  { immediate: false, filters: { ...BLANK, vehicleType: '', authStatus: '', bindStatus: '', kw: '' } }
)

const tree = parkTree()
const vnodes = parkVirtualNodes()
const summary = parkingSummary()
const vehicleTypeOptsData = vehicleTypeOpts()
const authStatusOptsData = authStatusOpts()
const bindStatusOptsData = parkBindStatusOpts()

const treeCollapsed = ref(false)
const activeId = ref('')
const activeChain = ref([])
const activeVn = ref('')
const scopePath = ref([])
const highlightId = ref('')

const vnLabel = computed(() => vnodes.find(v => v.key === activeVn.value)?.label || '')
const ownerLabel = computed(() => (query.ownerId ? ownerName(query.ownerId) : ''))
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getParkingDetail)

const flatNode = new Map()
;(function flatten(list) {
  list.forEach(n => {
    flatNode.set(n.id, n)
    if (n.children?.length) flatten(n.children)
  })
})(tree)

/* ---------- 换绑 / 解绑（B 级：本地改状态 + 提示等待厂商回执） ---------- */
const dlg = ref(false)
const dlgMode = ref('bind')
const saving = ref(false)
const form = reactive({ plateNo: '', owner: '', reason: '', effectDate: '' })
const REASONS = {
  bind: ['车辆更换', '二手过户', '录入错误', '业主申请', '临停转月卡'],
  unbind: ['车辆报废', '车位转让', '长期未使用', '录入错误', '业主申请']
}
const curReasonOpts = computed(() => REASONS[dlgMode.value] || REASONS.bind)

function openBind(mode) {
  if (!detailData.value) return
  dlgMode.value = mode
  form.plateNo = ''
  form.owner = detailData.value.owner?.name || ownerName(detailData.value.parking.ownerId)
  form.reason = ''
  form.effectDate = ''
  dlg.value = true
}
function submitBind() {
  const p = detailData.value?.parking
  if (!p) return
  const bind = dlgMode.value === 'bind'
  if (bind && !form.plateNo) { ElMessage.error('请输入新车牌'); return }
  if (!form.reason) { ElMessage.error(bind ? '请选择换绑原因' : '请选择解绑原因'); return }
  saving.value = true
  setTimeout(() => {
    // 换绑留痕：提交即写一条待回执记录，抽屉时间线即时反映
    const log = {
      title: bind ? `换绑为 ${form.plateNo}` : '解除绑定',
      memo: `${form.reason} · 已下发厂商，等待回执`,
      done: false
    }
    if (bind) {
      const v = detailData.value.vehicle
      if (v) v.plateNo = form.plateNo
      else detailData.value.vehicle = {
        plateNo: form.plateNo, vehicleType: '—', brand: '—', color: '—',
        authStatus: '待审核', inOutType: '月卡', cardNo: '—'
      }
      p.plateNo = form.plateNo
      p.bindStatus = '已绑定'
      p.bound = true
      // 绑定成功后「尚未绑定车牌」这条待办要撤掉，否则与当前状态矛盾
      detailData.value.bindLogs = [log, ...(detailData.value.bindLogs || []).filter(l => l.title !== '尚未绑定车牌')]
      ElMessage.success(`已提交换绑：${p.parkNo} → ${form.plateNo}（等待厂商回执）`)
    } else {
      detailData.value.vehicle = null
      p.plateNo = ''
      p.bindStatus = '未绑定'
      p.bound = false
      detailData.value.bindLogs = [log, ...(detailData.value.bindLogs || []).filter(l => !l.title.startsWith('绑定 '))]
      ElMessage.success(`已提交解绑：${p.parkNo}（等待厂商回执）`)
    }
    saving.value = false
    dlg.value = false
  }, 600)
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
  search()
}
function onCrumb(index) {
  if (index >= activeChain.value.length - 1) return
  const node = flatNode.get(activeChain.value[index])
  if (!node) return
  Object.assign(query, BLANK)
  Object.assign(query, node.patch)
  activeId.value = node.id
  activeChain.value = activeChain.value.slice(0, index + 1)
  scopePath.value = scopePath.value.slice(0, index + 1)
  activeVn.value = ''
  search()
}
function clearScope() {
  Object.assign(query, BLANK)
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  search()
}
function reset() {
  Object.assign(query, { ...BLANK, vehicleType: '', authStatus: '', bindStatus: '', kw: '' })
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  search()
}

function onRow(row) { openDetail(row.parkId) }
function rowClass({ row }) { return row.parkId === highlightId.value ? 'row--focus' : '' }
function jump(path, focus) { router.push(`${path}?focus=${focus}`) }
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }

/* ---------- 落地：focus 锚点 + vf 虚拟节点（承接原 /a/parking 的「车位到期」入口） ---------- */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  const vf = String(route.query.vf || '')
  if (vf && vnodes.some(v => v.key === vf)) {
    Object.assign(query, BLANK)
    Object.assign(query, { vf, bindStatus: '', vehicleType: '', authStatus: '', kw: '' })
    activeId.value = ''
    activeChain.value = []
    activeVn.value = vf
    scopePath.value = []
    await load()
    return
  }
  if (focus && location) {
    if (focus.type === 'park' || focus.type === 'vehicle') {
      Object.assign(query, BLANK)
      Object.assign(query, {
        communityId: location.communityId || '', zone: location.zone || '', status: location.status || ''
      })
      activeId.value = [location.communityId, location.zone, location.status].filter(Boolean).join(':')
      activeChain.value = [location.communityId, `${location.communityId}:${location.zone}`, activeId.value].filter(Boolean)
      scopePath.value = pathOf(tree, activeId.value)
      await load()
      highlightId.value = location.parkId || ''
      if (open && location.parkId) openDetail(location.parkId)
      return
    }
    if (focus.type === 'owner') {
      clearScope()
      query.ownerId = focus.id
      await load()
      return
    }
  }
  clearScope()
})
</script>

<style scoped>
.filter-bar { gap: 12px; }
.filter-bar { gap: 12px; }
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-exp { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; }
.ps-exp.is-expire { color: var(--biz-danger); }
.is-expire { color: var(--biz-danger); }
</style>
