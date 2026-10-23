<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>PC 收银台</b>：前台按「业主」检索，一次带出名下全部房产与账单，勾选后合并收款。
        左侧选人（一人多房）、中间选账单（可按房筛选）、右侧结算；支持现金/扫码/POS/预存抵扣，收款后即时销账。
      </div>
    </div>

    <!-- 检索 -->
    <div class="panel" style="margin-top:16px;">
      <div class="search-row">
        <el-input
          v-model="kw" clearable
          placeholder="输入业主姓名 / 房号 / 手机号 / 身份证后四位"
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
              <div class="oitem__d">{{ maskPhone(o.phone) }} · {{ roomOfScope(o) || (o.houseIds.length + ' 套房') }}</div>
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

        <div class="sec__hd" style="margin:18px 0 10px;"><h4>收款方式</h4></div>
        <el-radio-group v-model="method" class="methods">
          <el-radio-button label="扫码">扫码</el-radio-button>
          <el-radio-button label="现金">现金</el-radio-button>
          <el-radio-button label="POS">POS</el-radio-button>
          <el-radio-button label="预存抵扣">预存抵扣</el-radio-button>
          <el-radio-button label="转账">转账</el-radio-button>
        </el-radio-group>

        <div class="sec__hd" style="margin:18px 0 10px;"><h4>备注</h4></div>
        <el-input v-model="remark" type="textarea" :rows="2" placeholder="选填，如：业主现场缴纳、发票后补" />

        <div class="pay-actions">
          <el-button style="width:100px;" @click="reset">清空</el-button>
          <el-button style="width:100px;" :disabled="!sel.length">挂账</el-button>
          <el-button type="primary" style="flex:1;" :disabled="!sel.length" :loading="paying" @click="confirmPay">
            确认收款
          </el-button>
        </div>

        <div class="tip">
          <el-icon><InfoFilled /></el-icon>
          <span>一人多房合并收费：一次收款可跨多套房、多个科目，收据按房拆分打印。</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { cashierBuildingOpts, cashierOwnerList, cashierOwnerRoom, cashierUnitOpts, debtOf, isDebt, ownerProfile } from '@/utils/api'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { maskPhone, money } from '@/utils/format'

const kw = ref('')
const ownerId = ref('OW00001')
const houseFilter = ref('__all')
const sel = ref([])
const discount = ref(0)
const method = ref('扫码')
const remark = ref('')
const paying = ref(false)
const tableRef = ref()

const p = computed(() => ownerProfile(ownerId.value))
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

const debtRows = computed(() =>
  p.value.bills.filter(isDebt).map(b => ({ ...b, room: roomOf(b.houseId) }))
    .sort((a, b) => b.overdueDays - a.overdueDays)
)
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
}

function confirmPay() {
  if (!sel.value.length) return
  paying.value = true
  setTimeout(() => {
    // 原型内本地销账：改内存数据，刷新后恢复
    const now = '2026-10-21'
    for (const row of sel.value) {
      row.status = '已缴'
      row.paidAmount = row.payable
      row.unpaid = 0
      row.payTime = now
      row.payMethod = method.value
      row.overdueDays = 0
    }
    paying.value = false
    ElMessage.success(`收款成功 ¥${money(payableTotal.value)} · ${sel.value.length} 笔账单已销账`)
    sel.value = []
    discount.value = 0
    remark.value = ''
  }, 700)
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

.methods { display: flex; flex-wrap: wrap; gap: 6px; }
.methods :deep(.el-radio-button__inner) { border-radius: 6px !important; border-left: 1px solid var(--biz-border) !important; }

.pay-actions { display: flex; gap: 8px; margin-top: 18px; }
.tip {
  display: flex; gap: 8px; margin-top: 14px; padding: 10px;
  background: rgba(91,108,255,.06); border-radius: 8px;
  font-size: 11.5px; color: #5a6488; line-height: 1.6;
}
.is-danger { color: var(--biz-danger); }
</style>
