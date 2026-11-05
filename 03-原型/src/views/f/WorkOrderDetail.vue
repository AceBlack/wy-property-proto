<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>报修工单 · 详情与派单</b>：五段流程「受理 → 派单 → 上门 → 完工 → 评价」。
        派单三模式：自动派单（按技能+片区+空闲）→ 15 分钟未接自动进抢单池 → 再超时升级主管。
        入户维修完工即生成服务账单，可在线付或挂账并入物业费。
      </div>
    </div>

    <!-- 概要头 -->
    <div class="panel" style="margin-top:16px;">
      <div class="whead">
        <div>
          <div class="whead__t">
            <span class="mono">{{ wo.woNo }}</span>
            {{ wo.title }}
            <StatusTag domain="workOrder" :value="wo.status" />
            <StatusTag domain="priority" :value="wo.priority" />
            <span class="tag" :class="hasFee ? 'tag--warning' : 'tag--muted'">
              {{ hasFee ? `商业服务 · 收费 ¥${money(wo.totalFee)}` : (isPublicRepair ? '公共区域 · 免费' : '非维修类 · 无费用') }}
            </span>
          </div>
          <div class="whead__s">
            {{ wo.type }} · {{ wo.category }}
            <template v-if="isBiz && wo.serviceName"> · {{ wo.serviceName }}</template>
            · {{ wo.houseName || '公共区域' }}
            <template v-if="wo.ownerName"> · {{ wo.ownerName }} {{ wo.ownerPhone }}</template>
            · 来源 {{ wo.source }}
          </div>
        </div>
        <div class="whead__r">
          <el-button :icon="'Back'" @click="goList">返回列表</el-button>
          <el-button :icon="'Share'">转派</el-button>
          <el-button :icon="'CircleCheck'">完工登记</el-button>
          <el-button type="primary" :icon="'Promotion'">立即派单</el-button>
        </div>
      </div>

      <div class="steps" style="margin-top:18px;">
        <div v-for="(s, i) in steps" :key="s" class="steps__i" :class="{ 'is-done': i < curStep, 'is-now': i === curStep }">
          {{ i + 1 }}. {{ s }}
        </div>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1.65fr 1fr;">
      <div>
        <!-- 工单信息 -->
        <div class="panel">
          <div class="sec__hd"><h4>报修信息</h4><span class="desc">业主提交时间 {{ wo.createTime }}</span></div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">工单号</span><span class="dl__v">{{ wo.woNo }}</span></div>
            <div class="dl__i"><span class="dl__k">来源</span><span class="dl__v">{{ wo.source }}</span></div>
            <div class="dl__i"><span class="dl__k">报修人</span><span class="dl__v">{{ wo.ownerName }} · {{ wo.ownerPhone }}</span></div>
            <div class="dl__i"><span class="dl__k">房屋</span><span class="dl__v">{{ wo.houseName || '公共区域（不入户）' }}</span></div>
            <div class="dl__i"><span class="dl__k">工单类型</span><span class="dl__v">{{ wo.type }}</span></div>
            <div class="dl__i"><span class="dl__k">{{ isBiz ? '项目分类' : '设施部位' }}</span><span class="dl__v">{{ wo.category || '—' }}</span></div>
            <div v-if="isBiz" class="dl__i"><span class="dl__k">服务项目</span><span class="dl__v">{{ wo.serviceName || '—' }}<span class="muted" style="margin-left:6px;">{{ wo.priceCode }}</span></span></div>
            <div class="dl__i"><span class="dl__k">紧急程度</span><span class="dl__v">{{ wo.priority }}</span></div>
            <div class="dl__i is-full"><span class="dl__k">问题描述</span><span class="dl__v">{{ wo.description }}</span></div>
          </div>

          <div class="imgs">
            <div v-for="i in wo.images" :key="i" class="img">
              <el-icon><PictureFilled /></el-icon>
              <span>现场照片 {{ i }}</span>
            </div>
          </div>
        </div>

        <!-- 处理记录 -->
        <div class="panel" style="margin-top:16px;">
          <div class="panel__hd"><h3>处理记录</h3><span class="spacer" /><span class="desc">已耗时 {{ elapsed }} 小时</span></div>
          <div class="tl">
            <div v-for="(n, i) in timeline" :key="i" class="tl__i"
              :class="{ 'is-done': n.done, 'is-now': !n.done && timeline.slice(0, i).every(x => x.done) }">
              <div class="tl__t">{{ n.t }}<span v-if="!n.done" class="tl__pending">待处理</span></div>
              <div class="tl__m">{{ n.m }}</div>
            </div>
          </div>
        </div>

        <!-- 费用：商业服务收费 / 公共区域免费 / 非维修类无费用 -->
        <div v-if="hasFee" class="panel" style="margin-top:16px;">
          <div class="panel__hd">
            <h3>服务费用</h3>
            <span class="tag tag--warning">商业服务 · 收费</span>
            <span class="spacer" />
            <span class="desc">支付状态：{{ wo.payStatus }}</span>
          </div>
          <el-table :data="feeRows" size="small" show-summary :summary-method="feeSummary">
            <el-table-column prop="name" label="项目" width="110" />
            <el-table-column prop="spec" label="说明" min-width="240" show-overflow-tooltip />
            <el-table-column prop="qty" label="数量" width="70" align="right" />
            <el-table-column prop="price" label="单价" width="100" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.price) }}</span></template>
            </el-table-column>
            <el-table-column prop="amount" label="金额" width="110" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.amount) }}</span></template>
            </el-table-column>
          </el-table>
          <div class="fee-inner">
            <span>内部口径（业主不可见）</span>
            <b>成本 ¥{{ money(internal.cost) }}</b>
            <b>毛利 ¥{{ money(internal.profit) }}（{{ internal.margin }}%）</b>
            <em>金额按下单时的服务项目快照结算，字典改价不回溯</em>
          </div>
          <div class="fee-foot">
            <span class="muted" style="font-size:12px;">
              完工后按服务项目生成账单；业主可在线支付，或挂账并入下期物业费
            </span>
            <span class="spacer" />
            <el-button :icon="'Money'" :disabled="wo.payStatus !== '未支付'">生成服务账单</el-button>
            <el-button :disabled="wo.payStatus !== '未支付'">并入下期物业费</el-button>
          </div>
        </div>
        <div v-else-if="isPublicRepair" class="panel" style="margin-top:16px;">
          <div class="panel__hd">
            <h3>费用</h3><span class="tag tag--muted">公共区域 · 免费</span>
          </div>
          <div class="free-note">
            公共设施（{{ wo.category }}）的维修不向业主收费，成本走物业运营成本，<b>完工后不生成账单</b>。
            材料与工时仍会登记，仅用于成本核算与报价参考。
          </div>
        </div>

        <!-- 工时积分：公共区域单没有提成，积分是这块活的激励入口 -->
        <div v-if="isPublicRepair" class="panel" style="margin-top:16px;">
          <div class="panel__hd">
            <h3>工时积分</h3>
            <span class="tag" :class="wo.pointsStatus === '待结算' ? 'tag--warning' : 'tag--muted'">
              {{ wo.pointsStatus || '未记录' }}
            </span>
            <span class="spacer" />
            <span class="desc">{{ wo.pointsPeriod || '—' }} 归属期间</span>
          </div>

          <div class="pt-now">
            <div class="pt-now__i">
              <span>实际工时</span>
              <b>{{ wo.laborHours ?? '—' }}<em v-if="wo.laborHours"> 小时</em></b>
            </div>
            <div class="pt-now__i">
              <span>部位权重</span>
              <b>{{ wo.laborPointWeight ?? pointWeight }}<em>×</em></b>
            </div>
            <div class="pt-now__i is-points">
              <span>工时积分</span>
              <b>{{ wo.laborPoints ?? '—' }}<em v-if="wo.laborPoints"> 分</em></b>
            </div>
            <div class="pt-now__i">
              <span>记入人</span>
              <b class="is-text">{{ wo.pointsBy || '—' }}</b>
            </div>
          </div>

          <!-- 录入：完工后才能记；已结算不给改 -->
          <div class="pt-form">
            <span class="pt-form__k">本次工时</span>
            <el-input-number v-model="hoursInput" :min="0.5" :max="24" :step="0.5" :precision="1"
              controls-position="right" style="width:118px" />
            <span class="pt-form__u">小时</span>
            <span class="pt-form__calc">
              按 {{ wo.category }} 权重 {{ pointWeight }} 计 →
              <b>{{ previewPoints }}</b> 分
            </span>
            <span class="spacer" />
            <el-button type="primary" size="small" :disabled="!canSavePoints" :loading="savingPoints"
              @click="onSavePoints">
              {{ wo.laborPoints ? '重新记录' : '记入积分' }}
            </el-button>
          </div>
          <div v-if="!canSavePoints" class="pt-hint is-warn">{{ blockReason }}</div>
          <div v-else class="pt-hint">
            规则：积分 = 工时 × {{ LABOR_POINT_RULE.basePerHour }} 分/时 × 部位权重
            （电梯 1.5 / 公共设备 1.4 / 配电 1.3 / 给排水 1.2 / 土建 1.1 / 照明与门窗 1.0 / 环境 0.8）。
            规则版本 <code>{{ LABOR_POINT_RULE.version }}</code>，调权重不影响已记录的积分。
          </div>

          <!-- 绩效关系：本期只记录，折算未开通 -->
          <div class="perf-note">
            <b>与绩效的关系</b>
            <span>
              积分按<b>自然月</b>归属到「{{ wo.pointsPeriod || '—' }}」期间，绩效核算时按
              <code>empId + period</code> 汇总（<code>laborPointSummary()</code>）。
              <b v-if="!PERF_CONVERSION.implemented">本期只做记录，绩效折算尚未开通</b>
              <span class="muted" v-if="!PERF_CONVERSION.implemented">（{{ PERF_CONVERSION.note }}）</span>
              <b v-else>已开通折算</b>
            </span>
          </div>

          <div v-if="pointLedger.length" class="sec__hd" style="margin-top:14px;">
            <h4>记录流水</h4><span class="desc">共 {{ pointLedger.length }} 条</span>
          </div>
          <div v-if="pointLedger.length" class="pt-log">
            <div v-for="e in pointLedger" :key="e.ledgerId" class="pt-log__i" :class="{ 'is-void': e.status === '已作废' }">
              <span class="pt-log__at">{{ e.at }}</span>
              <span class="pt-log__h">{{ e.hours }} 小时 × {{ e.weight }} = <b>{{ e.points }}</b> 分</span>
              <span class="pt-log__by">{{ e.by }}</span>
              <span class="pt-log__st">{{ e.status }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右栏 -->
      <div>
        <div class="panel">
          <div class="sec__hd"><h4>派单</h4><span class="desc">当前：{{ wo.dispatchMode }}</span></div>
          <el-radio-group v-model="mode" style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">
            <el-radio value="自动派单">
              自动派单
              <span class="muted" style="font-size:12px;">按技能 / 片区 / 空闲度匹配</span>
            </el-radio>
            <el-radio value="后台指派">
              后台指派
              <span class="muted" style="font-size:12px;">主管手动选择处理人</span>
            </el-radio>
            <el-radio value="抢单">
              抢单池
              <span class="muted" style="font-size:12px;">推送全员，先到先得</span>
            </el-radio>
          </el-radio-group>

          <el-select v-if="mode !== '自动派单'" v-model="assignee" filterable placeholder="选择处理人" style="width:100%;margin-top:12px;">
            <el-option v-for="e in cand" :key="e.empId" :label="`${e.name} · ${e.position}`" :value="e.name" />
          </el-select>

          <div class="assignee" v-if="wo.assignee">
            <div class="assignee__ava">{{ wo.assignee.slice(0, 1) }}</div>
            <div>
              <div class="assignee__n">{{ wo.assignee }}<span class="tag tag--success" style="margin-left:6px;">已接单</span></div>
              <div class="assignee__d">{{ wo.assigneePhone }} · 工程部 · 水电</div>
            </div>
          </div>

          <el-button type="primary" plain style="width:100%;margin-top:14px;" :icon="'Promotion'" @click="doDispatch">
            {{ mode === '抢单' ? '发到抢单池' : '确认派单' }}
          </el-button>
          <div class="hint">15 分钟未接单自动进入抢单池；抢单池 30 分钟无人接单，升级片区主管。</div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd"><h4>SLA</h4></div>
          <div class="sla">
            <div class="sla__n">{{ slaLeft }}<span>小时</span></div>
            <div class="sla__bar"><i :style="{ width: slaPct + '%' }" /></div>
            <div class="sla__d">承诺 {{ wo.slaHours }} 小时 · 已用 {{ elapsed }} 小时 · {{ wo.isOverdue ? '已超时' : '剩余时间内' }}</div>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd"><h4>业主评价</h4><span class="desc">{{ wo.score ? '已评价' : '完工后可见' }}</span></div>
          <template v-if="wo.score">
            <div class="eval">
              <div class="eval__s">{{ wo.score }}<span>星</span></div>
              <div class="eval__b">
                <div class="eval__tags">
                  <span v-for="t in (wo.evalTags || [])" :key="t" class="eval__tag">{{ t }}</span>
                </div>
                <div class="eval__txt">{{ wo.evaluate || '业主未留言' }}</div>
              </div>
            </div>
          </template>
          <EmptyState v-else type="empty" desc="工单尚未完工，暂无评价" />
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd"><h4>关联</h4></div>
          <div class="rel">
            <span>业主 360</span>
            <el-button v-if="wo.ownerId" link type="primary"
              @click="$router.push(`/a/owners?focus=owner:${wo.ownerId}&open=1`)">
              {{ wo.ownerName || wo.ownerId }} →
            </el-button>
            <span v-else class="muted">公共区域工单无业主</span>
          </div>
          <div class="rel">
            <span>房屋台账</span>
            <el-button v-if="wo.houseId" link type="primary"
              @click="$router.push(`/a/houses?focus=house:${wo.houseId}`)">
              {{ wo.houseName }} →
            </el-button>
            <span v-else class="muted">不关联房屋</span>
          </div>
          <div class="rel">
            <span>历史工单</span>
            <el-button v-if="wo.houseId" link type="primary" @click="$router.push('/f/workorders')">
              该房共 {{ sameHouseCount }} 单 →
            </el-button>
            <span v-else class="muted">—</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  LABOR_POINT_RULE, PERF_CONVERSION, calcLaborPoints, getWorkOrder, hoursBetween, laborPointLedgerOf,
  canEditLaborPoints, laborPointWeight, repairCandidates, saveLaborPoints, wosOfOwner
} from '@/utils/api'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'

const route = useRoute()
const router = useRouter()

/**
 * 详情按 URL 上的 ?id= 取数（列表「详情」跳过来时带的）。
 * 以前这里写死 getWorkOrder('WO000001')：从列表点任何一行进来看到的都是第一张单，
 * 而费用明细还是另一套硬编码数字（120+80），跟工单自己的 totalFee 都对不上。
 */
const woId = computed(() => String(route.query.id || ''))
/* 写操作（记积分）改的是 workOrders 里的同一个对象，引用没变 Vue 不会重算；
   所以挂一个 tick：保存后 +1，让 computed 重新读一次。 */
const tick = ref(0)
const wo = computed(() => (tick.value, getWorkOrder(woId.value)))
const isBiz = computed(() => wo.value.type === '商业服务')
const isPublicRepair = computed(() => wo.value.type === '公共区域维修')
const hasFee = computed(() => isBiz.value)

/** 五段流程：受理 → 派单 → 上门 → 完工 → 评价 */
const steps = ['受理', '派单', '上门', '完工', '评价']
const STEP_INDEX = {
  待派单: 1, 已派单: 2, 处理中: 3, 待确认: 3, 已完工: 4, 已评价: 5, 已关闭: 5, 已取消: 1
}
const curStep = computed(() => STEP_INDEX[wo.value.status] ?? 1)

const mode = ref(wo.value.dispatchMode)
const assignee = ref(wo.value.assignee)
const cand = repairCandidates(20)

const elapsed = computed(() => {
  const h = hoursBetween(wo.value.createTime, wo.value.finishTime || '2026-11-02 12:00')
  return Math.max(1, Math.round(h))
})
const respMin = computed(() => (wo.value.acceptTime ? Math.round(hoursBetween(wo.value.createTime, wo.value.acceptTime) * 60) : 0))
const slaLeft = computed(() => Math.max(0, wo.value.slaHours - elapsed.value))
const slaPct = computed(() => Math.min(100, (elapsed.value / wo.value.slaHours) * 100))

/** 时间线：只渲染真实发生过的节点，没发生的写清"等待什么" */
const timeline = computed(() => {
  const w = wo.value
  const rows = [
    { t: '业主提交报修', m: `${w.createTime} · ${w.source}${w.ownerName ? ' · ' + w.ownerName : ''}`, done: true },
    {
      t: w.assignee ? `${w.dispatchMode} → ${w.assignee}` : '等待派单',
      m: w.assignee ? '按技能 + 片区 + 空闲度匹配' : '待派单：可自动派单、后台指派或推抢单池',
      done: !!w.assignee
    },
    {
      t: w.acceptTime ? '师傅接单' : '等待接单',
      m: w.acceptTime ? `${w.acceptTime} · 响应 ${respMin.value} 分钟（SLA ${w.slaHours} 小时）` : '派单后 15 分钟未接自动进抢单池',
      done: !!w.acceptTime
    },
    {
      t: w.arriveTime ? '已到达现场' : '等待上门',
      m: w.arriveTime ? `${w.arriveTime} · 定位打卡` : '师傅接单后按预约时段上门',
      done: !!w.arriveTime
    },
    {
      t: w.finishTime ? '完工登记' : '等待完工',
      m: w.finishTime
        ? `${w.finishTime} · 历时 ${w.durationHours} 小时${isBiz.value ? ` · 服务费 ¥${money(w.totalFee)}` : ' · 公共区域免费'}`
        : (isBiz.value ? '完工时按服务项目生成账单（可在线付或挂账）' : '完工后登记处理措施与工时'),
      done: !!w.finishTime
    },
    {
      t: w.score ? `业主评价 ${w.score} 星` : '等待业主评价',
      m: w.score ? `${(w.evalTags || []).join('、')}${w.evaluate ? ' · ' + w.evaluate : ''}` : '完工后推送小程序确认，超 48 小时未评价自动五星',
      done: !!w.score
    }
  ]
  return rows
})

/** 费用明细：只有商业服务有；金额一律取工单上的快照，不查字典当前价 */
const feeRows = computed(() => (isBiz.value
  ? [
      { name: '材料费', spec: `${wo.value.serviceName || wo.value.category} · 材料按成本价过账`, qty: 1, price: wo.value.materialFee, amount: wo.value.materialFee },
      { name: '人工费', spec: '上门 1 次 · 按价目表工时计价（师傅提成基数）', qty: 1, price: wo.value.laborFee, amount: wo.value.laborFee }
    ]
  : []))
function feeSummary({ columns }) {
  const sums = []
  columns.forEach((c, i) => {
    if (i === 0) sums[i] = '合计'
    else if (c.property === 'amount') sums[i] = money(wo.value.totalFee)
    else sums[i] = ''
  })
  return sums
}
/** 内部口径：成本与毛利只在后台看，不对业主展示 */
const internal = computed(() => {
  const cost = Number(wo.value.serviceCost) || 0
  const income = Number(wo.value.totalFee) || 0
  const profit = Math.round((income - cost) * 100) / 100
  return { cost, profit, margin: income ? Math.round(profit / income * 1000) / 10 : 0 }
})

/** 该房的历史工单数（同一业主同一房屋） */
const sameHouseCount = computed(() =>
  wosOfOwner(wo.value.ownerId).filter(w => w.houseId && w.houseId === wo.value.houseId).length)

function doDispatch() {
  if (mode.value !== '自动派单' && !assignee.value) {
    ElMessage.error('请选择处理人'); return
  }
  ElMessage.success(mode.value === '抢单'
    ? '已推送到抢单池（12 名师傅在线）'
    : `已派单给 ${mode.value === '自动派单' ? '系统自动匹配' : assignee.value}，等待接单`)
}
/* ---------------- 工时积分 ---------------- */
const hoursInput = ref(1)
const savingPoints = ref(false)
/** 该部位的权重：与接口同一套表，页面不另写一份 */
const pointWeight = computed(() => laborPointWeight(wo.value.category))
const previewPoints = computed(() => calcLaborPoints({ category: wo.value.category, hours: hoursInput.value }).points)
const pointLedger = computed(() => {
  void tick.value
  return laborPointLedgerOf(wo.value.woId)
})

/** 能不能记：类型对、已派单、已完工、还没结算 —— 与接口校验同口径，提前在按钮上拦住 */
const canSavePoints = computed(() =>
  canEditLaborPoints()                                  // 权限：客服能看不能记
  && wo.value.type === '公共区域维修'
  && !!wo.value.assignee
  && ['已完工', '已评价', '已关闭'].includes(wo.value.status)
  && wo.value.pointsStatus !== '已结算'
)
const blockReason = computed(() => {
  if (!canEditLaborPoints()) return '你的角色只能查看工时积分（需要「工时积分·操作」权限）'
  if (!wo.value.assignee) return '还没派单，先派单再记工时'
  if (!['已完工', '已评价', '已关闭'].includes(wo.value.status)) return `工单当前「${wo.value.status}」，完工后才能记积分`
  if (wo.value.pointsStatus === '已结算') return `${wo.value.pointsPeriod} 已结算，积分不能再改（要改走冲正）`
  return ''
})

async function onSavePoints() {
  savingPoints.value = true
  try {
    const r = saveLaborPoints(wo.value.woId, { hours: hoursInput.value, operator: '工程主管' })
    tick.value += 1
    ElMessage.success(`已记录 ${r.ledger.hours} 小时 → ${r.ledger.points} 分，归属 ${r.ledger.period}（本期仅记录，绩效折算未开通）`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    savingPoints.value = false
  }
}

function goList() { router.push('/f/workorders') }
</script>

<style scoped>
.whead { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.whead__t { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600; color: var(--biz-text-1); flex-wrap: wrap; }
.whead__s { font-size: 12.5px; color: var(--biz-text-3); margin-top: 6px; }
.whead__r { display: flex; gap: 8px; margin-left: auto; }
.mono { font-family: var(--biz-font-mono); font-size: 13px; color: var(--biz-text-3); font-weight: 400; }

.imgs { display: flex; gap: 10px; margin-top: 14px; }
.img {
  width: 96px; height: 72px; border-radius: 8px; background: var(--biz-bg-fill);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  color: var(--biz-text-3); font-size: 11px;
}
.img .el-icon { font-size: 20px; }

.fee-foot { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.fee-foot .spacer { flex: 1; }

.assignee { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding: 10px; background: var(--biz-bg-fill); border-radius: 10px; }
.assignee__ava { width: 34px; height: 34px; border-radius: 50%; background: var(--biz-gradient); color: #fff; display: grid; place-items: center; font-size: 13px; font-weight: 600; }
.assignee__n { font-size: 13px; font-weight: 500; display: flex; align-items: center; }
.assignee__d { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }
.hint { margin-top: 10px; font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; }

.sla__n { font-family: var(--biz-font-num); font-size: 28px; font-weight: 600; color: var(--el-color-primary); }
.sla__n span { font-size: 12px; color: var(--biz-text-3); margin-left: 3px; font-weight: 400; }
.sla__bar { height: 7px; border-radius: 999px; background: var(--biz-bg-fill); overflow: hidden; margin: 8px 0; }
.sla__bar i { display: block; height: 7px; border-radius: 999px; background: var(--biz-gradient); }
.sla__d { font-size: 11.5px; color: var(--biz-text-3); }

.rel { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; font-size: 12.5px; color: var(--biz-text-2); }

/* 公共区域免费说明 / 内部成本条 / 时间线待办 / 评价 */
.free-note {
  padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.8;
  background: rgba(18, 185, 138, .07); color: var(--biz-text-2);
}
.fee-inner {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  margin-top: 10px; padding: 8px 12px; border-radius: 7px;
  background: rgba(91, 108, 255, .06); font-size: 12px; color: var(--biz-text-3);
}
.fee-inner b { font-family: var(--biz-font-num); color: var(--biz-text-1); }
.fee-inner em { font-style: normal; color: var(--biz-text-4, #a6adc1); }
.tl__pending {
  margin-left: 6px; padding: 0 5px; border-radius: 4px; font-size: 10.5px;
  background: rgba(217, 138, 31, .12); color: var(--biz-warning, #d98a1f);
}
.eval { display: flex; gap: 14px; align-items: flex-start; padding-top: 2px; }
.eval__s { font-family: var(--biz-font-num); font-size: 30px; line-height: 1; color: var(--biz-warning, #d98a1f); }
.eval__s span { font-size: 12px; margin-left: 2px; }
.eval__tags { display: flex; flex-wrap: wrap; gap: 6px; }
.eval__tag {
  padding: 1px 8px; border-radius: 10px; font-size: 11.5px;
  background: rgba(18, 185, 138, .1); color: var(--biz-success, #12b98a);
}
.eval__txt { margin-top: 6px; font-size: 12.5px; color: var(--biz-text-2); line-height: 1.7; }

/* 公共区域免费说明 / 内部成本条 / 时间线待办 / 评价 */
.free-note {
  padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.8;
  background: rgba(18, 185, 138, .07); color: var(--biz-text-2);
}
.fee-inner {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  margin-top: 10px; padding: 8px 12px; border-radius: 7px;
  background: rgba(91, 108, 255, .06); font-size: 12px; color: var(--biz-text-3);
}
.fee-inner b { font-family: var(--biz-font-num); color: var(--biz-text-1); }
.fee-inner em { font-style: normal; color: var(--biz-text-4, #a6adc1); }
.tl__pending {
  margin-left: 6px; padding: 0 5px; border-radius: 4px; font-size: 10.5px;
  background: rgba(217, 138, 31, .12); color: var(--biz-warning, #d98a1f);
}
.eval { display: flex; gap: 14px; align-items: flex-start; padding-top: 2px; }
.eval__s { font-family: var(--biz-font-num); font-size: 30px; line-height: 1; color: var(--biz-warning, #d98a1f); }
.eval__s span { font-size: 12px; margin-left: 2px; }
.eval__tags { display: flex; flex-wrap: wrap; gap: 6px; }
.eval__tag {
  padding: 1px 8px; border-radius: 10px; font-size: 11.5px;
  background: rgba(18, 185, 138, .1); color: var(--biz-success, #12b98a);
}
.eval__txt { margin-top: 6px; font-size: 12.5px; color: var(--biz-text-2); line-height: 1.7; }

/* ---------------- 工时积分 ---------------- */
.pt-now {
  display: flex; flex-wrap: wrap; gap: 28px; padding: 10px 0 12px;
  border-bottom: 1px dashed var(--biz-border, #eef0f6);
}
.pt-now__i { display: flex; flex-direction: column; gap: 3px; }
.pt-now__i > span { font-size: 11.5px; color: var(--biz-text-3); }
.pt-now__i > b {
  font-family: var(--biz-font-num); font-size: 19px; line-height: 1.15; color: var(--biz-text-1);
}
.pt-now__i > b em { font-style: normal; font-size: 11.5px; color: var(--biz-text-3); margin-left: 2px; }
.pt-now__i > b.is-text { font-family: inherit; font-size: 13px; }
.pt-now__i.is-points > b { color: var(--biz-primary, #5b6cff); }

.pt-form { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.pt-form__k { font-size: 12.5px; color: var(--biz-text-3); }
.pt-form__u { font-size: 12px; color: var(--biz-text-3); }
.pt-form__calc { font-size: 12px; color: var(--biz-text-2); }
.pt-form__calc b { font-family: var(--biz-font-num); color: var(--biz-primary, #5b6cff); }

.pt-hint { margin-top: 8px; font-size: 11.5px; line-height: 1.75; color: var(--biz-text-3); }
.pt-hint.is-warn { color: var(--biz-warning, #d98a1f); }
.pt-hint code, .perf-note code {
  font-family: var(--biz-font-num); font-size: 11px; padding: 0 4px; border-radius: 3px;
  background: var(--biz-bg-fill); color: var(--biz-text-2);
}

/* 绩效关系：这一段是本期"只记录不折算"的说明书，要显眼但不抢 */
.perf-note {
  margin-top: 12px; padding: 9px 12px; border-radius: 8px; font-size: 12px; line-height: 1.85;
  background: rgba(91, 108, 255, .05); color: var(--biz-text-2);
}
.perf-note > b { display: block; margin-bottom: 2px; color: var(--biz-text-1); }
.perf-note b { color: var(--biz-text-1); }
.perf-note .muted { color: var(--biz-text-3); }

.pt-log__i {
  display: flex; align-items: center; gap: 14px; padding: 6px 0;
  border-bottom: 1px dashed var(--biz-border, #eef0f6); font-size: 12px; color: var(--biz-text-2);
}
.pt-log__i:last-child { border-bottom: 0; }
.pt-log__at { width: 128px; color: var(--biz-text-3); font-family: var(--biz-font-num); font-size: 11.5px; }
.pt-log__h b { font-family: var(--biz-font-num); color: var(--biz-text-1); }
.pt-log__by { color: var(--biz-text-3); }
.pt-log__st { margin-left: auto; font-size: 11px; color: var(--biz-warning, #d98a1f); }
.pt-log__i.is-void { opacity: .45; }
.pt-log__i.is-void .pt-log__st { color: var(--biz-text-4, #a6adc1); }
</style>
