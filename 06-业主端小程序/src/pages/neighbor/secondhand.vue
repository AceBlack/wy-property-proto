<!--
  闲置详情（§12.2 第 4 条）
  ------------------------------------------------------------
  改版要点：**去掉公开评论区**，只留「想要 / 私信」。
  一旦有业主对业主的公开回帖，类目就往【社交-社区/论坛】靠 —— 这条是红线。
  展示只到**楼栋**（`buildingText`），不显示门牌；手机号默认不公开。
-->
<template>
  <view class="page">
    <NavBar title="闲置详情" :subtitle="item?.category || ''" />
    <view class="body" :class="{ 'body--with-foot': !!item }">
      <Empty v-if="!item" text="宝贝不存在或已下架" />

      <template v-else>
        <Cover :cover="item.cover" h="360rpx" :badge="item.condition" :label="item.category" />

        <view class="card sh">
          <view class="sh__f">
            <text class="sh__p">{{ item.price > 0 ? `¥${item.price}` : '免费送' }}</text>
            <text v-if="item.originPrice" class="sh__o">原价 ¥{{ item.originPrice }}</text>
            <Tag :text="item.status" size="sm" :color="item.status === '已上架' ? 'var(--biz-accent-dark)' : 'var(--biz-text-3)'" />
          </view>
          <text class="sh__t">{{ item.title }}</text>
          <text class="sh__d">{{ item.desc }}</text>
          <view class="sh__meta">
            <text>卖家 {{ item.sellerName }} · {{ item.buildingText }}</text>
            <text>{{ item.views }} 浏览 · {{ item.wantCount }} 想要</text>
          </view>
        </view>

        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">交易方式</text><text class="sec-hd__d">{{ item.contactMode === '公开' ? '卖家公开了手机号' : '站内私信' }}</text></view>
          <text class="sh__note">· 平台不代收、不担保：看好物品当面交易，先验货再付款。</text>
          <text class="sh__note">
            · {{ item.contactMode === '公开' ? '卖家选择公开联系方式，可在私信里索取号码。' : '手机号默认不公开：发私信后卖家会收到通知，由他决定怎么联系你。' }}
          </text>
          <text class="sh__note">· 只显示到楼栋、不显示门牌；遇虚假信息可举报，物业核实后下架。</text>
        </view>

        <view class="sh__tip">
          <text class="demo-tip">说明</text>
          <text class="sh__tip-t">
            本页不做公开评论（类目红线）。私信只记录"你发过一条"，不是即时聊天 ——
            小程序做 IM 要额外的审核与运维，也做不过微信群。
          </text>
        </view>
      </template>
    </view>

    <Bar
      v-if="item"
      :label="item.wanted ? '已收藏' : '想要'"
      :amount="''"
      :hint="`${item.wantCount} 人想要 · 线下交易`"
      :okText="item.wanted ? '取消想要' : '想要'"
      btn-id="sh-want"
      @submit="want"
    >
      <template #left>
        <view id="sh-msg" class="sh__btn sh__btn--line" @tap="openMsg"><text>私信卖家</text></view>
      </template>
    </Bar>

    <!-- 私信（半屏，预设话术，不接 IM） -->
    <Sheet v-model:show="msgSheet" title="私信卖家" :sub="item ? `${item.sellerName} · ${item.buildingText}` : ''">
      <view class="ms__quick">
        <view v-for="q in QUICK" :key="q" class="chip" :class="{ 'is-on': draft === q }" @tap="draft = q">
          <text>{{ q }}</text>
        </view>
      </view>
      <textarea v-model="draft" class="textarea ms__text" maxlength="200" placeholder="想问什么？例如：还在吗、能便宜点吗、什么时候方便看" placeholder-class="ph" />
      <view id="msg-submit" class="btn btn--primary ms__submit" @tap="send"><text>发送</text></view>
      <text class="ms__note">演示环境只记录发送动作，不会真的通知到卖家；真实环境由员工端/卖家微信接收。</text>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Tag from '@/components/Tag.vue'
import Cover from '@/components/Cover.vue'
import Empty from '@/components/Empty.vue'
import Sheet from '@/components/Sheet.vue'
import { itemOf, sendMessage, toggleWant } from '@/api/neighbor'
import { toast, toastOk, toastErr } from '@/utils/ui'
import { gateLogin } from '@/utils/guard'

const QUICK = ['还在吗？', '能便宜点吗？', '什么时候方便自提？', '可以留到周末吗？']

const id = ref('')
const ver = ref(0)
const msgSheet = ref(false)
const draft = ref('')

const item = computed(() => {
  ver.value
  return id.value ? itemOf(id.value) : null
})

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})
onShow(() => {
  ver.value++
})

async function want() {
  if (!gateLogin()) return
  try {
    /* 用返回值判断，不要读 item.value.wanted —— 那是上一次渲染的状态，
       异步之后读到的可能是新的也可能是旧的，提示语会随机说反 */
    const on = await toggleWant(id.value)
    ver.value++
    toastOk(on ? '已收藏' : '已取消')
  } catch (e) {
    toastErr(e.message || '操作失败')
  }
}

function openMsg() {
  if (!gateLogin()) return
  msgSheet.value = true
}

async function send() {
  try {
    await sendMessage(id.value, draft.value)
    msgSheet.value = false
    draft.value = ''
    toastOk('已发送')
  } catch (e) {
    toastErr(e.message || '发送失败')
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 220rpx; }

.sh { margin-top: 20rpx; }
.sh__f { display: flex; align-items: baseline; gap: 12rpx; }
.sh__p { font-family: var(--biz-font-num); font-size: 44rpx; font-weight: 700; color: var(--biz-danger); }
.sh__o { font-size: 20rpx; color: var(--biz-text-4); text-decoration: line-through; }
.sh__t { display: block; margin-top: 12rpx; font-size: 29rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.sh__d { display: block; margin-top: 10rpx; font-size: 24rpx; color: var(--biz-text-2); line-height: 1.65; }
.sh__meta { display: flex; justify-content: space-between; margin-top: 16rpx; font-size: 20rpx; color: var(--biz-text-4); }
.sh__note { display: block; font-size: 22rpx; color: var(--biz-text-3); line-height: 1.8; }
.sh__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.sh__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }

.sh__btn {
  align-self: flex-start;
  height: 68rpx; border-radius: var(--biz-radius-btn); font-size: 23rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center; padding: 0 22rpx;
}
.sh__btn--line { background: #fff; border: 2rpx solid var(--biz-border); color: var(--biz-text-1); }

.ms__quick { display: flex; flex-wrap: wrap; gap: 12rpx; }
.ms__text { margin-top: 20rpx; height: 150rpx; }
.ms__submit { margin-top: 20rpx; }
.ms__note { display: block; margin-top: 14rpx; font-size: 20rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
