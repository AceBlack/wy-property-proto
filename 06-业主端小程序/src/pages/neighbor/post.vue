<!-- 动态详情：物业发布的内容 + 业主评论（先审后发） -->
<template>
  <view class="page">
    <NavBar title="动态详情" />
    <view class="body">
      <Empty v-if="!post" text="内容不存在或已撤回" />
      <template v-else>
        <view class="card">
          <view class="pt__hd">
            <Tag :text="post.category" size="sm" color="var(--biz-primary)" />
            <text class="pt__at">{{ post.publishTime }}</text>
          </view>
          <text class="pt__t">{{ post.title }}</text>
          <text class="pt__c">{{ post.content }}</text>
          <view v-if="post.images" class="pt__imgs">
            <Cover v-for="i in post.images" :key="i" :cover="i" h="180rpx" />
          </view>
          <view class="pt__foot">
            <text class="pt__m">{{ post.author }} · {{ post.authorRole }}</text>
            <view class="pt__acts">
              <text class="pt__a" :class="{ 'is-on': post.liked }" @tap="like">赞 {{ post.likeCount }}</text>
              <text class="pt__a">{{ post.commentCount }} 评论</text>
            </view>
          </view>
        </view>

        <view class="sec-hd pt__sec">
          <text class="sec-hd__t">邻里评论</text>
          <text class="sec-hd__d">先审后发</text>
        </view>

        <view v-for="c in comments" :key="c.commentId" class="card cm">
          <Avatar :name="c.authorName" size="sm" :tone="c.authorName.length" />
          <view class="cm__b">
            <view class="cm__hd">
              <text class="cm__n">{{ c.authorName }}</text>
              <text v-if="c.houseShort" class="cm__h">{{ c.houseShort }}</text>
              <text v-if="c.mine" class="cm__mine">审核中</text>
            </view>
            <text class="cm__c">{{ c.content }}</text>
            <text class="cm__at">{{ c.at }}</text>
          </view>
        </view>
        <Empty v-if="!comments.length" text="还没有评论" sub="说两句，邻居看得见" />
      </template>
    </view>

    <Bar okText="写评论" btn-id="post-comment" @submit="openSheet" />

    <Sheet v-model:show="sheet" title="写评论" sub="提交后由物业审核，通过后展示">
      <textarea v-model="draft" class="textarea" maxlength="120" placeholder="说点什么…" placeholder-class="ph" />
      <view id="comment-submit" class="btn btn--primary pt__submit" @tap="submit"><text>提交评论</text></view>
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
import Avatar from '@/components/Avatar.vue'
import { commentsOf, postOf } from '@/api/neighbor'
import { activeHouse } from '@/api/mp'
import { addComment, app, toggleLike } from '@/store/app'
import { toastOk, toast } from '@/utils/ui'
import { gateLogin } from '@/utils/guard'

const id = ref('')
const sheet = ref(false)
const draft = ref('')
const ver = ref(0)

const post = computed(() => {
  ver.value
  return id.value ? postOf(id.value) : null
})
const comments = computed(() => {
  ver.value
  return id.value ? commentsOf(id.value) : []
})

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})
onShow(() => {
  ver.value++
})

function like() {
  if (!gateLogin()) return
  toggleLike(id.value)
  ver.value++
}

function openSheet() {
  if (!gateLogin()) return
  sheet.value = true
}

function submit() {
  if (!draft.value.trim()) return toast('写点什么再提交')
  addComment({
    postId: id.value,
    ownerId: '',
    authorName: (app.session?.name || '业主').slice(0, 1) + '**',
    houseShort: activeHouse()?.shortName || '',
    content: draft.value.trim(),
    likeCount: 0
  })
  draft.value = ''
  sheet.value = false
  ver.value++
  toastOk('已提交，待审核')
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 200rpx; }
.pt__hd { display: flex; align-items: center; justify-content: space-between; }
.pt__at { font-size: 20rpx; color: var(--biz-text-4); }
.pt__t { display: block; margin-top: 14rpx; font-size: 32rpx; font-weight: 700; color: var(--biz-text-1); line-height: 1.4; }
.pt__c { display: block; margin-top: 12rpx; font-size: 25rpx; color: var(--biz-text-2); line-height: 1.75; }
.pt__imgs { display: flex; gap: 12rpx; margin-top: 16rpx; }
.pt__imgs > * { flex: 1; }
.pt__foot { display: flex; align-items: center; justify-content: space-between; margin-top: 20rpx; }
.pt__m { font-size: 20rpx; color: var(--biz-text-4); }
.pt__acts { display: flex; gap: 22rpx; }
.pt__a { font-size: 21rpx; color: var(--biz-text-3); }
.pt__a.is-on { color: var(--biz-primary); font-weight: 600; }
.pt__sec { margin: 30rpx 0 16rpx; }
.cm { display: flex; gap: 14rpx; padding: 20rpx 22rpx; }
.cm__b { flex: 1; min-width: 0; }
.cm__hd { display: flex; align-items: center; gap: 10rpx; }
.cm__n { font-size: 25rpx; font-weight: 600; color: var(--biz-text-1); }
.cm__h { font-size: 19rpx; color: var(--biz-text-4); }
.cm__mine { font-size: 18rpx; color: var(--biz-warning); background: #fff8f0; border-radius: 4rpx; padding: 1rpx 8rpx; }
.cm__c { display: block; margin-top: 8rpx; font-size: 24rpx; color: var(--biz-text-2); line-height: 1.6; }
.cm__at { display: block; margin-top: 8rpx; font-size: 19rpx; color: var(--biz-text-4); }
.pt__submit { margin-top: 20rpx; }
</style>
