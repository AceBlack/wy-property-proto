<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>口径自检 · 把"容易改坏的东西"变成可一键跑的不变量</b>：欠费口径、枚举取值、外键完整性、
        权限码引用、敏感字段白名单——这些一旦单点改错，页面上不一定报错，但数字会悄悄错（历史事故：
        「部分缴费」让欠费错降 1194 元、「入场/进场」让通行小计显示 0）。
        本页把 {{ result.total }} 条不变量跑一遍，<b>红项即缺陷</b>；开发阶段可直接搬成后端单测。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">检查项</div><div class="dstat__v">{{ result.total }}<span class="unit">条</span></div></div>
        <div class="dstat"><div class="dstat__k">通过</div><div class="dstat__v">{{ result.total - result.failed }}<span class="unit">条</span></div></div>
        <div class="dstat">
          <div class="dstat__k">失败</div>
          <div class="dstat__v" :class="result.failed ? 'is-warn' : ''">{{ result.failed }}<span class="unit">条</span></div>
        </div>
        <div class="dstat"><div class="dstat__k">最近一次</div><div class="dstat__v" style="font-size:15px;">{{ result.at }}</div></div>
      </div>
      <div class="sum-note">
        口径：全部检查都用<b>全量数据</b>跑（不受页面筛选与角色数据范围影响），避免"筛出来是对的、全量是错的"。
        金额类容忍 0.02 元浮点误差；枚举类逐行比对，越界会给出示例。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Refresh'" @click="run">重新自检</el-button>
        <el-button :icon="'Download'" @click="onExport">导出结果</el-button>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">
          分组：{{ groups.length }} 组 · 失败项优先展示
        </span>
      </div>

      <el-table :data="rows" style="width:100%" max-height="calc(100vh - 500px)"
        :row-class-name="({ row }) => row.pass ? '' : 'row--danger'">
        <el-table-column label="结果" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.pass ? 'success' : 'danger'" effect="plain">
              {{ row.pass ? '通过' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="group" label="分组" width="120" />
        <el-table-column prop="name" label="不变量" min-width="300" show-overflow-tooltip />
        <el-table-column prop="detail" label="实测" min-width="320" show-overflow-tooltip>
          <template #default="{ row }">
            <span :class="row.pass ? 'muted' : 'is-warn'" style="font-size:12.5px;">{{ row.detail }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="sec__hd"><h4>这些检查为什么值得留下</h4><span class="desc">每一条都对应过一次真实缺陷或一次评审追问</span></div>
      <div class="why">
        <div class="why__i">
          <b>金额自洽</b>：应收 = 已收 + 未收；欠费 = 未缴 + 部分缴 + 逾期。第 9 批「部分缴费」事故就是这条没过。
        </div>
        <div class="why__i">
          <b>枚举一致性</b>：状态值必须落在 `ENUM`（从配色字典派生）里。页面曾经各写一份数组，
          数据加了新状态，页面下拉里没有 → 用户筛不出来。
        </div>
        <div class="why__i">
          <b>外键完整性</b>：账单能回溯到房屋、房屋能回溯到责任人、租户能回溯到业主。
          开发换真库后，这三条就是外键约束 + 级联规则。
        </div>
        <div class="why__i">
          <b>责任范围</b>：每栋楼必须有楼管、且同一楼栋（单元）只能有一条绑定——否则要么没人管，要么两个人抢。
        </div>
        <div class="why__i">
          <b>权限一致</b>：角色引用的权限码必须存在；同一路由不能挂两个功能（会互相抢页面守卫，
          `a.sensitive.view` 必须无路由就是这条）。
        </div>
        <div class="why__i">
          <b>数据安全</b>：敏感字段白名单里的列必须真实存在，否则导出时"以为脱敏了，其实没脱"。
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { auditChecks } from '@/utils/api'
import { exportList } from '@/utils/export'

const result = ref({ checks: [], total: 0, failed: 0, at: '' })

function run() { result.value = auditChecks() }
onMounted(run)

/** 失败项优先，组内保持原顺序（组顺序本身是「从金额到安全」的递进） */
const rows = computed(() => {
  const list = [...result.value.checks]
  const failed = list.filter(c => !c.pass)
  const passed = list.filter(c => c.pass)
  return [...failed, ...passed]
})
const groups = computed(() => [...new Set(result.value.checks.map(c => c.group))])

const EXPORT_COLS = [
  { prop: 'group', label: '分组' }, { prop: 'name', label: '不变量' },
  { prop: 'resultText', label: '结果' }, { prop: 'detail', label: '实测' }
]
function onExport() {
  exportList({
    name: '口径自检结果', source: '/e/audit', columns: EXPORT_COLS,
    rows: result.value.checks.map(c => ({ ...c, resultText: c.pass ? '通过' : '失败' })),
    filters: { at: result.value.at }
  })
}
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); line-height: 1.8; }
.is-warn { color: var(--biz-danger); }
.why { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 18px; margin-top: 8px; }
.why__i { font-size: 12.5px; color: var(--biz-text-2); line-height: 1.75; padding-left: 10px; border-left: 2px solid var(--biz-border); }
.why__i b { color: var(--biz-text-1); }
</style>
