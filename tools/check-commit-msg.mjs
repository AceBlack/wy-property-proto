#!/usr/bin/env node
/**
 * commit message 校验（2026-11-06 第 68 批确立）
 *
 * 为什么要有它：规范写在 md 里等于没写 —— 三天后就没人看了。
 * 这里只做四件便宜的事：标题格式、首行长度、四个尾行是否齐全。
 * 不检查"写得好不好"，那种事机器判断不了，也没必要拦。
 *
 * 用法:
 *   node tools/check-commit-msg.mjs <commit-msg-file>
 *   node tools/check-commit-msg.mjs --text "feat(原型): xxx"
 *
 * 退出码: 0 通过 / 1 不合规 / 2 用法错误
 */
import fs from 'node:fs'

const args = process.argv.slice(2)
let raw = ''
if (args[0] === '--text') {
  raw = args.slice(1).join(' ')
} else if (args[0]) {
  if (args[0] === '-h' || args[0] === '--help') {
    console.log('用法: node tools/check-commit-msg.mjs <commit-msg-file> | --text "..."')
    process.exit(0)
  }
  try {
    raw = fs.readFileSync(args[0], 'utf8')
  } catch {
    console.error(`读不到提交信息文件: ${args[0]}`)
    process.exit(2)
  }
} else {
  console.error('用法: node tools/check-commit-msg.mjs <commit-msg-file> | --text "..."')
  process.exit(2)
}

/* git 会把 # 开头的行当注释删掉，校验时也要去掉，否则模板没填也能过 */
const lines = raw.replace(/\r/g, '').split('\n').filter(l => !l.startsWith('#'))
const subject = (lines.find(l => l.trim()) || '').trim()
const body = lines.slice(lines.findIndex(l => l.trim()) + 1).join('\n')

/* 特殊提交放行：merge / revert / rebase 的 fixup 不属于本规范覆盖范围 */
if (/^(Merge|Revert|fixup!|squash!|amend!)/i.test(subject)) process.exit(0)

if (!subject) {
  console.error('✘ 提交信息为空')
  process.exit(1)
}

const TYPES = ['feat', 'fix', 'chore', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'style']
const errors = []

const m = subject.match(/^([a-z]+)(\([^)]+\))?:\s*(.+)$/)
if (!m) {
  errors.push(`第一行格式不对，应为「<type>(<scope>): 说明」，例如 feat(原型): 邻里运营后台 6 页`)
} else {
  if (!TYPES.includes(m[1])) errors.push(`type「${m[1]}」不认识，只能取 ${TYPES.join(' / ')}`)
  if (!m[2]) errors.push(`缺 scope，例如 (原型) / (契约) / (员工端) / (数据)`)
  if (/^(更新|优化|调整|修改|fix|update)/i.test(m[3].trim())) {
    errors.push(`第一行只说「${m[3].trim()}」等于没说，写清做了什么`)
  }
}

const len = [...subject].length
if (len > 80) errors.push(`第一行 ${len} 字符，超过 80。把细节挪到正文`)

/* 标题与正文之间要空一行，否则 GitHub 会把正文当标题的续行 */
const subjIdx = lines.findIndex(l => l.trim())
if (lines[subjIdx + 1] !== undefined && lines[subjIdx + 1].trim() !== '') {
  errors.push('标题与正文之间要空一行')
}

const REQ = [
  { key: '批次', re: /^批次:\s*(\d+(-\d+)?|无)\s*$/m, hint: '批次: 68 或 批次: 61-68，不属于任何批次写 批次: 无' },
  { key: '影响', re: /^影响:\s*\S+/m, hint: '影响: 03-原型, 04-契约' },
  { key: '验证', re: /^验证:\s*\S+/m, hint: '验证: check 9/9 · build · 冒烟 72/72（没跑就写「未运行（原因）」）' },
  { key: 'BREAKING', re: /^BREAKING:\s*\S+/m, hint: 'BREAKING: 无 或 BREAKING: canEditActivities() 不再覆盖代报名' }
]
for (const r of REQ) {
  if (!r.re.test(body)) errors.push(`缺「${r.key}」行 —— ${r.hint}`)
}

if (errors.length) {
  console.error('\n✘ 提交信息不合规（提交规范.md）：\n')
  errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`))
  console.error('\n参考格式：\n')
  console.error('  feat(原型): 邻里运营后台 6 页\n')
  console.error('  正文写「为什么这么定」，不写文件清单。\n')
  console.error('  批次: 68')
  console.error('  影响: 03-原型, 04-契约')
  console.error('  验证: check 9/9 · build · 冒烟 72/72')
  console.error('  BREAKING: 无\n')
  console.error('  紧急情况可临时绕过：git commit --no-verify\n')
  process.exit(1)
}

process.exit(0)
