<template>
  <view class="page">
    <NavBar title="工单详情" :subtitle="d?.row?.no || ''" />

    <view v-if="d" class="body body--with-foot">
      <!-- 头 -->
      <view class="card head" :class="{ 'is-urgent': d.row.priority !== '普通' }">
        <view class="head__top">
          <text class="pri" :style="{ color: d.row.priorityTone, borderColor: d.row.priorityTone }">{{ d.row.priority }}</text>
          <text class="status" :style="{ color: d.row.statusTone }">{{ d.row.status }}</text>
          <text v-if="d.row.mode === '抢单' && d.row.status === '待派单' && !d.row.assignee" class="mode">抢单池</text>
          <text v-if="d.row.isOverdue" class="overdue">SLA 超时</text>
        </view>
        <text class="head__t">{{ d.row.title }}</text>
        <view class="head__loc">
          <text class="head__pin">◎</text>
          <text>{{ d.row.houseName }}</text>
        </view>
        <view class="head__time">
          <view class="ht">
            <text class="ht__k">报修</text>
            <text class="ht__v num">{{ d.row.createTime.slice(5, 16) }}</text>
          </view>
          <view class="ht">
            <text class="ht__k">接单</text>
            <text class="ht__v num">{{ d.acceptTime ? d.acceptTime.slice(5, 16) : '待接单' }}</text>
          </view>
          <view class="ht">
            <text class="ht__k">SLA</text>
            <text class="ht__v num">{{ d.slaHours }} 小时</text>
          </view>
        </view>

        <!-- 抢到手后的到场倒计时：这条比 SLA 更紧，超时要记迟到 -->
        <view v-if="d.row.grabLeft" class="arrive-tip" :class="{ 'is-late': d.row.grabLeft.startsWith('已超时') }">
          <text class="arrive-tip__t">{{ d.row.grabLeft }}</text>
          <text class="arrive-tip__d">抢单规则：抢到后需在 {{ arriveLimit }} 分钟内到场打卡，超时记迟到；不去了要点「放弃」，会计一次弃单。</text>
        </view>
      </view>

      <!-- 报修内容 -->
      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">报修内容</text><text class="sec-hd__d">{{ d.row.type }} · {{ d.row.category }}</text></view>
        <text class="desc">{{ d.description }}</text>
        <view class="ph-row">
          <view v-for="n in Math.min(d.images, 3)" :key="n" class="ph"><text>照{{ n }}</text></view>
          <text v-if="d.images > 3" class="ph-more">+{{ d.images - 3 }}</text>
          <text v-if="!d.images" class="ph-none">业主未上传照片</text>
        </view>
      </view>

      <!-- 付费单：价目 / 预付 / 增项 / 提成 -->
      <view v-if="d.fee.type === '收费'" class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">费用与提成</text>
          <text class="sec-hd__d">{{ d.raw.prepaid ? '业主下单已预付，现场加项后付' : '完工后向业主收款' }}</text>
        </view>

        <!-- 服务项目：读**下单时的快照**，不反查字典（后台调价不能让历史单跟着变） -->
        <view v-if="d.price" class="price">
          <view class="price__hd">
            <text class="price__code num">{{ d.price.code || '未记价目码' }}</text>
            <text class="price__name">{{ d.price.name }}</text>
          </view>
          <view class="price__row">
            <text class="price__k">材料</text>
            <text class="price__v num">{{ money(d.price.material) }}</text>
            <text class="price__k">人工</text>
            <text class="price__v num">{{ money(d.price.labor) }}</text>
            <text class="price__k">下单总价</text>
            <text class="price__v num">{{ money(d.price.total) }}</text>
          </view>
          <text class="price__note">业主下单时看到的就是这份价目，所以移动端没有报价环节。</text>
          <view v-if="priceChanged" class="price__diff">
            <text class="price__diff-t">后台已调价：该项目当前 ¥{{ money(d.price.dictPrice) }}，本单仍按下单时 ¥{{ money(d.price.total) }} 结算。</text>
          </view>
        </view>

        <view class="fee">
          <view class="fee__i"><text class="fee__k">材料费</text><text class="fee__v num">{{ money(d.fee.material) }}</text></view>
          <view class="fee__i"><text class="fee__k">人工费</text><text class="fee__v num">{{ money(d.fee.labor) }}</text></view>
          <view class="fee__i"><text class="fee__k">合计</text><text class="fee__v num is-total">{{ money(d.fee.total) }}</text></view>
        </view>

        <view class="pay-line">
          <text class="pay-line__k">收款状态</text>
          <text class="pay-line__v" :style="{ color: payTone }">{{ d.fee.payStatus }}</text>
          <text v-if="d.raw.prepaid && d.fee.payStatus !== '已支付'" class="pay-line__d">预付未到账（演示数据），现场按未支付处理</text>
          <text v-else-if="d.fee.payStatus === '已挂账'" class="pay-line__d">挂账原因：{{ d.raw.hangReason }}</text>
        </view>

        <!-- 增项：师傅现场加的，必须业主确认后才合并 -->
        <view class="addons">
          <view class="addons__hd">
            <text class="addons__t">现场增项</text>
            <text class="addons__n">{{ d.addons.length }} 项<text v-if="d.addonSum.pending"> · {{ d.addonSum.pending }} 项待业主确认</text></text>
          </view>
          <view v-for="a in d.addons" :key="a.code + a.at" class="ad" :class="{ 'is-pending': !a.confirmed }">
            <view class="ad__l">
              <text class="ad__n">{{ a.name }} <text class="ad__q num">×{{ a.qty }}</text></text>
              <text class="ad__d">{{ a.confirmed ? '业主已确认，已合并到本单' : '待业主确认' }} · {{ a.at }}</text>
            </view>
            <text class="ad__v num">{{ money(a.total) }}</text>
          </view>
          <text v-if="!d.addons.length" class="addons__none">现场发现额外问题（拆旧、高空、二次上门…）时，在完工页加增项。</text>
        </view>

        <view class="comm-line">
          <view class="comm-line__l">
            <text class="comm-line__k">本单提成</text>
            <text class="comm-line__d">人工费 {{ money(d.fee.labor) }} × {{ rateText }}（材料费不计提）</text>
          </view>
          <view class="comm-line__r">
            <text id="wo-commission" class="comm-line__v num">{{ money(d.commission) }}</text>
            <text class="comm-line__s" :class="{ 'is-settled': d.settled }">{{ d.settled ? '已结' : d.addonSum.pending ? '未定' : '在途' }}</text>
          </view>
        </view>
      </view>

      <!-- 公区维修：不向业主收费、无提成，写清楚免得师傅以为页面漏了 -->
      <view v-if="d.fee.type !== '收费'" class="card">
        <view class="sec-hd"><text class="sec-hd__t">费用</text><text class="sec-hd__d">{{ d.row.type }}</text></view>
        <text class="desc">公共区域维修不向业主收费，也不计提成；工单只考核响应与完工时限。</text>
        <text v-if="d.row.serviceName" class="desc muted">部位：{{ d.row.serviceName }}</text>
      </view>

      <!-- 单据信息 -->
      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">单据信息</text></view>
        <Cell label="工单号" :value="d.row.no" />
        <Cell label="报修人" :value="d.row.ownerName || '未留姓名'" />
        <view class="cell-phone">
          <text class="cell-phone__k">联系电话</text>
          <text class="cell-phone__v num">{{ revealed ? d.ownerPhone : maskPhone(d.ownerPhone) }}</text>
          <text v-if="canReveal" class="cell-phone__act" @tap="revealed = !revealed">{{ revealed ? '隐藏' : '揭示' }}</text>
          <text v-else-if="d.row.mine" class="cell-phone__act" @tap="revealByCall">拨号</text>
        </view>
        <Cell label="受理人" :value="d.row.assignee || '未指派'" />
        <Cell label="派单方式" :value="d.raw.dispatchBy ? `由 ${d.raw.dispatchBy} 指派` : d.row.mode" />
        <Cell label="到场时间" :value="d.arriveTime || '未到场'" />
        <Cell label="完工时间" :value="d.finishTime || '—'" :last="true" />
      </view>

      <!-- 业主评价 -->
      <view v-if="d.ownerEval" class="card">
        <view class="sec-hd"><text class="sec-hd__t">业主评价</text><text class="sec-hd__d">{{ d.ownerEval.score }} 分</text></view>
        <view class="stars">{{ '★'.repeat(d.ownerEval.score) }}{{ '☆'.repeat(5 - d.ownerEval.score) }}</view>
        <view v-if="d.ownerEval.tags.length" class="chips">
          <text v-for="t in d.ownerEval.tags" :key="t" class="chip">{{ t }}</text>
        </view>
        <text v-if="d.ownerEval.text" class="desc">{{ d.ownerEval.text }}</text>
      </view>

      <!-- 员工回评 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">业主配合度</text>
          <text class="sec-hd__d">只给内部看，不影响业主评分</text>
        </view>
        <template v-if="d.staffEval">
          <view class="stars">{{ '★'.repeat(d.staffEval.score) }}{{ '☆'.repeat(5 - d.staffEval.score) }}</view>
          <view v-if="d.staffEval.tags.length" class="chips">
            <text v-for="t in d.staffEval.tags" :key="t" class="chip is-staff">{{ t }}</text>
          </view>
          <text v-if="d.staffEval.note" class="desc">{{ d.staffEval.note }}</text>
        </template>
        <view v-else-if="canRate" id="wo-rate" class="rate-entry" @tap="openRate">
          <text>这单已完工，记一笔业主配合度</text>
          <view class="chev" />
        </view>
        <text v-else class="desc muted">{{ d.row.status === '处理中' || d.row.status === '已派单' ? '完工后才能回评' : '这单没有回评记录' }}</text>
      </view>
    </view>

    <!-- 操作 -->
    <view v-if="d" class="footbar">
      <template v-if="canGrabNow">
        <view class="grab-hint">
          <text class="grab-hint__t">抢到这单可得 {{ money(d.commission) }}</text>
          <text class="grab-hint__d">先到先得 · 抢到后 {{ arriveLimit }} 分钟内到场</text>
        </view>
        <view id="wo-grab" class="btn btn--primary foot-btn" @tap="doGrab">抢单</view>
      </template>
      <template v-else-if="canDispatchNow">
        <view id="dispatch-btn" class="btn btn--primary foot-btn" @tap="openDispatch">{{ dispatchLabel }}</view>
      </template>
      <template v-else-if="needArrive">
        <view id="wo-abandon" class="btn btn--line foot-btn" @tap="doAbandon">放弃</view>
        <view id="wo-arrive" class="btn btn--primary foot-btn" @tap="doArrive">到场打卡</view>
      </template>
      <template v-else-if="canFinish">
        <view id="wo-transfer" class="btn btn--line foot-btn" @tap="openTransfer">转单</view>
        <view id="wo-finish" class="btn btn--primary foot-btn" @tap="openFinish">完工</view>
      </template>
      <template v-else-if="canCollect">
        <view id="wo-pay" class="btn btn--primary foot-btn" @tap="openPay">出示收款码</view>
      </template>
      <template v-else>
        <view class="foot-hint"><text>{{ footHint }}</text></view>
      </template>
    </view>

    <!-- 完工（含现场增项） -->
    <Sheet v-model:show="finishSheet" title="完工登记" sub="处理结果业主可见；现场加项要业主确认后才能结算" max-height="82vh">
      <textarea
        v-model="finishRemark"
        class="textarea"
        :maxlength="140"
        placeholder="例：更换角阀并做打压测试，地面已清理"
        placeholder-class="ph-txt"
      />

      <view v-if="d && d.fee.type === '收费'" class="addon-box">
        <view class="ng__row">
          <text class="fk">现场增项</text>
          <text class="fd">{{ d.addons.length }} 项 · 合计 {{ money(d.addonSum.total) }}</text>
        </view>
        <view class="chips">
          <text
            v-for="a in ADDON_ITEMS"
            :key="a.code"
            :id="`addon-${a.code}`"
            class="chip ad-chip"
            @tap="addThis(a)"
          >{{ a.name }} <text class="ad-chip__p num">+{{ money(a.labor + a.material) }}</text></text>
        </view>
        <view v-for="a in d.addons" :key="'s' + a.code + a.at" class="ad">
          <view class="ad__l">
            <text class="ad__n">{{ a.name }} <text class="ad__q num">×{{ a.qty }}</text></text>
            <text class="ad__d">{{ a.confirmed ? '业主已确认' : '待业主确认' }}</text>
          </view>
          <text class="ad__v num">{{ money(a.total) }}</text>
        </view>
        <view v-if="d.addonSum.pending" class="addon-confirm">
          <text class="addon-confirm__t">增项合计 {{ money(d.addonSum.total) }} 需业主确认后合并到本单</text>
          <view id="addon-owner-confirm" class="btn btn--line btn--sm" @tap="doOwnerConfirm">业主当面确认</view>
          <text class="addon-confirm__d">业主端未上线，这里用「当面确认」桥接：确认后金额合并到本单，与预付款分开结算。</text>
        </view>
      </view>

      <view class="ng__row">
        <text class="fk">现场照片</text>
        <text class="fd">{{ finishPhotos.length }}/3</text>
      </view>
      <PhotoPicker v-model="finishPhotos" :max="3" />
      <view class="sheet__act">
        <view class="btn btn--line" @tap="finishSheet = false">取消</view>
        <view id="wo-finish-confirm" class="btn btn--primary" :class="{ 'btn--disabled': !finishRemark.trim() }" @tap="doFinish">
          确认完工
        </view>
      </view>
    </Sheet>

    <!-- 收款码 -->
    <Sheet v-model:show="paySheet" title="收款" sub="移动端不出收银台：只出示收款码，钱直接进公司账户" max-height="78vh">
      <template v-if="d">
        <view class="qr">
          <view class="qr__box">
            <view class="qr__grid">
              <view
                v-for="(on, i) in qrCells"
                :key="i"
                class="qr__cell"
                :class="{ 'is-on': on }"
              />
            </view>
          </view>
          <text class="qr__tag">演示收款码 · 按工单号生成</text>
          <text class="qr__amt num">{{ money(d.fee.total) }}</text>
          <text class="qr__d">{{ d.row.no }} · {{ d.row.houseName }}</text>
          <text class="qr__d">业主扫码支付，收款方为项目账户，经手人不碰现金</text>
        </view>
        <view class="sheet__act">
          <view class="btn btn--line" @tap="openHang">业主不在 / 挂账</view>
          <view id="pay-qr-confirm" class="btn btn--primary" @tap="doPay">模拟业主支付成功</view>
        </view>
        <text class="pay-note">现金不在此列：收现金要走收银台与日结交班，员工端不提供该入口。</text>
      </template>
    </Sheet>

    <!-- 挂账原因 -->
    <Sheet v-model:show="hangSheet" title="挂账" sub="挂账必须写清原因，否则这单的钱永远没人跟" max-height="52vh">
      <view class="chips">
        <text
          v-for="r in HANG_REASONS"
          :key="r"
          :id="`hang-${r}`"
          class="chip"
          @tap="doHang(r)"
        >{{ r }}</text>
      </view>
    </Sheet>

    <!-- 派单 -->
    <ActionSheet
      v-model:show="dispatchSheet"
      title="派给谁"
      sub="按手上未完结的单排序，负载少的先派"
      :actions="dispatchTargets"
      @select="doDispatch"
    />

    <!-- 转单 -->
    <ActionSheet
      v-model:show="transferSheet"
      title="转给谁"
      sub="转单后回到「已派单」，等对方接"
      :actions="targets"
      @select="doTransfer"
    />

    <!-- 回评 -->
    <Sheet v-model:show="rateSheet" title="业主配合度" sub="内部参考，不对外展示" max-height="60vh">
      <view class="rate-stars">
        <text v-for="n in 5" :key="n" class="rate-star" :class="{ 'is-on': n <= rateScore }" @tap="rateScore = n">★</text>
      </view>
      <view class="chips" style="margin-top: 16rpx">
        <text
          v-for="t in STAFF_EVAL_TAGS"
          :key="t"
          class="chip"
          :class="{ 'is-on': rateTags.includes(t) }"
          @tap="toggleTag(t)"
        >{{ t }}</text>
      </view>
      <textarea v-model="rateNote" class="textarea" style="margin-top: 16rpx" :maxlength="80" placeholder="补充一句（选填）" placeholder-class="ph-txt" />
      <view class="sheet__act">
        <view class="btn btn--line" @tap="rateSheet = false">取消</view>
        <view id="wo-rate-confirm" class="btn btn--primary" @tap="doRate">保存</view>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Cell from '@/components/Cell.vue'
import Sheet from '@/components/Sheet.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import { CAP, can } from '@/config/personas'
import {
  HANG_REASONS,
  STAFF_EVAL_TAGS,
  abandon,
  addAddonItem,
  arrive,
  canDispatch,
  canGrab,
  claim,
  detailOf,
  loadWoDetail,
  dispatchTargets as targetsOf,
  dispatchTo,
  finish,
  grabQuota,
  hangUp,
  ownerConfirmAddons,
  payByQr,
  rateOwner,
  transfer,
  transferTargets
} from '@/api/wo'
import { ADDON_ITEMS, priceOfCode, projectParam } from '@/api/pricing'
import { maskPhone, money } from '@/utils/format'
import { app, persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const id = ref('')
const ver = ref(0)
const revealed = ref(false)
const finishSheet = ref(false)
const finishRemark = ref('')
const finishPhotos = ref([])
const paySheet = ref(false)
const hangSheet = ref(false)
const dispatchSheet = ref(false)
const transferSheet = ref(false)
const rateSheet = ref(false)
const rateScore = ref(5)
const rateTags = ref([])
const rateNote = ref('')

const d = computed(() => (ver.value, id.value ? detailOf(id.value, persona.value) : null))
const canReveal = computed(() => can(persona.value, CAP.sensitive))
const arriveLimit = computed(() => projectParam(persona.value?.communityId).grabArriveMinutes || 15)
const rateText = computed(() => `${Math.round((projectParam(persona.value?.communityId).commissionRate || 0) * 100)}%`)
/* 后台调过价：字典当前价 ≠ 下单快照价，页面上必须说清按哪个结算 */
const priceChanged = computed(() => {
  const p = d.value?.price
  return !!p && p.dictPrice > 0 && Number(p.dictPrice) !== Number(p.total)
})

const payTone = computed(() => ({ 已支付: 'var(--biz-accent)', 未支付: 'var(--biz-danger)', 已挂账: 'var(--biz-warning)' }[d.value?.fee?.payStatus] || 'var(--biz-text-2)'))

const canGrabNow = computed(() => {
  const r = d.value?.row
  if (!r) return false
  return canGrab(persona.value) && r.feeType === '收费' && r.status === '待派单' && !r.assignee
})
const canDispatchNow = computed(() => {
  const r = d.value?.row
  if (!r) return false
  return canDispatch(persona.value, d.value.raw) && ['待派单', '已派单'].includes(r.status)
})
const needArrive = computed(() => {
  const r = d.value?.row
  if (!r) return false
  return r.mine && r.status === '处理中' && !d.value.arriveTime
})
const canFinish = computed(() => {
  const r = d.value?.row
  return !!r && r.mine && r.status === '处理中'
})
const canCollect = computed(() => {
  const r = d.value?.row
  if (!r) return false
  if (r.feeType !== '收费') return false
  if (r.payStatus === '已支付' || r.payStatus === '已挂账') return false
  return r.mine && ['已完工', '待确认', '已评价'].includes(r.status)
})
const canRate = computed(() => {
  const r = d.value?.row
  return !!r && r.mine && ['已完工', '已关闭', '已评价'].includes(r.status) && !d.value?.staffEval
})
const footHint = computed(() => {
  const r = d.value?.row
  if (!r) return ''
  if (['已关闭', '已取消'].includes(r.status)) return `工单${r.status}，只能查看`
  if (r.status === '已评价') return '已评价，流程结束'
  if (r.status === '已完工') return r.feeType === '收费' && r.payStatus !== '已支付' ? '已完工，等收款' : '已完工，等业主确认或评价'
  if (r.status === '待确认') return '等业主确认增项，计时已停'
  if (r.status === '已派单') return r.mine ? '已派给你，接单后可完工' : `由 ${r.assignee} 处理`
  if (!r.mine) return r.assignee ? `由 ${r.assignee} 处理中` : '待派单给具体的人'
  return ''
})
/**
 * 收款码占位：不接真支付通道，但要"看起来像二维码"，否则评审时像块噪点。
 * 21×21 网格 + 三个定位角，图案由工单号做种子，同一单每次一致。
 */
const qrCells = computed(() => {
  const N = 21
  const seed = String(d.value?.row?.no || 'BX').split('').reduce((s, c) => s + c.charCodeAt(0), 0)
  const finder = (r, c) => {
    const inBox = (r0, c0) => r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7
    const box = inBox(0, 0) || inBox(0, N - 7) || inBox(N - 7, 0)
    if (!box) return null
    const rr = r < 7 ? r : r - (N - 7)
    const cc = c < 7 ? c : c - (N - 7)
    const edge = rr === 0 || rr === 6 || cc === 0 || cc === 6
    const core = rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4
    return edge || core
  }
  const out = []
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const f = finder(r, c)
      if (f !== null) {
        out.push(f)
        continue
      }
      /* 定位块周围的留白 */
      const nearBox =
        (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8)
      if (nearBox) {
        out.push(false)
        continue
      }
      out.push(((r * 31 + c * 17 + seed) % 7) % 3 === 0)
    }
  }
  return out
})

const targets = computed(() => (id.value ? transferTargets(persona.value, id.value) : []))
const dispatchTargets = computed(() => (id.value ? targetsOf(persona.value, id.value) : []))
/* 已指派的人还在等接单时，这个按钮就是「改派」，别让项目经理以为没派出去 */
const dispatchLabel = computed(() => (d.value?.row?.assignee ? '改派' : '派给维修工'))

/**
 * 拉详情再重算。HTTP 模式下 `detailOf` 读的是缓存，
 * 不先 await 这一下，页面首帧会是空的（金额、增项、时间线全没有）。
 */
async function loadDetail() {
  if (!id.value) return
  try {
    await loadWoDetail(id.value, persona.value)
  } catch (e) {
    toastErr(e?.message || '工单加载失败')
  }
  ver.value++
}

onLoad(async o => {
  id.value = o.id || ''
  await loadDetail()
})

/* 同路由换 id 时 uni 的 H5 路由复用组件（与业主房屋、审批详情同一个坑）：监听 hash 同步 */
onMounted(() => {
  // #ifdef H5
  const syncFromHash = () => {
    const m = String(location.hash || '').match(/[?&]id=([^&]+)/)
    if (!m) return
    const next = decodeURIComponent(m[1])
    if (next !== id.value) {
      id.value = next
      loadDetail()
    }
  }
  syncFromHash()
  window.addEventListener('hashchange', syncFromHash)
  onUnmounted(() => window.removeEventListener('hashchange', syncFromHash))
  // #endif
})

onShow(async () => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  await loadDetail()
})

/** 写操作之后统一走这里：先把最新详情拉回来，再触发重算 */
async function refresh() {
  await loadDetail()
}

async function doGrab() {
  try {
    await claim(id.value, persona.value)
    await refresh()
    toastOk(`抢到了，${arriveLimit.value} 分钟内到场`)
  } catch (e) {
    /* 失败也要刷新：多半是被别人抢走了，页面该显示"已派给 XX" */
    await refresh()
    toastErr(e?.message || '抢单失败')
  }
}

async function doArrive() {
  try {
    const r = await arrive(id.value, persona.value)
    await refresh()
    toastOk(r.late ? '已到场（超时，已记录迟到）' : '已到场打卡')
  } catch (e) {
    toastErr(e?.message || '打卡失败')
  }
}

async function doAbandon() {
  try {
    const r = await abandon(id.value, persona.value)
    await refresh()
    toastErr(`已放弃，退回抢单池（今日弃单 ${r.used}/${r.limit}）`)
    setTimeout(() => uni.navigateBack(), 600)
  } catch (e) {
    toastErr(e?.message || '操作失败')
  }
}

function openDispatch() {
  if (!dispatchTargets.value.length) {
    toastErr('本项目没有可派的维修工')
    return
  }
  dispatchSheet.value = true
}

async function doDispatch(name) {
  try {
    await dispatchTo(id.value, name, persona.value, '客服受理后指派')
    dispatchSheet.value = false
    await refresh()
    toastOk(`已派给 ${name}，等他接单`)
  } catch (e) {
    toastErr(e?.message || '派单失败')
  }
}

function openFinish() {
  finishRemark.value = ''
  finishPhotos.value = []
  finishSheet.value = true
}

async function addThis(item) {
  try {
    await addAddonItem(id.value, item.code, 1, persona.value, priceOfCode(item.code) || item)
    await refresh()
  } catch (e) {
    toastErr(e?.message || '添加失败')
  }
}

async function doOwnerConfirm() {
  try {
    await ownerConfirmAddons(id.value)
    await refresh()
    toastOk('业主已确认，增项合并到本单')
  } catch (e) {
    toastErr(e?.message || '确认失败')
  }
}

async function doFinish() {
  if (!finishRemark.value.trim()) {
    toastErr('完工要写处理结果')
    return
  }
  try {
    await finish(id.value, { remark: finishRemark.value.trim(), photos: finishPhotos.value.length, persona: persona.value })
    finishSheet.value = false
    await refresh()
    toastOk('已完工')
  } catch (e) {
    toastErr(e?.message || '完工失败')
  }
}

function openPay() {
  paySheet.value = true
}

async function doPay() {
  try {
    await payByQr(id.value, persona.value, '微信支付')
    paySheet.value = false
    await refresh()
    toastOk('业主已支付，提成转入已结')
  } catch (e) {
    toastErr(e?.message || '收款失败')
  }
}

function openHang() {
  paySheet.value = false
  hangSheet.value = true
}

async function doHang(reason) {
  try {
    await hangUp(id.value, reason)
    hangSheet.value = false
    await refresh()
    toastOk(`已挂账：${reason}`)
  } catch (e) {
    toastErr(e?.message || '挂账失败')
  }
}

function openTransfer() {
  if (!targets.value.length) {
    toastErr('没有可转的人')
    return
  }
  transferSheet.value = true
}

async function doTransfer(name) {
  try {
    await transfer(id.value, name, '现场情况不匹配')
    await refresh()
    toastOk(`已转给 ${name}`)
  } catch (e) {
    toastErr(e?.message || '转单失败')
  }
}

/* 入户单要给师傅拨号权限：没有 a.sensitive.view 的岗位，拨号即视为对「本单业主」的一次揭示并留痕 */
function revealByCall() {
  revealed.value = true
  toastOk('已揭示本单业主号码（记录访问日志）')
}

function openRate() {
  rateScore.value = 5
  rateTags.value = []
  rateNote.value = ''
  rateSheet.value = true
}

function toggleTag(t) {
  const i = rateTags.value.indexOf(t)
  if (i >= 0) rateTags.value.splice(i, 1)
  else rateTags.value.push(t)
}

async function doRate() {
  try {
    await rateOwner(id.value, { score: rateScore.value, tags: rateTags.value, note: rateNote.value.trim() })
    rateSheet.value = false
    await refresh()
    toastOk('已记录')
  } catch (e) {
    toastErr(e?.message || '保存失败')
  }
}
</script>

<style scoped>
.head.is-urgent {
  border: 2rpx solid rgba(255, 107, 107, 0.24);
}

.head__top {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.pri {
  font-size: 19rpx;
  border: 2rpx solid currentColor;
  border-radius: 8rpx;
  padding: 3rpx 10rpx;
}

.status {
  font-size: 22rpx;
  font-weight: 600;
}

.mode {
  font-size: 18rpx;
  color: var(--biz-warning);
  background: #fff7ed;
  border-radius: 6rpx;
  padding: 2rpx 8rpx;
}

.overdue {
  font-size: 19rpx;
  color: #fff;
  background: var(--biz-danger);
  border-radius: 999rpx;
  padding: 3rpx 12rpx;
}

.head__t {
  display: block;
  margin-top: 16rpx;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.35;
  color: var(--biz-text-1);
}

.head__loc {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 23rpx;
  color: var(--biz-text-2);
}

.head__pin {
  color: var(--biz-primary);
}

.head__time {
  margin-top: 20rpx;
  display: flex;
  gap: 12rpx;
}

.ht {
  flex: 1;
  background: var(--biz-bg-fill);
  border-radius: 12rpx;
  padding: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.ht__k {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.ht__v {
  font-size: 23rpx;
  color: var(--biz-text-1);
}

.arrive-tip {
  margin-top: 16rpx;
  padding: 14rpx 16rpx;
  border-radius: 12rpx;
  background: #fff7ed;
  border: 2rpx solid #ffe2bd;
}

.arrive-tip.is-late {
  background: #fff0f0;
  border-color: #ffd0d0;
}

.arrive-tip__t {
  display: block;
  font-size: 23rpx;
  font-weight: 600;
  color: #a35c13;
}

.arrive-tip.is-late .arrive-tip__t {
  color: var(--biz-danger);
}

.arrive-tip__d {
  display: block;
  margin-top: 6rpx;
  font-size: 19rpx;
  color: #b8814a;
  line-height: 1.55;
}

.desc {
  display: block;
  font-size: 24rpx;
  color: var(--biz-text-2);
  line-height: 1.7;
}

.desc.muted {
  color: var(--biz-text-4);
  font-size: 22rpx;
}

.ph-row {
  margin-top: 16rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.ph {
  width: 120rpx;
  height: 120rpx;
  border-radius: 14rpx;
  background: var(--biz-bg-fill);
  border: 2rpx dashed var(--biz-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.ph-more {
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.ph-none {
  font-size: 21rpx;
  color: var(--biz-text-4);
}

.price {
  padding: 16rpx;
  border-radius: 14rpx;
  background: var(--biz-bg-fill);
  margin-bottom: 16rpx;
}

.price__hd {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.price__code {
  font-size: 18rpx;
  color: var(--biz-primary);
  background: #fff;
  border-radius: 6rpx;
  padding: 2rpx 8rpx;
}

.price__name {
  flex: 1;
  min-width: 0;
  font-size: 24rpx;
  color: var(--biz-text-1);
  font-weight: 600;
}

.price__row {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
}

.price__k {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.price__v {
  font-size: 22rpx;
  color: var(--biz-text-2);
  margin-right: 12rpx;
}

.price__diff {
  margin-top: 10rpx;
  padding: 10rpx 12rpx;
  border-radius: 10rpx;
  background: #fff7ed;
}

.price__diff-t {
  font-size: 18rpx;
  color: #a35c13;
  line-height: 1.55;
}

.price__note {
  display: block;
  margin-top: 10rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.fee {
  display: flex;
  gap: 12rpx;
}

.fee__i {
  flex: 1;
  background: var(--biz-bg-fill);
  border-radius: 12rpx;
  padding: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.fee__k {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.fee__v {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.fee__v.is-total {
  color: var(--biz-danger);
}

.pay-line {
  margin-top: 14rpx;
  padding: 12rpx 0;
  border-top: 2rpx solid var(--biz-border-light);
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
}

.pay-line__k {
  font-size: 23rpx;
  color: var(--biz-text-3);
}

.pay-line__v {
  font-size: 24rpx;
  font-weight: 600;
}

.pay-line__d {
  width: 100%;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.addons {
  margin-top: 14rpx;
  padding-top: 14rpx;
  border-top: 2rpx dashed var(--biz-border-light);
}

.addons__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.addons__t {
  font-size: 23rpx;
  font-weight: 600;
  color: var(--biz-text-2);
}

.addons__n {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.addons__none {
  display: block;
  margin-top: 8rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.55;
}

.ad {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 10rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.ad:last-child {
  border-bottom: none;
}

.ad.is-pending .ad__n {
  color: #a35c13;
}

.ad__l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}

.ad__n {
  font-size: 23rpx;
  color: var(--biz-text-1);
}

.ad__q {
  font-size: 19rpx;
  color: var(--biz-text-3);
}

.ad__d {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.ad__v {
  font-size: 23rpx;
  color: var(--biz-text-1);
}

.comm-line {
  margin-top: 14rpx;
  padding: 14rpx 16rpx;
  border-radius: 14rpx;
  background: linear-gradient(135deg, #fff7ed 0%, #fff 80%);
  border: 2rpx solid #ffe2bd;
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.comm-line__l {
  flex: 1;
  min-width: 0;
}

.comm-line__k {
  display: block;
  font-size: 22rpx;
  color: #a35c13;
  font-weight: 600;
}

.comm-line__d {
  display: block;
  margin-top: 4rpx;
  font-size: 18rpx;
  color: #b8814a;
  line-height: 1.45;
}

.comm-line__r {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2rpx;
}

.comm-line__v {
  font-size: 34rpx;
  color: #d97706;
  line-height: 1.1;
}

.comm-line__s {
  font-size: 18rpx;
  color: var(--biz-warning);
}

.comm-line__s.is-settled {
  color: var(--biz-accent);
}

.cell-phone {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 22rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.cell-phone__k {
  width: 160rpx;
  font-size: 26rpx;
  color: var(--biz-text-3);
  flex: none;
}

.cell-phone__v {
  flex: 1;
  text-align: right;
  font-size: 27rpx;
  color: var(--biz-text-2);
}

.cell-phone__act {
  flex: none;
  font-size: 21rpx;
  color: var(--biz-primary);
  padding: 6rpx 14rpx;
  border-radius: 999rpx;
  background: var(--biz-primary-light-9);
}

.stars {
  font-size: 30rpx;
  color: var(--biz-warning);
  letter-spacing: 4rpx;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 12rpx;
}

.chip {
  font-size: 21rpx;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background: var(--biz-bg-fill);
  color: var(--biz-text-2);
  border: 2rpx solid transparent;
}

.chip.is-staff {
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-color: var(--biz-primary-light-8);
}

.chip.is-on {
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-color: var(--biz-primary);
  font-weight: 600;
}

.ad-chip {
  border-color: var(--biz-border-light);
}

.ad-chip__p {
  font-size: 18rpx;
  color: #d97706;
}

.addon-box {
  margin-top: 18rpx;
  padding: 16rpx;
  border-radius: 14rpx;
  background: var(--biz-bg-fill);
}

.addon-confirm {
  margin-top: 14rpx;
  padding: 14rpx;
  border-radius: 12rpx;
  background: #fff7ed;
  border: 2rpx solid #ffe2bd;
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
}

.addon-confirm__t {
  flex: 1;
  min-width: 300rpx;
  font-size: 21rpx;
  color: #a35c13;
  line-height: 1.5;
}

.addon-confirm__d {
  width: 100%;
  font-size: 18rpx;
  color: #b8814a;
  line-height: 1.5;
}

.rate-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 20rpx;
  background: var(--biz-primary-light-9);
  border-radius: 14rpx;
  font-size: 24rpx;
  color: var(--biz-primary);
}

.chev {
  width: 14rpx;
  height: 14rpx;
  border-top: 3rpx solid var(--biz-primary);
  border-right: 3rpx solid var(--biz-primary);
  transform: rotate(45deg);
}

.foot-btn {
  flex: 1;
}

.grab-hint {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  margin-right: 16rpx;
}

.grab-hint__t {
  font-size: 24rpx;
  font-weight: 600;
  color: #d97706;
}

.grab-hint__d {
  font-size: 19rpx;
  color: var(--biz-text-3);
}

.foot-hint {
  flex: 1;
  font-size: 23rpx;
  color: var(--biz-text-3);
  text-align: center;
  line-height: 1.5;
}

.ng__row {
  display: flex;
  align-items: center;
  margin: 18rpx 0 10rpx;
}

.fk {
  font-size: 23rpx;
  color: var(--biz-text-2);
  font-weight: 600;
}

.fd {
  margin-left: auto;
  font-size: 21rpx;
  color: var(--biz-text-4);
}

.sheet__act {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}

.sheet__act .btn {
  flex: 1;
  height: 84rpx;
  font-size: 27rpx;
}

.rate-stars {
  display: flex;
  justify-content: center;
  gap: 16rpx;
  padding: 10rpx 0;
}

.rate-star {
  font-size: 56rpx;
  color: var(--biz-border);
}

.rate-star.is-on {
  color: var(--biz-warning);
}

.qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
}

.qr__box {
  width: 300rpx;
  height: 300rpx;
  flex: none;
  flex: none;
  border-radius: 16rpx;
  background: #fff;
  border: 2rpx solid var(--biz-border-light);
  padding: 18rpx;
}

.qr__grid {
  width: 100%;
  height: 100%;
  display: flex;
  flex-wrap: wrap;
}

.qr__cell {
  width: 4.7619%;
  height: 4.7619%;
  background: transparent;
}

.qr__cell.is-on {
  background: #1f2937;
}

.qr__amt {
  font-size: 44rpx;
  color: var(--biz-text-1);
  font-weight: 700;
}

.qr__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
  text-align: center;
}

.qr__tag {
  font-size: 17rpx;
  color: var(--biz-text-4);
  background: var(--biz-bg-fill);
  border-radius: 999rpx;
  padding: 3rpx 14rpx;
}

.qr__tag {
  font-size: 17rpx;
  color: var(--biz-text-4);
  background: var(--biz-bg-fill);
  border-radius: 999rpx;
  padding: 3rpx 14rpx;
}

.pay-note {
  display: block;
  margin: 14rpx 0 8rpx;
  padding-bottom: 4rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.55;
}

.ph-txt {
  color: var(--biz-text-4);
}
</style>
