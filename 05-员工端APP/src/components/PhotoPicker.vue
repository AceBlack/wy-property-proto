<!--
  现场拍照件。
  三个必须体现的东西（交接单 §六 三态）：
  1. 真拍：uni.chooseImage（H5 走文件选择，App 走相机）；
  2. 无相机 / 拒绝授权：不报错了之，而是落一张「占位图 + 说明」，提交时把说明带上去，主管知道这张是缺的；
  3. 演示用：给一个「模拟一张」，截图与自动化不依赖真摄像头。
-->
<template>
  <view class="pp">
    <view class="pp__grid">
      <view v-for="(p, i) in list" :key="p.id" class="pp__cell">
        <image v-if="p.kind === 'photo'" class="pp__img" :src="p.src" mode="aspectFill" @tap="preview(i)" />
        <view v-else class="pp__ph" @tap="preview(i)">
          <text class="pp__ph-i">▧</text>
          <text class="pp__ph-t">占位</text>
        </view>
        <view class="pp__del" @tap.stop="remove(i)"><text>✕</text></view>
        <text v-if="p.kind === 'placeholder'" class="pp__badge">无照片</text>
      </view>

      <view v-if="list.length < max" class="pp__add" hover-class="pp__add--hover" @tap="openSheet">
        <text class="pp__add-i">＋</text>
        <text class="pp__add-t">{{ list.length }}/{{ max }}</text>
      </view>
    </view>

    <!-- 占位说明：缺照片时要留下「为什么缺」 -->
    <view v-if="placeholderNote" class="pp__note">
      <text class="pp__note-i">!</text>
      <text class="pp__note-t">{{ placeholderNote }}</text>
    </view>

    <ActionSheet
      v-model:show="sheet"
      title="现场照片"
      sub="照片是异常判定的证据，能拍就拍；拍不了要说明原因"
      :actions="sheetActions"
      @select="onAction"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import ActionSheet from './ActionSheet.vue'
import { toast, toastErr } from '@/utils/ui'
import { DEMO } from '@/config/personas'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  max: { type: Number, default: 3 }
})
const emit = defineEmits(['update:modelValue', 'placeholder'])

const list = computed(() => props.modelValue || [])
const sheet = ref(false)
const placeholderNote = ref('')
let seq = 0

const sheetActions = [
  { label: '拍照', desc: '调用相机，照片带时间水印', value: 'camera' },
  { label: '从相册选择', desc: '现场来不及拍时补选', value: 'album' },
  { label: '模拟一张（演示用）', desc: '不调用相机，生成一张示例图', value: 'mock' },
  { label: '相机不可用，记占位说明', desc: '记为缺证，提交时会标出「无照片」', value: 'placeholder' }
]

function openSheet() {
  if (props.max <= list.value.length) return
  sheet.value = true
}

function push(item) {
  emit('update:modelValue', [...list.value, item])
}

function remove(i) {
  const next = list.value.slice()
  const [gone] = next.splice(i, 1)
  if (gone?.kind === 'placeholder') placeholderNote.value = ''
  emit('update:modelValue', next)
}

function preview(i) {
  const p = list.value[i]
  if (!p || p.kind !== 'photo') return
  uni.previewImage({ urls: list.value.filter(x => x.kind === 'photo').map(x => x.src), current: p.src })
}

/** 模拟图：内联 SVG，不依赖网络图片，截图里也能看出这是「演示图」 */
function mockPhoto() {
  const label = `现场照片 · 模拟 · ${DEMO.nowText}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dfe2ff"/><stop offset="1" stop-color="#e6faf3"/>
    </linearGradient></defs>
    <rect width="480" height="480" fill="url(#g)"/>
    <circle cx="240" cy="206" r="58" fill="none" stroke="#5b6cff" stroke-width="10" opacity=".5"/>
    <circle cx="240" cy="206" r="20" fill="#5b6cff" opacity=".45"/>
    <text x="240" y="322" font-size="24" fill="#4a5168" text-anchor="middle" font-family="PingFang SC, sans-serif">${label}</text>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function addMock() {
  push({ id: `p${++seq}${Date.now().toString(36)}`, kind: 'photo', src: mockPhoto(), at: DEMO.nowText })
  toast('已生成一张演示照片')
}

function addPlaceholder(reason = '当前设备相机不可用，已记录占位') {
  placeholderNote.value = `${reason}：这张记为缺证，提交后由主管复核。`
  push({
    id: `p${++seq}${Date.now().toString(36)}`,
    kind: 'placeholder',
    src: '',
    note: placeholderNote.value,
    at: DEMO.nowText
  })
  emit('placeholder', placeholderNote.value)
  toastErr('相机不可用，已记占位说明')
}

function choose(sourceType) {
  const left = props.max - list.value.length
  uni.chooseImage({
    count: Math.max(1, left),
    sizeType: ['compressed'],
    sourceType: sourceType === 'camera' ? ['camera'] : ['album', 'camera'],
    success: res => {
      const paths = res.tempFilePaths || []
      paths.slice(0, left).forEach(path => {
        push({ id: `p${++seq}${Date.now().toString(36)}`, kind: 'photo', src: path, at: DEMO.nowText })
      })
    },
    fail: err => {
      const msg = String(err?.errMsg || '')
      /* 用户主动取消不算失败，不落占位 */
      if (msg.includes('cancel')) return
      addPlaceholder(sourceType === 'camera' ? '相机未授权或不可用' : '相册不可用')
    }
  })
}

function onAction(value) {
  if (value === 'camera') choose('camera')
  else if (value === 'album') choose('album')
  else if (value === 'mock') addMock()
  else if (value === 'placeholder') addPlaceholder()
}
</script>

<style scoped>
.pp {
  width: 100%;
}

.pp__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.pp__cell {
  width: 148rpx;
  height: 148rpx;
  border-radius: 16rpx;
  overflow: hidden;
  position: relative;
  background: var(--biz-bg-fill);
}

.pp__img {
  width: 100%;
  height: 100%;
  display: block;
}

.pp__ph {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  border: 3rpx dashed rgba(255, 159, 64, 0.6);
  border-radius: 16rpx;
  background: #fff8f0;
}

.pp__ph-i {
  font-size: 34rpx;
  color: var(--biz-warning);
  line-height: 1;
}

.pp__ph-t {
  font-size: 20rpx;
  color: #a35c13;
}

.pp__del {
  position: absolute;
  top: 0;
  right: 0;
  width: 40rpx;
  height: 40rpx;
  background: rgba(16, 31, 66, 0.55);
  color: #fff;
  font-size: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom-left-radius: 12rpx;
}

.pp__badge {
  position: absolute;
  left: 0;
  bottom: 0;
  right: 0;
  background: rgba(255, 159, 64, 0.9);
  color: #fff;
  font-size: 18rpx;
  text-align: center;
  padding: 4rpx 0;
}

.pp__add {
  width: 148rpx;
  height: 148rpx;
  border-radius: 16rpx;
  border: 3rpx dashed var(--biz-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  background: #fff;
}

.pp__add--hover {
  border-color: var(--biz-primary);
  background: var(--biz-primary-light-9);
}

.pp__add-i {
  font-size: 40rpx;
  color: var(--biz-text-4);
  line-height: 1;
}

.pp__add-t {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.pp__note {
  margin-top: 14rpx;
  display: flex;
  gap: 10rpx;
  padding: 14rpx 18rpx;
  background: #fff8f0;
  border-radius: 12rpx;
}

.pp__note-i {
  flex: none;
  width: 28rpx;
  height: 28rpx;
  border-radius: 50%;
  background: var(--biz-warning);
  color: #fff;
  font-size: 18rpx;
  font-weight: 700;
  text-align: center;
  line-height: 28rpx;
  margin-top: 2rpx;
}

.pp__note-t {
  flex: 1;
  font-size: 22rpx;
  color: #a35c13;
  line-height: 1.5;
}
</style>
