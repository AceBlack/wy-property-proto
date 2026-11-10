/**
 * 人脸申请单 fixtures（批次 83）
 * ----------------------------------------------------------------
 * 批次 80 在业主端做了「刷脸通行」，状态存在 `app.faces` 里，种子从物业档案的
 * `faceRegistered` 布尔派生。那个布尔在后台是**手工开关**，不是核验动作 ——
 * 所以接口化时不能沿用，要建真正的申请单。
 *
 * 模型：**申请单是唯一真相**，`members.faceStatus` 是它的投影。
 * 与车位那边 `expireDate` 是账单投影同一个道理：派生值可以有，但不能有第二个写入口。
 *
 * 五态里「未采集」不落记录（没有申请单就是没采集），其余四态各来一条样例 ——
 * 否则演示时整页一个样子，看不出"待核验 / 已驳回 / 已冻结"长什么样：
 *
 *   | 主体 | 状态 | 用来演示 |
 *   |---|---|---|
 *   | 张建国（本人） | 已生效 | 常态：刷脸即可通行 |
 *   | 陈静（配偶，已核验） | 已生效 | 业主帮家人录过后已通过 |
 *   | 王小雪（子女，**未核验**） | 未采集 | 成员没核验就没有"帮他录"入口 |
 *   | 李秀兰（本人） | 待核验 | 昨天提交，物业还没审 |
 *   | 王浩然（本人） | 已驳回 | 照片模糊，带原因 |
 *
 * 刻意**不给**任何影像件：原型不存真图，`images` 只记张数。
 *
 * 用法：node scripts/gen-face-fixtures.mjs
 * 自检：成员必须属于该业主、已核验成员才能有待核验/已生效的申请、驳回必须带原因。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'fixtures')

const readFx = f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))
const write = (name, rows) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(rows, null, 2) + '\n')
  console.log(`  ${name}  ${Array.isArray(rows) ? rows.length + ' 条' : '对象'}`)
}

const owners = readFx('owners.json')
const members = readFx('members.json')
const houses = readFx('houses.json')

const ownerById = new Map(owners.map(o => [o.ownerId, o]))
const memberById = new Map(members.map(m => [m.memberId, m]))
const firstHouseOf = oid => (houses.find(h => h.ownerId === oid) || {}).houseId || ''

/** 申请单：`faceId` 一旦生成就不再变，撤回只改状态，不删记录（合规要留痕） */
const faces = [
  {
    faceId: 'FC00001',
    subjectType: '业主',
    ownerId: 'OW00001',
    memberId: '',
    houseId: firstHouseOf('OW00001'),
    name: '张建国',
    relation: '本人',
    status: '已生效',
    submittedAt: '2026-03-11 10:20',
    auditAt: '2026-03-11 16:05',
    auditBy: '周敏',
    rejectReason: '',
    frozenReason: '',
    guardian: '',
    images: 2
  },
  {
    faceId: 'FC00002',
    subjectType: '家属',
    ownerId: 'OW00001',
    memberId: 'MB00001',
    houseId: firstHouseOf('OW00001'),
    name: '陈静',
    relation: '配偶',
    status: '已生效',
    submittedAt: '2026-03-12 09:10',
    auditAt: '2026-03-12 14:30',
    auditBy: '周敏',
    /* 代录要留痕：老人孩子不会自己传照片，出事时要能追到是谁代同意的 */
    guardian: '张建国（配偶，代同意）',
    images: 2
  },
  {
    faceId: 'FC00003',
    subjectType: '业主',
    ownerId: 'OW00002',
    memberId: '',
    houseId: firstHouseOf('OW00002'),
    name: '李秀兰',
    relation: '本人',
    status: '待核验',
    submittedAt: '2026-10-20 08:40',
    auditAt: '',
    auditBy: '',
    rejectReason: '',
    frozenReason: '',
    guardian: '',
    images: 2
  },
  {
    faceId: 'FC00004',
    subjectType: '业主',
    ownerId: 'OW00003',
    memberId: '',
    houseId: firstHouseOf('OW00003'),
    name: '王浩然',
    relation: '本人',
    status: '已驳回',
    submittedAt: '2026-10-18 19:02',
    auditAt: '2026-10-19 09:15',
    auditBy: '周敏',
    /* 驳回必须带原因：业主看得到这句，是他重拍的唯一依据 */
    rejectReason: '照片逆光、面部不清晰，请在光线均匀处正对镜头重拍',
    frozenReason: '',
    guardian: '',
    images: 1
  }
]

write('access-faces.json', faces)

/* ============================ members.faceStatus 投影 ============================ */
/**
 * 只给"已核验成员"算状态：未核验的成员按产品规则**不能被代录**，
 * 所以他们的 faceStatus 恒为「未采集」—— 写别的值等于承认"未核验也能录"。
 */
const latestOf = memberId => faces
  .filter(f => f.memberId === memberId)
  .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))[0]

const membersOut = members.map(m => {
  const hit = m.certified ? latestOf(m.memberId) : null
  return {
    ...m,
    faceStatus: hit ? hit.status : '未采集',
    faceUpdatedAt: hit ? (hit.auditAt || hit.submittedAt) : ''
  }
})
write('members.json', membersOut)

/* ============================ 自检 ============================ */
const problems = []
const STATUS = ['待核验', '已生效', '已驳回', '已冻结']

if (new Set(faces.map(f => f.faceId)).size !== faces.length) problems.push('faceId 有重复')

for (const f of faces) {
  if (!ownerById.has(f.ownerId)) problems.push(`${f.faceId} 的业主 ${f.ownerId} 不在档案里`)
  if (!f.houseId) problems.push(`${f.faceId} 没有 houseId`)
  if (!STATUS.includes(f.status)) problems.push(`${f.faceId} 状态非法：${f.status}`)
  if (f.status === '已驳回' && !f.rejectReason) problems.push(`${f.faceId} 驳回了却没写原因`)
  if ((f.status === '已生效' || f.status === '已驳回') && !f.auditAt) problems.push(`${f.faceId} 已审过却没有审计时间`)
  if (f.subjectType === '家属') {
    const m = memberById.get(f.memberId)
    if (!m) problems.push(`${f.faceId} 指向不存在的成员 ${f.memberId}`)
    else if (m.ownerId !== f.ownerId) problems.push(`${f.faceId} 的成员 ${f.memberId} 不属于业主 ${f.ownerId}`)
    else if (!m.certified) problems.push(`${f.faceId} 的成员 ${f.memberId} 未核验，不该有申请单`)
    if (!f.guardian) problems.push(`${f.faceId} 代家人录入却没有监护人留痕`)
  }
  if (f.subjectType === '业主' && f.memberId) problems.push(`${f.faceId} 是业主本人却带了 memberId`)
}

/* 一个主体只能有一条"当前有效"的申请（待核验 / 已生效）：
   两条同时在，页面就不知道显示哪一条，物业也会审两次 */
const live = faces.filter(f => f.status === '待核验' || f.status === '已生效')
const seen = new Set()
for (const f of live) {
  const key = f.memberId ? `m:${f.memberId}` : `o:${f.ownerId}`
  if (seen.has(key)) problems.push(`主体 ${key} 同时存在多条待核验/已生效申请`)
  seen.add(key)
}

if (problems.length) {
  console.error('\n✘ 自检未通过：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

const stat = {}
for (const m of membersOut) stat[m.faceStatus] = (stat[m.faceStatus] || 0) + 1
console.log(`\n✔ 人脸申请单 ${faces.length} 条；家庭成员 ${membersOut.length} 人：` +
  Object.entries(stat).map(([k, v]) => `${k} ${v}`).join(' / '))
console.log(`  业主侧样例：张建国 已生效 · 李秀兰 待核验 · 王浩然 已驳回 · 王小雪（未核验）未采集`)
