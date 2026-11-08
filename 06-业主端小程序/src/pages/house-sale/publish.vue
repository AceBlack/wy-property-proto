<!--
  发布租售（§13.6）
  ------------------------------------------------------------
  只让业主发：租户只有使用权、家属需显式授权（一期不做）。
  产权校验在**进入页面时**做一次、提交时再做一次 —— 不能等到审核才拦：
  审核员看到「张**」判断不了他是房主还是租客（§13.3）。

  表单只填 5 项：价格 / 装修 / 配套 / 描述 / 图片。
  **面积、户型、朝向、楼层从档案带出且只读** —— 从设计上消灭"虚标面积"，
  也直接省掉审核的一半工作量：业主改不了，审核员也不用核对。
-->
<template>
  <view class="page">
    <NavBar title="发布租售" subtitle="业主本人发布 · 楼管审核" />
    <view class="body">
      <Empty v-if="!allowed" text="这项功能需要业主本人使用" sub="租户与家属暂不能发布；可让业主本人操作或联系楼管" />

      <template v-else>
        <!-- 照片正误对照：首屏就必须看到 -->
        <view class="card pub__rule">
          <text class="pub__rule-t">这张图能不能让陌生人找到你家？</text>
          <view class="pub__rule-grid">
            <view class="pub__rule-col pub__rule-col--bad">
              <text class="pub__rule-h">❌ 不要拍</text>
              <text class="pub__rule-i">门牌号 / 单元号</text>
              <text class="pub__rule-i">邻居家门、对门、楼道</text>
              <text class="pub__rule-i">能看出是哪栋的窗外远景</text>
              <text class="pub__rule-i">家庭合照、快递单、证件</text>
            </view>
            <view class="pub__rule-col pub__rule-col--ok">
              <text class="pub__rule-h">✅ 只拍</text>
              <text class="pub__rule-i">室内整体与采光</text>
              <text class="pub__rule-i">家具家电</text>
              <text class="pub__rule-i">厨房 / 卫生间</text>
              <text class="pub__rule-i">窗外远景（不露楼栋）</text>
            </view>
          </view>
          <text class="pub__rule-d">拍到门牌与楼道会被驳回 —— 驳回理由会原样显示在「我的挂牌」里。</text>
        </view>

        <!-- 选房 -->
        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">选择要出租的房</text><text class="sec-hd__d">名下房产</text></view>
          <view
            v-for="h in houses"
            :key="h.houseId"
            class="opt"
            :class="{ 'is-active': houseId === h.houseId, 'is-disabled': h.blocked }"
            @tap="pickHouse(h)"
          >
            <view class="opt__body">
              <text class="opt__t">{{ h.communityName }} {{ h.buildingName }}{{ h.unitName }}{{ h.room }}</text>
              <text class="opt__d">{{ h.houseType }} · {{ h.area }}㎡ · {{ h.orientation }} · {{ h.floor }} 层</text>
              <text v-if="h.blocked" class="opt__d danger">{{ h.blockedReason }}</text>
            </view>
            <view class="opt__check" />
          </view>
          <Empty v-if="!houses.length" text="名下没有可发布的房" sub="需要先完成业主认证" />
        </view>

        <!-- 只读档案 -->
        <view v-if="cur" class="card">
          <view class="sec-hd"><text class="sec-hd__t">房屋档案</text><text class="sec-hd__d">只读，不可修改</text></view>
          <view class="pub__rows">
            <view class="pub__r"><text class="pub__k">小区</text><text class="pub__v">{{ cur.communityName }}</text></view>
            <view class="pub__r"><text class="pub__k">楼栋</text><text class="pub__v">{{ cur.buildingName }}</text></view>
            <view class="pub__r"><text class="pub__k">户型</text><text class="pub__v">{{ cur.houseType }}</text></view>
            <view class="pub__r"><text class="pub__k">面积</text><text class="pub__v">{{ cur.area }} ㎡</text></view>
            <view class="pub__r"><text class="pub__k">朝向</text><text class="pub__v">{{ cur.orientation }}</text></view>
            <view class="pub__r"><text class="pub__k">楼层</text><text class="pub__v">第 {{ cur.floor }} 层</text></view>
          </view>
          <text class="pub__note">面积 / 户型 / 朝向 / 楼层由房屋档案带出，业主不可修改。</text>
        </view>

        <template v-if="cur">
          <!-- 价格 -->
          <view class="card">
            <view class="field">
              <view class="field__k"><text>期望租金</text><text class="field__hint">元 / 月</text></view>
              <input v-model="form.price" class="field__input field__input--boxed" type="digit" placeholder="例如 2800" placeholder-class="ph" />
            </view>
            <view class="field">
              <view class="field__k"><text>押付方式</text></view>
              <view class="chips">
                <text v-for="t in PAY_TERMS" :key="t" class="chip" :class="{ 'is-on': form.payTerm === t }" @tap="form.payTerm = t">{{ t }}</text>
              </view>
            </view>
            <view class="field">
              <view class="field__k"><text>可入住时间</text></view>
              <view class="chips">
                <text v-for="t in AVAILABLE" :key="t.value" class="chip" :class="{ 'is-on': form.availableFrom === t.value }" @tap="form.availableFrom = t.value">{{ t.label }}</text>
              </view>
            </view>
          </view>

          <!-- 装修 / 配套 -->
          <view class="card">
            <view class="field">
              <view class="field__k"><text>装修</text></view>
              <view class="chips">
                <text v-for="d in DECORATES" :key="d" class="chip" :class="{ 'is-on': form.decorate === d }" @tap="form.decorate = d">{{ d }}</text>
              </view>
            </view>
            <view class="field">
              <view class="field__k"><text>配套</text><text class="field__hint">{{ form.facilities.length }}/6</text></view>
              <view class="chips">
                <text v-for="f in FACILITIES" :key="f" class="chip" :class="{ 'is-on': form.facilities.includes(f) }" @tap="toggleFac(f)">{{ f }}</text>
              </view>
            </view>
          </view>

          <!-- 描述 -->
          <view class="card">
            <view class="field">
              <view class="field__k"><text>房源描述</text><text class="field__hint">{{ form.desc.length }}/300</text></view>
              <textarea v-model="form.desc" class="textarea pub__text" maxlength="300" placeholder="交通、周边、适合什么样的租客；不要写门牌与议价" placeholder-class="ph" />
            </view>
          </view>

          <!-- 图片 -->
          <view class="card">
            <view class="sec-hd"><text class="sec-hd__t">照片</text><text class="sec-hd__d">1~9 张</text></view>
            <PhotoPicker v-model="photos" :max="9" />
          </view>

          <view v-if="err" class="banner banner--offline">
            <view class="banner__ico"><text>!</text></view>
            <text class="banner__t">{{ err }}</text>
          </view>

          <view class="pub__tip">
            <text class="demo-tip">说明</text>
            <text class="pub__tip-t">
              提交后进入「待审核」，由本房责任楼管审核（24 小时未审会升到上级）。
              只做信息发布：平台不代收租金、不收佣金、不参与议价与成交。
              60 天后自动过期，内容没改可以直接续挂（免二次审核）。
            </text>
          </view>
        </template>
      </template>
    </view>

    <Bar
      v-if="allowed && cur"
      label="提交后"
      hint="待审核 · 楼管审核后展示"
      okText="提交审核"
      :disabled="!canSubmit"
      btn-id="listing-submit"
      @submit="submit"
    />
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Empty from '@/components/Empty.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import { publishableHouses, publishListing } from '@/api/listing'
import { identity } from '@/store/app'
import { DEMO } from '@/config/demo'
import { toastErr } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const PAY_TERMS = ['押一付三', '押二付一', '半年付', '年付']
const DECORATES = ['毛坯', '简装', '精装', '豪装']
const FACILITIES = ['冰箱', '洗衣机', '空调', '热水器', '宽带', '家私']
const AVAILABLE = [
  { value: DEMO.today, label: '随时入住' },
  { value: '2026-11-01', label: '11 月初' },
  { value: '2026-11-15', label: '11 月中' },
  { value: '2026-12-01', label: '12 月起' }
]

const allowed = ref(false)
const houses = ref([])
const houseId = ref('')
const photos = ref([])
const err = ref('')
const form = reactive({
  price: '',
  payTerm: '押一付三',
  availableFrom: DEMO.today,
  decorate: '简装',
  facilities: ['空调', '热水器'],
  desc: ''
})

const cur = computed(() => houses.value.find(h => h.houseId === houseId.value) || null)
const canSubmit = computed(() => !!cur.value && Number(form.price) >= 500 && photos.value.length > 0)

onLoad(() => {
  if (!gateOwner('发布租售')) return
  if (identity.value !== '业主') {
    uni.showModal({
      title: '仅业主本人可发布',
      content: '租户只有使用权、家属需业主显式授权（一期不做）。请让业主本人操作，或直接联系楼栋管家。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#5b6cff',
      success: () => uni.navigateBack()
    })
    return
  }
  allowed.value = true
  houses.value = publishableHouses()
  const first = houses.value.find(h => !h.blocked)
  if (first) houseId.value = first.houseId
})

function pickHouse(h) {
  if (h.blocked) {
    uni.showToast({ title: h.blockedReason, icon: 'none' })
    return
  }
  houseId.value = h.houseId
}

function toggleFac(f) {
  const i = form.facilities.indexOf(f)
  if (i >= 0) form.facilities.splice(i, 1)
  else if (form.facilities.length < 6) form.facilities.push(f)
}

async function submit() {
  err.value = ''
  try {
    await publishListing({
      houseId: houseId.value,
      price: form.price,
      deposit: Number(form.price),
      payTerm: form.payTerm,
      decorate: form.decorate,
      facilities: form.facilities,
      availableFrom: form.availableFrom,
      desc: form.desc,
      images: photos.value.length
    })
    uni.showModal({
      title: '已提交审核',
      content: '本房责任楼管会审核内容与照片（24 小时内）。审核中可以在「我的挂牌」看到进度与驳回理由。',
      showCancel: false,
      confirmText: '知道了',
      success: () => uni.redirectTo({ url: '/pages/house-sale/mine' })
    })
  } catch (e) {
    err.value = e.message || '提交失败'
    toastErr(err.value)
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 230rpx; }

.pub__rule { background: #fffdf9; border: 2rpx solid rgba(255, 159, 64, 0.35); box-shadow: none; }
.pub__rule-t { font-size: 26rpx; font-weight: 700; color: #a35c13; }
.pub__rule-grid { display: flex; gap: 14rpx; margin-top: 14rpx; }
.pub__rule-col { flex: 1; border-radius: 12rpx; padding: 14rpx 16rpx; }
.pub__rule-col--bad { background: #fff1f2; }
.pub__rule-col--ok { background: #eefaf3; }
.pub__rule-h { font-size: 21rpx; font-weight: 700; color: var(--biz-text-1); }
.pub__rule-i { display: block; margin-top: 6rpx; font-size: 19rpx; color: var(--biz-text-2); line-height: 1.5; }
.pub__rule-d { display: block; margin-top: 12rpx; font-size: 20rpx; color: #8a5a1e; line-height: 1.6; }

.pub__rows { display: flex; flex-wrap: wrap; }
.pub__r { width: 50%; display: flex; gap: 12rpx; padding: 8rpx 0; }
.pub__k { width: 90rpx; flex: none; font-size: 22rpx; color: var(--biz-text-3); }
.pub__v { flex: 1; font-size: 23rpx; color: var(--biz-text-1); }
.pub__note { display: block; margin-top: 10rpx; font-size: 20rpx; color: var(--biz-text-4); line-height: 1.6; }
.pub__text { margin-top: 6rpx; height: 180rpx; }

.pub__tip { margin-top: 22rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.pub__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }

.opt.is-disabled { opacity: 0.55; }
.danger { color: var(--biz-danger) !important; }
</style>
