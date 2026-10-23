<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>欠费催缴工作台 · A 级交互</b>：按<b>房屋</b>聚合欠费（不按账单逐条催），勾选 → 选催缴方式 → 生成催缴单 → 记录催缴历史。
        ①账龄卡片即筛选条件；②催缴记录可在「催缴历史」页签按批次追溯；③单据可打印、可导出（导出走下载中心）。
        口径与报表「未收费房屋」同源：<code>isDebt(b) &amp;&amp; unpaid &gt; 0</code>。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel rsum">
        <div class="rsum__l">欠费房屋</div><div class="rsum__v">{{ sum.houseCount }}<span class="unit">户</span></div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">欠费金额</div><div class="rsum__v money--out">¥ {{ money(sum.amount) }}</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">已催缴覆盖</div>
        <div class="rsum__v">{{ sum.covered }}<span class="unit">/ {{ sum.houseCount }} 户</span></div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">催缴记录</div><div class="rsum__v">{{ sum.recordCount }}<span class="unit">条</span></div>
      </div>
    </div>

    <!-- 账龄分布 -->
    <div class="panel" style="margin-top:16px;">
      <div class="toolbar" style="margin-bottom:0;gap:10px;">
        <span class="muted" style="font-size:12.5px;">账龄分布（点击筛选）：</span>
        <el-button
          v-for="(b, i) in sum.buckets" :key="b.label" size="small"
          :type="minDays === [0, 31, 91, 181][i] ? 'primary' : 'default'"
          @click="pickBucket(i)"
        >{{ b.label }} · {{ b.n }} 户 · ¥{{ wan(b.amt) }}</el-button>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="reload" />
      </div>
    </div>

    <el-tabs v-model="tab" style="margin-top:12px;">
      <!-- 欠费池 -->
      <el-tab-pane label="欠费池" name="pool">
        <div class="panel" style="margin-top:12px;">
          <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
            <el-form-item label="项目">
              <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px">
                <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="账期">
              <el-select v-model="query.period" placeholder="全部" clearable style="width:110px">
                <el-option v-for="p in billPeriodOpts()" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
            <el-form-item label="逾期≥">
              <el-select v-model="query.minDays" placeholder="不限" clearable style="width:100px">
                <el-option v-for="d in [30, 60, 90, 180]" :key="d" :label="d + ' 天'" :value="d" />
              </el-select>
            </el-form-item>
            <el-form-item label="金额≥">
              <el-select v-model="query.minAmount" placeholder="不限" clearable style="width:100px">
                <el-option v-for="a in [500, 1000, 3000, 5000]" :key="a" :label="a + ' 元'" :value="a" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="房号 / 业主 / 手机号" clearable style="width:150px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button type="primary" :icon="'Promotion'" :disabled="!picked.length" @click="collectVisible = true">
              生成催缴单{{ picked.length ? `（${picked.length} 户）` : '' }}
            </el-button>
            <el-button :icon="'Printer'" :disabled="!picked.length" @click="printVisible = true">打印催缴单</el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <span class="muted" style="font-size:12.5px;">
              共 {{ total }} 户 · 已选 {{ picked.length }} 户 / ¥{{ money(pickedAmount) }}
            </span>
          </div>
          <el-table
            v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 430px)"
            @selection-change="onSel"
          >
            <el-table-column type="selection" width="46" />
            <el-table-column prop="houseName" label="房屋" min-width="180" show-overflow-tooltip />
            <el-table-column prop="ownerName" label="业主" width="100" />
            <el-table-column label="手机号" width="130">
              <template #default="{ row }">{{ maskPhone(row.phone) }}</template>
            </el-table-column>
            <el-table-column prop="communityName" label="项目" width="110" />
            <el-table-column label="欠费笔数" width="90" align="right" prop="count" />
            <el-table-column label="欠费金额" width="120" align="right">
              <template #default="{ row }"><span class="money money--out">¥ {{ money(row.sum) }}</span></template>
            </el-table-column>
            <el-table-column label="最长逾期" width="110" align="right">
              <template #default="{ row }">
                <span :class="row.maxDays > 180 ? 'money--out' : ''">{{ row.maxDays }} 天</span>
              </template>
            </el-table-column>
            <el-table-column label="账期" min-width="150">
              <template #default="{ row }">
                <span class="muted">{{ row.periods.slice().sort().reverse().join('、') }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="$router.push(`/b/bills?focus=house:${row.houseId}&open=1`)">账单</el-button>
                <el-button link type="primary" @click="openHistory(row)">催缴记录</el-button>
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

      <!-- 催缴历史 -->
      <el-tab-pane label="催缴历史" name="history">
        <div class="panel" style="margin-top:12px;">
          <el-form :model="hq" class="filter-bar" label-width="72px" @submit.prevent>
            <el-form-item label="催缴方式">
              <el-select v-model="hq.method" placeholder="全部" clearable style="width:110px">
                <el-option v-for="m in COLLECT_METHODS" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
            <el-form-item label="结果">
              <el-select v-model="hq.status" placeholder="全部" clearable style="width:120px">
                <el-option v-for="s in COLLECT_STATUS" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item label="批次">
              <el-input v-model="hq.batchNo" placeholder="如 CJ202604" clearable style="width:130px" />
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="hq.kw" placeholder="房号 / 业主" clearable style="width:150px" @keyup.enter="searchH" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="searchH">查询</el-button>
            </el-form-item>
          </el-form>
        </div>
        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <span class="muted" style="font-size:12.5px;">共 {{ hTotal }} 条催缴记录</span>
            <span class="spacer" />
            <el-button :icon="'Download'" :disabled="!hRows.length" @click="onExportH">导出</el-button>
          </div>
          <el-table v-loading="hLoading" :data="hRows" style="width:100%" max-height="calc(100vh - 380px)">
            <el-table-column prop="recordId" label="记录号" width="100" />
            <el-table-column prop="batchNo" label="批次" width="110" />
            <el-table-column prop="houseName" label="房屋" min-width="170" show-overflow-tooltip />
            <el-table-column prop="ownerName" label="业主" width="90" />
            <el-table-column label="催缴金额" width="110" align="right">
              <template #default="{ row }"><span class="money">¥ {{ money(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column prop="overdueDays" label="逾期" width="80" align="right" />
            <el-table-column prop="method" label="方式" width="90" />
            <el-table-column label="结果" width="110">
              <template #default="{ row }"><StatusTag domain="collection" :value="row.status" /></template>
            </el-table-column>
            <el-table-column prop="operator" label="催缴人" width="100" />
            <el-table-column prop="collectTime" label="催缴时间" width="140" />
            <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
          </el-table>
          <div class="pager">
            <el-pagination
              background layout="total, sizes, prev, pager, next"
              :total="hTotal" :current-page="hPageNo" :page-size="hSize" :page-sizes="PAGE_SIZES"
              @current-change="p => { hPageNo.value = p; loadH() }" @size-change="s => { hSize.value = s; loadH() }"
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 生成催缴单 -->
    <el-dialog v-model="collectVisible" title="生成催缴单" width="480">
      <el-form label-width="88px">
        <el-form-item label="催缴户数"><b>{{ picked.length }}</b> 户</el-form-item>
        <el-form-item label="欠费合计"><span class="money money--out">¥ {{ money(pickedAmount) }}</span></el-form-item>
        <el-form-item label="催缴方式">
          <el-select v-model="collectMethod" style="width:100%">
            <el-option v-for="m in COLLECT_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="collectNote" type="textarea" :rows="2" placeholder="如：第三轮催缴，限期 7 日内缴清" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="collectVisible = false">取消</el-button>
        <el-button type="primary" @click="doCollect">确认生成</el-button>
      </template>
    </el-dialog>

    <!-- 打印预览 -->
    <el-dialog v-model="printVisible" title="催缴单打印预览" width="760">
      <div class="print-area">
        <div class="print-area__hd">
          <div class="tt">物业费催缴通知单</div>
          <div class="muted">批次：待生成 · 打印时间 {{ today }} · 共 {{ picked.length }} 户</div>
        </div>
        <table class="print-tb">
          <thead>
            <tr><th>房屋</th><th>业主</th><th>欠费笔数</th><th>欠费金额</th><th>最长逾期</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in picked" :key="r.houseId">
              <td>{{ r.houseName }}</td><td>{{ r.ownerName }}</td>
              <td class="r">{{ r.count }}</td><td class="r">¥ {{ money(r.sum) }}</td><td class="r">{{ r.maxDays }} 天</td>
            </tr>
          </tbody>
          <tfoot>
            <tr><td colspan="3" class="r">合计</td><td class="r">¥ {{ money(pickedAmount) }}</td><td></td></tr>
          </tfoot>
        </table>
        <div class="print-area__ft">
          请于收到本通知之日起 7 日内缴清欠费，逾期将按合同约定收取违约金并通过法律途径追缴。<br />
          服务热线：028-8888 6666 · {{ picked[0]?.communityName || '物业管理服务中心' }}
        </div>
      </div>
      <template #footer>
        <el-button @click="printVisible = false">关闭</el-button>
        <el-button type="primary" :icon="'Printer'" @click="doPrint">打印</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import { useListQuery } from '@/composables/useQuery'
import { exportList } from '@/utils/export'
import { maskPhone, money, wan } from '@/utils/format'
import { printArea } from '@/utils/print'
import {
  COLLECT_METHODS, COLLECT_STATUS, PAGE_SIZES, billPeriodOpts, collectionSummary,
  communityOpts, createCollection, queryCollectionRecords, queryDebtPool
} from '@/utils/api'

const tab = ref('pool')
const sum = ref(collectionSummary())
const minDays = ref(null)

// —— 欠费池 ——
const poolFetcher = p => queryDebtPool({ ...p, filters: { ...p.filters, minDays: minDays.value } })
const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(poolFetcher, {
  filters: { communityId: '', period: '', minDays: null, minAmount: null, kw: '' }, size: 20
})
const picked = ref([])
const pickedAmount = computed(() => picked.value.reduce((s, r) => s + r.sum, 0))
function onSel(list) { picked.value = list }
function pickBucket(i) {
  const v = [0, 31, 91, 181][i]
  minDays.value = minDays.value === v ? null : v
  search()
}
function reload() { sum.value = collectionSummary(); load(); loadH() }

// —— 生成催缴单 ——
const collectVisible = ref(false)
const collectMethod = ref('短信')
const collectNote = ref('')
async function doCollect() {
  try {
    const res = createCollection({
      houseIds: picked.value.map(r => r.houseId),
      method: collectMethod.value, note: collectNote.value
    })
    ElMessage.success(`已生成催缴单 ${res.batchNo}：${res.count} 户 / ¥${money(res.amount)}`)
    collectVisible.value = false
    tab.value = 'history'
    sum.value = collectionSummary()
    loadH()
  } catch (e) { ElMessage.error(e?.message || '生成失败') }
}

// —— 催缴历史 ——
const hq = ref({ method: '', status: '', batchNo: '', kw: '' })
const hRows = ref([]); const hTotal = ref(0); const hPageNo = ref(1); const hSize = ref(20); const hLoading = ref(false)
async function loadH() {
  hLoading.value = true
  try {
    const res = await queryCollectionRecords({ pageNo: hPageNo.value, size: hSize.value, filters: { ...hq.value } })
    hRows.value = res.rows; hTotal.value = res.total
  } finally { hLoading.value = false }
}
function searchH() { hPageNo.value = 1; loadH() }
function openHistory(row) { hq.value = { ...hq.value, kw: row.houseName }; tab.value = 'history'; loadH() }
loadH()

const today = new Date().toISOString().slice(0, 10)

// —— 导出 ——
const POOL_COLS = [
  { prop: 'houseName', label: '房屋' }, { prop: 'ownerName', label: '业主' },
  { prop: 'communityName', label: '项目' }, { prop: 'count', label: '欠费笔数' },
  { prop: 'sum', label: '欠费金额' }, { prop: 'maxDays', label: '最长逾期天数' }
]
const HIST_COLS = [
  { prop: 'recordId', label: '记录号' }, { prop: 'batchNo', label: '批次' },
  { prop: 'houseName', label: '房屋' }, { prop: 'ownerName', label: '业主' },
  { prop: 'amount', label: '催缴金额' }, { prop: 'method', label: '方式' },
  { prop: 'status', label: '结果' }, { prop: 'collectTime', label: '催缴时间' }
]
function onExport() {
  exportList({ name: '欠费催缴池', source: '/b/collection', columns: POOL_COLS, rows: rows.value, filters: { ...query, minDays: minDays.value } })
}
function onExportH() {
  exportList({ name: '催缴记录', source: '/b/collection', columns: HIST_COLS, rows: hRows.value, filters: { ...hq.value } })
}

// —— 打印（X4：走通用打印通道 utils/print.js，与收据 / 台账同一套排版基线）——
const printVisible = ref(false)
function doPrint() {
  if (!printArea('物业费催缴通知单', '.print-area')) ElMessage.warning('没有可打印内容，或打印窗口被浏览器拦截')
}
</script>

<style scoped>
.print-area__hd { border-bottom: 1px solid var(--biz-line, #e6e9f0); padding-bottom: 10px; }
.print-area__hd .tt { font-size: 17px; font-weight: 600; }
.print-tb { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
.print-tb th, .print-tb td { border: 1px solid var(--biz-line, #e6e9f0); padding: 7px 10px; text-align: left; }
.print-tb th { background: var(--biz-bg-2, #f7f8fb); }
.print-tb .r { text-align: right; }
.print-area__ft { font-size: 12.5px; color: var(--biz-text-2, #6b7590); margin-top: 10px; }
</style>
