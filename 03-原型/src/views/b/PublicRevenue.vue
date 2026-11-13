<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>公共收益台账</b>：电梯广告、场地租赁、商铺租金、通信基站这类钱，
        <b>产权归全体业主</b>，物业只能按合同分成拿服务费。
        台账同时给「合同额 / 归业主 / 归物业」三个数 —— 只给合同额，汇报时会被当成公司收入，
        而这笔钱大部分不是公司的。
        <br />
        与「多种经营收入」的关系：商业合作收入 = 合同金额 − 公共收益（年化），
        所以这张表是那个数的底稿，两处必须能对上。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr));">
        <div class="dstat">
          <div class="dstat__k">有公共收益的合同</div>
          <div class="dstat__v">{{ summary.count }}<span class="unit">份</span></div>
          <div class="dstat__s">电梯广告 / 场地 / 商铺 / 基站</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">期间归业主</div>
          <div class="dstat__v">{{ wan(summary.ownerShare) }}<span class="unit">元</span></div>
          <div class="dstat__s">合同期内合计 · 平均分成 {{ summary.avgRate }}%</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">年化归业主</div>
          <div class="dstat__v">{{ wan(summary.annualOwner) }}<span class="unit">元</span></div>
          <div class="dstat__s">每年应划入业主共有资金</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">年化归物业</div>
          <div class="dstat__v">{{ wan(summary.annualCompany) }}<span class="unit">元</span></div>
          <div class="dstat__s">这部分才是公司收入</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">合同总额</div>
          <div class="dstat__v">{{ wan(summary.amount) }}<span class="unit">元</span></div>
          <div class="dstat__s">归业主 {{ wan(summary.ownerShare) }} + 归物业 {{ wan(summary.companyShare) }}</div>
        </div>
      </div>
      <div class="sum-note">
        <b>为什么不能只统计合同额</b>：一份 10 万的广告位合同，归业主 7 万、物业 3 万。
        把 10 万记成收入，等于把业主的钱算成自己的营收 —— 公示时对不上账，审计也过不去。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="filters" class="filter-bar" label-width="56px" @submit.prevent>
        <el-form-item label="项目">
          <el-select v-model="filters.communityId" placeholder="全部" clearable style="width:130px">
            <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="年度">
          <el-select v-model="filters.year" placeholder="全部年度" clearable style="width:120px">
            <el-option v-for="y in years" :key="y" :label="y + ' 年'" :value="y" />
          </el-select>
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Refresh'" @click="reset">重置</el-button>
        </el-form-item>
        <el-form-item class="acts" style="margin-left:auto;">
          <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出公示表</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 按项目：公示通常是按小区张贴，先给一版能直接抄的数 -->
    <div class="panel" style="margin-top:16px;">
      <div class="sec__hd" style="margin:0 0 10px;">
        <h4>按项目汇总</h4>
        <span class="desc">公示按小区出，这一排可以直接抄进公示稿</span>
      </div>
      <div class="bylist">
        <div v-for="c in summary.byCommunity" :key="c.communityName" class="byitem">
          <div class="byitem__n">{{ c.communityName }}</div>
          <div class="byitem__r">
            <span>期间归业主</span><b>¥{{ money(c.ownerShare) }}</b>
          </div>
          <div class="byitem__r">
            <span>年化归业主</span><b>¥{{ money(c.annualOwner) }}</b>
          </div>
          <div class="byitem__r is-sub">
            <span>{{ c.count }} 份合同 · 合同额</span><b>¥{{ money(c.amount) }}</b>
          </div>
        </div>
        <div v-if="!summary.byCommunity.length" class="blk__empty">当前筛选下没有公共收益合同</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <span class="muted" style="font-size:12.5px;">
          {{ filters.year ? filters.year + ' 年覆盖的合同' : '全部在期合同' }} · 共 {{ rows.length }} 份
        </span>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">归业主比例 = 公共收益 ÷ 合同金额</span>
      </div>
      <el-table :data="rows" style="width:100%" max-height="calc(100vh - 520px)">
        <el-table-column label="合同" min-width="210">
          <template #default="{ row }">
            <div class="nowrap">{{ row.name }}</div>
            <div class="ps-sub">{{ row.contractNo }} · {{ row.subtype }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="communityName" label="项目" min-width="120" show-overflow-tooltip />
        <el-table-column prop="partyB" label="相对方" min-width="120" show-overflow-tooltip />
        <el-table-column label="期间" width="180">
          <template #default="{ row }">
            <div class="nowrap">{{ row.startDate }}</div>
            <div class="ps-sub">{{ row.endDate }}</div>
          </template>
        </el-table-column>
        <el-table-column label="合同金额" width="110" align="right">
          <template #default="{ row }"><span class="num">¥{{ money(row.amount) }}</span></template>
        </el-table-column>
        <el-table-column label="归业主" width="150" align="right">
          <template #default="{ row }">
            <span class="num money">¥{{ money(row.ownerShare) }}</span>
            <div class="ps-sub">占 {{ row.publicRate }}%</div>
          </template>
        </el-table-column>
        <el-table-column label="归物业" width="110" align="right">
          <template #default="{ row }"><span class="num">¥{{ money(row.companyShare) }}</span></template>
        </el-table-column>
        <el-table-column label="年化归业主" width="110" align="right">
          <template #default="{ row }"><span class="num money">¥{{ money(row.annualOwner) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="92">
          <template #default="{ row }"><StatusTag domain="contract" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="说明" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="muted">{{ row.publicRevenueNote || '按合同分成条款' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="legal">
      <b>口径</b>：公共收益不进入物业公司的营业收入，只按合同分成计入「多种经营收入 · 商业合作」；
      归业主的部分应划入业主共有资金账户，用于公共设施维护或业主大会决定的事项。
      本页数据来自合同台账（`incomeCategory='多种经营'` 且 `publicRevenue > 0` 的合同），
      <b>不在本页单独造数</b> —— 两处数字对不上时，以合同为准。
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import StatusTag from '@/components/StatusTag.vue'
import { communityOpts, publicRevenueRows, publicRevenueSummary, publicRevenueYears } from '@/api'
import { exportList } from '@/utils/export'
import { money, wan } from '@/utils/format'

const cmOpts = communityOpts()
const years = publicRevenueYears()
const filters = ref({ communityId: '', year: '' })

/* 汇总与明细用同一份 filters：分开取数会出现"上面 12 份、下面 9 行"这种对不上的情况 */
const rows = computed(() => publicRevenueRows(filters.value))
const summary = computed(() => publicRevenueSummary(filters.value))

function reset() { filters.value = { communityId: '', year: '' } }

const COLS = [
  { prop: 'contractNo', label: '合同编号' },
  { prop: 'name', label: '合同名称' },
  { prop: 'communityName', label: '项目' },
  { prop: 'partyB', label: '相对方' },
  { prop: 'subtype', label: '类型' },
  { prop: 'startDate', label: '生效日' },
  { prop: 'endDate', label: '到期日' },
  { prop: 'amount', label: '合同金额' },
  { prop: 'ownerShare', label: '归业主' },
  { prop: 'companyShare', label: '归物业' },
  { prop: 'publicRate', label: '归业主比例(%)' },
  { prop: 'annualOwner', label: '年化归业主' },
  { prop: 'status', label: '状态' },
  { prop: 'publicRevenueNote', label: '说明' }
]
function onExport() {
  exportList({
    name: '公共收益台账', source: '/b/public-revenue',
    columns: COLS, rows: rows.value, filters: { ...filters.value }
  })
}
</script>

<style scoped>
.bylist { display: flex; gap: 12px; flex-wrap: wrap; }
.byitem {
  flex: 1; min-width: 200px;
  border: 1px solid var(--biz-border-light); border-radius: 10px;
  padding: 12px 14px; background: var(--biz-bg-fill);
}
.byitem__n { font-size: 13px; font-weight: 600; color: var(--biz-text-1); margin-bottom: 8px; }
.byitem__r {
  display: flex; align-items: baseline; justify-content: space-between;
  font-size: 12px; color: var(--biz-text-3); padding: 2px 0;
}
.byitem__r b { font-family: var(--biz-font-num); font-size: 14px; color: var(--el-color-primary); }
.byitem__r.is-sub { border-top: 1px dashed var(--biz-border-light); margin-top: 4px; padding-top: 5px; }
.byitem__r.is-sub b { font-size: 12.5px; color: var(--biz-text-2); font-weight: 500; }

.legal {
  margin-top: 14px; padding: 12px 16px; border-radius: 10px;
  background: #f7f9fc; border: 1px solid var(--biz-border-light);
  font-size: 12px; line-height: 1.75; color: var(--biz-text-3);
}
.legal b { color: var(--biz-text-2); }
</style>
