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
            <span class="tag" :class="isFree ? 'tag--muted' : 'tag--warning'">{{ isFree ? '公共区域 · 免费' : '入户 · 收费' }}</span>
          </div>
          <div class="whead__s">
            {{ wo.type }} · {{ wo.category }} · {{ wo.houseName }} · {{ wo.ownerName }} {{ wo.ownerPhone }} · 来源 {{ wo.source }}
          </div>
        </div>
        <div class="whead__r">
          <el-button :icon="'Back'" @click="$router.back()">返回</el-button>
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
            <div class="dl__i"><span class="dl__k">房屋</span><span class="dl__v">{{ wo.houseName }}</span></div>
            <div class="dl__i"><span class="dl__k">报修类型</span><span class="dl__v">{{ wo.type }} / {{ wo.category }}</span></div>
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
            <div class="tl__i is-done">
              <div class="tl__t">业主提交报修</div>
              <div class="tl__m">{{ wo.createTime }} · {{ wo.source }} · 张建国</div>
            </div>
            <div class="tl__i is-done">
              <div class="tl__t">{{ wo.dispatchMode }} → {{ wo.assignee }}</div>
              <div class="tl__m">09:15 · 按技能（水电）+ 片区（1 栋）+ 空闲自动匹配 · 3 秒内接单</div>
            </div>
            <div class="tl__i is-done">
              <div class="tl__t">师傅接单</div>
              <div class="tl__m">{{ wo.acceptTime }} · 响应 {{ respMin }} 分钟（SLA {{ wo.slaHours }} 小时）</div>
            </div>
            <div class="tl__i is-now">
              <div class="tl__t">已到达现场</div>
              <div class="tl__m">{{ wo.arriveTime }} · 定位打卡已通过</div>
            </div>
            <div class="tl__i">
              <div class="tl__t">完工登记（待操作）</div>
              <div class="tl__m">需填写处理措施、更换材料、工时与收费</div>
            </div>
            <div class="tl__i">
              <div class="tl__t">业主确认与评价</div>
              <div class="tl__m">完工后推送小程序确认，超 48 小时未评价自动五星</div>
            </div>
          </div>
        </div>

        <!-- 费用 -->
        <div class="panel" style="margin-top:16px;">
          <div class="panel__hd">
            <h3>费用明细</h3>
            <span class="tag" :class="isFree ? 'tag--muted' : 'tag--warning'">{{ wo.feeType }}</span>
            <span class="spacer" />
            <span class="desc">支付状态：{{ wo.payStatus }}</span>
          </div>
          <el-table :data="feeRows" size="small" show-summary :summary-method="feeSummary">
            <el-table-column prop="name" label="项目" min-width="180" />
            <el-table-column prop="spec" label="规格 / 说明" min-width="200" />
            <el-table-column prop="qty" label="数量" width="90" align="right" />
            <el-table-column prop="price" label="单价" width="100" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.price) }}</span></template>
            </el-table-column>
            <el-table-column prop="amount" label="金额" width="110" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.amount) }}</span></template>
            </el-table-column>
          </el-table>
          <div class="fee-foot">
            <span class="muted" style="font-size:12px;">定价规则：起步价 + 工时 + 材料 + 加价项，不超过项目上限</span>
            <span class="spacer" />
            <el-button :icon="'Money'">生成服务账单</el-button>
            <el-button>并入下期物业费</el-button>
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
          <div class="sec__hd"><h4>业主评价</h4><span class="desc">完工后可见</span></div>
          <EmptyState type="empty" desc="工单尚未完工，暂无评价" />
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd"><h4>关联</h4></div>
          <div class="rel"><span>业主 360</span><el-button link type="primary">张建国 →</el-button></div>
          <div class="rel"><span>房屋台账</span><el-button link type="primary">1栋1单元0501 →</el-button></div>
          <div class="rel"><span>历史工单</span><el-button link type="primary">该房共 1 单 →</el-button></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getWorkOrder, repairCandidates } from '@/utils/api'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { hoursBetween } from '@/utils/api'
import { money } from '@/utils/format'

const wo = getWorkOrder('WO000001')
// 收费口径以 feeType 为准（公共区域维修免费，入户维修收费）
const isFree = computed(() => wo.feeType !== '收费')
const steps = ['受理', '派单', '上门', '完工', '评价']
const curStep = 2 // 处理中 → 已上门
const mode = ref(wo.dispatchMode)
const assignee = ref(wo.assignee)

// 派单候选人：岗位筛选与兜底收归 api
const cand = repairCandidates(20)

const elapsed = computed(() => {
  const h = hoursBetween(wo.createTime, '2026-10-21 12:00')
  return Math.max(1, Math.round(h))
})
const respMin = computed(() => Math.round(hoursBetween(wo.createTime, wo.acceptTime) * 60))
const slaLeft = computed(() => Math.max(0, wo.slaHours - elapsed.value))
const slaPct = computed(() => Math.min(100, (elapsed.value / wo.slaHours) * 100))

const feeRows = [
  { name: '材料费 · 角阀', spec: 'DN15 全铜', qty: 1, price: 120, amount: 120 },
  { name: '工时费', spec: '上门 1 次 · 0.5 小时', qty: 1, price: 80, amount: 80 }
]
function feeSummary({ columns, data }) {
  const sums = []
  columns.forEach((c, i) => {
    if (i === 0) sums[i] = '合计'
    else if (c.property === 'amount') sums[i] = money(wo.totalFee)
    else sums[i] = ''
  })
  return sums
}

function doDispatch() {
  if (mode.value !== '自动派单' && !assignee.value) {
    ElMessage.error('请选择处理人'); return
  }
  ElMessage.success(mode.value === '抢单'
    ? '已推送到抢单池（12 名师傅在线）'
    : `已派单给 ${mode.value === '自动派单' ? '孙德海（自动匹配）' : assignee.value}，等待接单`)
}
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
</style>
