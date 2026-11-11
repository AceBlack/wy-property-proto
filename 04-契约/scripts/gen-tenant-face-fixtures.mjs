/**
 * 租客人脸申请单 fixtures（H5）
 * ----------------------------------------------------------------
 * 业主的人脸在 `access-faces.json`（批次 83 生成，只含业主与家属）。
 * 租客的人脸此前散在租户编辑里：点一下 `faceRegistered = true`，**没有受理人、没有状态**。
 *
 * H5 的口径是「同一件事只开一个入口」，所以租客也进同一张申请单，只是主体类型不同，
 * 由 PC 的人脸核验工作台按 `subjectType` 分成两段。
 *
 * 单独一个文件而不是并进 `access-faces.json`：那个文件由 `gen-face-fixtures.mjs` 生成，
 * 重跑会连带重写 `members.json` 的人脸投影 —— 为了加两行租客去动 169 个成员的字段不划算。
 *
 * 用法：node scripts/gen-tenant-face-fixtures.mjs
 * 自检：租户必须在住且已实名（未实名的租客轮不到录人脸）、房屋必须存在、待核验不能有审计时间。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'fixtures')
const readFx = f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))

const tenants = readFx('tenants.json')
const houses = readFx('houses.json')
const houseById = new Map(houses.map(h => [h.houseId, h]))

/* 挑两个「在住 + 已实名 + 还没人脸」的租客：这正是待核验队列里真实会出现的两类人 */
const pool = tenants.filter(t => t.status === '在住' && t.certified && !t.faceRegistered && houseById.has(t.houseId))

const rows = [
  {
    faceId: 'FC01001',
    subjectType: '租客',
    tenantId: pool[0]?.tenantId || '',
    ownerId: pool[0]?.ownerId || '',
    memberId: '',
    houseId: pool[0]?.houseId || '',
    name: pool[0]?.name || '',
    relation: '承租人',
    status: '待核验',
    submittedAt: '2026-10-20 18:30',
    auditAt: '',
    auditBy: '',
    rejectReason: '',
    frozenReason: '',
    guardian: '',
    images: 1,
    source: '员工端'
  },
  {
    faceId: 'FC01002',
    subjectType: '租客',
    tenantId: pool[1]?.tenantId || '',
    ownerId: pool[1]?.ownerId || '',
    memberId: '',
    houseId: pool[1]?.houseId || '',
    name: pool[1]?.name || '',
    relation: '承租人',
    status: '待核验',
    submittedAt: '2026-10-21 08:05',
    auditAt: '',
    auditBy: '',
    rejectReason: '',
    frozenReason: '',
    guardian: '',
    images: 1,
    source: '物业前台'
  }
]

/* ============================ 自检 ============================ */
const problems = []
if (pool.length < 2) problems.push(`在住 + 已实名 + 未录人脸的租客只有 ${pool.length} 个，样例要 2 个`)
for (const r of rows) {
  if (!r.tenantId) problems.push(`${r.faceId} 没有 tenantId`)
  if (!houseById.has(r.houseId)) problems.push(`${r.faceId} 的房屋 ${r.houseId} 不存在`)
  if (r.status === '待核验' && (r.auditAt || r.auditBy)) problems.push(`${r.faceId} 待核验却有审计时间`)
  if (r.status === '已驳回' && !r.rejectReason) problems.push(`${r.faceId} 驳回没写原因`)
}
if (problems.length) {
  console.error('\n✘ 自检未通过：')
  problems.forEach(p => console.error('  - ' + p))
  process.exit(1)
}

fs.writeFileSync(path.join(OUT, 'access-faces-tenants.json'), JSON.stringify(rows, null, 2) + '\n')
console.log(`✔ access-faces-tenants.json  ${rows.length} 条（待核验）`)
rows.forEach(r => console.log(`   ${r.faceId} ${r.name} · ${houses.find(h => h.houseId === r.houseId)?.shortName || r.houseId} · 来源 ${r.source}`))
