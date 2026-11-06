<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>临时收费台账</b>：摆摊费、场地租用、赔偿款这类<b>与业务没有关联</b>的收费。
        付款方三选一：业主 / 租户 / <b>外部单位或个人</b>（外来摊贩没有档案，记名字和电话即可）。
        <br />
        <b>不计入收缴率</b>：收缴率的定义是「应收 vs 实收」，而临时收费压根没有"应收"这一步，
        进了分母只会让收缴率凭空下降、没人能解释。<b>但要计入营业收入</b> ——
        所以它有独立的台账，收款后按科目汇入收入报表。
        <br />
        收款时写一条缴费流水（渠道「临时收费」），日结能看见、开票池能开票。
        与账单的关系是零：没有账单、不改账单、不生成应收。
      </div>
    </div>

    <!-- 四个数：待收 / 本月已收 / 累计已收 / 已作废 -->
    <div class="grid tstats">
      <div class="panel tstat">
        <div class="tstat__k">待收款</div>
        <div class="tstat__v">{{ st.pending }} <span class="unit">笔</span></div>
        <div class="tstat__s">¥ {{ money(st.pendingAmount) }}</div>
      </div>
      <div class="panel tstat">
        <div class="tstat__k">本月已收</div>
        <div class="tstat__v is-ok">¥ {{ money(st.monthAmount) }}</div>
        <div class="tstat__s">计入营业收入</div>
      </div>
      <div class="panel tstat">
        <div class="tstat__k">累计已收</div>
        <div class="tstat__v">¥ {{ money(st.paidAmount) }}</div>
        <div class="tstat__s">{{ st.paidCount }} 笔 · 其中外部 {{ st.external }} 笔</div>
      </div>
      <div class="panel tstat">
        <div class="tstat__k">已作废</div>
        <div class="tstat__v is-muted">{{ st.voided }} <span class="unit">笔</span></div>
        <div class="tstat__s">作废必须写原因</div>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="panel" style="margin-top:16px;">
      <div class="filters">
        <el-input v-model="q.kw" clearable placeholder="单号 / 付款方 / 手机 / 事由"
          :prefix-icon="'Search'" style="width:230px;" @keyup.enter="applyFilter" />
        <el-select v-model="q.communityId" clearable placeholder="全部项目" style="width:160px;" @change="applyFilter">
          <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="q.partyType" clearable placeholder="全部付款方" style="width:130px;" @change="applyFilter">
          <el-option v-for="p in TEMP_CHARGE_PARTY" :key="p" :label="p" :value="p" />
        </el-select>
        <el-select v-model="q.status" clearable placeholder="全部状态" style="width:120px;" @change="applyFilter">
          <el-option v-for="s in TEMP_CHARGE_STATUS" :key="s" :label="s" :value="s" />
        </el-select>
        <el-button type="primary" :icon="'Search'" @click="applyFilter">查询</el-button>
        <el-button @click="resetFilter">重置</el-button>
        <span class="spacer" />
        <el-button v-if="canEdit" type="primary" plain :icon="'Plus'" @click="openCreate">新建收费单</el-button>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>收费台账</h3>
        <span class="spacer" />
        <span class="desc">按建单时间倒序 · 共 {{ total }} 条</span>
      </div>

      <el-table :data="rows" stripe v-loading="loading" style="width:100%">
        <el-table-column label="单号" width="164">
          <template #default="{ row }">
            <div class="mono">{{ row.chargeNo }}</div>
            <div class="sub">{{ String(row.createdAt).slice(0, 16) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="付款方" min-width="200">
          <template #default="{ row }">
            <div class="party">
              <el-tag size="small" effect="plain" :type="row.partyType === '外部' ? 'warning' : 'info'">
                {{ row.partyType }}
              </el-tag>
              <span class="party__n">{{ row.partyName }}</span>
            </div>
            <div class="sub">{{ row.houseName || row.partyPhone || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="事由 / 科目" min-width="170">
          <template #default="{ row }">
            <div>{{ row.reason }}</div>
            <div class="sub">科目：{{ row.itemName }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="communityName" label="项目" width="120" show-overflow-tooltip />
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">
            <span class="money">{{ money(row.amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.statusType" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="收款" width="150">
          <template #default="{ row }">
            <template v-if="row.status === '已收款'">
              <div>{{ row.method }}</div>
              <div class="sub">{{ String(row.payTime).slice(0, 16) }}</div>
            </template>
            <div v-else-if="row.status === '已作废'" class="sub warn-txt ellip" :title="row.voidReason">{{ row.voidReason }}</div>
            <span v-else class="sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
            <template v-if="row.status === '待收款' && canEdit">
              <el-button link type="primary" size="small" @click="openPay(row)">收款</el-button>
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="openVoid(row)">作废</el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState title="没有符合条件的收费单" hint="换个筛选条件，或点右上角「新建收费单」" />
        </template>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="pageNo" v-model:page-size="size" :total="total"
          :page-sizes="PAGE_SIZES" layout="total, sizes, prev, pager, next" background
          @current-change="load" @size-change="onSize"
        />
      </div>
    </div>

    <!-- 新建 / 编辑 -->
    <el-drawer v-model="ed.visible" :title="ed.chargeId ? '编辑收费单' : '新建收费单'" size="560px" :close-on-click-modal="false">
      <el-form label-width="96px" label-position="right">
        <el-form-item label="付款方" required>
          <el-radio-group v-model="ed.partyType" @change="onPartyChange">
            <el-radio-button v-for="p in TEMP_CHARGE_PARTY" :key="p" :label="p" :value="p">{{ p }}</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <!-- 外部：没有档案，只记名字和电话 -->
        <template v-if="ed.partyType === '外部'">
          <el-form-item label="单位 / 个人" required>
            <el-input v-model="ed.partyName" maxlength="40" placeholder="如：陈记糖油果子 / 社区便民集市" />
          </el-form-item>
          <el-form-item label="联系电话">
            <el-input v-model="ed.partyPhone" maxlength="11" placeholder="选填，11 位手机号" />
          </el-form-item>
        </template>

        <template v-else-if="ed.partyType === '业主'">
          <el-form-item label="选择业主" required>
            <el-select v-model="ed.ownerId" filterable remote :remote-method="searchOwners"
              :loading="ownerLoading" placeholder="输入姓名 / 手机号搜索" style="width:100%"
              @change="onOwnerPick">
              <el-option v-for="o in ownerOpts" :key="o.value" :label="`${o.label}${o.houseName ? ' · ' + o.houseName : ''}`" :value="o.value" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="ed.houseName" label="关联房屋">
            <span>{{ ed.houseName }}</span>
          </el-form-item>
        </template>

        <template v-else>
          <el-form-item label="选择租户" required>
            <el-select v-model="ed.tenantId" filterable remote :remote-method="searchTenants"
              :loading="tenantLoading" placeholder="输入姓名 / 公司名搜索" style="width:100%"
              @change="onTenantPick">
              <el-option v-for="t in tenantOpts" :key="t.value" :label="`${t.label}${t.houseName ? ' · ' + t.houseName : ''}`" :value="t.value" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="ed.houseName" label="关联房屋">
            <span>{{ ed.houseName }}</span>
          </el-form-item>
        </template>

        <el-form-item label="所属项目" required>
          <el-select v-model="ed.communityId" placeholder="收入按项目入账，必选" style="width:100%">
            <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <div v-if="ed.partyType !== '外部'" class="hint">业主 / 租户选了房屋后会自动带出，可改</div>
        </el-form-item>

        <el-form-item label="收费事由" required>
          <el-select v-model="ed.reason" filterable allow-create default-first-option
            placeholder="选一个常用事由，或直接输入" style="width:100%" @change="onReasonChange">
            <el-option v-for="r in reasonOpts" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
          <div class="hint">预设只是省打字，不是白名单 —— 事由可以自由填写</div>
        </el-form-item>

        <el-form-item label="收入科目">
          <el-input v-model="ed.itemName" maxlength="20" placeholder="默认与事由相同，发票上的项目名就是它" />
        </el-form-item>

        <el-form-item label="金额" required>
          <el-input-number v-model="ed.amount" :min="0.01" :max="1000000" :precision="2" :step="10"
            controls-position="right" style="flex:0 0 180px;width:180px" />
          <span class="hint" style="display:inline-block;margin-left:10px;">元</span>
        </el-form-item>

        <el-form-item label="备注">
          <el-input v-model="ed.remark" type="textarea" :rows="2" maxlength="120" show-word-limit placeholder="选填" />
        </el-form-item>
      </el-form>

      <div class="drawer-tip">
        <b>建单只登记，不动钱</b>。要收钱在台账里点「收款」——
        那时才写缴费流水，日结与开票池才看得到。已收款的单据不能改金额，要改先作废重开。
      </div>

      <template #footer>
        <el-button @click="ed.visible = false">取消</el-button>
        <el-button type="primary" :loading="ed.saving" @click="saveForm">保存</el-button>
      </template>
    </el-drawer>

    <!-- 收款 -->
    <el-dialog v-model="pay.visible" title="收款" width="520" :close-on-click-modal="false">
      <div v-if="pay.row" class="pay-brief">
        <div class="pay-brief__n">{{ pay.row.partyName }}</div>
        <div class="pay-brief__m">
          {{ pay.row.reason }} · <span class="money">¥ {{ money(pay.row.amount) }}</span>
        </div>
      </div>

      <div class="sec__hd" style="margin:14px 0 8px;">
        <h4>收款方式</h4>
        <span class="desc">最多 {{ PAY_SPLIT_MAX }} 种 · 合计须等于应收</span>
      </div>

      <div class="splits" :key="pay.key">
        <div v-for="(r, i) in pay.rows" :key="i" class="split-row">
          <el-select v-model="r.method" size="small" style="width:116px">
            <el-option v-for="m in PAY_METHODS" :key="m" :label="m" :value="m"
              :disabled="m !== r.method && pay.rows.some(x => x.method === m)" />
          </el-select>
          <el-input-number v-model="r.amount" :min="0" :max="999999" :precision="2" :step="10"
            size="small" controls-position="right" style="flex:1" />
          <el-button link type="danger" :disabled="pay.rows.length === 1" @click="removeSplit(i)">删</el-button>
        </div>
        <div class="split-foot">
          <el-button link type="primary" :disabled="pay.rows.length >= PAY_SPLIT_MAX" @click="addSplit">
            + 再加一种方式
          </el-button>
        </div>
      </div>

      <!-- 临时收费没有房屋，用不了预存抵扣：说清楚，不让人选完莫名填不进金额 -->
      <div class="pay-note">
        临时收费<b>不挂房屋</b>，所以用不了「预存抵扣」—— 预存余额是记在房屋账户上的。
      </div>

      <div class="split-check" :class="payCheck.ok ? 'is-ok' : 'is-warn'">
        <span>已分配 <b class="money">¥{{ money(payCheck.sum) }}</b> / 应收 <b class="money">¥{{ money(payCheck.total) }}</b></span>
        <span class="split-check__m">{{ payCheck.ok ? '✓ 可以收款' : payCheck.msg }}</span>
      </div>

      <el-form label-width="70px" style="margin-top:12px;">
        <el-form-item label="备注">
          <el-input v-model="pay.remark" maxlength="60" placeholder="选填" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="pay.visible = false">取消</el-button>
        <el-button type="primary" :disabled="!payCheck.ok" :loading="pay.saving" @click="doPay">
          确认收款
        </el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <el-drawer v-model="detail.visible" title="收费单详情" size="520px">
      <template v-if="detail.row">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="单号">{{ detail.row.chargeNo }}</el-descriptions-item>
          <el-descriptions-item label="付款方">
            {{ detail.row.partyType }} · {{ detail.row.partyName }}
            <span v-if="detail.row.partyPhone" class="muted">（{{ detail.row.partyPhone }}）</span>
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.row.houseName" label="关联房屋">{{ detail.row.houseName }}</el-descriptions-item>
          <el-descriptions-item label="所属项目">{{ detail.row.communityName }}</el-descriptions-item>
          <el-descriptions-item label="收费事由">{{ detail.row.reason }}</el-descriptions-item>
          <el-descriptions-item label="收入科目">{{ detail.row.itemName }}</el-descriptions-item>
          <el-descriptions-item label="金额">
            <span class="money">¥ {{ money(detail.row.amount) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="detail.row.statusType" effect="plain">{{ detail.row.status }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="建单">{{ detail.row.createdAt }} · {{ detail.row.createdBy }}</el-descriptions-item>
          <template v-if="detail.row.status === '已收款'">
            <el-descriptions-item label="收款方式">{{ detail.row.method }}</el-descriptions-item>
            <el-descriptions-item label="收款时间">{{ detail.row.payTime }}</el-descriptions-item>
            <el-descriptions-item label="收款人">{{ detail.row.operator }}</el-descriptions-item>
            <el-descriptions-item label="流水号">
              <span class="mono">{{ detail.row.payId }}</span>
            </el-descriptions-item>
          </template>
          <template v-if="detail.row.status === '已作废'">
            <el-descriptions-item label="作废原因">{{ detail.row.voidReason }}</el-descriptions-item>
            <el-descriptions-item label="作废">{{ detail.row.voidAt }} · {{ detail.row.voidBy }}</el-descriptions-item>
          </template>
          <el-descriptions-item v-if="detail.row.remark" label="备注">{{ detail.row.remark }}</el-descriptions-item>
        </el-descriptions>

        <div class="detail-note">
          <b>这张单不计入收缴率</b>：收缴率只看「应收 vs 实收」，临时收费没有应收；
          已收款的部分计入营业收入，按科目汇总。
        </div>
      </template>
    </el-drawer>

    <!-- 作废 -->
    <el-dialog v-model="voidDlg.visible" title="作废收费单" width="420">
      <div class="void-hd">单号 <b class="mono">{{ voidDlg.row?.chargeNo }}</b> · {{ voidDlg.row?.partyName }}</div>
      <el-form label-width="70px" style="margin-top:10px;">
        <el-form-item label="作废原因" required>
          <el-input v-model="voidDlg.reason" maxlength="60" show-word-limit placeholder="如：缴费人取消、金额填错重开" />
        </el-form-item>
      </el-form>
      <div class="void-tip">作废必须写原因 —— 台账事后要能解释这张单为什么没收钱。</div>
      <template #footer>
        <el-button @click="voidDlg.visible = false">取消</el-button>
        <el-button type="danger" :loading="voidDlg.saving" @click="doVoid">确认作废</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  PAY_METHODS, PAY_SPLIT_MAX, PAGE_SIZES, TEMP_CHARGE_PARTY, TEMP_CHARGE_STATUS,
  canEditTempCharges, communityOpts, getTempCharge, invoiceOwnerOpts, invoiceTenantOpts,
  paySplitCheck, payTempCharge, queryTempCharges, saveTempCharge, tempChargeReasonOpts,
  tempChargeStats, voidTempCharge
} from '@/utils/api'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'

const canEdit = computed(() => canEditTempCharges())
const cmOpts = communityOpts()
const reasonOpts = tempChargeReasonOpts()

const q = reactive({ kw: '', communityId: '', partyType: '', status: '' })
const pageNo = ref(1)
const size = ref(20)
const total = ref(0)
const rows = ref([])
const loading = ref(false)
const st = ref({ pending: 0, pendingAmount: 0, monthAmount: 0, paidAmount: 0, paidCount: 0, voided: 0, external: 0 })

async function load() {
  loading.value = true
  try {
    const res = await queryTempCharges({ pageNo: pageNo.value, size: size.value, filters: { ...q } })
    rows.value = res.rows
    total.value = res.total
    st.value = tempChargeStats()
  } catch (e) {
    ElMessage.error(e?.message || '台账加载失败')
  } finally {
    loading.value = false
  }
}
function applyFilter() { pageNo.value = 1; load() }
function resetFilter() { Object.assign(q, { kw: '', communityId: '', partyType: '', status: '' }); applyFilter() }
function onSize() { pageNo.value = 1; load() }

/* ---------------- 新建 / 编辑 ---------------- */
const ed = reactive({
  visible: false, saving: false, chargeId: '',
  partyType: '外部', partyName: '', partyPhone: '',
  ownerId: '', tenantId: '', houseId: '', houseName: '',
  communityId: '', reason: '摆摊费', itemName: '摆摊费', amount: null, remark: ''
})
const ownerOpts = ref([])
const tenantOpts = ref([])
const ownerLoading = ref(false)
const tenantLoading = ref(false)

async function searchOwners(kw) {
  ownerLoading.value = true
  try { ownerOpts.value = await invoiceOwnerOpts(kw) } finally { ownerLoading.value = false }
}
async function searchTenants(kw) {
  tenantLoading.value = true
  try { tenantOpts.value = await invoiceTenantOpts(kw) } finally { tenantLoading.value = false }
}

function onPartyChange() {
  /* 换类型必须清掉另一边的 id：带着业主 id 存成"租户单"会串账 */
  ed.ownerId = ''
  ed.tenantId = ''
  ed.houseId = ''
  ed.houseName = ''
  ed.partyName = ''
  ed.partyPhone = ''
  if (ed.partyType !== '外部' && !ownerOpts.value.length) searchOwners('')
  if (ed.partyType === '租户' && !tenantOpts.value.length) searchTenants('')
}
function onOwnerPick(id) {
  const o = ownerOpts.value.find(x => x.value === id)
  if (!o) return
  ed.partyName = o.label
  ed.partyPhone = o.phone || ''
  ed.houseId = o.houseId || ''
  ed.houseName = o.houseName || ''
  /* 项目由房屋带出 —— 业主名下多房时，先给第一个，允许人改 */
  if (o.communityId) ed.communityId = o.communityId
}
function onTenantPick(id) {
  const t = tenantOpts.value.find(x => x.value === id)
  if (!t) return
  ed.partyName = t.label
  ed.partyPhone = t.phone || ''
  ed.houseId = t.houseId || ''
  ed.houseName = t.houseName || ''
  if (t.communityId) ed.communityId = t.communityId
}
/** 科目默认跟着事由走；人改过科目就不再自动覆盖 */
function onReasonChange(v) {
  if (!ed.itemName || reasonOpts.some(r => r.value === ed.itemName)) ed.itemName = v
}

function openCreate() {
  Object.assign(ed, {
    visible: true, saving: false, chargeId: '',
    partyType: '外部', partyName: '', partyPhone: '',
    ownerId: '', tenantId: '', houseId: '', houseName: '',
    communityId: cmOpts[0]?.id || '', reason: '摆摊费', itemName: '摆摊费', amount: null, remark: ''
  })
  searchOwners('')
  searchTenants('')
}

function openEdit(row) {
  Object.assign(ed, {
    visible: true, saving: false, chargeId: row.chargeId,
    partyType: row.partyType, partyName: row.partyName, partyPhone: row.partyPhone || '',
    ownerId: row.ownerId || '', tenantId: row.tenantId || '',
    houseId: row.houseId || '', houseName: row.houseName || '',
    communityId: row.communityId, reason: row.reason, itemName: row.itemName,
    amount: row.amount, remark: row.remark || ''
  })
  searchOwners('')
  searchTenants('')
  /* 编辑时下拉里要有当前这一项，否则 el-select 只显示 id */
  if (row.ownerId && !ownerOpts.value.some(x => x.value === row.ownerId)) {
    ownerOpts.value = [{ value: row.ownerId, label: row.partyName, phone: row.partyPhone, houseName: row.houseName }, ...ownerOpts.value]
  }
  if (row.tenantId && !tenantOpts.value.some(x => x.value === row.tenantId)) {
    tenantOpts.value = [{ value: row.tenantId, label: row.partyName, phone: row.partyPhone, houseName: row.houseName }, ...tenantOpts.value]
  }
}

async function saveForm() {
  ed.saving = true
  try {
    await saveTempCharge({
      partyType: ed.partyType,
      partyName: ed.partyName,
      partyPhone: ed.partyPhone,
      ownerId: ed.ownerId,
      tenantId: ed.tenantId,
      houseId: ed.houseId,
      communityId: ed.communityId,
      reason: ed.reason,
      itemName: ed.itemName,
      amount: ed.amount,
      remark: ed.remark
    }, ed.chargeId)
    ElMessage.success(ed.chargeId ? '已保存' : '收费单已建立，去台账里点「收款」')
    ed.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    ed.saving = false
  }
}

/* ---------------- 收款 ---------------- */
const pay = reactive({ visible: false, saving: false, row: null, rows: [], remark: '', key: 0 })
const payCheck = computed(() => {
  if (!pay.row) return { ok: false, sum: 0, total: 0, msg: '' }
  return paySplitCheck(pay.rows, pay.row.amount)
})

function openPay(row) {
  pay.row = row
  pay.rows = [{ method: '微信支付', amount: row.amount }]
  pay.remark = ''
  pay.key += 1
  pay.visible = true
}
function addSplit() {
  if (pay.rows.length >= PAY_SPLIT_MAX) return
  const used = new Set(pay.rows.map(r => r.method))
  const next = PAY_METHODS.find(m => !used.has(m) && m !== '预存抵扣') || '现金'
  /* 从金额最大的一行分一半，新行立刻有数 —— 给 0 会立即报「金额必须大于 0」 */
  const host = pay.rows.reduce((m, r) => (r.amount > m.amount ? r : m), pay.rows[0])
  const half = Math.round((Number(host.amount) || 0) / 2 * 100) / 100
  host.amount = Math.round(((Number(host.amount) || 0) - half) * 100) / 100
  pay.rows.push({ method: next, amount: half })
}
function removeSplit(i) {
  if (pay.rows.length === 1) return
  pay.rows.splice(i, 1)
}

async function doPay() {
  pay.saving = true
  try {
    const res = await payTempCharge(pay.row.chargeId, { splits: pay.rows, remark: pay.remark })
    ElMessage.success(`收款成功 ¥${money(res.charge.amount)}（${res.methodText}）`)
    pay.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '收款失败')
  } finally {
    pay.saving = false
  }
}

/* ---------------- 详情 / 作废 ---------------- */
const detail = reactive({ visible: false, row: null })
async function openDetail(row) {
  detail.visible = true
  detail.row = row
  const full = await getTempCharge(row.chargeId)
  if (full) detail.row = full
}

const voidDlg = reactive({ visible: false, saving: false, row: null, reason: '' })
function openVoid(row) {
  voidDlg.row = row
  voidDlg.reason = ''
  voidDlg.visible = true
}
async function doVoid() {
  if (!voidDlg.reason.trim()) { ElMessage.warning('请填写作废原因'); return }
  voidDlg.saving = true
  try {
    await voidTempCharge(voidDlg.row.chargeId, voidDlg.reason)
    ElMessage.success('已作废')
    voidDlg.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '作废失败')
  } finally {
    voidDlg.saving = false
  }
}

onMounted(load)
</script>

<style scoped>
.tstats { margin-top: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.tstat { padding: 14px 16px; }
.tstat__k { font-size: 12.5px; color: var(--biz-text-3); }
.tstat__v { font-family: var(--biz-font-num); font-size: 22px; color: var(--biz-text-1); margin-top: 4px;
  display: flex; align-items: baseline; gap: 4px; }
.tstat__v.is-ok { color: var(--biz-success, #2f9e6e); }
.tstat__v.is-muted { color: var(--biz-text-3); }
.tstat__v .unit { font-size: 12px; color: var(--biz-text-3); }
.tstat__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }

.filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filters .spacer { flex: 1; }

.mono { font-family: var(--biz-font-num); font-size: 12.5px; }
.sub { font-size: 11.5px; color: var(--biz-text-3); margin-top: 1px; }
.party { display: flex; align-items: center; gap: 6px; }
.party__n { font-size: 13px; color: var(--biz-text-1); }
.money { font-family: var(--biz-font-num); }
.warn-txt { color: var(--biz-warning, #d98a1f); }
.ellip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pager { display: flex; justify-content: flex-end; padding-top: 12px; }

.hint { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.7; margin-top: 3px; }
.drawer-tip {
  margin-top: 16px; padding: 10px 12px; border-radius: 8px;
  background: var(--biz-bg-fill); font-size: 12px; line-height: 1.8; color: var(--biz-text-2);
}
.drawer-tip b { color: var(--biz-text-1); }

.pay-brief { padding: 10px 12px; border-radius: 8px; background: var(--biz-bg-fill); }
.pay-brief__n { font-size: 14px; color: var(--biz-text-1); font-weight: 600; }
.pay-brief__m { font-size: 12.5px; color: var(--biz-text-3); margin-top: 3px; }

.splits { display: flex; flex-direction: column; gap: 8px; }
.split-row { display: flex; align-items: center; gap: 8px; }
.split-foot { display: flex; align-items: center; gap: 8px; }
.pay-note {
  margin-top: 8px; font-size: 11.5px; line-height: 1.7; color: var(--biz-text-3);
}
.pay-note b { color: var(--biz-text-2); }

.split-check {
  display: flex; flex-direction: column; gap: 2px; margin-top: 10px;
  padding: 8px 10px; border-radius: 8px; font-size: 12px; background: var(--biz-bg-fill);
}
.split-check.is-ok { color: var(--biz-success, #2f9e6e); }
.split-check.is-warn { color: var(--biz-danger, #d64545); }
.split-check__m { font-size: 11.5px; opacity: .9; }

.detail-note {
  margin-top: 14px; padding: 10px 12px; border-radius: 8px;
  background: var(--biz-bg-fill); font-size: 12px; line-height: 1.8; color: var(--biz-text-2);
}
.detail-note b { color: var(--biz-text-1); }

.void-hd { font-size: 13px; color: var(--biz-text-2); }
.void-tip { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.7; }
</style>
