<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>抄表与公摊 · A 级交互</b>：①「抄表录入」按账期逐表抄录，改读数自动算用量，波动超阈值标异常；
        ②「抄表推单」把复核过的读数按业态单价出成水电账单（插卡代充 / 国网自缴的项目不出账）；
        ③「公摊计算」把公共用水、公共用电分别归集后按建筑面积摊到户，可预览并一键生成账单。
        写操作均为<b>内存态</b>；公摊系数（分户合计 8%）为演示固定值，正式实现应取总表与分表的实际差额；
        读数录入受表具量程约束（水表 99999 吨 / 电表 999999 度），超量程拒绝保存。
        <b>复核只是承认读数，出账才产生应收</b> —— 所以推单前必须没有未抄/待复核的表。
      </div>
    </div>

    <!-- 抄表录入的汇总卡：推单页有自己的一套指标，两套并排会打架（一个说 3176 吨，一个说 105 吨） -->
    <div v-if="tab !== 'bill'" class="grid" style="margin-top:16px;grid-template-columns:repeat(5,minmax(0,1fr));">
      <div class="panel rsum" data-card="m-period"><div class="rsum__l">账期</div><div class="rsum__v" style="font-size:17px;">{{ sum.period }}</div></div>
      <div class="panel rsum" data-card="m-meters"><div class="rsum__l">表具 / 抄表数</div><div class="rsum__v">{{ sum.meterCount }}<span class="unit">/ {{ sum.readingCount }}</span></div></div>
      <div class="panel rsum" data-card="m-pending"><div class="rsum__l">待录入 / 待复核</div><div class="rsum__v">{{ sum.pending }}<span class="unit">/ {{ sum.review }}</span></div></div>
      <div class="panel rsum" data-card="m-usage"><div class="rsum__l">用水 / 用电</div><div class="rsum__v" style="font-size:15px;">{{ sum.waterUsage }} 吨 / {{ sum.elecUsage }} 度</div></div>
      <div class="panel rsum" data-card="m-abnormal"><div class="rsum__l">异常读数</div><div class="rsum__v money--out">{{ sum.abnormal }}</div></div>
    </div>

    <el-tabs v-model="tab" style="margin-top:16px;" @tab-change="onTab">
      <el-tab-pane label="抄表录入" name="read">
        <div class="panel" style="margin-top:12px;">
          <el-form :model="query" class="filter-bar" label-width="60px" @submit.prevent>
            <el-form-item label="账期">
              <el-select v-model="query.period" style="width:110px" @change="onPeriod">
                <el-option v-for="p in METER_PERIODS()" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
            <el-form-item label="项目">
              <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px">
                <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="query.type" placeholder="全部" clearable style="width:90px">
                <el-option v-for="t in ['水表', '电表']" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width:100px">
                <el-option v-for="s in READING_STATUS" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item label="异常">
              <el-select v-model="query.abnormal" placeholder="全部" clearable style="width:90px">
                <el-option label="仅异常" value="yes" /><el-option label="仅正常" value="no" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="房号 / 表号" clearable style="width:140px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Select'" :disabled="!picked.length" @click="doApprove">
              复核通过{{ picked.length ? `（${picked.length}）` : '' }}
            </el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 条 · 已选 {{ picked.length }} 条</span>
          </div>
          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 420px)" @selection-change="onSel">
            <el-table-column type="selection" width="46" />
            <el-table-column prop="houseName" label="房屋" min-width="170" show-overflow-tooltip />
            <el-table-column prop="meterNo" label="表号" width="90" />
            <el-table-column prop="type" label="类型" width="70" />
            <el-table-column prop="lastReading" label="上期读数" width="100" align="right" />
            <el-table-column label="本期读数" width="130" align="right">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.currentReading" :min="row.lastReading" :max="METER_CAP[row.type] || 99999"
                  :precision="2" :controls="false"
                  size="small" style="width:100px" @change="v => doSave(row, v)"
                />
              </template>
            </el-table-column>
            <el-table-column label="用量" width="100" align="right">
              <template #default="{ row }">
                <span :class="row.abnormal ? 'money--out' : ''">{{ row.usage }} {{ row.unit }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }"><StatusTag domain="reading" :value="row.status" /></template>
            </el-table-column>
            <el-table-column prop="readDate" label="抄表日" width="110" />
            <el-table-column prop="reader" label="抄表人" width="100" />
            <el-table-column label="异常" width="80" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.abnormal" size="small" type="danger" effect="plain">波动</el-tag>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination
              background layout="total, sizes, prev, pager, next"
              :total="total" :current-page="pageNo" :page-size="size" :page-sizes="PAGE_SIZES"
              @current-change="p => { pageNo.value = p; load() }" @size-change="s => { size.value = s; load() }"
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="抄表推单" name="bill">
        <div class="panel" style="margin-top:12px;">
          <el-form :model="billQuery" class="filter-bar" data-area="bill" label-width="60px" @submit.prevent>
            <el-form-item label="账期">
              <el-select v-model="billQuery.period" style="width:110px" @change="doPreview">
                <el-option v-for="p in periods" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
            <el-form-item label="项目">
              <el-select v-model="billQuery.communityId" placeholder="全部项目" clearable style="width:130px" @change="doPreview">
                <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="视图">
              <el-switch v-model="onlyBillable" size="small" active-text="只看要处理的" @change="doPreview" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button type="primary" :icon="'DocumentAdd'" :disabled="!canBill" @click="doBill">
                生成水电账单{{ pv.billableCount ? `（${pv.billableCount}）` : '' }}
              </el-button>
              <el-button :icon="'Refresh'" @click="doPreview">重新预览</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="panel rsum" data-card="b-count">
            <div class="rsum__l">可出账 / 全量</div>
            <div class="rsum__v">{{ pv.billableCount }}<span class="unit">/ {{ pv.total }} 条</span></div>
          </div>
          <div class="panel rsum" data-card="b-amount">
            <div class="rsum__l">应出账金额</div>
            <div class="rsum__v">¥ {{ money(pv.amount) }}</div>
          </div>
          <div class="panel rsum" data-card="b-split">
            <div class="rsum__l">水 / 电</div>
            <div class="rsum__v" style="font-size:15px;">
              {{ pv.waterUsage }} 吨<span class="unit">/ {{ pv.elecUsage }} 度</span>
            </div>
          </div>
          <div class="panel rsum" data-card="b-block">
            <div class="rsum__l">阻断项 / 已推单</div>
            <div class="rsum__v" :class="pv.blockingCount ? 'money--out' : ''">
              {{ pv.blockingCount }}<span class="unit">/ {{ pv.billedCount }}</span>
            </div>
          </div>
        </div>

        <div v-if="pv.blockingCount" class="blockbar">
          <b>还有 {{ pv.blockingCount }} 条读数不能出账，整批已拦住</b>
          <span>{{ pv.blockingTop.join('；') }}{{ pv.blockingCount > 3 ? ' 等' : '' }}</span>
          <span class="blockbar__hint">
            只出一半的话，另一半户这个月就没有应收，收缴率的分母凭空少一截，而且没人会发现少了谁。
            请先补抄 / 复核缺的表。
          </span>
        </div>

        <div class="panel" data-area="bill-table" style="margin-top:16px;">
          <div class="toolbar">
            <span class="muted" style="font-size:12.5px;">
              单价按<b>业态价目表</b>取（住宅电 0.568、零售铺 0.80、餐饮铺 0.90、办公 1.00、商业水 5.55），
              不是收费科目上的 4.2 / 0.62 —— 拿参考价给商业户出账，每户每月都少收。
              插卡代充与国网自缴的项目不出账：<b>{{ pv.byMode.card }}</b> 条代充、<b>{{ pv.byMode.none }}</b> 条自缴。
            </span>
            <span class="spacer" />
            <span class="muted" style="font-size:12.5px;">预览 {{ billRows.length }} 行 · 单次最多推 500 户</span>
          </div>
          <el-table :data="billRows.slice(0, 200)" style="width:100%" max-height="calc(100vh - 470px)">
            <el-table-column prop="houseName" label="房屋" min-width="180" show-overflow-tooltip />
            <el-table-column prop="meterNo" label="表号" width="90" />
            <el-table-column prop="type" label="类型" width="70" />
            <el-table-column label="本期用量" width="100" align="right">
              <template #default="{ row }">{{ row.usage }} {{ row.unit }}</template>
            </el-table-column>
            <el-table-column label="单价" width="110" align="right">
              <template #default="{ row }">
                <span v-if="row.price">{{ row.price }} 元/{{ row.unit }}</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="应出金额" width="110" align="right">
              <template #default="{ row }">
                <span class="money" :class="{ 'money--out': row.amount > 0 }">¥ {{ money(row.amount) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="项目模式" width="130">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="row.mode === 'meter' ? 'primary' : 'info'">
                  {{ row.mode === 'meter' ? '抄表出账' : (row.mode === 'card' ? '物业代充' : '业主自缴') }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="150">
              <template #default="{ row }">
                <el-tag v-if="row.billable" size="small" type="success" effect="plain">可出账</el-tag>
                <el-tag v-else-if="row.blocking.length" size="small" type="danger" effect="plain">{{ row.blocking[0] }}</el-tag>
                <el-tag v-else-if="row.billId" size="small" effect="plain">已推单</el-tag>
                <span v-else class="muted">{{ row.info[0] || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="billId" label="账单号" width="120">
              <template #default="{ row }"><span class="muted">{{ row.billId || '—' }}</span></template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="公摊计算" name="share">
        <div class="panel" style="margin-top:12px;">
          <el-form class="filter-bar" label-width="60px" @submit.prevent>
            <el-form-item label="账期">
              <el-select v-model="sharePeriod" style="width:110px">
                <el-option v-for="p in METER_PERIODS()" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
            <el-form-item label="项目">
              <el-select v-model="shareCommunity" placeholder="全部项目" clearable style="width:130px">
                <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Refresh'" @click="doCalc">重新计算</el-button>
              <el-button type="primary" :icon="'DocumentAdd'" @click="doGenerate">生成公摊账单</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="panel rsum" data-card="s-usage"><div class="rsum__l">分户用量（水 / 电）</div><div class="rsum__v" style="font-size:15px;">{{ calc.waterUsage }} 吨<span class="unit">/ {{ calc.elecUsage }} 度</span></div></div>
          <div class="panel rsum" data-card="s-public"><div class="rsum__l">公共用量（8%）</div><div class="rsum__v money--out" style="font-size:15px;">{{ calc.pubWater }} 吨<span class="unit">/ {{ calc.pubElec }} 度</span></div></div>
          <div class="panel rsum" data-card="s-amount"><div class="rsum__l">分摊总额</div><div class="rsum__v">¥ {{ money(calc.publicAmount) }}</div></div>
          <div class="panel rsum" data-card="s-houses"><div class="rsum__l">参与分摊</div><div class="rsum__v">{{ calc.houseCount }}<span class="unit">户</span></div></div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <span class="muted" style="font-size:12.5px;">
              分摊规则：水 ¥{{ calc.priceWater }}/吨 + 电 ¥{{ calc.priceElec }}/度 分别归集后合并摊到户 · 按建筑面积占比 ·
              水费 ¥{{ money(calc.amtWater) }} + 电费 ¥{{ money(calc.amtElec) }} ·
              共 {{ calc.houseCount }} 户，下表预览前 50 户，导出为全量
            </span>
            <span class="spacer" />
            <el-button :icon="'Download'" :disabled="!calc.rows.length" @click="onExportShare">导出分摊明细</el-button>
          </div>
          <el-table :data="calc.rows.slice(0, 50)" style="width:100%" max-height="calc(100vh - 420px)">
            <el-table-column prop="houseName" label="房屋" min-width="180" show-overflow-tooltip />
            <el-table-column prop="communityName" label="项目" width="110" />
            <el-table-column label="建筑面积" width="110" align="right">
              <template #default="{ row }">{{ money(row.area) }} ㎡</template>
            </el-table-column>
            <el-table-column label="分摊比例" width="100" align="right">
              <template #default="{ row }">{{ row.shareRate }}%</template>
            </el-table-column>
            <el-table-column label="分摊用量（水 / 电）" width="150" align="right">
              <template #default="{ row }">{{ row.shareWater }} 吨<span class="muted"> / {{ row.shareElec }} 度</span></template>
            </el-table-column>
            <el-table-column label="分摊金额" width="120" align="right">
              <template #default="{ row }"><span class="money">¥ {{ money(row.shareAmount) }}</span></template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import { useListQuery } from '@/composables/useQuery'
import { exportList } from '@/utils/export'
import { money } from '@/utils/format'
import {
  METER_CAP, METER_PERIODS, PAGE_SIZES, READING_STATUS, approveReadings, communityOpts,
  computeShare, generateMeterBills, generateShareBills, meterBillPreview, meterSummary,
  queryMeterReadings, saveReading
} from '@/utils/api'

const tab = ref('read')
const periods = METER_PERIODS()
const sum = ref(meterSummary(periods[0]))

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(queryMeterReadings, {
  filters: { communityId: '', period: periods[0], type: '', status: '', abnormal: '', kw: '' }, size: 20
})
function onPeriod() { sum.value = meterSummary(query.period); search() }

const picked = ref([])
function onSel(list) { picked.value = list }
async function doSave(row, v) {
  try {
    const r = saveReading(row.readingId, v)
    Object.assign(row, r)
    ElMessage.success(`用量 ${r.usage} ${r.unit}${r.abnormal ? '（波动异常，请复核）' : ''}`)
    sum.value = meterSummary(query.period)
    load()   // 写后立即回查，保证列表里显示的用量/状态与保存结果一致
    // 抄表数据变了，公摊结果同步刷新，避免「卡片与生成账单」两处口径不一致
    if (tab.value === 'share') doCalc(false)
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
    load()   // 重新拉取，把输入框还原为已保存的读数
  }
}
async function doApprove() {
  try {
    const n = approveReadings(picked.value.map(r => r.readingId))
    ElMessage.success(`已复核 ${n} 条，状态置为「已计费」`)
    picked.value = []
    sum.value = meterSummary(query.period)
    load()
  } catch (e) { ElMessage.error(e?.message || '复核失败') }
}

// —— 抄表推单 ——
/* 推单是"抄表"与"收钱"之间的那一步：复核通过只是承认读数，出账才产生应收 */
const billQuery = ref({ period: periods[0], communityId: '' })
const onlyBillable = ref(true)
const pv = ref(meterBillPreview({ period: periods[0] }))
const canBill = computed(() => pv.value.billableCount > 0)
/** 默认只显示"要处理的"：三种模式混在一起时，代充/自缴会占掉 2/3 的行 */
const billRows = computed(() => {
  const rs = pv.value.rows
  if (!onlyBillable.value) return rs
  return rs.filter(r => r.billable || r.blocking.length || r.billId)
})
function doPreview() { pv.value = meterBillPreview({ ...billQuery.value }) }

/**
 * 推单。
 * 抄表是分批的（先抄完的楼栋先出账），所以阻断时不硬拦，而是把"会跳过 N 户"说清楚再确认 ——
 * 默默少出一半才是最坏的结果：业主这个月没账单，收缴率也看不出少了谁。
 */
async function doBill() {
  const p = pv.value
  if (!p.billableCount) { ElMessage.warning('没有可出账的读数'); return }
  if (p.blockingCount) {
    try {
      await ElMessageBox.confirm(
        `还有 ${p.blockingCount} 条读数未抄或待复核，本次只出已抄完的 ${p.billableCount} 户（¥${money(p.amount)}）。` +
        `被跳过的户这个月不会有账单，补抄后可再推一次（已推的不会重复）。`,
        '仅推已抄完的', { type: 'warning', confirmButtonText: '仍然推单', cancelButtonText: '先去补抄' }
      )
    } catch { return }
  }
  try {
    const r = generateMeterBills({ ...billQuery.value, allowPartial: p.blockingCount > 0 })
    ElMessage.success(
      `已生成 ${r.count} 张水电账单（水 ${r.waterCount} / 电 ${r.elecCount}），合计 ¥${money(r.amount)}` +
      (r.skipped ? `；跳过 ${r.skipped} 户未抄/待复核` : '') + '。业主端「待缴账单」立即可见'
    )
    doPreview()
    load()
    sum.value = meterSummary(query.period)
  } catch (e) { ElMessage.error(e?.message || '生成失败') }
}

// —— 公摊 ——
const sharePeriod = ref(periods[0])
const shareCommunity = ref('')
const calc = ref(computeShare({ period: periods[0] }))
function doCalc(notify = true) {
  calc.value = computeShare({ communityId: shareCommunity.value, period: sharePeriod.value })
  if (notify) ElMessage.success('已按最新抄表数据重新计算')
}
/** 切到「公摊计算」/「抄表推单」时自动重算，避免沿用进入页面时的旧结果 */
function onTab(name) {
  if (name === 'share') doCalc(false)
  if (name === 'bill') doPreview()
}
async function doGenerate() {
  try {
    doCalc(false)   // 先对齐卡片，保证「看到的」与「生成的」同一口径
    const res = generateShareBills({ communityId: shareCommunity.value, period: sharePeriod.value })
    ElMessage.success(`已生成 ${res.count} 张公摊账单，合计 ¥${money(res.amount)}（科目：公共能耗分摊）`)
  } catch (e) { ElMessage.error(e?.message || '生成失败') }
}

const READ_COLS = [
  { prop: 'houseName', label: '房屋' }, { prop: 'meterNo', label: '表号' },
  { prop: 'type', label: '类型' }, { prop: 'lastReading', label: '上期读数' },
  { prop: 'currentReading', label: '本期读数' }, { prop: 'usage', label: '用量' },
  { prop: 'status', label: '状态' }, { prop: 'readDate', label: '抄表日' }
]
const SHARE_COLS = [
  { prop: 'houseName', label: '房屋' }, { prop: 'communityName', label: '项目' },
  { prop: 'area', label: '建筑面积' }, { prop: 'shareRate', label: '分摊比例(%)' },
  { prop: 'shareWater', label: '分摊水量(吨)' }, { prop: 'shareElec', label: '分摊电量(度)' },
  { prop: 'shareAmount', label: '分摊金额(元)' }
]
function onExport() {
  exportList({ name: '抄表记录', source: '/b/meters', columns: READ_COLS, rows: rows.value, filters: { ...query } })
}
function onExportShare() {
  exportList({
    name: '公摊分摊明细', source: '/b/meters', columns: SHARE_COLS,
    rows: calc.value.rows, filters: { period: sharePeriod.value, communityId: shareCommunity.value }
  })
}
</script>

<style scoped>
.blockbar {
  margin-top: 14px; padding: 12px 16px; border-radius: 10px;
  background: #fff5f5; border: 1px solid #f5c2c2; color: #a33;
  display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; line-height: 1.6;
}
.blockbar b { font-size: 13px; }
.blockbar span { color: #b45; }
.blockbar__hint { color: #9a6a1f !important; font-size: 12px; }
</style>
