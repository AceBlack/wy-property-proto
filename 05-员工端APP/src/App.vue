<script setup>
import { watch } from 'vue'
import { onLaunch } from '@dcloudio/uni-app'
import { app, syncPending } from '@/store/app'
import { toastOk } from '@/utils/ui'

onLaunch(() => {
  /* 真实网络状态只作为初值参考；演示里可以手动切「弱网/断网」 */
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) app.net = 'offline'
  } catch (e) {
    /* 非浏览器环境忽略 */
  }
})

/* 从「断网」切回「在线」时自动把待同步的提交送上去 */
watch(
  () => app.net,
  async v => {
    if (v !== 'online' || !app.pending.length) return
    const r = await syncPending()
    if (r.ok) toastOk(`已同步 ${r.ok} 条待上传记录`)
  }
)
</script>

<style>
@import './styles/tokens.css';
@import './styles/app.css';
</style>
