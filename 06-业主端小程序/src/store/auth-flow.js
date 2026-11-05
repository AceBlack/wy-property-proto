/**
 * 认证向导的临时状态（选社区 → 选楼栋 → 选房间 → 选身份）。
 * 不放 URL：uni 的页面栈对 query 长度敏感，且 step 之间要回退保留选择；
 * 也不落 localStorage：这是"正在填的表单"，退出小程序就该丢。
 */
import { reactive } from 'vue'

export const flow = reactive({
  communityId: '',
  communityName: '',
  buildingId: '',
  buildingName: '',
  houseId: '',
  houseName: '',
  identity: '业主',
  proof: ''
})

export function resetFlow() {
  Object.assign(flow, {
    communityId: '',
    communityName: '',
    buildingId: '',
    buildingName: '',
    houseId: '',
    houseName: '',
    identity: '业主',
    proof: ''
  })
}
