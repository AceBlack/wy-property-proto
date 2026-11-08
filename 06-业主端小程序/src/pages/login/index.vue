<!--
  屏 · 登录（L1，不强制实名）
  ------------------------------------------------------------
  设计稿：微信快捷登录 + 手机号验证码登录，底部协议勾选。
  这里多给一条「演示身份」—— 没有真实 AppID 与短信通道，选身份代替授权，
  这是演示态，不是能力（README「演示态与缺口」里写明）。
  登录之后**不跳实名、不跳绑定**：首页可以逛，缴费/报修时才引导认证。
-->
<template>
  <view class="page">
    <view class="hero">
      <view class="hero__logo"><text>家</text></view>
      <text class="hero__t">登录</text>
    </view>

    <view class="body">
      <view class="lg__btns">
        <view id="wx-login" class="btn btn--wx" @tap="panel = 'demo'">
          <text class="btn__ico">微</text>
          <text>微信快捷登录</text>
        </view>
        <view id="phone-login" class="btn btn--primary" @tap="panel = 'phone'">
          <text>手机号登录</text>
        </view>
      </view>

      <view class="lg__agree" @tap="agree = !agree">
        <view class="lg__check" :class="{ 'is-on': agree }"><text v-if="agree">✓</text></view>
        <text class="lg__agree-t">
          我已阅读并同意《服务协议》《隐私政策》，未登录也可浏览社区公告与邻里内容
        </text>
      </view>

      <view class="lg__hint">
        <text class="demo-tip">演示</text>
        <text class="lg__hint-t">
          演示环境没有真实微信授权与短信通道：点身份卡即视为已授权并拿到手机号；
          验证码固定 8888。
        </text>
      </view>
    </view>

    <!-- 手机号 + 验证码面板（设计稿是底部弹层） -->
    <Sheet v-model:show="sheetVisible" :title="step === 'phone' ? '手机号登录' : '输入验证码'" :sub="step === 'code' ? `验证码已发送至 ${maskPhone(phone)}` : ''">
      <template v-if="step === 'phone'">
        <view class="lg__field">
          <text class="lg__prefix">+86</text>
          <input v-model="phone" class="lg__input" type="number" maxlength="11" placeholder="请输入手机号" placeholder-class="ph" />
          <text v-if="phone" class="lg__clear" @tap="phone = ''">✕</text>
        </view>
        <view id="send-code" class="btn btn--primary lg__submit" :class="{ 'btn--disabled': phone.length !== 11 }" @tap="sendCode">
          <text>下一步</text>
        </view>
      </template>

      <template v-else>
        <view class="lg__field">
          <input v-model="code" class="lg__input lg__input--code" type="number" maxlength="6" placeholder="请输入 6 位验证码" placeholder-class="ph" />
        </view>
        <view class="lg__resend">
          <text v-if="left > 0" class="lg__resend-t">重新获取（{{ left }}s）</text>
          <text v-else id="resend" class="lg__resend-a" @tap="sendCode">验证码已过期，重新获取</text>
        </view>
        <view id="do-login" class="btn btn--primary lg__submit" :class="{ 'btn--disabled': code.length < 4 }" @tap="doLogin">
          <text>登录</text>
        </view>
      </template>
    </Sheet>

    <!-- 演示身份 -->
    <Sheet v-model:show="demoVisible" title="选择演示身份" sub="数据取自物业档案，登录后仍需房产认证才能缴费报修">
      <view
        v-for="p in personas"
        :key="p.id"
        :id="`persona-${p.id}`"
        class="demo-row"
        :class="{ 'is-on': pid === p.id }"
        @tap="pickPersona(p)"
      >
        <Avatar :name="p.name" size="sm" :tone="p.id.length" />
        <view class="demo-row__body">
          <view class="demo-row__hd">
            <text class="demo-row__n">{{ p.name }}</text>
            <Tag :text="p.role" size="sm" color="var(--biz-primary)" />
          </view>
          <text class="demo-row__d">{{ p.desc }}</text>
        </view>
        <text class="demo-row__phone">{{ maskPhone(p.phone) }}</text>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import Sheet from '@/components/Sheet.vue'
import Tag from '@/components/Tag.vue'
import Avatar from '@/components/Avatar.vue'
import { PERSONAS } from '@/config/personas'
import { isLogged, login } from '@/store/app'
import { apiLogin } from '@/api/mp'
import { hydrate } from '@/api/remote'
import { maskPhone } from '@/utils/format'
import { toast, toastErr } from '@/utils/ui'
import { HOME } from '@/utils/guard'

const personas = PERSONAS
const agree = ref(true)
const panel = ref('')
const step = ref('phone')
const phone = ref('')
const code = ref('')
const left = ref(0)
const pid = ref('')
let timer = null

const sheetVisible = computed({
  get: () => panel.value === 'phone',
  set: v => {
    if (!v) panel.value = ''
  }
})
const demoVisible = computed({
  get: () => panel.value === 'demo',
  set: v => {
    if (!v) panel.value = ''
  }
})

onLoad(() => {
  if (isLogged.value) uni.reLaunch({ url: HOME })
})

onUnload(() => clearInterval(timer))

function guardAgree() {
  if (agree.value) return true
  toastErr('请先阅读并同意服务协议与隐私政策')
  return false
}

function sendCode() {
  if (phone.value.length !== 11) {
    toastErr('请填 11 位手机号')
    return
  }
  step.value = 'code'
  code.value = ''
  left.value = 60
  clearInterval(timer)
  timer = setInterval(() => {
    left.value -= 1
    if (left.value <= 0) clearInterval(timer)
  }, 1000)
  toast('验证码已发送（演示固定 8888）')
}

function doLogin() {
  if (!guardAgree()) return
  if (left.value <= 0 && code.value !== '8888') {
    toastErr('验证码已过期，请重新获取')
    return
  }
  if (code.value !== '8888') {
    toastErr('验证码不正确（演示码 8888）')
    return
  }
  finish('')
}

function pickPersona(p) {
  if (!guardAgree()) return
  pid.value = p.id
  finish(p.id)
}

async function finish(personaId) {
  const p = personas.find(x => x.id === personaId)
  const ph = p ? p.phone : phone.value
  /* 接口模式：先换 token 再落本地会话。失败就停在登录页，不要"看着登上了其实没会话" */
  let tok = ''
  try {
    const r = await apiLogin(ph)
    tok = r?.token || ''
  } catch (e) {
    toastErr(e.message || '登录失败，请稍后重试')
    return
  }
  login({ phone: ph, personaId, token: tok })
  /* 登录只是 L1，快照要 L2 才有 —— 这里拉一次，成功后进首页就有房与账单；
     没绑房时 hydrate 会拿到空列表，等于没做，不影响流程 */
  await hydrate({ force: true })
  toast('登录成功')
  setTimeout(() => uni.reLaunch({ url: HOME }), 300)
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }

.hero {
  padding: calc(env(safe-area-inset-top) + 160rpx) 40rpx 80rpx;
  background: linear-gradient(160deg, #eef1ff 0%, #f7f8ff 55%, #f1f2fa 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  border-radius: 0 0 48rpx 48rpx;
}
.hero__logo {
  width: 120rpx; height: 120rpx; border-radius: 32rpx;
  background: var(--biz-gradient); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 46rpx; font-weight: 700;
  box-shadow: var(--biz-shadow-primary);
}
.hero__t { margin-top: 26rpx; font-size: 44rpx; font-weight: 700; color: var(--biz-text-1); letter-spacing: 2rpx; }

.body { padding: 0 48rpx 60rpx; }
.lg__btns { margin-top: 60rpx; display: flex; flex-direction: column; gap: 24rpx; }
.btn { height: 92rpx; font-size: 29rpx; }
.btn__ico {
  width: 40rpx; height: 40rpx; border-radius: 50%; background: rgba(255,255,255,0.24);
  font-size: 22rpx; display: flex; align-items: center; justify-content: center; margin-right: 10rpx;
}
.btn--wx { background: #f0fbf4; color: #0aa84f; border: 2rpx solid rgba(10,168,79,0.18); }

.lg__agree { display: flex; gap: 12rpx; align-items: flex-start; margin-top: 36rpx; }
.lg__check {
  flex: none; width: 30rpx; height: 30rpx; border-radius: 50%; border: 3rpx solid var(--biz-border);
  display: flex; align-items: center; justify-content: center; font-size: 18rpx; color: #fff; margin-top: 4rpx;
}
.lg__check.is-on { background: var(--biz-primary); border-color: var(--biz-primary); }
.lg__agree-t { flex: 1; font-size: 21rpx; color: var(--biz-text-3); line-height: 1.6; }

.lg__hint { margin-top: 40rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.lg__hint-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }

.lg__field {
  display: flex; align-items: center; gap: 16rpx;
  background: var(--biz-bg-fill); border-radius: 16rpx; padding: 0 24rpx; height: 96rpx;
}
.lg__prefix { font-size: 28rpx; color: var(--biz-text-2); font-weight: 600; }
.lg__input { flex: 1; font-size: 32rpx; color: var(--biz-text-1); height: 96rpx; }
.lg__input--code { letter-spacing: 8rpx; }
.lg__clear { font-size: 24rpx; color: var(--biz-text-4); padding: 8rpx; }
.lg__submit { margin-top: 28rpx; }
.lg__resend { margin-top: 16rpx; text-align: right; }
.lg__resend-t { font-size: 22rpx; color: var(--biz-text-4); }
.lg__resend-a { font-size: 22rpx; color: var(--biz-danger); }

.demo-row {
  display: flex; align-items: center; gap: 16rpx;
  padding: 20rpx; border-radius: 16rpx; background: var(--biz-bg-fill); margin-bottom: 12rpx;
}
.demo-row.is-on { background: var(--biz-primary-light-9); }
.demo-row__body { flex: 1; min-width: 0; }
.demo-row__hd { display: flex; align-items: center; gap: 12rpx; }
.demo-row__n { font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); }
.demo-row__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.demo-row__phone { flex: none; font-size: 21rpx; color: var(--biz-text-4); font-family: var(--biz-font-num); }
</style>
