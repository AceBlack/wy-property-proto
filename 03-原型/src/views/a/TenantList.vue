<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>租户管理 · 以「租约」为行</b>：一个租客一条生效中的租约，房屋与业主全部从房屋台账同源派生，口径与 /a/houses 一致；
        <b>{{ summary.expiring }} 条租约 90 天内到期</b>、<b>{{ summary.uncertified }} 人未实名</b>进树即可见。
        租户不是业主：门禁、人脸、通知都按「在住人」发，收费对象仍是业主——详情页把这条边界写清楚。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">在租租约</div><div class="dstat__v">{{ summary.total }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">90 天内到期</div><div class="dstat__v" :class="summary.expiring > 0 ? 'is-warn' : ''">{{ summary.expiring }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">未实名 / 未人脸</div><div class="dstat__v" :class="summary.uncertified + summary.noface > 0 ? 'is-warn' : ''">{{ summary.uncertified }} / {{ summary.noface }}<span class="unit">人</span></div></div>
        <div class="dstat"><div class="dstat__k">月租金合计</div><div class="dstat__v">{{ wan(summary.rentIncome) }}<span class="unit">元/月</span></div></div>
      </div>
      <div class="sum-note">
        口径：租约条数按「房屋维度」统计，一人租多套计多条；平均月租 ¥{{ money(summary.avgRent, 0) }}，到期与未实名走左侧常用视图。
      </div>
    </div>

    <div class="ia" :class="{ 'is-collapsed': treeCollapsed }" style="margin-top:16px;">
      <div class="ia__tree">
        <SpaceTree
          title="租户范围" tree-title="项目 / 楼栋 / 单元"
          :nodes="tree" :virtual="vnodes"
          placeholder="搜项目 / 楼栋 / 单元"
          :active-id="activeId" :active-vn="activeVn"
          @pick="onPick" @collapse="treeCollapsed = true"
        />
      </div>

      <div class="ia__main">
        <el-button v-if="treeCollapsed" class="ia__handle" size="small" :icon="'Expand'" @click="treeCollapsed = false">
          展开租户树
        </el-button>

        <div class="panel">
          <div class="scopebar">
            <template v-if="scopePath.length">
              <span v-for="(p, i) in scopePath" :key="p">
                <span class="scopebar__i" :class="{ 'is-last': i === scopePath.length - 1 }" @click="onCrumb(i)">{{ p }}</span>
                <span v-if="i < scopePath.length - 1" class="scopebar__sep">/</span>
              </span>
            </template>
            <span v-else class="scopebar__i is-last">全部租户</span>
            <span v-if="activeVn" class="scopebar__vf">{{ vnLabel }}</span>
            <span v-if="query.ownerId" class="scopebar__vf">业主 {{ ownerLabel }}</span>
            <span class="spacer" />
            <span class="scopebar__hint">树定范围 · 筛选定属性</span>
            <el-button link type="primary" @click="clearScope">清除范围</el-button>
          </div>

          <el-form :model="query" class="filter-bar" label-width="56px" @submit.prevent>
            <el-form-item label="实名">
              <el-select v-model="query.certified" placeholder="全部" clearable style="width:80px">
                <el-option label="已认证" :value="true" />
                <el-option label="未认证" :value="false" />
              </el-select>
            </el-form-item>
            <el-form-item label="人脸">
              <el-select v-model="query.faceRegistered" placeholder="全部" clearable style="width:80px">
                <el-option label="已录入" :value="true" />
                <el-option label="未录入" :value="false" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="租客 / 电话 / 房号 / 业主" clearable style="width:150px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Plus'" @click="$router.push('/a/tenants/new')">新增租约</el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 条租约</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 500px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column label="租客" min-min-width="120">
              <template #default="{ row }">
                <div class="nowrap">{{ row.name }}</div>
                <div class="ps-sub">{{ row.tenantId }}</div>
              </template>
            </el-table-column>
            <el-table-column label="房屋" min-min-width="150">
              <template #default="{ row }">
                <div class="nowrap">{{ row.houseName }}</div>
                <div class="ps-sub">{{ row.communityName }} · {{ row.buildingName }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="ownerName" label="业主" min-width="86" />
            <el-table-column label="月租" min-width="88" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.rent, 0) }}</span></template>
            </el-table-column>
            <el-table-column label="租期" min-width="96">
              <template #default="{ row }">
                <div class="nowrap">{{ row.leaseStart }}</div>
                <div class="ps-sub">{{ row.leaseEnd }}</div>
              </template>
            </el-table-column>
            <el-table-column label="租约状态" min-width="118">
              <template #default="{ row }">
                <StatusTag domain="lease" :value="leaseStatus(row)" />
                <div class="ps-sub" :class="{ 'is-expire': row.expiring || row.expired }">{{ leftText(row) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="实名 / 人脸" min-width="118">
              <template #default="{ row }">
                <el-tag size="small" :type="row.certified ? 'success' : 'warning'" effect="plain">
                  {{ row.certified ? '已实名' : '未实名' }}
                </el-tag>
                <el-tag size="small" :type="row.faceRegistered ? 'success' : 'info'" effect="plain" style="margin-left:4px">
                  {{ row.faceRegistered ? '人脸' : '无人脸' }}
                </el-tag>
              </template>
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
      v-model="detailVisible" :loading="detailLoading"
      :title="detailData ? `${detailData.tenant.name} · ${detailData.tenant.houseName}` : ''"
      :subtitle="detailData ? `${detailData.tenant.tenantId} · ${detailData.tenant.communityName} · 租期 ${detailData.tenant.leaseStart} ~ ${detailData.tenant.leaseEnd}` : ''"
      :status="detailData ? leaseStatus(detailData.tenant) : ''" status-domain="lease"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">月租</div><div class="dstat__v">¥{{ money(detailData.tenant.rent, 0) }}</div></div>
          <div class="dstat"><div class="dstat__k">租期</div><div class="dstat__v">{{ detailData.tenant.months }}<span class="unit">个月</span></div></div>
          <div class="dstat"><div class="dstat__k">剩余</div><div class="dstat__v" :class="detailData.tenant.expiring || detailData.tenant.expired ? 'is-warn' : ''">{{ leftText(detailData.tenant) }}</div></div>
          <div class="dstat"><div class="dstat__k">年租金</div><div class="dstat__v">{{ wan(detailData.tenant.rent * 12) }}<span class="unit">元</span></div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>租户信息</h4><span class="desc">在住人 · 非业主</span></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">租户编号</span><span class="dl__v">{{ detailData.tenant.tenantId }}</span></div>
          <div class="dl__i"><span class="dl__k">姓名</span><span class="dl__v">{{ detailData.tenant.name }}</span></div>
          <div class="dl__i"><span class="dl__k">手机号</span><span class="dl__v">{{ maskPhone(detailData.tenant.phone) }}</span></div>
          <div class="dl__i"><span class="dl__k">身份证</span><span class="dl__v">{{ maskId(detailData.tenant.idCard) }}</span></div>
          <div class="dl__i"><span class="dl__k">实名认证</span><span class="dl__v">{{ detailData.tenant.certified ? '已认证' : '未认证 · 待提交证件' }}</span></div>
          <div class="dl__i"><span class="dl__k">人脸</span><span class="dl__v">{{ detailData.tenant.faceRegistered ? '已录入 · 可刷脸通行' : '未录入 · 仅刷卡' }}</span></div>
        </div>

        <template v-if="detailData.house">
          <div class="sec__hd" style="margin-top:18px;"><h4>承租房屋</h4></div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">房号</span><span class="dl__v">{{ detailData.house.fullName }}</span></div>
            <div class="dl__i"><span class="dl__k">项目 / 楼栋</span><span class="dl__v">{{ detailData.house.communityName }} · {{ detailData.house.buildingName }}</span></div>
            <div class="dl__i"><span class="dl__k">户型 / 面积</span><span class="dl__v">{{ detailData.house.houseType }} · {{ money(detailData.house.area) }} ㎡</span></div>
            <div class="dl__i"><span class="dl__k">房屋用途</span><span class="dl__v"><StatusTag domain="house" :value="detailData.house.usage" /></span></div>
            <div class="dl__i"><span class="dl__k">建筑面积</span><span class="dl__v">{{ money(detailData.house.area) }} ㎡</span></div>
            <div class="dl__i"><span class="dl__k">房屋欠费</span><span class="dl__v" :class="{ 'is-expire': detailData.debt > 0 }">¥{{ money(detailData.debt) }}</span></div>
          </div>
        </template>

        <template v-if="detailData.owner">
          <div class="sec__hd" style="margin-top:18px;"><h4>业主（收费对象）</h4><span class="desc">租金由业主代缴或租户代付，账始终是业主的</span></div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">姓名</span><span class="dl__v">{{ detailData.owner.name }}</span></div>
            <div class="dl__i"><span class="dl__k">手机号</span><span class="dl__v">{{ maskPhone(detailData.owner.phone) }}</span></div>
            <div class="dl__i"><span class="dl__k">业主类型</span><span class="dl__v">{{ detailData.owner.ownerType }}</span></div>
          </div>
        </template>

        <div v-if="detailData.bills.length" style="margin-top:18px;">
          <div class="sec__hd"><h4>该房屋账单</h4><span class="desc">{{ detailData.bills.length }} 条</span></div>
          <el-table :data="detailData.bills" size="small" max-height="200">
            <el-table-column prop="period" label="账期" width="96" />
            <el-table-column prop="itemName" label="科目" min-width="120" show-overflow-tooltip />
            <el-table-column label="应收" width="96" align="right">
              <template #default="{ row }">¥{{ money(row.amount) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }"><StatusTag domain="bill" :value="row.status" /></template>
            </el-table-column>
          </el-table>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>租约进度</h4><span class="desc">认证 → 人脸 → 到期</span></div>
        <div class="tl">
          <div v-for="(l, i) in detailData.timeline" :key="i" class="tl__i" :class="{ 'is-done': l.done }">
            <div class="tl__t">{{ l.title }}</div>
            <div class="tl__m">{{ l.memo }}</div>
          </div>
        </div>

        <div class="rel">
          <el-button size="small" @click="jump('/a/houses', 'house:' + detailData.tenant.houseId)">房屋台账</el-button>
          <el-button size="small" @click="jump('/a/owners', 'owner:' + detailData.tenant.ownerId)">业主档案</el-button>
          <el-button size="small" @click="jump('/b/bills', 'house:' + detailData.tenant.houseId)">该房账单</el-button>
          <span class="rel__note">房屋与租户是一对一在租关系；换租客要先结束旧租约，避免同一房屋出现两条生效租约</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button
          v-if="detailData && !detailData.tenant.certified"
          :disabled="!!remindAt"
          @click="doRemind(detailData.tenant)"
        >{{ remindAt ? '已提醒 ' + remindAt.slice(5, 16) : '提醒实名认证' }}</el-button>
        <el-button type="primary" @click="$router.push('/a/tenants/' + (detailData?.tenant?.tenantId || '') + '/edit')">发起续租</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, getTenantDetail, ownerName, queryTenants, remindTenantAuth, tenantRemindAt,
  tenantSummary, tenantTree, tenantVirtualNodes
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { pathOf, useFocusLanding } from '@/composables/useFocus'
import SpaceTree from '@/components/SpaceTree.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { maskId, maskPhone, money, wan } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()
const route = useRoute()
const BLANK = { communityId: '', buildingId: '', unitId: '', vf: '', ownerId: '' }
const BLANK_ALL = { ...BLANK, certified: '', faceRegistered: '', kw: '' }


/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'tenantId', label: '租约号' },
  { prop: 'name', label: '承租人' },
  { prop: 'phone', label: '手机号' },
  { prop: 'houseName', label: '房屋' },
  { prop: 'ownerName', label: '业主' },
  { prop: 'leaseStart', label: '起租日' },
  { prop: 'leaseEnd', label: '到期日' },
  { prop: 'rent', label: '月租金' },
  { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '租户管理', source: '/a/tenants', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const { rows, total, pageNo, size, loading, query, load, search } = useListQuery(
  queryTenants, { immediate: false, filters: { ...BLANK_ALL } }
)

const tree = tenantTree()
const vnodes = tenantVirtualNodes()
const summary = tenantSummary()

const treeCollapsed = ref(false)
const activeId = ref('')
const activeChain = ref([])
const activeVn = ref('')
const scopePath = ref([])
const highlightId = ref('')

const vnLabel = computed(() => vnodes.find(v => v.key === activeVn.value)?.label || '')
const ownerLabel = computed(() => (query.ownerId ? ownerName(query.ownerId) : ''))
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getTenantDetail)

/* B 级补齐：提醒实名认证（短信 + 站内信，内存态记录提醒时间） */
const remindVer = ref(0)
const remindAt = computed(() => {
  void remindVer.value
  const t = detailData.value?.tenant
  return t ? tenantRemindAt(t.tenantId) : ''
})
function doRemind(t) {
  try {
    const r = remindTenantAuth(t.tenantId)
    remindVer.value++
    ElMessage.success(`已向 ${r.name}（${maskPhone(r.phone)}）发送实名认证提醒：${r.channels.join(' + ')}`)
  } catch (e) { ElMessage.error(e?.message || '提醒失败') }
}

const flatNode = new Map()
;(function flatten(list) {
  list.forEach(n => {
    flatNode.set(n.id, n)
    if (n.children?.length) flatten(n.children)
  })
})(tree)

function leaseStatus(t) {
  return t.expired ? '已到期' : t.expiring ? '即将到期' : '生效中'
}
function leftText(t) {
  if (t.leftDays === null) return '—'
  if (t.leftDays < 0) return `已过期 ${Math.abs(t.leftDays)} 天`
  if (t.leftDays === 0) return '今天到期'
  return `剩余 ${t.leftDays} 天`
}

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

function onRow(row) { openDetail(row.tenantId) }
function rowClass({ row }) {
  return row.tenantId === highlightId.value || row.houseId === highlightId.value ? 'row--focus' : ''
}
function jump(path, focus) { router.push(`${path}?focus=${focus}`) }
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }

/* ---------- 落地：focus 锚点 + vf 虚拟节点 ---------- */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  const vf = String(route.query.vf || '')
  if (vf && vnodes.some(v => v.key === vf)) {
    Object.assign(query, BLANK_ALL)
    Object.assign(query, { vf })
    activeId.value = ''
    activeChain.value = []
    activeVn.value = vf
    scopePath.value = []
    await load()
    return
  }
  if (focus && location) {
    // 租户 / 房屋 / 业主三种锚点都落到「单元」这一层，单元是租户树上最细粒度
    const uid = location.unitId || location.houseId || ''
    Object.assign(query, BLANK_ALL)
    Object.assign(query, {
      communityId: location.communityId || '',
      buildingId: location.buildingId || '',
      unitId: uid,
      ownerId: focus.type === 'owner' ? focus.id : ''
    })
    if (uid) {
      activeId.value = uid
      activeChain.value = [location.communityId, location.buildingId, uid].filter(Boolean)
      scopePath.value = pathOf(tree, uid)
    } else {
      activeId.value = ''
      activeChain.value = []
      scopePath.value = []
    }
    activeVn.value = ''
    await load()
    highlightId.value = focus.type === 'owner' ? '' : (location.houseId || '')
    if (open && focus.type === 'tenant') openDetail(focus.id)
    return
  }
  clearScope()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-exp { font-size: 12px; color: var(--biz-text-2); }
.ps-exp.is-expire { color: var(--biz-danger); }
.is-expire { color: var(--biz-danger); }
.num { font-family: var(--biz-font-num); }
</style>
