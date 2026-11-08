/**
 * 家属样例生成
 * ----------------------------------------------------------------
 * 为什么单独一个脚本：家属（members）在 `04/fixtures` 里一直没有 —— 业主端能跑，
 * 是因为它直读 `02/mock` 的全量数据。一旦切到接口，家属就登不上：
 * mock 服务的登录按手机号在 owners / members / tenants 三张表里找，没有 members 表，
 * 陈静这类"家属"演示身份直接 404。
 *
 * 裁剪口径：只保留 `ownerId` 落在已导出业主（前 60 位）里的家属。
 * 不裁的话会出现"家属挂在一个 fixtures 里不存在的业主上"，绑定环节 join 不到房。
 *
 * 用法：node scripts/gen-members-fixture.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.resolve(ROOT, '../02-原型设计/mock')
const OUT = path.join(ROOT, 'fixtures')

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const membersRaw = read(path.join(SRC, 'members.json'))
const owners = read(path.join(OUT, 'owners.json'))
const ownerIds = new Set(owners.map(o => o.ownerId))

const rows = membersRaw
  .filter(m => ownerIds.has(m.ownerId))
  .map(m => ({
    memberId: m.memberId,
    ownerId: m.ownerId,
    name: m.name,
    relation: m.relation,
    phone: m.phone,
    /* 完整证件号：与 owners 同一口径（fixture 保留真值，接口层只回后四位） */
    idCard: m.idCard,
    certified: !!m.certified,
    liveTogether: !!m.liveTogether
  }))

fs.writeFileSync(path.join(OUT, 'members.json'), JSON.stringify(rows, null, 2) + '\n')

/* 自检：手机号必须唯一，否则按手机号找人会有歧义（真实系统里这是硬约束） */
const phones = rows.map(r => r.phone)
const dup = phones.filter((p, i) => phones.indexOf(p) !== i)
const orphan = rows.filter(r => !ownerIds.has(r.ownerId)).length
console.log(`members.json  ${rows.length} 条（源 ${membersRaw.length}，裁剪掉 ${membersRaw.length - rows.length}）`)
console.log(`自检：手机号重复 ${dup.length} 个 · 孤儿家属 ${orphan} 条`)
