<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>业主档案 · 双轴（空间 / 权属）</b>：默认<b>空间轴</b>——682 位业主里只有 37 位一人多房（5.4%），
        物业日常问的是「3栋201 是谁」，不是「张建国住哪」。切到权属轴按人的属性分组。
        取数走 <code>api.queryOwners / getOwnerDetail / houseTree / ownerTree</code>。
      </div>
    </div>

    <div class="ia__switch" style="margin-top:16px;">
      <span class="lbl">视图轴</span>
      <el-radio-group v-model="axis" size="small" @change="onAxis">
        <el-radio-button value="space">空间轴</el-radio-button>
        <el-radio-button value="owner">权属轴</el-radio-button>
      </el-radio-group>
      <span class="lbl">空间轴按楼栋单元找人，权属轴按人的属性找房</span>
    </div>

    <div class="ia" :class="{ 'is-collapsed': treeCollapsed }">
      <div class="ia__tree">
        <SpaceTree
          :title="axis === 'space' ? '空间范围' : '权属分组'"
          :tree-title="axis === 'space' ? '项目 / 楼栋 / 单元' : '按人的属性'"
          :nodes="axis === 'space' ? spaceTree : ownerTreeData"
          :virtual="axis === 'space' ? vnodes : []"
          :extra-keys="axis === 'space' ? searchKeys : {}"
          :placeholder="axis === 'space' ? '搜楼栋 / 单元 / 业主' : '搜分组'"
          :active-id="activeId" :active-vn="activeVn"
          :tree-max-height="axis === 'space' ? 'calc(100vh - 470px)' : 'calc(100vh - 400px)'"
          @pick="onPick" @collapse="treeCollapsed = true"
        />
      </div>

      <div class="ia__main">
        <el-button v-if="treeCollapsed" class="ia__handle" size="small" :icon="'Expand'" @click="treeCollapsed = false">
          展开范围树
        </el-button>

        <div class="panel">
          <div class="scopebar">
            <span class="scopebar__vf">{{ axis === 'space' ? '空间轴' : '权属轴' }}</span>
            <template v-if="scopePath.length">
              <span v-for="(p, i) in scopePath" :key="p">
                <span class="scopebar__i" :class="{ 'is-last': i === scopePath.length - 1 }" @click="onCrumb(i)">{{ p }}</span>
                <span v-if="i < scopePath.length - 1" class="scopebar__sep">/</span>
              </span>
            </template>
            <span v-else class="scopebar__i is-last">全部业主</span>
            <span v-if="activeVn" class="scopebar__vf">{{ vnLabel }}</span>
            <span class="spacer" />
            <span class="scopebar__hint">树定范围 · 筛选定属性</span>
            <el-button link type="primary" @click="clearScope">清除范围</el-button>
          </div>

          <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
            <el-form-item label="业主类型">
              <el-select v-model="query.ownerType" placeholder="全部" clearable style="width:120px">
                <el-option v-for="o in ownerTypeOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="信用等级">
              <el-select v-model="query.creditLevel" placeholder="全部" clearable style="width:110px">
                <el-option v-for="o in creditOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="姓名 / 手机 / 房号" clearable style="width:180px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Plus'" @click="$router.push('/a/owners/new')">新增业主</el-button>
            <el-button :icon="'Connection'" :disabled="picked.length < 2" @click="openMerge">
              合并业主{{ picked.length >= 2 ? `（${picked.length}）` : '' }}
            </el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <span v-if="picked.length" class="muted" style="font-size:12.5px;">已选 {{ picked.length }} 位</span>
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 位</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 430px)"
            :row-class-name="rowClass" @row-click="onRow" @selection-change="onSel">
            <el-table-column type="selection" width="46" />
            <el-table-column prop="name" label="业主" width="100" />
            <el-table-column prop="phone" label="手机号" width="120" />
            <el-table-column prop="ownerType" label="类型" width="90" />
            <el-table-column label="名下房屋" min-width="170" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.houseCount === 1">{{ row.houseNames[0] }}</span>
                <span v-else-if="row.houseCount > 1">{{ row.houseNames[0] }} 等 {{ row.houseCount }} 套</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="车位" width="70" align="right">
              <template #default="{ row }"><span class="money">{{ row.parkCount }}</span></template>
            </el-table-column>
            <el-table-column label="认证" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.certified ? 'success' : 'info'" effect="plain">
                  {{ row.certified ? '已认证' : '未认证' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="欠费" width="105" align="right">
              <template #default="{ row }">
                <span class="money" :class="row.debt > 0 ? 'money--out' : ''">¥ {{ money(row.debt) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="175" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
            <el-button link type="warning" @click.stop="openSplit(row)">拆分</el-button>
                <el-button link type="primary" @click.stop="jump('/a/houses', 'owner:' + row.ownerId)">房屋</el-button>
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
      v-model="detailVisible" :loading="detailLoading" :title="detailData?.owner?.name"
      :subtitle="detailData ? `${detailData.owner.ownerId} · ${detailData.owner.phone} · ${detailData.houses.length} 套房` : ''"
      :tag="detailData?.owner?.creditLevel ? `信用 ${detailData.owner.creditLevel}` : ''"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">名下房屋</div><div class="dstat__v">{{ detailData.houses.length }}<span class="unit">套</span></div></div>
          <div class="dstat"><div class="dstat__k">建筑面积</div><div class="dstat__v">{{ money(detailData.totalArea) }}<span class="unit">㎡</span></div></div>
          <div class="dstat"><div class="dstat__k">车位</div><div class="dstat__v">{{ detailData.parkings.length }}<span class="unit">个</span></div></div>
          <div class="dstat"><div class="dstat__k">欠费合计</div><div class="dstat__v" :class="detailData.debt > 0 ? 'is-warn' : ''">¥ {{ money(detailData.debt) }}</div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>档案信息</h4><span class="desc">虚线字段可点击直接改（X2 内联编辑），权属与房屋变更走「编辑业主 / 合并 / 拆分」</span>
        </div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">姓名</span><span class="dl__v">
            <InlineField :model-value="detailData.owner.name" :save="v => saveOwnerField('name', v)"
              @update:model-value="v => detailData.owner.name = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">手机号</span><span class="dl__v">
            <InlineField :model-value="detailData.owner.phone" :save="v => saveOwnerField('phone', v)"
              @update:model-value="v => detailData.owner.phone = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">邮箱</span><span class="dl__v">
            <InlineField :model-value="detailData.owner.email" placeholder="选填"
              :save="v => saveOwnerField('email', v)" @update:model-value="v => detailData.owner.email = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">信用等级</span><span class="dl__v">
            <InlineField :model-value="detailData.owner.creditLevel" type="select" :options="['A', 'B', 'C']"
              :save="v => saveOwnerField('creditLevel', v)" @update:model-value="v => detailData.owner.creditLevel = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">应急联系人</span><span class="dl__v">
            <InlineField :model-value="detailData.owner.emergencyContact" placeholder="选填"
              :save="v => saveOwnerField('emergencyContact', v)" @update:model-value="v => detailData.owner.emergencyContact = v" />
          </span></div>
          <div class="dl__i"><span class="dl__k">应急电话</span><span class="dl__v">
            <InlineField :model-value="detailData.owner.emergencyPhone" placeholder="选填"
              :save="v => saveOwnerField('emergencyPhone', v)" @update:model-value="v => detailData.owner.emergencyPhone = v" />
          </span></div>
          <div class="dl__i is-full"><span class="dl__k">备注</span><span class="dl__v">
            <InlineField :model-value="detailData.owner.remark" type="textarea" placeholder="记录特殊情况 / 协调事项"
              :save="v => saveOwnerField('remark', v)" @update:model-value="v => detailData.owner.remark = v" />
          </span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>名下房屋</h4><span class="desc">点击可跳房屋台账</span></div>
        <el-table :data="detailData.debtByHouse" size="small" @row-click="r => jump('/a/houses', 'house:' + r.house.houseId)">
          <el-table-column prop="house.fullName" label="房屋" min-width="180" show-overflow-tooltip />
          <el-table-column prop="house.useStatus" label="状态" width="95">
            <template #default="{ row }"><StatusTag domain="house" :value="row.house.useStatus" /></template>
          </el-table-column>
          <el-table-column label="未结" width="80" align="right">
            <template #default="{ row }"><span class="money">{{ row.count }}</span></template>
          </el-table-column>
          <el-table-column label="欠费" width="110" align="right">
            <template #default="{ row }">
              <span class="money" :class="row.debt > 0 ? 'money--out' : ''">¥ {{ money(row.debt) }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="detailData.vehicles.length" style="margin-top:18px;">
          <div class="sec__hd"><h4>车辆</h4><span class="desc">{{ detailData.vehicles.length }} 辆</span></div>
          <el-table :data="detailData.vehicles" size="small">
            <el-table-column prop="plateNo" label="车牌" width="120" />
            <el-table-column prop="vehicleType" label="类型" width="90" />
            <el-table-column prop="authStatus" label="授权" width="90">
              <template #default="{ row }"><StatusTag domain="vehicle" :value="row.authStatus" /></template>
            </el-table-column>
            <el-table-column prop="inOutType" label="进出" width="90" />
          </el-table>
        </div>

        <div class="rel">
          <el-button size="small" @click="jump('/a/houses', 'owner:' + detailData.owner.ownerId)">房屋台账</el-button>
          <el-button size="small" @click="jump('/a/vehicles', 'owner:' + detailData.owner.ownerId)">车位与车辆</el-button>
          <el-button size="small" @click="jump('/b/bills', 'owner:' + detailData.owner.ownerId)">账单查询</el-button>
          <el-button size="small" @click="jump('/f/workorders', 'owner:' + detailData.owner.ownerId)">工单列表</el-button>
          <span class="rel__note">从业主出发的跳转带 focus 参数，目标页会自动展开对应层级并高亮该行</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button @click="$router.push('/a/owners/' + (detailData?.owner?.ownerId || '') + '/edit')">编辑业主</el-button>
        <el-button type="primary" @click="jump('/a/houses', 'owner:' + detailData?.owner?.ownerId)">房屋台账</el-button>
      </template>
    </DetailDrawer>

    <!-- A3 合并业主（多选后批量执行，给出成功 / 拦截回执） -->
    <el-dialog v-model="mgVisible" title="合并业主档案" width="560">
      <div class="muted" style="font-size:12.5px;margin-bottom:10px;">
        把重复档案归并到同一人：仅「同名且证件号或手机号一致」才可合并，其余会被拦截并说明原因。
      </div>
      <el-form label-width="96px">
        <el-form-item label="保留为">
          <el-select v-model="mainId" style="width:300px">
            <el-option v-for="o in picked" :key="o.ownerId" :label="`${o.name} · ${o.phone} · ${o.ownerId}`" :value="o.ownerId" />
          </el-select>
        </el-form-item>
        <el-form-item label="人工确认">
          <el-checkbox v-model="forceMerge">同名但证件 / 手机号不一致时，由我确认是同一人</el-checkbox>
        </el-form-item>
      </el-form>
      <!-- W3 规范：内嵌表最多 10 行 + 滚动，用固定 max-height，不用 calc(100vh - Npx) -->
      <el-table :data="mergePreview" size="small" max-height="240">
        <el-table-column prop="ownerId" label="档案" width="100" />
        <el-table-column prop="name" label="业主" width="90" />
        <el-table-column prop="phone" label="手机号" width="120" />
        <el-table-column label="判定" min-width="180">
          <template #default="{ row }">
            <el-tag v-if="row.pass" size="small" type="success" effect="plain">可合并</el-tag>
            <span v-else class="muted" style="font-size:12px;">{{ row.reason }}</span>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="mgVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!passCount" @click="doMerge">确认合并（{{ passCount }}）</el-button>
      </template>
    </el-dialog>

    <!-- A3 拆分：产权变更后把房屋拆给新业主 -->
    <el-dialog v-model="spVisible" title="拆分房屋到新业主" width="560">
      <div class="muted" style="font-size:12.5px;margin-bottom:10px;">
        {{ spOwner.name }}（{{ spOwner.ownerId }}）名下 {{ spHouses.length }} 套，勾选要拆出的房屋；原业主至少保留 1 套。
      </div>
      <el-form label-width="96px">
        <el-form-item label="新业主姓名">
          <el-input v-model="spForm.name" placeholder="请输入产权人姓名" style="width:220px" />
        </el-form-item>
        <el-form-item label="新业主手机">
          <el-input v-model="spForm.phone" placeholder="选填" style="width:220px" />
        </el-form-item>
        <el-form-item label="拆出房屋">
          <el-select v-model="spForm.houseIds" multiple style="width:100%" placeholder="勾选要拆出的房屋">
            <el-option v-for="h in spHouses" :key="h.houseId" :label="h.fullName" :value="h.houseId" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="spVisible = false">取消</el-button>
        <el-button type="primary" @click="doSplit">确认拆分</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PAGE_SIZES, creditLevelOpts, getOwnerDetail, houseTree, houseTreeSearchKeys,
  ownerTree, ownerTypeOpts, ownerVirtualNodes, queryOwners
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { checkMergeOwners, housesOfOwner, mergeOwners, splitOwnerHouses, updateOwnerField } from '@/utils/api'
import { pathOf, useFocusLanding } from '@/composables/useFocus'
import SpaceTree from '@/components/SpaceTree.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import InlineField from '@/components/InlineField.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { maskPhone, money } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()
const BLANK = { communityId: '', buildingId: '', unitId: '', vf: '', creditLevel: '' }


/* 导出：只提交任务，文件在下载中心生成与下载 */
const EXPORT_COLS = [
  { prop: 'ownerId', label: '业主编号' },
  { prop: 'name', label: '业主' },
  { prop: 'phone', label: '手机号' },
  { prop: 'ownerType', label: '类型' },
  { prop: 'houseCount', label: '房屋数' },
  { prop: 'parkCount', label: '车位数' },
  { prop: 'debt', label: '欠费' },
  { prop: 'certifiedText', label: '认证' }
]
function onExport() {
  exportList({ name: '业主档案', source: '/a/owners', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const { rows, total, pageNo, size, loading, query, load, search } = useListQuery(
  queryOwners,
  { immediate: false, filters: { ...BLANK, ownerType: '', kw: '' } }
)

const spaceTree = houseTree()
const ownerTreeData = ownerTree()
const vnodes = ownerVirtualNodes()
const searchKeys = houseTreeSearchKeys()
const ownerTypeOptsData = ownerTypeOpts()
const creditOpts = creditLevelOpts()

const axis = ref('space')
const treeCollapsed = ref(false)
const activeId = ref('')
const activeChain = ref([])
const activeVn = ref('')
const scopePath = ref([])
const highlightId = ref('')

const vnLabel = computed(() => vnodes.find(v => v.key === activeVn.value)?.label || '')
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getOwnerDetail)

/** 当前轴下的节点索引（面包屑回退用） */
const treeOf = () => (axis.value === 'space' ? spaceTree : ownerTreeData)
const flatNode = () => {
  const m = new Map()
  const walk = list => list.forEach(n => {
    m.set(n.id, n)
    if (n.children?.length) walk(n.children)
  })
  walk(treeOf())
  return m
}

function onAxis() {
  clearScope()
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
  const node = flatNode().get(activeChain.value[index])
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
  Object.assign(query, { ...BLANK, ownerType: '', kw: '' })
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  search()
}

function onRow(row) { openDetail(row.ownerId) }

/* X2 内联编辑：档案信息单字段直接改，改完同步列表（OWNER_ROWS 已在 api 内同步） */
const OWNER_FIELD_LABEL = {
  name: '姓名', phone: '手机号', email: '邮箱', creditLevel: '信用等级',
  emergencyContact: '应急联系人', emergencyPhone: '应急电话', remark: '备注'
}
async function saveOwnerField(field, v) {
  const r = await updateOwnerField(detailData.value.owner.ownerId, field, v)
  Object.assign(detailData.value.owner, r)
  search()
  ElMessage.success(`已更新${OWNER_FIELD_LABEL[field] || field}`)
}
function rowClass({ row }) { return row.ownerId === highlightId.value ? 'row--focus' : '' }
function jump(path, focus) { router.push(`${path}?focus=${focus}`) }

/* ---------- A3 合并 / 拆分 + X3 批量回执 ---------- */
const picked = ref([])
function onSel(list) { picked.value = list }

const mgVisible = ref(false)
const mainId = ref('')
const forceMerge = ref(false)
const mergePreview = ref([])
const passCount = computed(() => mergePreview.value.filter(x => x.pass).length)
function openMerge() {
  if (picked.value.length < 2) return
  mainId.value = picked.value[0].ownerId
  buildPreview()
  mgVisible.value = true
}
function buildPreview() {
  try {
    const { ok, blocked } = checkMergeOwners(mainId.value, picked.value.map(o => o.ownerId), { force: forceMerge.value })
    const okIds = new Set(ok.map(o => o.ownerId))
    mergePreview.value = picked.value.map(o => ({
      ownerId: o.ownerId, name: o.name, phone: o.phone,
      pass: o.ownerId !== mainId.value && okIds.has(o.ownerId),
      reason: o.ownerId === mainId.value ? '保留的主档案'
        : (blocked.find(b => b.ownerId === o.ownerId)?.reason || '')
    }))
  } catch { mergePreview.value = [] }
}
watch([mainId, forceMerge], buildPreview)
async function doMerge() {
  try {
    const r = mergeOwners(mainId.value, mergePreview.value.filter(x => x.pass).map(x => x.ownerId), { force: forceMerge.value })
    await ElMessageBox.alert(
      `${r.message}。${r.blocked.length ? '被拦截：' + r.blocked.map(b => `${b.name}（${b.reason}）`).join('、') : ''}`,
      '合并结果', { type: r.blocked.length ? 'warning' : 'success' }
    )
    mgVisible.value = false
    picked.value = []
    search()
  } catch (e) { if (e?.message && e !== 'cancel') ElMessage.error(e.message) }
}

const spVisible = ref(false)
const spOwner = ref({})
const spHouses = ref([])
const spForm = ref({ name: '', phone: '', houseIds: [] })
function openSplit(row) {
  spOwner.value = { ...row }
  spHouses.value = housesOfOwner(row.ownerId)
  spForm.value = { name: '', phone: '', houseIds: [] }
  spVisible.value = true
}
async function doSplit() {
  try {
    const r = splitOwnerHouses(spOwner.value.ownerId, spForm.value.houseIds, {
      newOwnerName: spForm.value.name, phone: spForm.value.phone
    })
    ElMessage.success(`已拆出 ${r.houses} 套到新业主「${r.name}」（${r.newOwnerId}）`)
    spVisible.value = false
    search()
  } catch (e) { ElMessage.error(e?.message || '拆分失败') }
}
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }

useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  if (focus?.type === 'owner' && location) {
    if (location.communityId) {
      Object.assign(query, BLANK)
      Object.assign(query, {
        communityId: location.communityId, buildingId: location.buildingId, unitId: location.unitId
      })
      activeId.value = location.unitId || location.buildingId || location.communityId
      activeChain.value = [location.communityId, location.buildingId, location.unitId].filter(Boolean)
      scopePath.value = pathOf(spaceTree, activeId.value)
    }
    await load()
    highlightId.value = focus.id
    if (open) openDetail(focus.id)
    return
  }
  clearScope()
})
</script>

<style scoped>
.axis { margin-bottom: 10px; }
.axis :deep(.el-radio-button__inner) { padding: 6px 12px; }
</style>
