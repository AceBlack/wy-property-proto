<!--
  刷脸通行（批次 80）
  ------------------------------------------------------------
  替代原来的「手机开门」二维码：小区没有二维码闸机，实际是人脸识别通行。
  所以这一页**没有开门按钮** —— 门是刷开的，页面上要做的是"我能不能刷"和"怎么才能刷"。

  流程固定三段：采集 → 待物业核验 → 生效。业主端不许自助生效，
  否则谁都能给自己（或给别人）开一张门禁卡。
-->
<template>
  <view class="page">
    <NavBar title="刷脸通行" :subtitle="subtitle" />
    <view class="body">
      <Empty v-if="loaded && !approved" text="认证后可查看刷脸信息" sub="人脸只对本小区已认证住户开放" />
      <Empty v-else-if="loaded && loadErr" text="人脸信息加载失败" sub="退出重进可重试；急用请联系物业服务中心" />

      <template v-else-if="approved">
        <!-- 本人 -->
        <view class="card fc__me">
          <view class="fc__me-hd">
            <view>
              <text class="fc__name">{{ me.name }}</text>
              <text class="fc__role">{{ me.role }}{{ me.at ? ` · 更新于 ${me.at.slice(0, 10)}` : '' }}</text>
            </view>
            <Tag :text="me.label" size="sm" :color="toneColor(me.tone)" />
          </view>
          <text class="fc__sum" :class="{ 'is-ok': summary.ok }">{{ summary.text }}</text>
          <text v-if="me.note" class="fc__note">{{ me.note }}</text>
          <text v-if="me.readOnlyWhy" class="fc__note">{{ me.readOnlyWhy }}</text>
          <text v-if="me.status === '已驳回' && me.note" class="fc__note is-danger">驳回原因：{{ me.note }}</text>

          <view class="fc__acts">
            <view
              v-if="!me.readOnly"
              id="face-enroll"
              class="btn btn--primary btn--sm"
              @tap="openEnroll({ key: me.key, name: '本人', member: false })"
            ><text>{{ me.status === '已生效' ? '重新采集' : '录入人脸' }}</text></view>
            <view
              v-if="!me.readOnly && me.status !== '未采集'"
              id="face-withdraw"
              class="btn btn--ghost btn--sm"
              @tap="withdraw(me.key)"
            ><text>撤回授权</text></view>
          </view>
        </view>

        <!-- 家庭成员：只有业主看得到 -->
        <view v-if="family.length" class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">家庭成员</text>
            <text class="sec-hd__d">{{ family.length }} 人 · 可协助录入</text>
          </view>
          <view v-for="(m, i) in family" :key="m.memberId" class="fc__fam" :class="{ 'is-last': i === family.length - 1 }">
            <view class="fc__fam-hd">
              <view>
                <text class="fc__fam-n">{{ m.name }}</text>
                <text class="fc__fam-r">{{ m.relation }}{{ m.certified ? '' : ' · 资料待核验' }}</text>
              </view>
              <Tag :text="m.label" size="sm" :color="toneColor(m.tone)" />
            </view>
            <view class="fc__fam-ft">
              <text class="fc__fam-d">{{ m.canEnroll ? m.desc : m.why }}</text>
              <view
                v-if="m.canEnroll"
                :id="`face-enroll-${m.memberId}`"
                class="btn btn--ghost btn--sm"
                @tap="openEnroll({ key: m.key, name: m.name, member: true })"
              ><text>{{ m.status === '已生效' ? '重拍' : '帮他录' }}</text></view>
            </view>
          </view>
        </view>

        <!-- 合规：这段不是装饰，人脸属于敏感个人信息 -->
        <view class="card fc__law">
          <view class="sec-hd"><text class="sec-hd__t">关于人脸信息</text></view>
          <text class="fc__law-p">· 用途：仅用于本小区单元门与车库闸机核验，不用于考勤、营销或其他场景。</text>
          <text class="fc__law-p">· 核验：提交后由物业人工核验，通过后才生效；未通过会给出原因。</text>
          <text class="fc__law-p">· 存储：原型不存真实照片；正式环境影像件加密存储，删除后 30 天内清空。</text>
          <text class="fc__law-p">· 撤回：可随时撤回，撤回后门禁权限 24 小时内停用。</text>
        </view>
      </template>
    </view>

    <!-- 采集 -->
    <Sheet v-model:show="sheet" title="采集人脸" :sub="target.name" max-height="70vh">
      <view class="fc__shot">
        <PhotoPicker v-model="photos" :max="1" />
      </view>
      <text class="fc__shot-tip">正面、光线均匀、不戴帽子墨镜；照片只用于门禁核验。</text>

      <view v-if="target.member" class="fc__guard">
        <view class="fc__guard-box" :class="{ 'is-on': guardian }" @tap="guardian = !guardian"><text>{{ guardian ? '✓' : '' }}</text></view>
        <text class="fc__guard-t">
          我是{{ target.name }}的监护人或家庭成员，已取得其同意，代为提交人脸信息
        </text>
      </view>

      <view class="fc__sheet-acts">
        <view class="btn btn--primary" id="face-submit" @tap="submitEnroll"><text>提交核验</text></view>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import Sheet from '@/components/Sheet.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import { accessSummary, familyFaces, loadFaces, selfFace, submitFace, withdrawFace } from '@/api/access'
import { isApproved } from '@/store/app'
import { activeHouse } from '@/api/mp'
import { confirm, toastErr, toastOk } from '@/utils/ui'

const ver = ref(0)
const loaded = ref(false)
const loadErr = ref(false)
const sheet = ref(false)
const photos = ref([])
const guardian = ref(false)
const target = ref({ key: '', name: '', member: false })

const approved = computed(() => {
  ver.value
  return isApproved.value
})
const me = computed(() => {
  ver.value
  return selfFace()
})
const summary = computed(() => accessSummary(me.value))
const family = computed(() => {
  ver.value
  return familyFaces()
})
const subtitle = computed(() => activeHouse.value?.fullName || '')

const toneColor = tone =>
  tone === 'ok' ? 'var(--biz-accent-dark)' : tone === 'danger' ? 'var(--biz-danger)' : tone === 'warn' ? 'var(--biz-warning)' : 'var(--biz-text-3)'

onLoad(opts => {
  /* 成员管理页可以带着 memberId 直接过来（「帮他录人脸」） */
  const mid = String(opts?.memberId || '')
  if (mid) openEnroll({ key: `member:${mid}`, name: String(opts?.name || '家人'), member: true })
})

onShow(async () => {
  /* 人脸状态随时会因为物业核验而变，每次进页面拉一次（接口模式），不做本地缓存 */
  try {
    await loadFaces()
    loadErr.value = false
  } catch (e) {
    loadErr.value = true
  }
  ver.value++
  loaded.value = true
})

function openEnroll(t) {
  target.value = t
  photos.value = []
  guardian.value = false
  sheet.value = true
}

async function submitEnroll() {
  if (!photos.value.length) {
    toastErr('请先拍照（或选择"模拟一张"）')
    return
  }
  try {
    await submitFace(target.value.key, { guardian: guardian.value })
    sheet.value = false
    ver.value++
    toastOk('已提交，等物业核验')
  } catch (e) {
    toastErr(e?.message || '提交失败')
  }
}

async function withdraw(key) {
  const ok = await confirm({
    title: '撤回人脸授权',
    content: '撤回后门禁权限 24 小时内停用，影像件将在 30 天内删除。需要时还要重新采集并核验。',
    okText: '确认撤回'
  })
  if (!ok) return
  try {
    await withdrawFace(key)
    ver.value++
    toastOk('已撤回')
  } catch (e) {
    toastErr(e?.message || '撤回失败')
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.card + .card { margin-top: 20rpx; }
.fc__me-hd { display: flex; align-items: flex-start; justify-content: space-between; }
.fc__name { display: block; font-size: 32rpx; font-weight: 700; color: var(--biz-text-1); }
.fc__role { display: block; margin-top: 6rpx; font-size: 22rpx; color: var(--biz-text-3); }
.fc__sum { display: block; margin-top: 18rpx; font-size: 26rpx; color: var(--biz-text-2); }
.fc__sum.is-ok { color: var(--biz-accent-dark); font-weight: 600; }
.fc__note { display: block; margin-top: 8rpx; font-size: 21rpx; color: var(--biz-text-3); line-height: 1.6; }
.fc__note.is-danger { color: var(--biz-danger); }
.fc__acts { margin-top: 22rpx; display: flex; gap: 16rpx; }
.fc__fam { padding: 20rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.fc__fam.is-last { border-bottom: none; padding-bottom: 0; }
.fc__fam-hd { display: flex; align-items: flex-start; justify-content: space-between; }
.fc__fam-n { display: block; font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.fc__fam-r { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.fc__fam-ft { margin-top: 12rpx; display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.fc__fam-d { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.5; }
.fc__law-p { display: block; margin-top: 12rpx; font-size: 21rpx; color: var(--biz-text-3); line-height: 1.7; }
.fc__shot { margin-bottom: 8rpx; }
.fc__shot-tip { display: block; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
.fc__guard { display: flex; gap: 14rpx; margin-top: 26rpx; align-items: flex-start; }
.fc__guard-box { flex: none; width: 36rpx; height: 36rpx; border: 2rpx solid var(--biz-border); border-radius: 8rpx; display: flex; align-items: center; justify-content: center; font-size: 22rpx; color: #fff; }
.fc__guard-box.is-on { background: var(--biz-primary); border-color: var(--biz-primary); }
.fc__guard-t { flex: 1; font-size: 21rpx; color: var(--biz-text-3); line-height: 1.6; }
.fc__sheet-acts { margin-top: 30rpx; }
</style>
