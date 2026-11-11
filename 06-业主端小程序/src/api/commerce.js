/**
 * 商业平台账户（2026-11-11）
 * ------------------------------------------------------------
 * **只读镜像**：这里只有积分与优惠券，**没有余额**。
 *
 * 为什么不给余额：商业平台储值与物业预存是两笔钱（两个主体、两套对账）。
 * 放在一起业主一定会问"能不能交物业费"，而这个问题的答案是"不能"。
 * 所以物业端不展示商业余额，也不支持拿它抵任何账单。
 *
 * 券的领取与核销都在商业平台：物业端只展示 + 给 `claimUrl`，
 * 写它的库就等于替另一家公司记账。
 */
import { IS_API } from './client'
import { fetchCommerce } from './remote'

const remote = { data: null, err: '' }
export const commerceLoaded = () => !IS_API || remote.data !== null

/** 本地演示种子：与 04 fixtures 同口径，免得"接口模式有、本地模式空" */
const LOCAL_DEMO = {
  memberName: '张建国',
  syncedAt: '2026-10-20 07:00',
  points: 1280,
  pointsExpiring: 200,
  pointsExpireAt: '2026-12-31',
  level: '银卡会员',
  levelNext: '金卡会员',
  levelProgress: { current: 1280, next: 2000 },
  coupons: [
    {
      couponId: 'CP001',
      title: '邻里中心通用券',
      type: '满减',
      faceValue: 20,
      threshold: 100,
      scope: '邻里中心 · 生活服务',
      validFrom: '2026-10-01',
      validTo: '2026-11-30',
      status: '可领取',
      claimUrl: 'https://example.com/commerce/coupon/CP001'
    },
    {
      couponId: 'CP002',
      title: '生鲜到家免配送费',
      type: '免邮',
      faceValue: 8,
      threshold: 0,
      scope: '生鲜到家',
      validFrom: '2026-10-15',
      validTo: '2026-11-15',
      status: '可领取',
      claimUrl: 'https://example.com/commerce/coupon/CP002'
    },
    {
      couponId: 'CP003',
      title: '邻里节 8 折券',
      type: '折扣',
      faceValue: 0,
      threshold: 0,
      scope: '邻里节活动商家',
      validFrom: '2026-09-01',
      validTo: '2026-10-10',
      status: '已过期',
      claimUrl: 'https://example.com/commerce/coupon/CP003'
    }
  ]
}

/**
 * 拉一次镜像。
 *
 * 404 = 该业主还没在商业平台注册（不是错误，页面显示"尚未开通商业账户"）；
 * 其他错误照常抛，页面给"加载失败，可重试"。
 */
export async function loadCommerce() {
  if (!IS_API) return
  try {
    remote.data = await fetchCommerce()
    remote.err = ''
  } catch (e) {
    remote.data = null
    remote.err = e?.status === 404 ? 'none' : 'err'
    if (remote.err === 'err') throw e
  }
}

export const commerceError = () => remote.err

export function commerceAccount() {
  if (!IS_API) return LOCAL_DEMO
  return remote.data
}

/** 可领的券排在前面：页面一进来先看到"能拿的"，而不是已经过期的 */
export function commerceCoupons() {
  const list = commerceAccount()?.coupons || []
  const rank = { 可领取: 0, 已领取: 1, 已过期: 2 }
  return [...list].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
}

export const commercePoints = () => commerceAccount()?.points || 0
