#!/usr/bin/env node
/**
 * DDL 静态检查 —— 没有数据库也能跑
 *
 * 为什么需要它：本地没有 psql，阿里云 RDS 暂时不可用，但建表脚本写错
 * 会在第一次真跑时才发现。这个脚本做能做的检查，抓低级错误。
 *
 * 用法：node 08-开发设计/sql/check-ddl.mjs
 * 退出码：0 全过 / 1 有失败
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL_DIR = dirname(fileURLToPath(import.meta.url))
const FILES = readdirSync(SQL_DIR).filter(f => f.endsWith('.sql')).sort()

/** 把文件切成语句：按行累加，遇到 CREATE TABLE 开始记括号深度 */
function splitStatements(text) {
  const lines = text.split('\n')
  const stmts = []
  let buf = []
  let depth = 0
  let inCreate = false

  for (const raw of lines) {
    const line = raw.replace(/--.*$/, '')           // 去行注释（够用，不处理字符串里的 --）
    if (!inCreate) {
      if (/^\s*CREATE\s+TABLE/i.test(line)) {
        inCreate = true
        buf = [line]
        depth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
        if (depth <= 0 && /;\s*$/.test(line)) { stmts.push(buf.join('\n')); inCreate = false }
      }
      continue
    }
    buf.push(line)
    depth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length
    if (depth <= 0) {
      stmts.push(buf.join('\n'))
      inCreate = false
      buf = []
    }
  }
  return stmts
}

/** 从 CREATE TABLE 语句里取表名与列定义 */
function parseTable(stmt) {
  const m = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:wy\.)?([a-z_][a-z0-9_]*)\s*\(/i)
  if (!m) return null
  const name = m[1]

  // 取括号内的内容（第一个 ( 到匹配的 )）
  let depth = 0, start = -1, body = ''
  for (let i = 0; i < stmt.length; i++) {
    const ch = stmt[i]
    if (ch === '(') { if (depth === 0 && start < 0) start = i + 1; depth++ }
    else if (ch === ')') { depth--; if (depth === 0 && start > 0) { body = stmt.slice(start, i); break } }
  }

  // 按顶层逗号切列（忽略 CHECK(...) 内部的逗号）
  const parts = []
  let d = 0, cur = ''
  for (const ch of body) {
    if (ch === '(') d++
    if (ch === ')') d--
    if (ch === ',' && d === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())

  const columns = []
  const constraints = []
  for (const p of parts) {
    if (!p) continue
    if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|EXCLUDE)\b/i.test(p)) {
      constraints.push(p)
    } else {
      const cm = p.match(/^([a-z_][a-z0-9_]*)\s+(.+)$/is)
      if (cm) columns.push({ name: cm[1], def: cm[2] })
    }
  }
  return { name, columns, constraints, raw: stmt }
}

const tables = []
for (const f of FILES) {
  const text = readFileSync(join(SQL_DIR, f), 'utf8')
  for (const stmt of splitStatements(text)) {
    const t = parseTable(stmt)
    if (t) tables.push({ ...t, file: f })
  }
}

const errors = []
const warns = []
const BIZ_EXEMPT = new Set(['tenant', 'permission'])     // 根表与全局权限码表
const TIME_COLS = /(_at|_date|period)$/

// ---------- 1. 表名规范 ----------
const seen = new Map()
for (const t of tables) {
  if (seen.has(t.name)) errors.push(`表重名：${t.name}（${seen.get(t.name)} 与 ${t.file}）`)
  seen.set(t.name, t.file)
  if (!/^[a-z][a-z0-9_]*$/.test(t.name)) errors.push(`${t.name}：表名应 snake_case`)
  if (t.name.endsWith('s') && !['assets', 'status'].includes(t.name)) {
    warns.push(`${t.name}：表名用了复数，约定是单数`)
  }
}

// ---------- 2. 主键 ----------
for (const t of tables) {
  const hasPk =
    t.constraints.some(c => /^PRIMARY\s+KEY/i.test(c)) ||
    t.columns.some(c => /PRIMARY\s+KEY/i.test(c.def))
  if (!hasPk) errors.push(`${t.name}：没有主键`)
}

// ---------- 3. tenant_id ----------
for (const t of tables) {
  if (BIZ_EXEMPT.has(t.name)) continue
  const has = t.columns.some(c => c.name === 'tenant_id')
  if (!has) errors.push(`${t.name}：缺 tenant_id（多租户隔离失效）`)
}

// ---------- 4. 金额精度 ----------
for (const t of tables) {
  for (const c of t.columns) {
    if (/^(real|float|float4|float8|double\s+precision|money)$/i.test(c.def.trim().split(/[\s,(]/)[0])) {
      if (/amount|price|fee|balance|cost|pay|total/i.test(c.name)) {
        errors.push(`${t.name}.${c.name}：金额用了浮点类型（应 numeric(14,2)）`)
      }
    }
    if (/numeric/i.test(c.def) && !/numeric\s*\(\s*\d+\s*,\s*\d+\s*\)/i.test(c.def)) {
      warns.push(`${t.name}.${c.name}：numeric 没写精度（建议 (14,2) 或 (14,4)）`)
    }
  }
}

// ---------- 5. 外键引用的表存在 ----------
for (const t of tables) {
  for (const c of t.constraints) {
    const fk = c.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:wy\.)?([a-z_][a-z0-9_]*)/i)
    if (fk && !seen.has(fk[2])) {
      errors.push(`${t.name}：外键引用不存在的表 ${fk[2]}`)
    }
  }
}

// ---------- 6. 审计四件套 ----------
const NEED_AUDIT = t => !['permission', 'dict_item', 'dict_type', 'system_param', 'role_permission'].includes(t.name)
for (const t of tables) {
  if (!NEED_AUDIT(t)) continue
  const hasCreated = t.columns.some(c => c.name === 'created_at')
  if (!hasCreated) warns.push(`${t.name}：缺 created_at（审计要求）`)
}

// ---------- 7. RLS 覆盖检查 ----------
const rlsFile = readFileSync(join(SQL_DIR, '20-rls.sql'), 'utf8')
const usesAutoRls = /DO \$\$/i.test(rlsFile) && /EXISTS \(/.test(rlsFile)
if (!usesAutoRls) {
  // 手写策略的模式：检查每张业务表是否有 ENABLE ROW LEVEL SECURITY
  for (const t of tables) {
    if (BIZ_EXEMPT.has(t.name)) continue
    const en = new RegExp(`ALTER TABLE (wy\\.)?${t.name} ENABLE ROW LEVEL SECURITY`, 'i').test(rlsFile)
    if (!en) errors.push(`${t.name}：20-rls.sql 没有为它启用 RLS`)
  }
} else {
  warns.push('RLS 使用 DO 块自动施加 —— 建表后必须实跑一次确认 NOTICE 数量对得上')
}
if (!/FORCE\s+ROW LEVEL SECURITY/i.test(rlsFile)) {
  errors.push('20-rls.sql：缺 FORCE ROW LEVEL SECURITY（表 owner 会绕过隔离）')
}

// ---------- 8. 危险写法 ----------
for (const t of tables) {
  if (/\bON\s+DELETE\s+CASCADE\b/i.test(t.raw)) {
    warns.push(`${t.name}：含 ON DELETE CASCADE，账务表慎用（会连带删历史）`)
  }
}
for (const f of FILES) {
  const text = readFileSync(join(SQL_DIR, f), 'utf8')
  if (/DROP\s+TABLE\s+(?!IF\s+EXISTS)/i.test(text)) errors.push(`${f}：有裸 DROP TABLE（应带 IF EXISTS）`)
  if (/TRUNCATE/i.test(text)) warns.push(`${f}：含 TRUNCATE`)
}

// ---------- 输出 ----------
const line = '─'.repeat(64)
console.log(line)
console.log(`DDL 静态检查 · ${FILES.length} 个文件 · ${tables.length} 张表`)
console.log(line)

if (errors.length) {
  console.log(`\n❌ 错误 ${errors.length} 条：`)
  errors.forEach(e => console.log('   ' + e))
} else {
  console.log('\n✅ 无错误')
}

if (warns.length) {
  console.log(`\n⚠️  提示 ${warns.length} 条：`)
  warns.forEach(w => console.log('   ' + w))
}

console.log('\n' + line)
console.log('表清单：')
tables.forEach(t => {
  const cols = String(t.columns.length).padStart(3)
  console.log(`   ${t.name.padEnd(26)} ${cols} 列   ${t.file}`)
})
console.log(line)

process.exit(errors.length ? 1 : 0)
