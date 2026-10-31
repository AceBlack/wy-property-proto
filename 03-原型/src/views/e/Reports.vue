<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>报表中心</b>：一张表 = 一份配置（<code>utils/reports.js</code>），页面不写死任何列。
        金额口径全部来自 <code>api.js</code>，与三个驾驶舱同源；明细表支持导出 CSV。
        <b>带「跑批」标记的统计报表不做实时查询</b>——数字由夜间跑批算好落库，页面读统计批次快照，
        可切历史批次、可手动重算（改账单不会让已生成的批次跟着变）。
        <b>批次保留</b>：日快照 90 天 / 月快照 24 期 / 年报永久；<b>已月结期间的批次一律不清理</b>——
        审计要能回答「那个月报表当时长什么样」，而月结正是"当时"被确认的时间点。
        <b>置灰的报表为未开工项</b>，标注了所属批次，避免误以为已交付。
      </div>
    </div>

    <div v-for="g in groups" :key="g" class="panel" style="margin-top:16px;">
      <div class="panel__hd"><h3>{{ g }}</h3><span class="spacer" /><span class="desc">{{ countOf(g) }} 张</span></div>
      <div class="rgrid">
        <div
          v-for="r in ofGroup(g)" :key="r.code"
          class="rcard" :class="{ 'is-off': !r.ready }"
          @click="open(r)"
        >
          <div class="rcard__hd">
            <span class="rcard__n">{{ r.name }}</span>
            <span class="tag" :class="r.prio === 'P0' ? 'tag--warn' : 'tag--muted'">{{ r.prio }}</span>
            <span v-if="r.snapshot" class="tag tag--muted">跑批</span>
            <span v-if="!r.ready" class="tag tag--muted">待开发</span>
          </div>
          <div class="rcard__d">{{ r.desc }}</div>
          <div class="rcard__f">
            <span>{{ r.ready ? '已接通数据 · 可导出' : '数据接口待补' }}</span>
            <span class="rcard__go">{{ r.ready ? '查看 →' : '排期中' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { REPORTS } from '@/utils/reports'

const router = useRouter()
const groups = [...new Set(REPORTS.map(r => r.group))]
const ofGroup = g => REPORTS.filter(r => r.group === g)
const countOf = g => ofGroup(g).length

function open(r) {
  if (!r.ready) {
    ElMessage({ message: `「${r.name}」属 ${r.prio} 批次，数据接口待补`, type: 'info', duration: 1800 })
    return
  }
  router.push('/e/reports/' + r.code)
}
</script>

<style scoped>
.rgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.rcard {
  border: 1px solid var(--biz-border-light); border-radius: var(--border-radius-md, 8px);
  padding: 14px 16px; cursor: pointer; transition: border-color .15s, box-shadow .15s;
}
.rcard:hover { border-color: var(--biz-brand, #5b6cff); box-shadow: 0 2px 8px rgba(0, 0, 0, .06); }
.rcard.is-off { opacity: .55; cursor: not-allowed; }
.rcard.is-off:hover { border-color: var(--biz-border-light); box-shadow: none; }
.rcard__hd { display: flex; align-items: center; gap: 8px; }
.rcard__n { font-size: 14px; font-weight: 600; color: var(--biz-text-1); }
.rcard__d { font-size: 12.5px; color: var(--biz-text-3); margin-top: 6px; min-height: 36px; line-height: 1.5; }
.rcard__f { display: flex; justify-content: space-between; font-size: 12px; color: var(--biz-text-3); margin-top: 8px; }
.rcard__go { color: var(--biz-brand, #5b6cff); }
</style>
