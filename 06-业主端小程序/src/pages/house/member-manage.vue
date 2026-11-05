<!-- 成员管理：列表 + 邀请二维码 + 编辑/解除 -->
<template>
  <view class="page">
    <NavBar title="家庭成员" :subtitle="house?.fullName" />
    <view class="body">
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">已登记成员</text>
          <text class="sec-hd__d">{{ res.members.length }} 人</text>
        </view>
        <view v-for="m in res.members" :key="m.memberId" class="row">
          <Avatar :name="m.name" size="sm" :tone="m.name.length" />
          <view class="row__b">
            <text class="row__n">{{ m.name }}</text>
            <text class="row__d">{{ m.relation }} · {{ maskPhone(m.phone) }}</text>
          </view>
          <view class="row__acts">
            <text class="row__a" @tap="goForm('create')">编辑</text>
            <text class="row__a row__a--bad" @tap="remove(m)">解除</text>
          </view>
        </view>
        <Empty v-if="!res.members.length" text="还没有登记家庭成员" sub="可以邀请已由物业登记的家人，或代家人创建" />
      </view>

      <view class="card mm__add">
        <view class="mm__opt" @tap="goForm('invite')">
          <view class="mm__ico"><text>邀</text></view>
          <view class="mm__b">
            <text class="mm__t">邀请家人</text>
            <text class="mm__d">家人已在物业登记过，扫码后自动关联</text>
          </view>
        </view>
        <view class="mm__opt" @tap="goForm('create')">
          <view class="mm__ico mm__ico--accent"><text>建</text></view>
          <view class="mm__b">
            <text class="mm__t">创建家人</text>
            <text class="mm__d">代家人填资料，提交后由物业核验</text>
          </view>
        </view>
      </view>

      <view class="mm__tip">
        <text class="demo-tip">说明</text>
        <text class="mm__tip-t">成员登记不等于门禁授权：人脸、门禁卡还要物业核验后生效。业主只能管理自己房的成员。</text>
      </view>
    </view>

    <Sheet v-model:show="qrSheet" title="邀请家人" sub="请使用微信扫一扫，或在家人手机上打开">
      <view class="qr">
        <view class="qr__box">
          <view v-for="i in 36" :key="i" class="qr__px" :class="{ 'is-on': (i * 5) % 4 < 2 }" />
        </view>
        <text class="qr__t">{{ house?.fullName }}</text>
        <text class="qr__d">邀请链接 24 小时内有效；演示环境不生成真实链接。</text>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Avatar from '@/components/Avatar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import Sheet from '@/components/Sheet.vue'
import { removeMember } from '@/store/app'
import { houseOf, residentsOf } from '@/api/mp'
import { maskPhone } from '@/utils/format'
import { go, toast } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const houseId = ref('')
const qrSheet = ref(false)
const ver = ref(0)
const house = computed(() => houseOf(houseId.value))
const res = computed(() => {
  ver.value
  return residentsOf(houseId.value)
})

onLoad(o => {
  if (!gateOwner('家庭成员')) return
  houseId.value = o?.houseId ? decodeURIComponent(o.houseId) : ''
})
onShow(() => {
  ver.value++
})

function goForm(mode) {
  if (mode === 'invite') {
    qrSheet.value = true
    return
  }
  go('/pages/house/member-form', { houseId: houseId.value })
}

async function remove(m) {
  const ok = await new Promise(r =>
    uni.showModal({
      title: '解除成员',
      content: `确定解除「${m.name}」与这套房的关联？解除后对方将无法用本房报修、开门。`,
      confirmText: '解除',
      confirmColor: '#ec4d63',
      success: x => r(!!x.confirm)
    })
  )
  if (!ok) return
  removeMember(m.memberId)
  ver.value++
  toast('已解除（演示态：真实环境需物业复核）')
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 50rpx; }
.row { display: flex; align-items: center; gap: 16rpx; padding: 18rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.row:last-of-type { border-bottom: none; }
.row__b { flex: 1; min-width: 0; }
.row__n { font-size: 26rpx; font-weight: 500; color: var(--biz-text-1); }
.row__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.row__acts { display: flex; gap: 16rpx; }
.row__a { font-size: 21rpx; color: var(--biz-primary); }
.row__a--bad { color: var(--biz-danger); }

.mm__add { padding: 12rpx 22rpx; }
.mm__opt { display: flex; align-items: center; gap: 16rpx; padding: 20rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.mm__opt:last-of-type { border-bottom: none; }
.mm__ico { flex: none; width: 72rpx; height: 72rpx; border-radius: 20rpx; background: var(--biz-primary-light-9); color: var(--biz-primary); display: flex; align-items: center; justify-content: center; font-size: 28rpx; font-weight: 700; }
.mm__ico--accent { background: var(--biz-accent-light-9); color: var(--biz-accent-dark); }
.mm__b { flex: 1; min-width: 0; }
.mm__t { font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.mm__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }

.mm__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.mm__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }

.qr { display: flex; flex-direction: column; align-items: center; padding: 10rpx 0 20rpx; }
.qr__box { width: 300rpx; height: 300rpx; display: flex; flex-wrap: wrap; padding: 18rpx; background: #fff; border: 2rpx solid var(--biz-border); border-radius: 16rpx; }
.qr__px { width: 12.5%; height: 12.5%; }
.qr__px.is-on { background: var(--biz-text-1); }
.qr__t { margin-top: 18rpx; font-size: 24rpx; color: var(--biz-text-2); }
.qr__d { margin-top: 8rpx; font-size: 21rpx; color: var(--biz-text-4); text-align: center; }
</style>
