/**
 * 租售信息 fixtures 生成器（PC 第 69 批）
 * ----------------------------------------------------------------
 * 为什么要有这个脚本：这两份源数据在 `03-原型/src/utils/api.js` 里是**运行时种子**
 * （PRNG + 手写状态排布），不是静态 JSON。直接手写 fixtures 会出现
 * "HTTP 模式 14 条、前端 mock 也是 14 条但价格不一样"这种最难查的问题。
 *
 * 所以这里把 `_lvSeed()` 的生成逻辑照抄一遍（含 PRNG 种子 20261106 + 69 与
 * 固定的 hoursAgo 排布），保证两边**同一份数字**：
 *   挂牌 14 条（待审 4 / 已发布 6 / 驳回 1 / 下架 1 / 过期 1 / 成交 1）
 *   看房请求 10 条（待联系 4 / 已联系 3 / 已带看 1 / 已关闭 2）
 *
 * 用法：node scripts/gen-listings-fixture.mjs
 * 源文件变了就重跑，别手改 fixtures。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.resolve(ROOT, '../03-原型/src/mock')
const OUT = path.join(ROOT, 'fixtures')

const readSrc = f => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'))
const write = (name, rows) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(rows, null, 2) + '\n')
  console.log(`  ${name}  ${rows.length} 条`)
}

/**
 * 注意：这里读的是 **fixtures 的抽样集**（220 套 / 80 人），不是 03 的 756 套全量。
 * 契约样例集本身就是抽样（`gen-fixtures.mjs` 里 owners 60 / houses 160），
 * 如果挂牌挂到抽样之外的房子上，mock-server join 不到面积户型，详情页就是空的。
 *
 * 代价：契约样例的 14 条挂牌与前端 mock（756 套全量）不是同一批房子，
 * 价格也不相同。结构、状态分布、业务规则一致，**数字不要求逐条相同**。
 * 业主端开发时若要从 mock 切到 HTTP，看到的是另一批样例房源 —— 这是既有的抽样约定。
 */
const houses = JSON.parse(fs.readFileSync(path.join(OUT, 'houses.json'), 'utf8'))
const employees = JSON.parse(fs.readFileSync(path.join(OUT, 'employees.json'), 'utf8'))
const ownerIds = new Set(JSON.parse(fs.readFileSync(path.join(OUT, 'owners.json'), 'utf8')).map(o => o.ownerId))

/* 与 03-原型/src/utils/api.js 保持一致的常量 */
const TODAY = '2026-10-21'
const DECORATE = ['毛坯', '简装', '精装', '豪装']
const PAY_TERM = ['押一付一', '押一付三', '押二付一', '半年付', '年付']

const lvNow = () => new Date(`${TODAY}T10:00:00`)
const communityOfOrg = orgId => {
  const m = /^O-(P\d{2})/.exec(String(orgId || ''))
  return m ? m[1] : ''
}
const lvRand = seed => {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

const LISTINGS = []
const VIEWINGS = []
let lvSeq = 0
let lvViewSeq = 0

/* ============================ ① 挂牌 ============================ */
const rng = lvRand(20261106 + 69)
const pick = list => list[Math.floor(rng() * list.length) % list.length]

/* 产权人也必须在样例集里：否则 mock-server join 不到人，审核页的"产权人"是空的。
   契约的 owners 只有 60 条，交集只有 47 套房子 —— 够用，但必须显式过滤。 */
const pool = houses.filter(h =>
  h.usage === '住宅' && h.useStatus === '已入住' && h.ownerId && h.stewardEmpId && ownerIds.has(h.ownerId))
const picked = []
const used = new Set()
const take = h => { if (h && !used.has(h.houseId)) { used.add(h.houseId); picked.push(h); return true } return false }

/* 先保证「楼栋管家锚点」名下有 6 套，否则演示用楼管进责任范围看到 0 条 */
const stw = employees.filter(e => e.position === '楼栋管家' && e.status !== '离职')
const anchorSteward = stw.find(e => communityOfOrg(e.orgId)) || stw[0]
if (anchorSteward) pool.filter(h => h.stewardEmpId === anchorSteward.empId).slice(0, 6).forEach(take)
let guard = 0
while (picked.length < 14 && guard < 4000) {
  guard += 1
  take(pool[Math.floor(rng() * pool.length) % pool.length])
}

const FAC_GROUPS = [
  ['冰箱', '洗衣机', '空调', '热水器', '宽带', '家私'],
  ['空调', '热水器', '宽带'],
  ['冰箱', '洗衣机', '空调', '热水器', '电梯'],
  ['空调', '宽带', '家私', '车位']
]
const DESCS = [
  '自住出租，家具家电齐全，可拎包入住。小区中间楼层，采光好，楼下就是儿童乐园。',
  '业主长期在外地，房子一直空着，希望租给爱干净、稳定的家庭。',
  '近地铁 4 号线，步行 8 分钟。周边有菜市场和幼儿园，适合小两口。',
  '刚做过深度保洁，厨房卫生间都是新换的。不接受养宠物，介意勿扰。',
  '南北通透，主卧带阳台。租期一年起，押一付三。',
  '业主自住三年，保养得好。楼下有充电桩车位，有车的话可以一起租。'
]

const plan = [
  { status: '待审核', hoursAgo: 60 },
  { status: '待审核', hoursAgo: 52 },
  { status: '待审核', hoursAgo: 30 },
  { status: '待审核', hoursAgo: 3 },
  { status: '已发布', hoursAgo: 240 },
  { status: '已发布', hoursAgo: 190 },
  { status: '已发布', hoursAgo: 150 },
  { status: '已发布', hoursAgo: 96 },
  { status: '已发布', hoursAgo: 40 },
  { status: '已发布', hoursAgo: 12 },
  { status: '已驳回', hoursAgo: 72, rejectReason: '第 3 张图拍到了门牌号，请删掉或打码后重新提交' },
  { status: '已下架', hoursAgo: 300, offlineReason: '业主已当面告知房子已租出，联系不上，先强制下架' },
  { status: '已过期', hoursAgo: 1600 },
  { status: '已成交', hoursAgo: 700, dealAt: '2026-10-02 15:20' }
]

const pad = n => String(n).padStart(2, '0')

plan.forEach((p, i) => {
  const h = picked[i]
  lvSeq += 1
  const createdAt = new Date(lvNow().getTime() - p.hoursAgo * 3600000)
  const at = `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())} ${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`
  const dec = pick(DECORATE)
  const area = Number(h.area) || 90
  const rate = 25 + Math.round(rng() * 7)
  const price = Math.round((area * rate) / 50) * 50
  const expireAt = new Date(createdAt.getTime() + 60 * 86400000)
  LISTINGS.push({
    listingId: `LS${String(lvSeq).padStart(5, '0')}`,
    houseId: h.houseId,
    ownerId: h.ownerId,
    publisherUserId: h.ownerId,
    stewardEmpId: h.stewardEmpId,
    type: '出租',
    price,
    deposit: price,
    payTerm: pick(PAY_TERM),
    decorate: dec,
    facilities: pick(FAC_GROUPS),
    availableFrom: `${TODAY.slice(0, 8)}${pad((rng() > 0.5 ? 25 : 28))}`,
    desc: pick(DESCS),
    images: 4 + Math.floor(rng() * 5),
    status: p.status,
    contentVersion: p.status === '已驳回' ? 2 : 1,
    auditedVersion: ['已发布', '已下架', '已过期', '已成交'].includes(p.status) ? 1 : 0,
    createdAt: at,
    expireAt: `${expireAt.getFullYear()}-${pad(expireAt.getMonth() + 1)}-${pad(expireAt.getDate())}`,
    dealAt: p.dealAt || '',
    auditBy: ['已发布', '已下架', '已过期', '已成交', '已驳回'].includes(p.status) ? '莫瑞' : '',
    auditAt: ['已发布', '已下架', '已过期', '已成交', '已驳回'].includes(p.status) ? at : '',
    rejectReason: p.rejectReason || '',
    offlineBy: p.status === '已下架' ? '徐悦' : '',
    offlineAt: p.status === '已下架' ? at : '',
    offlineReason: p.offlineReason || '',
    viewCount: 20 + Math.floor(rng() * 300)
  })
})

/* ======================== ② 看房请求 ======================== */
const published = LISTINGS.filter(l => l.status === '已发布')
const NAMES = ['刘敏', '张伟', '陈晓东', '王丽娜', '李强', '周文娟', '赵磊', '孙倩']
const TIMES = ['工作日白天', '工作日晚上', '周末']
const NOTES = ['在附近上班，想月底前搬进来', '带一个小孩，两室够用就行', '先看看，不着急', '预算 3000 以内']
const vPlan = [
  { status: '待联系', hoursAgo: 70 },
  { status: '待联系', hoursAgo: 30 },
  { status: '待联系', hoursAgo: 6 },
  { status: '待联系', hoursAgo: 2 },
  { status: '已联系', hoursAgo: 48, result: '已电话沟通，约周六上午看房' },
  { status: '已联系', hoursAgo: 20, result: '客户出差，下周再联系' },
  { status: '已联系', hoursAgo: 10, result: '已告知押一付三，客户考虑中' },
  { status: '已带看', hoursAgo: 36, result: '已看房，客户觉得楼层偏低' },
  { status: '已关闭', hoursAgo: 60, result: '客户已租别处' },
  { status: '已关闭', hoursAgo: 26, result: '号码停机，联系不上' }
]
vPlan.forEach((p, i) => {
  const l = published[i % published.length]
  lvViewSeq += 1
  const createdAt = new Date(lvNow().getTime() - p.hoursAgo * 3600000)
  VIEWINGS.push({
    viewingId: `VW${String(lvViewSeq).padStart(5, '0')}`,
    listingId: l.listingId,
    name: NAMES[i % NAMES.length],
    phone: `139${String(10000000 + i * 3317).slice(-8)}`,
    preferredTime: TIMES[i % TIMES.length],
    note: NOTES[i % NOTES.length],
    status: p.status,
    createdAt: `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())} ${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`,
    handledBy: p.status === '待联系' ? '' : '莫瑞',
    handledAt: p.status === '待联系' ? '' : `${TODAY} 09:${pad(20 + i)}`,
    resultNote: p.result || ''
  })
})

console.log('生成租售 fixtures：')
write('listings.json', LISTINGS)
write('listings-viewings.json', VIEWINGS)

const byStatus = LISTINGS.reduce((m, l) => { m[l.status] = (m[l.status] || 0) + 1; return m }, {})
console.log('  挂牌状态：', byStatus)
console.log('  看房请求：', VIEWINGS.reduce((m, v) => { m[v.status] = (m[v.status] || 0) + 1; return m }, {}))
