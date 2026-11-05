<template>
  <div class="scan">
    <div class="scan__wrap">
      <!-- 加载 -->
      <div v-if="loading" class="card card--center">
        <div class="spin" />
        <div class="hint">正在读取资产信息…</div>
      </div>

      <!-- 未找到 -->
      <div v-else-if="!view.ok" class="card card--center">
        <div class="mark mark--x">!</div>
        <div class="ttl">未找到该资产</div>
        <div class="hint">
          这个二维码可能已经换过，或者链接不完整。<br />
          如果标签上的编号还在，请把编号报给行政，他们能按编号查到。
        </div>
        <div class="foot">智慧物业 · 资产管理</div>
      </div>

      <!-- 正常（含已报废） -->
      <template v-else>
        <div v-if="view.scrapped" class="banner">该资产已报废，下方信息仅供追溯</div>

        <div class="card">
          <div class="hd">
            <div class="hd__n">{{ view.asset.name }}</div>
            <span class="st" :class="`is-${view.asset.status}`">{{ view.asset.status }}</span>
          </div>
          <div class="hd__c">{{ view.asset.catPath }}</div>

          <div class="rows">
            <div class="row">
              <span class="row__k">资产编号</span>
              <span class="row__v mono">{{ view.asset.assetNo }}</span>
            </div>
            <div class="row">
              <span class="row__k">使用部门</span>
              <span class="row__v">{{ view.asset.orgName }}</span>
            </div>
            <div class="row">
              <span class="row__k">存放位置</span>
              <span class="row__v">{{ view.asset.location }}</span>
            </div>
            <div class="row">
              <span class="row__k">保修到期</span>
              <span class="row__v" :class="{ 'is-out': view.asset.warrantyExpired }">
                {{ view.asset.warrantyEnd }}
                <span v-if="view.asset.warrantyExpired" class="tag-out">已过保</span>
              </span>
            </div>
          </div>
        </div>

        <div class="note">
          本页<b>不需要登录</b>即可查看，只展示资产的基本归属信息。<br />
          如需报修或领用，请在公司内部系统中操作。
        </div>

        <div class="foot">智慧物业 · 资产管理</div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { assetPublicView } from '@/api'

const route = useRoute()
const token = ref(String(route.params.token || ''))
const loading = ref(true)
const view = ref({ ok: false })

async function load() {
  loading.value = true
  try {
    view.value = await assetPublicView(token.value)
  } catch {
    /* 接口异常也走「未找到」：这个页面给的是外部用户，不该暴露内部错误细节 */
    view.value = { ok: false, reason: 'error' }
  } finally {
    loading.value = false
  }
}

/* 标题：后台的 index.html 写的是「智慧物业 V2 · 高保真原型」，
   扫码的人看到这个会莫名其妙 —— 进这一页时换成「资产信息」。 */
let _prevTitle = ''

/* body 上有 `min-width: var(--layout-min-w)`（后台的 PC 布局基线，约 1280）。
   扫码的人用的是手机，留着它会把整页撑到 1280、内容挤在左边一条。
   进这一页时摘掉，离开时还原 —— 只影响这一页，后台布局不动。 */
let _prevBodyMinW = ''

onMounted(() => {
  _prevTitle = document.title
  document.title = '资产信息'
  _prevBodyMinW = document.body.style.minWidth
  document.body.style.minWidth = '0'
  load()
})
onUnmounted(() => {
  if (_prevTitle) document.title = _prevTitle
  document.body.style.minWidth = _prevBodyMinW
})

watch(token, load)
watch(() => route.params.token, v => { token.value = String(v || '') })
</script>

<style scoped>
/* PC 后台的 body 上有 `min-width: var(--layout-min-w)`（约 1280），
   扫码页在手机上会被这个最小宽度撑开、内容挤在左边一条。
   用 fixed 脱离文档流，直接按视口定宽 —— 手机上是满屏，PC 上是居中的一列。 */
.scan {
  position: fixed;
  inset: 0;
  overflow-y: auto;
  background: var(--biz-bg-page, #f5f6f8);
  padding: 20px 16px 40px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  box-sizing: border-box;
}
.scan__wrap { width: 100%; max-width: 420px; }

.card {
  background: var(--biz-bg-card, #fff);
  border-radius: 14px;
  padding: 20px 18px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .06);
}
.card--center { text-align: center; padding: 36px 22px; }
.card + .note { margin-top: 12px; }

.banner {
  margin-bottom: 10px;
  padding: 9px 14px;
  border-radius: 10px;
  background: rgba(136, 135, 128, .14);
  color: var(--biz-text-2, #5f5e5a);
  font-size: 12.5px;
  text-align: center;
}

.hd { display: flex; align-items: flex-start; gap: 10px; }
.hd__n { flex: 1; font-size: 18px; font-weight: 600; line-height: 1.35; color: var(--biz-text-1, #1f2024); }
.hd__c { margin-top: 6px; font-size: 12.5px; color: var(--biz-text-3, #8a8f99); }

.st { flex: none; font-size: 12px; padding: 2px 10px; border-radius: 11px; margin-top: 2px; }
.st.is-在用 { background: rgba(18, 185, 138, .12); color: #12b98a; }
.st.is-闲置 { background: rgba(217, 138, 31, .12); color: #d98a1f; }
.st.is-报废 { background: rgba(136, 135, 128, .14); color: #5f5e5a; }

.rows { margin-top: 16px; border-top: 1px solid var(--biz-border, #eceef2); }
.row { display: flex; align-items: baseline; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--biz-border, #eceef2); }
.row:last-child { border-bottom: 0; padding-bottom: 2px; }
.row__k { flex: none; width: 74px; font-size: 13px; color: var(--biz-text-3, #8a8f99); }
.row__v { flex: 1; font-size: 14px; color: var(--biz-text-1, #1f2024); word-break: break-all; }
.row__v.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13.5px; letter-spacing: .3px; }
.row__v.is-out { color: #e34d59; }
.tag-out { font-size: 11px; border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; margin-left: 4px; }

.note {
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(91, 108, 255, .06);
  font-size: 12px;
  line-height: 1.75;
  color: var(--biz-text-2, #5f5e5a);
}
.note b { color: var(--biz-text-1, #1f2024); }

.foot { margin-top: 18px; text-align: center; font-size: 11.5px; color: var(--biz-text-3, #a8adb7); }

.mark {
  width: 48px; height: 48px; margin: 0 auto 14px; border-radius: 50%;
  display: grid; place-items: center; font-size: 24px; font-weight: 600;
}
.mark--x { background: rgba(227, 77, 89, .1); color: #e34d59; }
.ttl { font-size: 16px; font-weight: 600; color: var(--biz-text-1, #1f2024); }
.hint { margin-top: 10px; font-size: 12.5px; line-height: 1.8; color: var(--biz-text-3, #8a8f99); }

.spin {
  width: 26px; height: 26px; margin: 0 auto 12px;
  border: 2px solid rgba(0, 0, 0, .08);
  border-top-color: var(--biz-primary, #5b6cff);
  border-radius: 50%;
  animation: sp .8s linear infinite;
}
@keyframes sp { to { transform: rotate(360deg); } }
</style>
