<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>PC 收银台</b>：前台按「业主」检索，一次带出名下全部房产与账单，勾选后合并收款。
        左侧选人（一人多房）、中间选账单（可按房筛选）、右侧结算。
        <br />
        <b>支持组合支付</b>：一笔收款可以拆到最多 <b>3 种</b>方式（现金 + 微信 + 预存抵扣…），
        各方式金额合计必须等于实收，差一分都不让提交。收款后<b>真实写流水</b>（不是只改账单状态）——
        日结、开票池、报表都读它。
      </div>
    </div>

    <!-- 检索 -->
    <div class="panel" style="margin-top:16px;">
      <div class="search-row">
        <el-input
          v-model="kw" clearable
          placeholder="业主 / 租户姓名、房号、手机号、身份证后四位"
          style="max-width:460px;"
          :prefix-icon="'Search'"
        />
        <div class="quick">
          <span class="muted" style="font-size:12.5px;">演示对象：</span>
          <el-tag
            v-for="o in demoOwners" :key="o.ownerId" effect="plain" round
            style="cursor:pointer;" @click="pick(o.ownerId)"
          >{{ o.name }}</el-tag>
        </div>
        <span class="spacer" />
        <!-- 临时收费：摆摊费这类与业务无关的钱，不挂业主账单，单独一个口子 -->
        <el-button v-if="canTemp" :icon="'Yen'" plain @click="tcOpen = true">临时收费</el-button>
        <el-button :icon="'Document'" plain>交班对账</el-button>
        <el-button :icon="'Tickets'" plain>今日流水</el-button>
      </div>
    </div>

    <div class="cashier">
      <!-- 左：业主 -->
      <div class="panel side">
        <div class="panel__hd"><h3>业主</h3><span class="spacer" /><span class="desc">{{ resultList.length }} 位</span></div>

        <!-- 楼栋 / 单元：只收窄左栏选人范围，不新增栅格列，中栏账单表宽度不变 -->
        <div class="locals">
          <el-select v-model="bldgId" size="small" clearable placeholder="全部楼栋（可选）" style="width:100%">
            <el-option v-for="b in bldgOpts" :key="b.value" :label="b.label" :value="b.value" />
          </el-select>
          <el-select v-if="bldgId" v-model="unitId" size="small" clearable placeholder="全部单元" style="width:100%;margin-top:6px;">
            <el-option v-for="u in unitOpts" :key="u.value" :label="u.label" :value="u.value" />
          </el-select>
          <div v-if="bldgId" class="locals__hint">
            <span class="ellip">{{ scopeText }}</span>
            <el-button link type="primary" size="small" @click="clearLocals">清除</el-button>
          </div>
        </div>

        <div class="olist">
          <div
            v-for="o in resultList" :key="o.ownerId"
            class="oitem" :class="{ 'is-on': o.ownerId === ownerId }"
            @click="pick(o.ownerId)"
          >
            <div class="oitem__ava">{{ o.name.slice(0, 1) }}</div>
            <div class="oitem__b">
              <div class="oitem__n">{{ o.name }}<span class="oitem__t">{{ o.ownerType }}</span></div>
              <div class="oitem__d">
                <SensitiveText :value="o.phone" field="phone" entity-type="业主" :entity-id="o.ownerId"
                  :entity-name="o.name" source="/b/cashier" /> · {{ roomOfScope(o) || (o.houseIds.length + ' 套房') }}
              </div>
            </div>
            <div class="oitem__r">
              <div class="oitem__m">{{ money(quickDebt(o.ownerId)) }}</div>
              <div class="oitem__s">欠费</div>
            </div>
          </div>
          <EmptyState v-if="!resultList.length" type="search" desc="未找到匹配的业主" />
        </div>
      </div>

      <!-- 中：账单 -->
      <div class="panel">
        <div class="panel__hd">
          <h3>待收账单</h3>
          <span class="tag tag--primary">{{ p.owner.name }}</span>
          <span class="muted" style="font-size:12.5px;">{{ p.houses.length }} 套房 · {{ p.parkings.length }} 个车位</span>
          <span class="spacer" />
          <el-radio-group v-model="houseFilter" size="small">
            <el-radio-button label="__all">合并全部（{{ debtRows.length }}）</el-radio-button>
            <el-radio-button v-for="h in p.houses" :key="h.houseId" :label="h.houseId">{{ h.room }}</el-radio-button>
          </el-radio-group>
        </div>

        <el-table
          ref="tableRef" :data="shownRows" size="small" :height="430"
          @selection-change="onSel"
        >
          <el-table-column type="selection" width="46" />
          <el-table-column label="房屋" min-width="148">
            <template #default="{ row }">
              <div class="hcell" :title="houseName(row.houseId)">
                <span class="ellip">{{ shortHouse(row.houseId) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="period" label="所属期" width="76" />
          <el-table-column prop="itemName" label="科目" width="92" show-overflow-tooltip />
          <el-table-column prop="unpaid" label="本次应收" width="104" align="right">
            <template #default="{ row }">
              <div class="money strong">{{ money(row.unpaid) }}</div>
              <div v-if="row.lateFee" class="late">含滞纳金 {{ money(row.lateFee) }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="overdueDays" label="逾期" width="60" align="right">
            <template #default="{ row }">
              <span :class="{ 'is-danger': row.overdueDays > 90 }">{{ row.overdueDays ? row.overdueDays + ' 天' : '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="76">
            <template #default="{ row }"><StatusTag domain="bill" :value="row.status" /></template>
          </el-table-column>
          <template #empty><EmptyState type="empty" desc="该业主当前无欠费账单" /></template>
        </el-table>

        <div class="sumline">
          <span>已选 <b>{{ sel.length }}</b> 笔</span>
          <span class="dot">·</span>
          <span>应收 <b class="money">{{ money(sum.payable) }}</b></span>
          <span class="dot">·</span>
          <span>滞纳金 <b class="money">{{ money(sum.lateFee) }}</b></span>
          <span class="spacer" />
          <span class="muted" style="font-size:12px;">收款后即时销账，可在「缴费记录」追溯</span>
        </div>
      </div>

      <!-- 右：结算 -->
      <div class="panel side-r">
        <div class="panel__hd"><h3>结算</h3></div>

        <div class="pay-box">
          <div class="pay-line">
            <span>本次应收</span>
            <b class="money">{{ money(sum.unpaid) }}</b>
          </div>
          <div class="pay-line">
            <span>滞纳金</span>
            <b class="money">{{ money(sum.lateFee) }}</b>
          </div>
          <div class="pay-line">
            <span>减免</span>
            <el-input-number v-model="discount" :min="0" :max="sum.unpaid" :step="10" size="small" controls-position="right" style="width:120px;" />
          </div>
          <div class="pay-total">
            <span>实收合计</span>
            <b class="money">¥ {{ money(payableTotal) }}</b>
          </div>
        </div>

        <!-- 在住租户：租户到场代缴物业费时，就地补充 / 修正其信息（保存即生效） -->
        <div class="tenant-card">
          <div class="tenant-card__hd">
            <h4>在住租户</h4>
            <span class="desc">{{ ownerTenants.length }} 人 · 收费对象仍是业主</span>
          </div>
          <div v-if="!ownerTenants.length" class="tenant-card__empty">
            该业主名下暂无在住租户（出租后由业主小程序登记）
            <div style="margin-top:6px;">
              <el-button link type="primary" size="small" @click="$router.push('/a/tenants/new')">前台代录租户</el-button>
            </div>
          </div>
          <div v-for="t in ownerTenants.slice(0, 3)" :key="t.tenantId" class="tline">
            <div class="tline__b">
              <div class="tline__n">{{ t.name }}<span class="tline__r">{{ t.roomText }}</span></div>
              <div class="tline__m">
                信息 {{ t.completeness.rate }}% ·
                <span :class="{ 'is-warn': t.verifyStatus !== '已核验' }">{{ t.verifyStatus }}</span>
              </div>
            </div>
            <el-button link type="primary" size="small" @click="openTenantSupplement(t)">补充</el-button>
          </div>
          <div v-if="ownerTenants.length > 3" class="tenant-card__more">另有 {{ ownerTenants.length - 3 }} 人，可在「租户管理」查看</div>
          <div class="tenant-card__tip">租户代缴时可直接补充/修正信息，保存即生效，无需业主确认。</div>
        </div>

        <div class="sec__hd" style="margin:18px 0 10px;">
          <h4>收款方式</h4>
          <span class="desc">最多 {{ PAY_SPLIT_MAX }} 种 · 合计须等于实收</span>
        </div>

        <div class="splits" :key="splitKey">
          <div v-for="(row, i) in splitRows" :key="i" class="split-row">
            <el-select v-model="row.method" size="small" style="width:116px" @change="onMethodChange(row)">
              <el-option v-for="m in PAY_METHODS" :key="m" :label="m" :value="m"
                :disabled="m !== row.method && isMethodUsed(m)" />
            </el-select>
            <el-input-number v-model="row.amount" :min="0" :max="999999" :precision="2" :step="10"
              size="small" controls-position="right" style="flex:1;" @change="onAmountChange" />
            <el-button link type="danger" :disabled="splitRows.length === 1" @click="removeSplit(i)">删</el-button>
          </div>
          <div class="split-foot">
            <el-button link type="primary" :disabled="splitRows.length >= PAY_SPLIT_MAX" @click="addSplit">
              + 再加一种方式
            </el-button>
            <span class="spacer" />
            <span v-if="prepayAvail > 0" class="muted" style="font-size:11.5px;">
              预存可用 ¥{{ money(prepayAvail) }}
            </span>
          </div>
        </div>

        <div class="split-check" :class="!sel.length ? '' : (splitCheck.ok ? 'is-ok' : 'is-warn')">
          <span v-if="sel.length">
            已分配 <b class="money">¥{{ money(splitCheck.sum) }}</b> / 实收 <b class="money">¥{{ money(splitCheck.total) }}</b>
          </span>
          <span v-else>尚未勾选账单</span>
          <span class="split-check__m">
            {{ !sel.length ? '在中间列表勾选要收的账单，或直接点「合并全部」' : (splitCheck.ok ? '✓ 可以收款' : splitCheck.msg) }}
          </span>
        </div>

        <div class="sec__hd" style="margin:18px 0 10px;"><h4>备注</h4></div>
        <el-input v-model="remark" type="textarea" :rows="2" placeholder="选填，如：业主现场缴纳、发票后补" />

        <div class="pay-actions">
          <el-button style="width:100px;" @click="reset">清空</el-button>
          <!-- 挂账是「没收到钱」，不进金额行：塞进去实收会虚高 -->
          <el-button style="width:100px;" :disabled="!sel.length" title="挂账不产生收款流水，本期未开放">挂账</el-button>
          <el-button type="primary" style="flex:1;" :disabled="!canPay" :loading="paying" @click="confirmPay">
            确认收款
          </el-button>
        </div>

        <div v-if="lastResult" class="pay-done">
          <div class="pay-done__h">
            <b>收款成功</b>
            <span class="muted">{{ lastResult.batchNo }}</span>
          </div>
          <div class="pay-done__b">
            ¥{{ money(lastResult.received) }} · {{ lastResult.count }} 笔账单
            <template v-if="lastResult.discount > 0">（含减免 ¥{{ money(lastResult.discount) }}）</template>
          </div>
          <div class="pay-done__s">{{ lastResult.methodText }}</div>

          <!-- 开具票据：就在收款结果里开完，不让人为了开一张收据再跳一次页面 -->
          <div class="tk">
            <div class="tk__hd">
              <span>开具票据</span>
              <span class="spacer" />
              <el-button link type="primary" size="small" @click="$router.push('/b/payments')">查看流水</el-button>
            </div>

            <template v-if="!ticket.done">
              <div class="tk__row">
                <el-checkbox v-model="ticket.receipt">收据</el-checkbox>
                <el-checkbox v-model="ticket.invoice">发票</el-checkbox>
                <span class="tk__hint">可只开其一，也可都开</span>
              </div>

              <div class="tk__row">
                <span class="tk__k">购买方</span>
                <el-select v-model="ticket.profileId" size="small" style="flex:1" :disabled="ticket.multiHouse">
                  <el-option value="__owner__" :label="ticket.multiHouse ? '多房合并 · 按各自房主开具' : '按房主开具（默认）'" />
                  <el-option
                    v-for="pf in ticket.profiles" :key="pf.profileId || pf.title"
                    :label="`${pf.title}${pf.roleLabel ? '（' + pf.roleLabel + '）' : ''}`"
                    :value="pf.profileId || '__adhoc__'"
                  />
                </el-select>
              </div>

              <div class="tk__row">
                <span class="tk__k">项目</span>
                <el-select v-model="ticket.itemName" size="small" filterable allow-create style="flex:1"
                  placeholder="按各笔流水的实际科目">
                  <el-option value="" label="按各笔流水的实际科目（推荐）" />
                  <el-option v-for="it in ticketItemOpts" :key="it.value"
                    :label="`${it.label}（税率 ${it.taxRate}%）`" :value="it.value" />
                </el-select>
              </div>

              <el-button
                type="primary" size="small" :loading="ticket.loading"
                style="width:100%;margin-top:6px" @click="doIssueTicket"
              >开具{{ ticketLabel }}</el-button>
            </template>

            <template v-else>
              <div class="tk__ok">
                <!-- 一次收 N 笔会出 N 张收据（+ N 张发票），全列出来会把右栏撑爆：
                     只列前 3 张，其余给汇总 -->
                <div v-for="t in ticket.created.slice(0, 3)" :key="t.invoiceId" class="tk__item">
                  <el-tag size="small" effect="plain" :type="t.isReceipt ? 'success' : 'primary'">
                    {{ t.isReceipt ? '收据' : '发票' }}
                  </el-tag>
                  <span class="mono">{{ t.invoiceNo }}</span>
                  <span class="tk__amt">¥ {{ money(t.amount) }}</span>
                </div>
                <div v-if="ticket.created.length > 3" class="tk__more">
                  共 {{ ticket.created.length }} 张（每笔流水一张，收据按房拆）
                </div>
              </div>
              <div class="tk__f">
                <el-button v-if="ticket.receiptDoc" link type="primary" size="small" @click="openPrint(ticket.receiptDoc)">
                  打印收据
                </el-button>
                <el-button link type="primary" size="small" @click="$router.push('/b/invoices')">票据台账</el-button>
              </div>
            </template>
          </div>
        </div>

        <div class="tip">
          <el-icon><InfoFilled /></el-icon>
          <span>一人多房合并收费：一次收款可跨多套房、多个科目，收据按房拆分打印。</span>
        </div>
      </div>
    </div>

    <!-- 临时收费：建单 + 收款一步做完，与账单收款完全独立 -->
    <TempChargeDialog v-model="tcOpen" @done="onTempPaid" />
    <!-- 收据打印：走「开票设置 → 票据模板」的参数，针打套打 -->
    <ReceiptPrint v-model="printVisible" :invoice="printDoc" />

    <TenantSupplementDrawer
      v-model="tsVisible" :tenant="tsTarget" @saved="onTenantSaved"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  PAY_METHODS, PAY_SPLIT_MAX, canEditTempCharges, cashierBuildingOpts, cashierOwnerList,
  cashierOwnerRoom, cashierUnitOpts, debtOf, invoiceItemNameOpts, invoiceProfilesOfHouse,
  isDebt, issueInvoice, ownerProfile, payBills, paySplitCheck, prepayBalanceOf, tenantsOfOwner
} from '@/utils/api'
import TempChargeDialog from '@/components/TempChargeDialog.vue'
import ReceiptPrint from '@/components/ReceiptPrint.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import TenantSupplementDrawer from '@/components/TenantSupplementDrawer.vue'
import SensitiveText from '@/components/SensitiveText.vue'
import { money } from '@/utils/format'

const kw = ref('')
const ownerId = ref('OW00001')
const houseFilter = ref('__all')
const sel = ref([])
const discount = ref(0)
const remark = ref('')
const paying = ref(false)
const tableRef = ref()
/* 收款后要重算「待收账单」：只改账单字段不会让 computed 的 filter 重跑 */
const payVer = ref(0)
const lastResult = ref(null)
/* 临时收费弹窗：不选账单单据，直接建单 + 收款 */
const tcOpen = ref(false)

/* ---------------- 收款后同页开票 ----------------
 * 收据与发票是**两个独立状态**（`receiptStatus` / `invoiceStatus`），不是"开没开票"一个开关：
 * 只开收据的笔数不少，合成一个状态会让台账查不出"还差一张发票"。
 */
const ticket = reactive({
  receipt: true, invoice: false,
  profileId: '__owner__', itemName: '',
  profiles: [], multiHouse: false,
  loading: false, done: false, created: [], receiptDoc: null
})
const ticketItemOpts = invoiceItemNameOpts()
const ticketLabel = computed(() => {
  const n = (ticket.receipt ? 1 : 0) + (ticket.invoice ? 1 : 0)
  if (n === 2) return '收据 + 发票'
  if (n === 1) return ticket.receipt ? '收据' : '发票'
  return '票据'
})

async function initTicket(res) {
  const houses = [...new Set((res.payments || []).map(p => p.houseId).filter(Boolean))]
  ticket.multiHouse = houses.length > 1
  ticket.profileId = '__owner__'
  ticket.itemName = ''
  ticket.created = []
  ticket.receiptDoc = null
  ticket.done = false
  ticket.receipt = true
  ticket.invoice = false
  ticket.profiles = []
  /* 多房合并没法共用一条抬头档案：收据按房拆，各自按房主开 */
  if (!ticket.multiHouse && houses.length === 1) {
    try { ticket.profiles = await invoiceProfilesOfHouse(houses[0]) } catch { ticket.profiles = [] }
  }
}

async function doIssueTicket() {
  if (!ticket.receipt && !ticket.invoice) {
    ElMessage.warning('至少勾一种票据；都不开就点「查看流水」，之后仍可在票据台账补开')
    return
  }
  ticket.loading = true
  try {
    const types = []
    if (ticket.receipt) types.push('收据')
    if (ticket.invoice) types.push('电子发票')
    const res = issueInvoice((lastResult.value?.payments || []).map(p => p.payId), types, {
      profileId: ticket.profileId === '__owner__' || ticket.profileId === '__adhoc__' ? '' : ticket.profileId,
      itemName: ticket.itemName
    })
    ticket.created = res.created
    ticket.receiptDoc = res.receipts[0] || null
    ticket.done = true
    ElMessage.success(`已开具 ${res.count} 张 ${types.join(' / ')}`)
  } catch (e) {
    ElMessage.error(e?.message || '开票失败')
  } finally {
    ticket.loading = false
  }
}

/* 收据打印预览 */
const printVisible = ref(false)
const printDoc = ref(null)
function openPrint(doc) {
  printDoc.value = doc
  printVisible.value = true
}
const canTemp = computed(() => canEditTempCharges())
function onTempPaid(res) {
  ElMessage.success(`临时收费已入账 ¥${money(res.charge.amount)}，可在「临时收费」台账查看`)
}

/** 金额行。默认一行、金额跟实收走 —— 绝大多数收款是单方式全额 */
const splitRows = ref([{ method: '微信支付', amount: 0 }])
/* 金额行的重建标记：el-input-number 内部有 currentValue 缓存，外部把 amount 改回 0
   时输入框不一定跟着清（截图里收款后还留着上一笔的 1981.01）。换 key 强制重建最稳 */
const splitKey = ref(0)

const p = computed(() => ownerProfile(ownerId.value))

/* 在住租户：租户代缴物业费时，前台可当场补充/修正其信息（保存即生效） */
const tenantVer = ref(0)
const ownerTenants = computed(() => { void tenantVer.value; return tenantsOfOwner(ownerId.value) })
const tsVisible = ref(false)
const tsTarget = ref(null)
function openTenantSupplement(t) {
  tsTarget.value = t
  tsVisible.value = true
}
function onTenantSaved() {
  tenantVer.value++
  ElMessage.success('租户信息已更新，收费对象不变（账单仍归业主）')
}
const houseName = id => p.value.houses.find(h => h.houseId === id)?.fullName || id
const roomOf = id => p.value.houses.find(h => h.houseId === id)?.room || ''
// 合并收费表格里省掉项目名，避免一列被撑爆
const shortHouse = id => (houseName(id) || '').replace(/^\S+\s+/, '')

// 左栏结果：有关键字搜业主，否则给 4 个演示对象 + 欠费最高的 5 位
// 左栏检索：演示对象 / 欠费 Top5 / 关键字 / 楼栋·单元，全部收归 api
const resultList = computed(() =>
  cashierOwnerList(kw.value, { buildingId: bldgId.value, unitId: unitId.value })
)

/* 楼栋 / 单元：只作用于左栏选人（A 方案），不新增栅格列，中栏账单宽度不变 */
const bldgId = ref('')
const unitId = ref('')
const bldgOpts = cashierBuildingOpts()
const unitOpts = computed(() => cashierUnitOpts(bldgId.value))
const scopeText = computed(() => {
  if (!bldgId.value) return ''
  const b = bldgOpts.find(x => x.value === bldgId.value)
  const u = unitOpts.value.find(x => x.value === unitId.value)
  return `${b?.label || '已选楼栋'}${u ? ' · ' + u.label : ''} · ${resultList.value.length} 位业主`
})
function clearLocals() { bldgId.value = ''; unitId.value = '' }
function roomOfScope(o) {
  if (!bldgId.value) return ''
  const full = cashierOwnerRoom(o.ownerId, { buildingId: bldgId.value, unitId: unitId.value })
  return full ? full.replace(/^\S+\s+/, '') : ''
}
watch(bldgId, () => { unitId.value = '' })
// 换范围后当前业主可能已不在结果里，自动落到第一位，避免中/右栏停在范围外的人
watch([bldgId, unitId], () => {
  const list = resultList.value
  if (list.length && !list.some(o => o.ownerId === ownerId.value)) ownerId.value = list[0].ownerId
})

const debtRows = computed(() => {
  void payVer.value
  return p.value.bills.filter(isDebt).map(b => ({ ...b, room: roomOf(b.houseId) }))
    .sort((a, b) => b.overdueDays - a.overdueDays)
})
const shownRows = computed(() =>
  houseFilter.value === '__all' ? debtRows.value : debtRows.value.filter(b => b.houseId === houseFilter.value)
)

const sum = computed(() => {
  const rows = sel.value
  return {
    payable: rows.reduce((s, b) => s + (b.payable || 0), 0),
    lateFee: rows.reduce((s, b) => s + (b.lateFee || 0), 0),
    unpaid: rows.reduce((s, b) => s + (b.unpaid || 0), 0)
  }
})
const payableTotal = computed(() => Math.max(0, sum.value.unpaid - (discount.value || 0)))

/* 校验口径与数据层同一份实现：页面提示与提交拦截不可能说两套话。
   一笔都没勾时不报错 —— 收款成功后 sel 被清空，若继续校验，右栏会立刻变红，
   看着像刚刚那笔出错了 */
const splitCheck = computed(() => {
  if (!sel.value.length) {
    return { ok: true, rows: [], sum: 0, total: 0, diff: 0, msg: '' }
  }
  return paySplitCheck(splitRows.value, payableTotal.value)
})
const isMethodUsed = m => splitRows.value.some(r => r.method === m)

/** 选中账单涉及房屋的预存余额合计（跨房时是各房账户之和） */
const prepayAvail = computed(() => {
  const hs = [...new Set(sel.value.map(b => b.houseId))]
  return hs.reduce((a, h) => a + prepayBalanceOf(h), 0)
})

const canPay = computed(() => sel.value.length > 0 && splitCheck.value.ok && !paying.value)

/* 单行时金额跟随实收；多行时不动用户已填的值 */
watch(payableTotal, v => {
  if (splitRows.value.length === 1) splitRows.value[0].amount = v
})
/* 只在换业主时清结果条。跟着 sel 一起清的话，收款后 sel 被清空，
   "收款成功"提示会瞬间消失（第一版就是这样，用户完全看不到结果） */
watch(() => ownerId.value, () => { lastResult.value = null })

function addSplit() {
  if (splitRows.value.length >= PAY_SPLIT_MAX) return
  const used = new Set(splitRows.value.map(r => r.method))
  const next = PAY_METHODS.find(m => !used.has(m)) || '现金'
  /* 从金额最大的一行分一半出来，让新行立刻有数 —— 加完马上报红
     「金额必须大于 0」，是最容易让人放弃组合支付的地方 */
  const host = splitRows.value.reduce((m, r) => (r.amount > m.amount ? r : m), splitRows.value[0])
  const half = Math.round((Number(host.amount) || 0) / 2 * 100) / 100
  host.amount = Math.round(((Number(host.amount) || 0) - half) * 100) / 100
  splitRows.value.push({ method: next, amount: half })
  if (next === '预存抵扣') onMethodChange(splitRows.value[splitRows.value.length - 1])
}
function removeSplit(i) {
  if (splitRows.value.length === 1) return
  splitRows.value.splice(i, 1)
}
/** 选到预存抵扣时自动填「余额与该行剩余额度里较小的那个」 */
function onMethodChange(row) {
  if (row.method !== '预存抵扣') return
  /* 车位费没有 houseId，挂不到房屋预存账户上；不给提示的话这里会出现
     "选了预存抵扣但金额填不进去"，看着像坏了 */
  if (prepayAvail.value <= 0) {
    ElMessage.warning('这些账单没有可用的预存账户（车位费不挂房屋，用不了房屋预存）')
    row.amount = 0
    return
  }
  const others = splitCheck.value.sum - (Number(row.amount) || 0)
  const rest = Math.max(0, payableTotal.value - others)
  row.amount = Math.min(prepayAvail.value, rest)
  /* 预存只抵一部分时，剩下的要由另一行补上 —— 不补的话合计对不上，
     用户还得自己算「总价减余额是多少」 */
  const restRows = splitRows.value.filter(r => r !== row)
  if (restRows.length === 1) {
    restRows[0].amount = Math.round((payableTotal.value - row.amount) * 100) / 100
  }
}
function onAmountChange() { /* el-input-number 双向绑定即生效，这里只留钩子便于以后加千分位 */ }

/* 收款成功 / 清空之后回到「一行、零金额」。
   这里不要读 payableTotal —— sel 刚被清空，computed 的求值时机不好把控，
   出现过金额停在上一笔的旧值上（截图里 1981.01 一直留着）；直接给 0 最稳 */
function resetSplits() {
  splitRows.value = [{ method: '微信支付', amount: 0 }]
  splitKey.value++
}

function quickDebt(id) {
  return debtOf(p.value.ownerId === id ? p.value.bills : ownerBills(id))
}
const billCache = new Map()
function ownerBills(id) {
  if (!billCache.has(id)) billCache.set(id, ownerProfile(id)?.bills || [])
  return billCache.get(id)
}

function pick(id) {
  ownerId.value = id
  houseFilter.value = '__all'
  discount.value = 0
  sel.value = []
  lastResult.value = null
  splitKey.value++
}

function onSel(rows) { sel.value = rows }

// 账单变化后默认全选（收银台默认“全收”）
watch(shownRows, async () => {
  await nextTick()
  tableRef.value?.clearSelection()
  tableRef.value?.toggleAllSelection()
}, { immediate: true })

watch(houseFilter, () => { discount.value = 0 })

function reset() {
  discount.value = 0
  remark.value = ''
  tableRef.value?.clearSelection()
  resetSplits()
}

async function confirmPay() {
  if (!canPay.value) return
  paying.value = true
  try {
    const res = payBills({
      billIds: sel.value.map(b => b.billId),
      splits: splitRows.value,
      discount: discount.value,
      remark: remark.value
    })
    lastResult.value = res
    await initTicket(res)
    payVer.value++
    ElMessage.success(`收款 ¥${money(res.received)} · ${res.count} 笔账单已销账`)
    sel.value = []
    discount.value = 0
    remark.value = ''
    resetSplits()
  } catch (e) {
    ElMessage.error(e?.message || '收款失败')
  } finally {
    paying.value = false
  }
}
</script>

<style scoped>
.search-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.search-row .spacer { flex: 1; }
.quick { display: flex; align-items: center; gap: 3px; }

.cashier {
  display: grid; grid-template-columns: 284px minmax(0, 1fr) 320px;
  gap: 16px; margin-top: 16px; align-items: start;
}
.side { padding: 16px; }
.side-r { padding: 16px; position: sticky; top: 0; }

.olist { max-height: 520px; overflow-y: auto; margin: 0 -6px; padding: 0 6px; }
/* 楼栋 / 单元：左栏内联，不占中栏宽度 */
.locals { margin: 2px 0 8px; }
.locals__hint {
  display: flex; align-items: center; gap: 6px; margin-top: 6px;
  font-size: 11.5px; color: var(--biz-text-3);
}
.locals__hint .ellip { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oitem {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px;
  border-radius: 8px; cursor: pointer; transition: background .15s;
}
.oitem:hover { background: var(--biz-bg-hover); }
.oitem.is-on { background: rgba(91,108,255,.08); box-shadow: inset 0 0 0 1px rgba(91,108,255,.28); }
.oitem__ava {
  width: 32px; height: 32px; flex: 0 0 32px; border-radius: 50%;
  background: var(--biz-gradient); color: #fff; display: grid; place-items: center;
  font-size: 13px; font-weight: 600;
}
.oitem__b { flex: 1; min-width: 0; }
.oitem__n { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
.oitem__t { font-size: 10.5px; color: var(--biz-text-3); background: var(--biz-bg-fill); border-radius: 999px; padding: 0 6px; }
.oitem__d { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.oitem__r { text-align: right; flex: 0 0 auto; }
.oitem__m { font-family: var(--biz-font-num); font-size: 13px; font-weight: 600; color: var(--biz-danger); white-space: nowrap; }
.oitem__s { font-size: 10.5px; color: var(--biz-text-3); }

.hcell { display: flex; align-items: center; gap: 6px; min-width: 0; }
.late { font-size: 10.5px; color: var(--biz-text-3); font-weight: 400; }

.sumline {
  display: flex; align-items: center; gap: 8px;
  padding-top: 12px; font-size: 12.5px; color: var(--biz-text-2);
}
.sumline .spacer { flex: 1; }
.sumline .dot { color: var(--biz-text-4); }

.pay-box { background: var(--biz-bg-fill); border-radius: 10px; padding: 14px; }
.pay-line { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--biz-text-2); padding: 6px 0; }
.pay-total {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-top: 8px; padding-top: 12px; border-top: 1px dashed var(--biz-border);
  font-size: 13px; color: var(--biz-text-1);
}
.pay-total b { font-size: 22px; color: var(--el-color-primary); font-family: var(--biz-font-num); }

.splits { display: flex; flex-direction: column; gap: 8px; }
.split-row { display: flex; align-items: center; gap: 8px; }
.split-foot { display: flex; align-items: center; gap: 8px; }
.split-foot .spacer { flex: 1; }
.split-check {
  display: flex; flex-direction: column; gap: 2px;
  margin-top: 10px; padding: 8px 10px; border-radius: 8px;
  font-size: 12px; background: var(--biz-bg-fill);
}
.split-check.is-ok { color: var(--biz-success, #2f9e6e); }
.split-check.is-warn { color: var(--biz-danger, #d64545); }
.split-check .money { font-family: var(--biz-font-num); }
.split-check__m { font-size: 11.5px; opacity: .9; }

.pay-done {
  margin-top: 12px; padding: 10px 12px; border-radius: 8px;
  background: rgba(47,158,110,.08); border: 1px solid rgba(47,158,110,.25);
}
.pay-done__h { display: flex; align-items: baseline; gap: 8px; font-size: 13px; color: var(--biz-success, #2f9e6e); }
.pay-done__h .muted { font-size: 11px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.pay-done__b { font-size: 12.5px; color: var(--biz-text-1); margin-top: 4px; }
.pay-done__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }
.pay-done__f { margin-top: 6px; }

/* 收款结果里的开票区 */
.tk { margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(47,158,110,.3); }
.tk__hd { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--biz-text-1); font-weight: 600; }
.tk__hd .spacer { flex: 1; }
.tk__row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.tk__k { font-size: 12px; color: var(--biz-text-3); width: 44px; flex: 0 0 44px; }
.tk__hint { font-size: 11px; color: var(--biz-text-3); }
.tk__ok { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.tk__item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.tk__amt { margin-left: auto; font-family: var(--biz-font-num); color: var(--biz-text-2); }
.tk__f { margin-top: 4px; }
.tk__more { font-size: 11.5px; color: var(--biz-text-3); }

.pay-actions { display: flex; gap: 8px; margin-top: 18px; }
.tip {
  display: flex; gap: 8px; margin-top: 14px; padding: 10px;
  background: rgba(91,108,255,.06); border-radius: 8px;
  font-size: 11.5px; color: #5a6488; line-height: 1.6;
}
.is-danger { color: var(--biz-danger); }

.tenant-card {
  margin-top: 14px; padding: 12px 12px 10px; border-radius: 10px;
  border: 1px solid var(--biz-border-light); background: var(--biz-bg-fill);
}
.tenant-card__hd { display: flex; align-items: baseline; gap: 8px; }
.tenant-card__hd h4 { margin: 0; font-size: 13px; color: var(--biz-text-1); }
.tenant-card__hd .desc { font-size: 11px; color: var(--biz-text-3); }
.tenant-card__empty { font-size: 11.5px; color: var(--biz-text-3); margin-top: 8px; line-height: 1.6; }
.tenant-card__more { font-size: 11px; color: var(--biz-text-3); margin-top: 4px; }
.tenant-card__tip { font-size: 10.5px; color: var(--biz-text-3); margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--biz-border); }
.tline { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.tline__b { flex: 1; min-width: 0; }
.tline__n { font-size: 12.5px; color: var(--biz-text-1); display: flex; gap: 6px; align-items: baseline; }
.tline__r { font-size: 11px; color: var(--biz-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tline__m { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; }
.tline__m .is-warn { color: var(--biz-danger); }
</style>
