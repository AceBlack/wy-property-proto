<!--
  公告详情（§12.2 第 2 条：原「动态详情」改为公告详情）
  ------------------------------------------------------------
  公告不是"帖子"：它要能**签收**、要能看**附件**、阅读数直接用公告自带的
  `readCount / targetHouses`（后台与 PC 同一张表，业主端不另算一套）。
  附件只有一个数量字段，没有文件名 —— 所以如实写"演示环境不提供下载"，不假装能点。
-->
<template>
  <view class="page">
    <NavBar title="公告详情" :subtitle="n ? n.type : ''" />
    <view class="body" :class="{ 'body--with-foot': !!n }">
      <Empty v-if="!n" text="公告不存在或已撤回" sub="已撤回的公告业主端不再展示" />

      <template v-else>
        <view class="card">
          <view class="nd__hd">
            <text v-if="n.top" class="nd__top">置顶</text>
            <Tag :text="n.type" size="sm" color="var(--biz-primary)" />
            <text v-if="n.signed" class="nd__signed">已签收</text>
          </view>
          <text class="nd__t">{{ n.title }}</text>
          <view class="nd__meta">
            <text>{{ n.publisher }} · {{ n.publishTime }}</text>
            <text>阅读 {{ n.readCount }}/{{ n.targetHouses }} 户</text>
          </view>
          <text class="nd__c">{{ n.content }}</text>
        </view>

        <!-- 附件 -->
        <view v-if="n.attachmentCount" class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">附件 {{ n.attachmentCount }} 个</text>
            <text class="sec-hd__d"><text class="demo-tip">演示</text></text>
          </view>
          <view v-for="i in n.attachmentCount" :key="i" class="nd__att">
            <view class="nd__att-ico"><text>文</text></view>
            <text class="nd__att-t">附件 {{ i }}（演示环境不提供下载）</text>
          </view>
        </view>

        <!-- 签收 -->
        <view v-if="n.signed" class="card nd__signed-box">
          <text class="nd__signed-t">您已于 {{ n.signedAt }} 签收本公告</text>
          <text class="nd__signed-d">签收记录会回传到 PC 后台的公告阅读明细，物业不再重复电话通知。</text>
        </view>

        <view class="nd__tip">
          <text class="demo-tip">口径</text>
          <text class="nd__tip-t">
            公告与 PC 后台是同一张表，只同步「已发布」。签收是业主主动动作，与"打开看过"分开记：
            打开只算阅读，签收才代表"我知道了"。
          </text>
        </view>
      </template>
    </view>

    <Bar
      v-if="n"
      :label="n.signed ? '已签收' : '未签收'"
      :amount="''"
      :hint="n.signed ? n.signedAt : '签收后物业不再重复通知'"
      :okText="n.signed ? '已签收' : '我已阅读并签收'"
      :disabled="n.signed"
      btn-id="notice-sign"
      @submit="sign"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import { markNoticeRead, noticeOf, signNotice } from '@/api/neighbor'
import { toastOk } from '@/utils/ui'

const id = ref('')
const ver = ref(0)
const n = computed(() => {
  ver.value
  return id.value ? noticeOf(id.value) : null
})

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
  /* 打开即记已读（幂等）；签收要业主自己点。
     不 await：读公告不该等一个请求回来 —— 失败也只是"未读数没减"，不影响阅读 */
  if (id.value) markNoticeRead(id.value).catch(() => {})
})
onShow(() => {
  ver.value++
})

async function sign() {
  try {
    await signNotice(id.value)
    ver.value++
    toastOk('已签收')
  } catch (e) {
    toastErr(e.message || '签收失败')
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 210rpx; }

.nd__hd { display: flex; align-items: center; gap: 10rpx; }
.nd__top { font-size: 18rpx; color: var(--biz-danger); background: #fff0f1; border-radius: 4rpx; padding: 1rpx 8rpx; }
.nd__signed { font-size: 18rpx; color: var(--biz-accent-dark); background: var(--biz-accent-light-9); border-radius: 4rpx; padding: 1rpx 8rpx; }
.nd__t { display: block; margin-top: 14rpx; font-size: 33rpx; font-weight: 700; color: var(--biz-text-1); line-height: 1.4; }
.nd__meta { display: flex; align-items: center; justify-content: space-between; margin-top: 14rpx; font-size: 20rpx; color: var(--biz-text-4); }
.nd__c { display: block; margin-top: 18rpx; font-size: 25rpx; color: var(--biz-text-2); line-height: 1.8; white-space: pre-wrap; }

.nd__att { display: flex; align-items: center; gap: 14rpx; padding: 14rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.nd__att:last-child { border-bottom: none; }
.nd__att-ico { flex: none; width: 60rpx; height: 60rpx; border-radius: 14rpx; background: var(--biz-bg-fill); color: var(--biz-text-3); display: flex; align-items: center; justify-content: center; font-size: 22rpx; }
.nd__att-t { flex: 1; font-size: 23rpx; color: var(--biz-text-2); }

.nd__signed-box { background: var(--biz-accent-light-9); box-shadow: none; }
.nd__signed-t { font-size: 25rpx; font-weight: 600; color: var(--biz-accent-dark); }
.nd__signed-d { display: block; margin-top: 6rpx; font-size: 21rpx; color: var(--biz-text-3); line-height: 1.6; }

.nd__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.nd__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
