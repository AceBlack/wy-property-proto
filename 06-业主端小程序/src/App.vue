<script setup>
import { onLaunch } from '@dcloudio/uni-app'
import { rehydrate } from '@/store/app'
import { hydrate, hydratePublic } from '@/api/remote'

/**
 * 演示态写回重放：增项 / 支付 / 评价 / 新单 / 评论 / 报名 都落在内存 mock 上，
 * 同时把「改了什么」存进 localStorage，重新打开时按增量再打一遍。
 *
 * 批 B 起多一步：接口模式下把服务端快照拉一遍（房屋 / 住户 / 账单 / 价目）。
 * 刷新页面时 token 还在，但内存里的快照没了，不拉就会出现"房在、账单空"。
 */
onLaunch(() => {
  rehydrate()
  hydrate()
  /* 公开房源免登录：没登录也该看到真实房源，而不是本地那 14 条 */
  hydratePublic()
})
</script>

<style>
@import './styles/tokens.css';
@import './styles/app.css';
</style>
