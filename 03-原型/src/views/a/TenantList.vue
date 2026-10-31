<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>租户管理 · 以「在住人」为行</b>：租户由业主出租产生，<b>信息（含新增）由业主在小程序维护</b>，
        物业可代为补充或修正、<b>保存即生效</b>；补充动作也可在「租户到场代缴物业费」的收银台流程里完成。
        物业不是出租方，<b>租金不在后台展示与统计</b>；本页服务的是门禁人脸、通知触达与上门服务。
        <template v-if="!canEdit">当前角色只读（补充与核验由物业前台 / 项目经理执行）。</template>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr));">
        <div class="dstat">
          <div class="dstat__k">在住租户</div>
          <div class="dstat__v">{{ summary.live }}<span class="unit">人</span></div>
          <div class="dstat__k" style="margin-top:2px;">已搬离 {{ summary.moved }} 条（记录保留）</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">待核验</div>
          <div class="dstat__v" :class="summary.pending ? 'is-warn' : ''">{{ summary.pending }}<span class="unit">人</span></div>
          <div class="dstat__k" style="margin-top:2px;">另有信息不全 {{ summary.incomplete }} 人</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">未实名 / 未录人脸</div>
          <div class="dstat__v" :class="summary.uncertified + summary.noface ? 'is-warn' : ''">{{ summary.uncertified }}<span class="unit">/ {{ summary.noface }}</span></div>
          <div class="dstat__k" style="margin-top:2px;">未实名不能开通门禁</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">90 天内届满</div>
          <div class="dstat__v">{{ summary.expiring }}<span class="unit">人</span></div>
          <div class="dstat__k" style="margin-top:2px;">届满只提醒业主，不自动改状态</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">信息完整率</div>
          <div class="dstat__v">{{ summary.avgRate }}<span class="unit">%</span></div>
          <div class="dstat__k" style="margin-top:2px;">按 8 项物业必填口径</div>
        </div>
      </div>
      <div class="sum-note">
        口径：在住 = 业主已出租且物业未标记搬离；核验状态 待核验 / 已核验 / 信息不全；完整度按物业要用的 8 项计（姓名、手机、证件、实名、人脸、与业主关系、居住人数、紧急联系人），<b>不含租金</b>；
        KPI 为全量口径，不随筛选变化。核验门槛只看其中 5 项基础信息（实名与人脸属核验结果）。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="qvwrap">
        <QuickViews v-model="query.vf" :items="quickViews" hint="快捷视图与下方范围可叠加" @change="search" />
      </div>

      <el-form :model="query" class="filter-bar" label-width="60px" @submit.prevent>
        <ScopeFilter :model="query" @patch="p2 => Object.assign(query, p2)" @change="search" />
        <el-form-item label="核验">
          <el-select v-model="query.verifyStatus" placeholder="全部" clearable style="width:100px">
            <el-option v-for="o in verifyOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="来源">
          <el-select v-model="query.source" placeholder="全部" clearable style="width:100px">
            <el-option v-for="o in sourceOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="租客 / 电话 / 房号 / 业主" clearable style="width:160px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Plus'" :disabled="!canEdit" @click="$router.push('/a/tenants/new')">代业主登记</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <el-button v-if="canEdit" :icon="'Select'" :disabled="!picked.length" @click="doBatchVerify">
          批量核验{{ picked.length ? `（${picked.length}）` : '' }}
        </el-button>
        <span class="muted" style="font-size:12px;">租户新增以业主小程序为主，此处仅供前台代录（记为「物业补录·待核验」）</span>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="reload" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 条</span>
      </div>

      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 520px)"
        :row-class-name="rowClass" @row-click="onRow" @selection-change="onSel">
        <el-table-column type="selection" width="46" />
        <el-table-column label="住户" min-width="118">
          <template #default="{ row }">
            <div class="nowrap">{{ row.name }}</div>
            <div class="ps-sub">{{ row.tenantId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="房屋" min-width="150">
          <template #default="{ row }">
            <div class="nowrap">{{ row.houseName }}</div>
            <div class="ps-sub">{{ row.communityName }} · {{ row.buildingName }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="ownerName" label="业主" min-width="82" />
        <el-table-column prop="relation" label="与业主关系" min-width="96" />
        <el-table-column label="在住状态" width="92">
          <template #default="{ row }"><StatusTag domain="tenantStatus" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="核验" width="94">
          <template #default="{ row }"><StatusTag domain="tenantVerify" :value="row.verifyStatus" /></template>
        </el-table-column>
        <el-table-column label="实名 / 人脸" min-width="126">
          <template #default="{ row }">
            <el-tag size="small" :type="row.certified ? 'success' : 'warning'" effect="plain">{{ row.certified ? '已实名' : '未实名' }}</el-tag>
            <el-tag size="small" :type="row.faceRegistered ? 'success' : 'info'" effect="plain" style="margin-left:4px">{{ row.faceRegistered ? '人脸' : '无人脸' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="信息完整度" min-width="126">
          <template #default="{ row }">
            <div class="pg">
              <div class="pg__bar"><i :style="{ width: row.completeness.rate + '%' }" :class="{ 'is-ok': row.completeness.rate >= 100 }" /></div>
              <span class="pg__t">{{ row.completeness.filled }}/{{ row.completeness.total }}</span>
            </div>
            <div class="ps-sub" v-if="row.completeness.missing.length">缺 {{ row.completeness.missing.length }} 项</div>
          </template>
        </el-table-column>
        <el-table-column label="租期届满" min-width="110">
          <template #default="{ row }">
            <div class="nowrap">{{ row.leaseEnd }}</div>
            <div class="ps-sub" :class="{ 'is-expire': row.expiring || row.expired }">{{ leftText(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="96">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.source === '物业补录' ? 'warning' : 'info'">{{ row.source }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="118" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
            <el-button v-if="canEdit && row.live" link type="primary" @click.stop="openSupplement(row)">补充</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="search" desc="当前视图没有租户，换个快捷视图或清除范围看看">
            <template #action><el-button @click="reset">清除筛选条件</el-button></template>
          </EmptyState>
        </template>
      </el-table>

      <div class="table-foot">
        <el-pagination v-model:current-page="pageNo" v-model:page-size="size"
          :page-sizes="PAGE_SIZES" :total="total" layout="total, sizes, prev, pager, next, jumper" />
      </div>
    </div>

    <!-- 详情 -->
    <DetailDrawer
      v-model="detailVisible" :loading="detailLoading"
      :title="detailData ? `${detailData.tenant.name} · ${detailData.tenant.roomText}` : ''"
      :subtitle="detailSub"
      :status="detailData?.tenant?.status" status-domain="tenantStatus"
      :tag="detailData?.tenant?.source || ''"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">居住人数</div><div class="dstat__v">{{ detailData.tenant.residents }}<span class="unit">人</span></div></div>
          <div class="dstat"><div class="dstat__k">信息完整度</div><div class="dstat__v">{{ detailData.tenant.completeness.rate }}<span class="unit">%</span></div></div>
          <div class="dstat">
            <div class="dstat__k">租期届满</div>
            <div class="dstat__v" style="font-size:15px;" :class="detailData.tenant.expiring || detailData.tenant.expired ? 'is-warn' : ''">{{ leftText(detailData.tenant) }}</div>
          </div>
          <div class="dstat">
            <div class="dstat__k">门禁 / 人脸</div>
            <div class="dstat__v" style="font-size:15px;">{{ detailData.tenant.faceRegistered ? '已授权' : '未授权' }}</div>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>在住信息</h4><span class="desc">来源 {{ detailData.tenant.source }} · 业主维护为主</span>
        </div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">住户编号</span><span class="dl__v">{{ detailData.tenant.tenantId }}</span></div>
          <div class="dl__i"><span class="dl__k">姓名</span><span class="dl__v">{{ detailData.tenant.name }}</span></div>
          <div class="dl__i"><span class="dl__k">手机号</span><span class="dl__v">
            <SensitiveText :value="detailData.tenant.phone" field="phone" entity-type="租户"
              :entity-id="detailData.tenant.tenantId" :entity-name="detailData.tenant.name" source="/a/tenants" />
          </span></div>
          <div class="dl__i"><span class="dl__k">证件号</span><span class="dl__v">
            <SensitiveText :value="detailData.tenant.idCard" field="idCard" entity-type="租户"
              :entity-id="detailData.tenant.tenantId" :entity-name="detailData.tenant.name" source="/a/tenants" />
          </span></div>
          <div class="dl__i"><span class="dl__k">与业主关系</span><span class="dl__v">{{ detailData.tenant.relation }}</span></div>
          <div class="dl__i"><span class="dl__k">核验状态</span><span class="dl__v"><StatusTag domain="tenantVerify" :value="detailData.tenant.verifyStatus" /></span></div>
          <div class="dl__i"><span class="dl__k">租期</span><span class="dl__v">{{ detailData.tenant.leaseStart }} ~ {{ detailData.tenant.leaseEnd }}</span></div>
          <div class="dl__i"><span class="dl__k">最后修改</span><span class="dl__v">{{ detailData.tenant.updatedAt ? `${detailData.tenant.updatedBy} · ${detailData.tenant.updatedAt}` : '—' }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>物业补充信息</h4>
          <span class="desc">
            {{ detailData.tenant.completeness.missingBasic.length ? `核验门槛还缺 ${detailData.tenant.completeness.missingBasic.join('、')}` : '基础 5 项齐全，可提交核验' }}
          </span>
        </div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">第二联系电话</span><span class="dl__v" :class="{ 'is-empty': !detailData.tenant.secondPhone }">{{ detailData.tenant.secondPhone || '未补充' }}</span></div>
          <div class="dl__i"><span class="dl__k">紧急联系人</span><span class="dl__v" :class="{ 'is-empty': !detailData.tenant.emergencyContact }">{{ detailData.tenant.emergencyContact || '未补充' }}</span></div>
          <div class="dl__i"><span class="dl__k">车辆信息</span><span class="dl__v" :class="{ 'is-empty': !detailData.tenant.vehicles }">{{ detailData.tenant.vehicles || '未补充' }}</span></div>
          <div class="dl__i"><span class="dl__k">养宠</span><span class="dl__v">{{ detailData.tenant.pets ? '是' : '否' }}</span></div>
          <div class="dl__i"><span class="dl__k">特殊人群</span><span class="dl__v">{{ (detailData.tenant.specialCare || []).join('、') || '无' }}</span></div>
          <div class="dl__i is-full"><span class="dl__k">备注</span><span class="dl__v" :class="{ 'is-empty': !detailData.tenant.remark }">{{ detailData.tenant.remark || '未补充' }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>房屋与业主</h4><span class="desc">收费对象始终是业主，租户不产生应收</span></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">房号</span><span class="dl__v">{{ detailData.tenant.houseName }}</span></div>
          <div class="dl__i"><span class="dl__k">项目 / 楼栋</span><span class="dl__v">{{ detailData.tenant.communityName }} · {{ detailData.tenant.buildingName }}</span></div>
          <div class="dl__i"><span class="dl__k">户型 / 面积</span><span class="dl__v">{{ detailData.tenant.houseUsage }} · {{ detailData.house ? money(detailData.house.area) + ' ㎡' : '-' }}</span></div>
          <div class="dl__i"><span class="dl__k">产权业主</span><span class="dl__v">{{ detailData.tenant.ownerName }}</span></div>
          <div class="dl__i"><span class="dl__k">业主电话</span><span class="dl__v">
            <SensitiveText :value="detailData.tenant.ownerPhone" field="phone" entity-type="业主"
              :entity-id="detailData.tenant.ownerId" :entity-name="detailData.tenant.ownerName" source="/a/tenants" />
          </span></div>
          <div class="dl__i"><span class="dl__k">该房欠费</span><span class="dl__v" :class="{ 'is-expire': detailData.debt > 0 }">¥{{ money(detailData.debt) }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>操作记录</h4><span class="desc">业主登记 → 物业补充/核验 → 门禁 → 搬离</span></div>
        <div class="tl">
          <div v-for="(h, i) in detailData.history" :key="i" class="tl__i" :class="{ 'is-done': h.done }">
            <div class="tl__t">{{ h.action }}<span v-if="h.by && h.by !== '—'" class="tl__by"> · {{ h.by }}</span></div>
            <div class="tl__m">{{ h.memo }}<template v-if="h.at"> · {{ h.at }}</template></div>
          </div>
        </div>

        <div class="rel">
          <el-button size="small" @click="jump('/a/houses', 'house:' + detailData.tenant.houseId)">房屋台账</el-button>
          <el-button size="small" @click="jump('/a/owners', 'owner:' + detailData.tenant.ownerId)">业主档案</el-button>
          <el-button size="small" @click="jump('/b/bills', 'house:' + detailData.tenant.houseId)">该房账单</el-button>
          <span class="rel__note">租户代缴物业费时，可在收银台「在住租户」卡片里直接补充信息，不必回到本页</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="canEdit && detailData?.tenant?.live" @click="openSupplement(detailData.tenant)">补充信息</el-button>
        <el-button v-if="canEdit && detailData?.tenant?.live && detailData.tenant.verifyStatus !== '已核验'" @click="doVerify">核验通过</el-button>
        <el-button
          v-if="canEdit && detailData?.tenant?.live && detailData.tenant.certified && !detailData.tenant.faceRegistered"
          @click="doFace"
        >录入人脸</el-button>
        <el-button v-if="canEdit && detailData?.tenant?.live" type="danger" plain @click="openMoveOut(detailData.tenant)">标记搬离</el-button>
      </template>
    </DetailDrawer>

    <!-- 补充租户信息（与收银台共用） -->
    <TenantSupplementDrawer
      v-model="supplementVisible" :tenant="supplementTarget"
      @saved="onSupplementSaved"
    />

    <!-- 标记搬离 -->
    <el-dialog v-model="moveOutVisible" title="标记搬离" width="480" top="14vh">
      <el-form label-width="92px">
        <el-form-item label="租户"><span>{{ moveOutForm.name }} · {{ moveOutForm.houseName }}</span></el-form-item>
        <el-form-item label="搬离日期">
          <el-date-picker v-model="moveOutForm.date" type="date" value-format="YYYY-MM-DD" style="width:180px" />
        </el-form-item>
        <el-form-item label="搬离原因">
          <el-input v-model="moveOutForm.reason" placeholder="如：租期届满退租 / 业主收回自住" />
        </el-form-item>
        <el-alert type="warning" :closable="false" show-icon
          title="标记后：状态变为已搬离、门禁与人脸立即停用、房屋释放在住关系；记录保留可回溯，不物理删除。" />
      </el-form>
      <template #footer>
        <el-button @click="moveOutVisible = false">取消</el-button>
        <el-button type="danger" @click="doMoveOut">确认搬离</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PAGE_SIZES, batchVerifyTenants, getTenantDetail,
  moveOutTenant, queryTenants, registerTenantFace, tenantSourceOpts, tenantSummary,
  tenantQuickViews, tenantVerifyStatusOpts, verifyTenant
} from '@/api'
import { currentRoleId } from '@/utils/auth'
import { permCodesOfRole } from '@/utils/rbac'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { useFocusLanding } from '@/composables/useFocus'
import DetailDrawer from '@/components/DetailDrawer.vue'
import QuickViews from '@/components/QuickViews.vue'
import ScopeFilter from '@/components/ScopeFilter.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import TenantSupplementDrawer from '@/components/TenantSupplementDrawer.vue'
import { money } from '@/utils/format'
import SensitiveText from '@/components/SensitiveText.vue'
import { exportList } from '@/utils/export'

const router = useRouter()
const route = useRoute()
const canEdit = computed(() => permCodesOfRole(currentRoleId.value).has('a.tenants.edit'))

const BLANK = {
  vf: '', communityId: '', buildingId: '', unitId: '', verifyStatus: '', source: '', kw: ''
}
const { rows, total, pageNo, size, loading, query, load, search, reset } =
  useListQuery(queryTenants, { filters: { ...BLANK }, size: 20 })

const ver = ref(0)
const quickViews = computed(() => { void ver.value; return tenantQuickViews() })
const summary = computed(() => { void ver.value; return tenantSummary() })
const verifyOpts = tenantVerifyStatusOpts()
const sourceOpts = tenantSourceOpts()

function onCommunity() {
  query.buildingId = ''
  query.unitId = ''
  search()
}
function onBuilding() {
  query.unitId = ''
  search()
}
function reload() {
  ver.value++
  load()
}

const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getTenantDetail)
const detailSub = computed(() => detailData.value
  ? `${detailData.value.tenant.tenantId} · ${detailData.value.tenant.communityName} · 租期 ${detailData.value.tenant.leaseStart} ~ ${detailData.value.tenant.leaseEnd}`
  : '')

function leftText(t) {
  if (t.leftDays === null || t.leftDays === undefined) return '—'
  if (!t.live) return '已搬离'
  if (t.leftDays < 0) return `已届满 ${Math.abs(t.leftDays)} 天`
  if (t.leftDays === 0) return '今天届满'
  return `剩余 ${t.leftDays} 天`
}

function onRow(row) { openDetail(row.tenantId) }
function rowClass({ row }) { return row.tenantId === highlightId.value ? 'row--focus' : '' }
function jump(path, focus) { router.push(`${path}?focus=${focus}`) }

/* ---------- 补充 ---------- */
const supplementVisible = ref(false)
const supplementTarget = ref(null)
function openSupplement(t) {
  if (!canEdit.value) { ElMessage.warning('补充与核验由物业前台 / 项目经理执行'); return }
  supplementTarget.value = t
  supplementVisible.value = true
}
function onSupplementSaved() {
  reload()
  if (detailVisible.value && supplementTarget.value) openDetail(supplementTarget.value.tenantId)
}

/* ---------- 核验 ---------- */
async function doVerify() {
  const t = detailData.value?.tenant
  if (!t) return
  try {
    await ElMessageBox.confirm(
      `确认 ${t.name}（${t.houseName}）信息核验通过？核验后可为其开通门禁与人脸授权。`,
      '物业核验', { type: 'warning', confirmButtonText: '核验通过', cancelButtonText: '取消' }
    )
    const r = verifyTenant(t.tenantId, { verifier: '物业前台', pass: true })
    ElMessage.success(`${r.name} 已核验通过`)
    reload()
    openDetail(t.tenantId)
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(e?.message || '核验失败')
  }
}

/* ---------- 批量核验（基础 5 项齐全的才通过） ---------- */
const picked = ref([])
function onSel(list) { picked.value = list }
function doBatchVerify() {
  try {
    const r = batchVerifyTenants(picked.value.map(t => t.tenantId), { operator: '物业前台' })
    const tip = r.failed.length
      ? `已核验 ${r.ok} 人；跳过 ${r.failed.length} 人：${r.failed.slice(0, 3).map(f => `${f.name}（${f.reason}）`).join('、')}${r.failed.length > 3 ? ' 等' : ''}`
      : `${r.ok} 人已核验通过，门禁可在核验后录入人脸`
    ElMessage({ type: r.failed.length ? 'warning' : 'success', message: tip, duration: 4600 })
    picked.value = []
    reload()
  } catch (e) { ElMessage.error(e?.message || '批量核验失败') }
}

/* ---------- 录入人脸（门禁授权） ---------- */
function doFace() {
  const t = detailData.value?.tenant
  if (!t) return
  try {
    const r = registerTenantFace(t.tenantId, { operator: '物业前台' })
    ElMessage.success(`${r.name} 人脸已录入，门禁与通知触达已开通`)
    reload()
    openDetail(t.tenantId)
  } catch (e) { ElMessage.error(e?.message || '录入失败') }
}

/* ---------- 搬离 ---------- */
const moveOutVisible = ref(false)
const moveOutForm = reactive({ tenantId: '', name: '', houseName: '', date: '', reason: '' })
function openMoveOut(t) {
  moveOutForm.tenantId = t.tenantId
  moveOutForm.name = t.name
  moveOutForm.houseName = t.houseName
  moveOutForm.date = new Date().toISOString().slice(0, 10)
  moveOutForm.reason = ''
  moveOutVisible.value = true
}
function doMoveOut() {
  try {
    const r = moveOutTenant(moveOutForm.tenantId, {
      date: moveOutForm.date, reason: moveOutForm.reason, operator: '物业前台'
    })
    ElMessage.success(`${r.name} 已标记搬离，门禁与人脸已停用`)
    moveOutVisible.value = false
    detailVisible.value = false
    reload()
  } catch (e) { ElMessage.error(e?.message || '操作失败') }
}

/* ---------- 导出（不含租金） ---------- */
const EXPORT_COLS = [
  { prop: 'tenantId', label: '住户编号' }, { prop: 'name', label: '姓名' },
  { prop: 'phone', label: '手机号' }, { prop: 'houseName', label: '房屋' },
  { prop: 'ownerName', label: '业主' }, { prop: 'relation', label: '与业主关系' },
  { prop: 'residents', label: '居住人数' }, { prop: 'status', label: '在住状态' },
  { prop: 'verifyStatus', label: '核验状态' }, { prop: 'source', label: '来源' },
  { prop: 'leaseStart', label: '起租日' }, { prop: 'leaseEnd', label: '到期日' },
  { prop: 'rate', label: '信息完整度(%)' }
]
function onExport() {
  /* 完整度是派生的嵌套对象，导出前拍平成 rate 列 */
  const data = rows.value.map(r => ({ ...r, rate: r.completeness.rate }))
  exportList({ name: '租户管理', source: '/a/tenants', columns: EXPORT_COLS, rows: data, filters: { ...query } })
}

/* ---------- focus 落地：不再依赖左树，直接落到范围筛选 ---------- */
const highlightId = ref('')
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  const uid = location?.unitId || ''
  Object.assign(query, {
    ...BLANK,
    communityId: location?.communityId || '',
    buildingId: location?.buildingId || '',
    unitId: uid,
    ownerId: focus?.type === 'owner' ? focus.id : ''
  })
  await load()
  if (focus?.type === 'tenant') {
    highlightId.value = focus.id
    if (open) openDetail(focus.id)
  }
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.qv__n { font-family: var(--biz-font-num); color: var(--biz-text-3); margin-left: 2px; }
.nowrap { white-space: nowrap; }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-sub.is-expire { color: var(--biz-danger); }
.is-expire { color: var(--biz-danger); }
.is-empty { color: var(--biz-text-4, #a6adc1); }
.is-warn { color: var(--biz-danger); }
.pg { display: flex; align-items: center; gap: 6px; }
.pg__bar { flex: 1; height: 6px; border-radius: 3px; background: var(--biz-fill-2, #eef0f6); overflow: hidden; }
.pg__bar i { display: block; height: 100%; background: var(--biz-warning, #d98a1f); border-radius: 3px; }
.pg__bar i.is-ok { background: var(--biz-success, #12b98a); }
.pg__t { font-size: 11.5px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.tl__by { color: var(--biz-text-3); font-weight: 400; }
</style>
