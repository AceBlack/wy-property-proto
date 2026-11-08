<template>
  <view class="page">
    <NavBar title="举报处理" :subtitle="d?.reportId || ''" />

    <view v-if="!d" class="body">
      <Empty text="举报不存在或已处理" sub="回到待办列表刷新一下" />
    </view>

    <view v-else class="body body--with-foot">
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">被举报内容</text>
          <text class="sec-hd__d">{{ d.itemStatus }}</text>
        </view>
        <text class="title">{{ d.itemTitle }}</text>
        <view class="kv"><text class="kv__k">发布人</text><text class="kv__v">{{ d.sellerName }} · {{ buildingOf(d.sellerHouse) || '楼栋未填' }}</text></view>
      </view>

      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">举报内容</text>
          <text class="rp__reason">{{ d.reason }}</text>
        </view>
        <text class="detail">{{ d.detail }}</text>
        <view class="kv"><text class="kv__k">举报人</text><text class="kv__v">{{ d.reporterName }} · {{ d.building || '楼栋未填' }}</text></view>
        <view class="kv"><text class="kv__k">举报时间</text><text class="kv__v num">{{ d.at }}</text></view>
      </view>

      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">怎么处理</text>
          <text class="sec-hd__d">四选一 · 说明必填</text>
        </view>
        <view class="acts">
          <view
            v-for="(a, i) in ACTIONS"
            :key="a"
            :id="`nb-act-${i}`"
            class="act"
            :class="{ 'is-on': action === a, 'is-danger': a === '封禁 7 天' }"
            @tap="action = a"
          >
            <text class="act__t">{{ a }}</text>
            <text class="act__d">{{ HINT[a] }}</text>
          </view>
        </view>

        <text class="fld__k">处理说明（必填，事后要能解释为什么这么判）</text>
        <textarea
          id="nb-note"
          v-model="note"
          class="textarea"
          :maxlength="100"
          placeholder="例如：图片确为活体宠物交易，按社区规则下架并提醒发布人"
          placeholder-class="ph-txt"
        />
        <text v-if="action === '封禁 7 天'" class="warn">
          封禁只记在这次举报的处置里；原型不做登录拦截，上线后由业主端校验封禁状态。
        </text>
      </view>
    </view>

    <view v-if="d" class="footbar">
      <view id="nb-handle" class="btn btn--primary foot-btn" @tap="submit">提交处理</view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'
import { REPORT_ACTIONS } from '@pc/utils/api'
import { buildingOf, handle, reportOf } from '@/api/neighbor'
import { persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const ACTIONS = REPORT_ACTIONS
const HINT = {
  忽略: '内容没问题，或证据不足',
  仅警告: '内容保留，提醒发布人',
  下架并警告: '内容下线 + 发通知',
  '封禁 7 天': '内容下线 + 暂停发布'
}

const reportId = ref('')
const d = ref(null)
const action = ref(ACTIONS[0])
const note = ref('')

async function load() {
  d.value = await reportOf(reportId.value)
}

function submit() {
  if (!note.value.trim()) {
    toastErr('处理说明必填 —— 事后要能解释为什么这么判')
    return
  }
  try {
    handle(persona.value, reportId.value, { action: action.value, note: note.value.trim() })
    toastOk('已处理')
    setTimeout(() => uni.navigateBack(), 600)
  } catch (e) {
    toastErr(e.message || '处理失败')
  }
}

onLoad(o => {
  reportId.value = o.reportId || ''
  load()
})
</script>

<style scoped>
.rp__reason {
  font-size: 17rpx;
  color: var(--biz-danger);
  background: #fff0f0;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
}

.title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.45;
}

.detail {
  display: block;
  font-size: 23rpx;
  color: var(--biz-text-2);
  line-height: 1.7;
  padding: 6rpx 0 12rpx;
}

.kv {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  padding: 8rpx 0;
}

.kv__k {
  flex: none;
  width: 130rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.kv__v {
  flex: 1;
  font-size: 23rpx;
  color: var(--biz-text-1);
}

.acts {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.act {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  padding: 20rpx 20rpx;
  border-radius: 14rpx;
  background: var(--biz-bg-fill);
}

.act.is-on {
  background: var(--biz-primary-light-9);
  box-shadow: inset 0 0 0 2rpx var(--biz-primary);
}

.act.is-on .act__t {
  color: var(--biz-primary);
  font-weight: 600;
}

.act.is-danger.is-on {
  background: #fff0f0;
  box-shadow: inset 0 0 0 2rpx var(--biz-danger);
}

.act.is-danger.is-on .act__t {
  color: var(--biz-danger);
}

.act__t {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.act__d {
  font-size: 18rpx;
  color: var(--biz-text-4);
  text-align: right;
  flex: 1;
}

.fld__k {
  display: block;
  margin: 18rpx 0 10rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.textarea {
  width: 100%;
  height: 160rpx;
  padding: 16rpx 18rpx;
  border-radius: 14rpx;
  background: var(--biz-bg-fill);
  font-size: 24rpx;
  color: var(--biz-text-1);
}

.ph-txt {
  color: var(--biz-text-4);
}

.warn {
  display: block;
  margin-top: 12rpx;
  font-size: 18rpx;
  color: #a35c13;
  background: #fff7ed;
  border-radius: 10rpx;
  padding: 10rpx 14rpx;
  line-height: 1.55;
}

.foot-btn {
  flex: 1;
  height: 88rpx;
  font-size: 29rpx;
}
</style>
