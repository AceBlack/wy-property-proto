<script setup>
import { onLaunch } from '@dcloudio/uni-app'
import { rehydrate } from '@/store/app'

/**
 * 演示态写回重放：增项 / 支付 / 评价 / 新单 / 评论 / 报名 都落在内存 mock 上，
 * 同时把「改了什么」存进 localStorage，重新打开时按增量再打一遍。
 */
onLaunch(() => {
  rehydrate()
})
</script>

<style>
@import './styles/tokens.css';
@import './styles/app.css';
</style>
