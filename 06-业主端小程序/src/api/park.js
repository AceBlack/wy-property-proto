/**
 * 我的车位（批次 79）
 * ------------------------------------------------------------
 * 数据源：`@pc/mock` 的 parkings / vehicles / bills —— 与家庭账单**同一份**。
 * 契约化排在批次 82（等员工端窗口收工再动 04），这一版不写伪接口分支：
 * 写一个 `if (IS_API) return 本地数据` 等于让"接口模式"看起来通了，而数据仍来自 bundle。
 *
 * 三条口径写在这一层，页面只读结果（不在页面里重算，否则就有第二个真相）：
 *   1. **归属看 `parkings.ownerId`，不看房**：车位是独立资产，账单也不挂房
 *      （`bills` 里 1,344 条 houseId 为空的记录就是它）；
 *   2. **到期日只有一个来源**：`parkings.expireDate`（本地预缴后存 `app.parkExpire`）。
 *      接口化后它等于「管理费已缴至的账期末」，缴费后顺延 —— 不要另存一个手填日期；
 *   3. **换绑额度 = 本车位 + 自然月**，记录在 `app.parkLogs`，默认 1 次。
 *      阈值将来由后台 `/e/config` 下发（任务清单 H1），这一版是常量，不是"忘了做"。
 *
 * 规则本身在 `park-rule.mjs`（纯函数，`check:data` 直接跑），这里只做"取数 + 落 store"。
 */
import { bills, parkings, vehicles } from '@pc/mock'
import { activeBinding, app, identity, isRealname, persist } from '@/store/app'
import { DEMO, stamp } from '@/config/demo'
import {
  daysBetween, expiryOf as expiryRule, nextExpire, nextMonthFirst,
  normalizePlate, usedThisMonth, validPlate
} from './park-rule.mjs'

/* 页面只从 api 层取东西：规则住在 park-rule.mjs（纯函数、可被 check:data 直接跑），
   但页面不必知道这个分层，这里转出去 */
export { normalizePlate, validPlate }

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/** 换绑阈值：后台可配（H1），原型固定 1 次/车位/自然月 */
export const PLATE_LIMIT = 1
export const RENEW_MONTHS = [3, 6, 12]

const ownerIdOf = () => activeBinding.value?.ownerId || ''
const today = () => DEMO.today

/* ============================ 一、归属 ============================ */

/**
 * 我名下的车位。
 *
 * 租客返回空数组而不是"业主的车位"：租客通行靠租约核验后的人脸/门禁卡，
 * 车位归属与缴费都是业主的事，把业主的车位摆给租客看只会多一次误会。
 */
export function myParkings() {
  const oid = ownerIdOf()
  if (!oid) return []
  if (identity.value === '租客') return []
  return parkings.filter(p => p.ownerId === oid)
}

export const parkingOf = parkId => myParkings().find(p => p.parkId === parkId) || null

/** 当前车牌：本地换绑过的优先（刷新后仍生效） */
export const plateOf = p => app.parkPlates[p.parkId] || p.plateNo || ''

/** 当前到期日：预缴过的优先 */
export const expireOf = p => app.parkExpire[p.parkId] || p.expireDate || ''

export const vehiclesOf = parkId => vehicles.filter(v => v.parkId === parkId)

/**
 * 车位管理费账单。
 *
 * 03 的账单**带 `parkId`**（1344 条全有），所以能精确到车位 —— 两个车位的业主不会串账。
 * 04 的 fixtures 把 `parkId` 裁掉了（投影白名单没带上），那种情况退回"按业主归集"，
 * 并在页面上如实说明。补齐 fixtures 是批次 82 的事。
 */
export const parkBillsOf = parkId => {
  const oid = ownerIdOf()
  const all = bills.filter(b => !b.houseId && b.ownerId === oid)
  /* 数据里一条 parkId 都没有 = 这份样例是裁剪过的，只能按业主收 */
  const stripped = all.some(b => !b.parkId)
  const rows = stripped || !parkId ? all : all.filter(b => b.parkId === parkId)
  return rows
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
    .map(b => ({
      billId: b.billId,
      period: b.period,
      itemName: b.itemName || '车位管理费',
      payable: Number(b.payable) || 0,
      unpaid: Number(b.unpaid) || 0,
      status: b.status,
      isDebt: ['未缴', '部分缴', '逾期'].includes(b.status) && (Number(b.unpaid) || 0) > 0
    }))
}

/* ============================ 二、到期 ============================ */

export const daysLeft = date => daysBetween(date, today())

/** 到期展示（分档在纯函数里，页面只挑颜色） */
export const expiryOf = p => expiryRule(expireOf(p), today())

/* ============================ 三、换绑额度与校验 ============================ */

/** 历史样例：让人第一次打开就能看到"记录长什么样"，不然页面永远是空态 */
const SEED_LOGS = [
  {
    logId: 'PKL0001',
    parkId: 'PK00115',
    parkNo: 'B1-115',
    fromPlate: '川B·SFK21',
    toPlate: '川B·SFV7D',
    source: '物业代操作',
    operatorName: '莫瑞',
    operatorIdentity: '楼栋管家',
    at: '2026-09-12 15:20',
    vendorStatus: '已同步',
    reason: '原车牌过户'
  }
]

export function changeLogsOf(parkId) {
  return [...app.parkLogs.filter(l => l.parkId === parkId), ...SEED_LOGS.filter(l => l.parkId === parkId)]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

export function quotaOf(parkId) {
  const used = usedThisMonth(changeLogsOf(parkId), parkId, today())
  return { limit: PLATE_LIMIT, used, left: Math.max(0, PLATE_LIMIT - used), month: today().slice(0, 7) }
}

/**
 * 换绑四条前置。
 *
 * 顺序是刻意的：**身份 → 实名 → 到期 → 次数**。前两条是"有没有资格"，
 * 后两条是"现在能不能办"；把次数放前面，用户会先点一次发现不行，
 * 再看一眼才发现"哦我管理费过期了"。
 */
export function changeGuard(parkId) {
  const p = parkingOf(parkId)
  if (!p) {
    return { ok: false, park: null, quota: { limit: PLATE_LIMIT, used: 0, left: 0 }, reasons: [{ code: 'park', text: '这个车位不在您名下' }] }
  }
  const reasons = []
  if (identity.value !== '业主') reasons.push({ code: 'role', text: '换绑只对产权业主开放，家属/租客请联系业主或管家' })
  if (!isRealname.value) reasons.push({ code: 'realname', text: '请先完成实名认证' })

  const exp = expiryOf(p)
  if (exp.days !== null && exp.days < 0) {
    reasons.push({ code: 'expired', text: `车位管理费已于 ${exp.date} 到期，续费后可换绑` })
  }
  const quota = quotaOf(parkId)
  if (quota.left <= 0) {
    reasons.push({ code: 'quota', text: `本月换绑 ${quota.used}/${quota.limit} 次已用完，${nextMonthFirst(today())} 恢复` })
  }
  return { ok: reasons.length === 0, park: p, quota, reasons, expiry: exp }
}

/**
 * 换绑：**不经物业审核，但必须留痕**。
 * 返回记录，调用方用它渲染成功态（含"道闸同步"的承诺）。
 */
export function changePlate(parkId, rawPlate) {
  const g = changeGuard(parkId)
  if (!g.ok) {
    const e = new Error(g.reasons[0].text)
    e.code = g.reasons[0].code
    throw e
  }
  const plate = normalizePlate(rawPlate)
  if (!validPlate(plate)) throw new Error('车牌号格式不对，应为「川B·SFV7D」这样')
  if (plate === plateOf(g.park)) throw new Error('和当前车牌一样，不用换绑')

  /* 同一业主的另一个车位已用这个车牌：一辆车不能占两个车位 */
  const dup = myParkings().find(p => p.parkId !== parkId && plateOf(p) === plate)
  if (dup) throw new Error(`${plate} 已绑在 ${dup.parkNo} 上，一辆车不能占两个车位`)

  const log = {
    logId: `PKL${String(app.parkLogs.length + 2).padStart(4, '0')}`,
    parkId,
    parkNo: g.park.parkNo,
    fromPlate: plateOf(g.park),
    toPlate: plate,
    source: '业主自助',
    operatorName: app.session?.name || '',
    operatorIdentity: identity.value,
    at: stamp(),
    /* 厂商回执没有，就别编"已同步" —— 车牌识别系统还没对接（任务清单 H2） */
    vendorStatus: '待同步',
    reason: ''
  }
  app.parkPlates[parkId] = plate
  app.parkLogs.unshift(log)
  persist()
  return log
}

/* ============================ 四、预缴（续费） ============================ */

export const renewAmount = (p, months) => r2((Number(p.feeStandard) || 0) * Number(months || 0))

/** 预缴后的到期日预览（确认框与实际写入共用这一处） */
export const renewPreview = (p, months) => nextExpire(expireOf(p), today(), months)

export function paysOf(parkId) {
  return app.parkPays.filter(x => x.parkId === parkId).sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

/**
 * 预缴车位管理费：写一条流水 + 到期日顺延。
 *
 * **不并入家庭账单**：并入要改 `api/mp.js` 的账单层，而那个文件此刻正被员工端窗口改。
 * 这里记成"预缴"——预缴的是未来账期，本来就不在当期欠费里，所以待缴合计不受影响，
 * 不构成第二份金额真相。并入账单在批次 82 一起做。
 */
export function renew(parkId, months) {
  const p = parkingOf(parkId)
  if (!p) throw new Error('这个车位不在您名下')
  if (identity.value !== '业主') throw new Error('只有产权业主可以预缴车位管理费')
  const n = Number(months) || 0
  if (!RENEW_MONTHS.includes(n)) throw new Error('预缴月数只能选 3 / 6 / 12')

  const rec = {
    payId: `PKP${String(app.parkPays.length + 1).padStart(4, '0')}`,
    parkId,
    parkNo: p.parkNo,
    months: n,
    amount: renewAmount(p, n),
    from: expireOf(p),
    to: renewPreview(p, n),
    at: stamp(),
    method: '微信支付（模拟）',
    source: '业主自助'
  }
  app.parkPays.unshift(rec)
  app.parkExpire[parkId] = rec.to
  persist()
  return rec
}
