<!--
  发布闲置（§12.2 第 5 条）
  ------------------------------------------------------------
  · **先审后发**：提交后状态「审核中」，员工端（客服/楼管）审完才上架；
  · 位置只选到**楼栋**，页面也明说"不显示门牌"——业主填的时候就知道别人看到什么；
  · 联系方式默认「站内私信」，手机号不公开（§12.3 第 4 条）；
  · 内容安全只做了"明显违规词"这一道，真实环境要接微信 msgSecCheck（页面里写明，不假装做了）。
-->
<template>
  <view class="page">
    <NavBar title="发布闲置" subtitle="审核通过后邻居可见" />
    <view class="body">
      <view class="card">
        <view class="field">
          <view class="field__k"><text>标题</text><text class="field__hint">{{ title.length }}/30</text></view>
          <input v-model="title" class="field__input field__input--boxed" maxlength="30" placeholder="例如：九成新婴儿推车，自提" placeholder-class="ph" />
        </view>

        <view class="field">
          <view class="field__k"><text>分类</text></view>
          <view class="ip__chips">
            <view v-for="c in CATS" :key="c" class="chip" :class="{ 'is-on': cat === c }" @tap="cat = c"><text>{{ c }}</text></view>
          </view>
        </view>

        <view class="field">
          <view class="field__k"><text>成色</text></view>
          <view class="ip__chips">
            <view v-for="c in CONDITIONS" :key="c" class="chip" :class="{ 'is-on': cond === c }" @tap="cond = c"><text>{{ c }}</text></view>
          </view>
        </view>

        <view class="field">
          <view class="field__k"><text>价格</text><text class="field__hint">送人填 0</text></view>
          <input v-model="price" class="field__input field__input--boxed" type="digit" placeholder="元" placeholder-class="ph" />
        </view>

        <view class="field">
          <view class="field__k"><text>描述</text><text class="field__hint">{{ desc.length }}/300</text></view>
          <textarea v-model="desc" class="textarea ip__text" maxlength="300" placeholder="用多久了、有没有瑕疵、怎么自提" placeholder-class="ph" />
        </view>
      </view>

      <!-- 图片 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">照片（最多 9 张）</text>
          <text class="sec-hd__d">至少 1 张</text>
        </view>
        <PhotoPicker v-model="photos" :max="9" />
        <view class="ip__rule">
          <text class="ip__rule-t">这张图能不能让陌生人找到你家？</text>
          <text class="ip__rule-d">
            只拍物品与室内；**不要拍到门牌号、单元号、邻居家门、楼道**，也不要拍窗外的具体楼栋。
            拍到了会被驳回 —— 驳回理由会原样显示在「我发布的」里。
          </text>
        </view>
      </view>

      <!-- 位置 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">所在楼栋</text>
          <text class="sec-hd__d">不显示门牌</text>
        </view>
        <view v-for="b in builds" :key="b.buildingId" class="opt" :class="{ 'is-active': buildingId === b.buildingId }" @tap="buildingId = b.buildingId">
          <view class="opt__body">
            <text class="opt__t">{{ b.communityName }} {{ b.name }}</text>
            <text class="opt__d">邻居只会看到「{{ b.name }}」，看不到房号</text>
          </view>
          <view class="opt__check" />
        </view>
        <Empty v-if="!builds.length" text="还没有可发布的楼栋" sub="发布闲置需要先完成业主认证（名下有房）" />
      </view>

      <!-- 联系方式 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">联系方式</text>
          <text class="sec-hd__d">手机号默认不公开</text>
        </view>
        <view class="opt" :class="{ 'is-active': contact === '站内私信' }" @tap="contact = '站内私信'">
          <view class="opt__body">
            <text class="opt__t">站内私信</text>
            <text class="opt__d">邻居发私信，你决定怎么回；号码不外露</text>
          </view>
          <view class="opt__check" />
        </view>
        <view class="opt" :class="{ 'is-active': contact === '公开' }" @tap="contact = '公开'">
          <view class="opt__body">
            <text class="opt__t">公开手机号</text>
            <text class="opt__d">方便但会被所有人看到，建议选站内私信</text>
          </view>
          <view class="opt__check" />
        </view>
      </view>

      <view v-if="err" class="banner banner--offline">
        <view class="banner__ico"><text>!</text></view>
        <text class="banner__t">{{ err }}</text>
      </view>

      <view class="ip__note">
        <text class="demo-tip">说明</text>
        <text class="ip__note-t">
          提交后状态是「审核中」，由员工端审核（通常 24 小时内）。审核通过才上架；
          被驳回会带理由，改完可以重新提交。平台不代收、不担保，交易请当面验货。
        </text>
      </view>
    </view>

    <Bar label="提交后" hint="审核中 · 通常 24 小时内" okText="提交审核" :disabled="!canSubmit" btn-id="item-submit" @submit="submit" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Empty from '@/components/Empty.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import { ITEM_CATS, myBuildings, publishItem } from '@/api/neighbor'
import { go, toastErr } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const CATS = ITEM_CATS.filter(c => c !== '全部')
const CONDITIONS = ['全新', '几乎全新', '九成新', '八成新', '七成新']

const title = ref('')
const cat = ref('其他')
const cond = ref('九成新')
const price = ref('')
const desc = ref('')
const photos = ref([])
const buildingId = ref('')
const contact = ref('站内私信')
const builds = ref([])
const err = ref('')

onLoad(() => {
  if (!gateOwner('发布闲置')) return
  builds.value = myBuildings()
  if (builds.value.length) buildingId.value = builds.value[0].buildingId
})

const canSubmit = computed(
  () => title.value.trim().length >= 4 && price.value !== '' && photos.value.length > 0 && !!buildingId.value
)

async function submit() {
  err.value = ''
  try {
    await publishItem({
      title: title.value,
      category: cat.value,
      condition: cond.value,
      price: Number(price.value) || 0,
      desc: desc.value,
      images: photos.value.length,
      buildingId: buildingId.value,
      communityId: builds.value.find(b => b.buildingId === buildingId.value)?.communityId || '',
      contactMode: contact.value
    })
    uni.showModal({
      title: '已提交审核',
      content: '通常 24 小时内出结果。审核中可以在「邻里 → 我的 → 我发布的」里看到进度。',
      showCancel: false,
      confirmText: '知道了',
      success: () => uni.redirectTo({ url: '/pages/neighbor/my?tab=item' })
    })
  } catch (e) {
    err.value = e.message || '提交失败'
    toastErr(err.value)
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 220rpx; }

.ip__chips { display: flex; flex-wrap: wrap; gap: 12rpx; }
.ip__text { margin-top: 6rpx; height: 170rpx; }

.ip__rule { margin-top: 16rpx; padding: 18rpx 20rpx; background: #fff8f0; border-radius: 14rpx; }
.ip__rule-t { font-size: 23rpx; font-weight: 700; color: #a35c13; }
.ip__rule-d { display: block; margin-top: 8rpx; font-size: 21rpx; color: #8a5a1e; line-height: 1.65; }

.ip__note { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.ip__note-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
