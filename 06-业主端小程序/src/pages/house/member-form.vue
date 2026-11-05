<!-- 创建 / 邀请家人：关系 + 姓名 + 证件 + 手机号，四道校验 -->
<template>
  <view class="page">
    <NavBar title="添加家庭成员" :subtitle="house?.fullName" />
    <view class="body">
      <view class="card">
        <view class="field">
          <view class="field__k"><text>成员关系</text><text class="field__hint">必选</text></view>
          <view class="mf__rel">
            <view v-for="r in RELATIONS" :key="r" class="chip" :class="{ 'is-on': rel === r }" @tap="rel = r"><text>{{ r }}</text></view>
          </view>
        </view>

        <view class="field">
          <view class="field__k"><text>姓名</text><text class="field__hint">与证件一致</text></view>
          <input v-model="name" class="field__input field__input--boxed" maxlength="12" placeholder="请输入姓名" placeholder-class="ph" />
        </view>

        <view class="field">
          <view class="field__k"><text>身份证号</text><text class="field__hint">{{ idCard.length }}/18</text></view>
          <input v-model="idCard" class="field__input field__input--boxed" maxlength="18" placeholder="请输入身份证号" placeholder-class="ph" />
        </view>

        <view class="field">
          <view class="field__k"><text>手机号</text><text class="field__hint">用于接收门禁与通知</text></view>
          <input v-model="phone" class="field__input field__input--boxed" type="number" maxlength="11" placeholder="请输入手机号" placeholder-class="ph" />
        </view>
      </view>

      <view v-if="err" class="banner banner--offline">
        <view class="banner__ico"><text>!</text></view>
        <text class="banner__t">{{ err }}</text>
      </view>

      <view class="mf__tip">
        <text class="demo-tip">说明</text>
        <text class="mf__tip-t">
          提交后状态为「待核验」：成员关系与资料由物业核对，通过后才会开通门禁与人脸。
          业主端不存完整证件号，只留后四位用于比对。
        </text>
      </view>
    </view>

    <Bar label="提交后" hint="待物业核验" okText="确认提交" btn-id="mf-submit" @submit="submit" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import { addMember } from '@/store/app'
import { houseOf } from '@/api/mp'
import { toastOk } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const RELATIONS = ['配偶', '子女', '父母', '其他']
const houseId = ref('')
const rel = ref('')
const name = ref('')
const idCard = ref('')
const phone = ref('')
const err = ref('')

const house = computed(() => houseOf(houseId.value))

onLoad(o => {
  if (!gateOwner('添加家庭成员')) return
  houseId.value = o?.houseId ? decodeURIComponent(o.houseId) : ''
})

function submit() {
  if (!rel.value) return (err.value = '成员关系不能为空')
  if (!/^[\u4e00-\u9fa5·]{2,12}$/.test(name.value.trim())) return (err.value = '姓名需为 2~12 个汉字')
  if (!/^\d{17}[\dXx]$/.test(idCard.value.trim())) return (err.value = '身份证号格式不正确（18 位）')
  if (!/^1\d{10}$/.test(phone.value)) return (err.value = '手机号格式不正确')
  err.value = ''
  addMember({
    houseId: houseId.value,
    name: name.value.trim(),
    relation: rel.value,
    phone: phone.value,
    idCard4: idCard.value.trim().slice(-4),
    status: '待核验'
  })
  toastOk('已提交，待物业核验')
  setTimeout(() => uni.navigateBack(), 500)
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); display: flex; flex-direction: column; }
.body { flex: 1; padding: 20rpx 28rpx 220rpx; }
.mf__rel { display: flex; flex-wrap: wrap; gap: 12rpx; }
.mf__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.mf__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
