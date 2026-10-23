<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>工资表</b>：按「应发 → 代扣 → 实发」三段核算。应发 = 月度工资 + 加班费；
        代扣 = 社保（个人 10.5%）+ 公积金（7%）+ 个税（简化 3% 速算）。核算锁定后不可改，发放走银企直连或线下回执。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar" style="margin-bottom:0;">
        <el-date-picker v-model="month" type="month" value-format="YYYY-MM" style="width:130px;" />
        <el-select v-model="org" placeholder="全部项目" clearable style="width:150px;">
          <el-option v-for="o in orgOpts" :key="o.orgId" :label="o.name" :value="o.orgId" />
        </el-select>
        <el-select v-model="kw" placeholder="姓名/工号" clearable filterable style="width:150px;">
          <el-option v-for="e in employeeOpts" :key="e.empId" :label="`${e.name} ${e.empNo}`" :value="e.name" />
        </el-select>
        <span class="tag tag--warning">未核算</span>
        <span class="spacer" />
        <el-button :icon="'Refresh'" @click="recalc">重新核算</el-button>
        <el-button :icon="'Download'">导出工资表</el-button>
        <el-button type="primary" :icon="'Money'" :loading="paying" @click="pay">批量发放</el-button>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <KpiCard label="核算人数" :value="rows.length" unit="人" icon="UserFilled" />
      <KpiCard label="应发合计" :value="sum.gross" unit="元" icon="Wallet" gradient />
      <KpiCard label="代扣合计" :value="sum.deduct" unit="元" icon="Remove" color="#FF9F40" />
      <KpiCard label="实发合计" :value="sum.net" unit="元" icon="Money" color="#2ED9A3" />
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>{{ month }} 工资表</h3>
        <span class="spacer" />
        <span class="desc">共 {{ rows.length }} 人 · 数据来源：员工档案 + 考勤 + 绩效</span>
      </div>

      <el-table :data="paged" max-height="calc(100vh - 340px)" show-summary :summary-method="summary">
        <el-table-column prop="empNo" label="工号" width="92" fixed />
        <el-table-column prop="name" label="姓名" min-width="96" fixed show-overflow-tooltip />
        <el-table-column prop="position" label="岗位" min-min-width="110" show-overflow-tooltip />
        <el-table-column prop="base" label="基本工资" min-width="114" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.base) }}</span></template>
        </el-table-column>
        <el-table-column prop="perf" label="绩效" min-width="106" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.perf) }}</span></template>
        </el-table-column>
        <el-table-column prop="ot" label="加班费" min-width="106" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.ot) }}</span></template>
        </el-table-column>
        <el-table-column prop="gross" label="应发" min-width="124" align="right">
          <template #default="{ row }"><span class="money strong">{{ money(row.gross) }}</span></template>
        </el-table-column>
        <el-table-column prop="social" label="社保" min-width="110" align="right">
          <template #default="{ row }"><span class="money money--out">{{ money(row.social) }}</span></template>
        </el-table-column>
        <el-table-column prop="fund" label="公积金" min-width="110" align="right">
          <template #default="{ row }"><span class="money money--out">{{ money(row.fund) }}</span></template>
        </el-table-column>
        <el-table-column prop="tax" label="个税" min-width="104" align="right">
          <template #default="{ row }"><span class="money money--out">{{ money(row.tax) }}</span></template>
        </el-table-column>
        <el-table-column prop="net" label="实发" min-width="124" align="right">
          <template #default="{ row }"><span class="money strong">{{ money(row.net) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" min-width="86">
          <template #default="{ row }">
            <span class="tag" :class="row.paid ? 'tag--success' : 'tag--muted'">{{ row.paid ? '已发' : '待发' }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="table-foot">
        <el-pagination v-model:current-page="page" :page-size="size" :total="rows.length"
          layout="total, prev, pager, next" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { employeeOptions, orgs, payrollRows } from '@/utils/api'
import KpiCard from '@/components/KpiCard.vue'
import { money } from '@/utils/format'

const month = ref('2026-10')
const org = ref('')
const kw = ref('')
const page = ref(1), size = ref(20)
const paying = ref(false)
const paidSet = ref(new Set())

const orgOpts = orgs.filter(o => o.type !== '集团')
const employeeOpts = employeeOptions(60)
const orgName = id => orgs.find(o => o.orgId === id)?.name || id

// 薪酬核算口径收归 api，页面只负责展示与发放动作
const rows = computed(() => payrollRows({
  orgId: org.value, kw: kw.value, paidIds: [...paidSet.value]
}))
const paged = computed(() => rows.value.slice((page.value - 1) * size.value, page.value * size.value))

const sum = computed(() => rows.value.reduce((s, r) => ({
  gross: s.gross + r.gross, deduct: s.deduct + r.social + r.fund + r.tax, net: s.net + r.net
}), { gross: 0, deduct: 0, net: 0 }))

function summary({ columns }) {
  // 按 property 聚合，不依赖列索引（固定列会让索引位移）
  const agg = {}
  ;['base', 'perf', 'ot', 'gross', 'social', 'fund', 'tax', 'net'].forEach(k => {
    agg[k] = rows.value.reduce((a, r) => a + (r[k] || 0), 0)
  })
  return columns.map((c, i) => {
    if (i === 0) return '合计'
    return c.property && agg[c.property] !== undefined ? money(agg[c.property]) : ''
  })
}

function recalc() { ElMessage.success('已按最新考勤与绩效重新核算') }
function pay() {
  paying.value = true
  setTimeout(() => {
    const set = new Set(paidSet.value)
    rows.value.forEach(r => set.add(r.empId))
    paidSet.value = set
    paying.value = false
    ElMessage.success(`已提交代发：${rows.value.length} 人 / 实发 ¥${money(sum.value.net)}`)
  }, 700)
}
</script>
