#!/usr/bin/env node
// 静态自检（零依赖，可直接进 CI）：node scripts/check.mjs
//
// 为什么要有它：页面冒烟能发现"打不开"，但发现不了"数字悄悄错了"。
// 这里做六类**静态**检查，和 /e/audit 的运行时检查互补：
//   ① 禁用字面量：曾经引发缺陷的字符串（部分缴费 / 进场 / min-min-width）不得再出现
//   ② 双份 mock 一致：02-原型设计/mock 与 src/mock 必须逐字节一致（否则改了没同步，页面用旧数据）
//   ③ 路由 → 组件文件存在：防止删页/改名后留下死路由
//   ④ 适配层调用的 mock 函数必须真实导出（写过 recalcReportTask → 页面点了才报错）
//   ⑤ 页面里写死的权限码必须在 permissions.json 存在（拼错一个字母，按钮永远禁用而无人察觉）
//   ⑥ 计划详情三段表格的列头必须齐全（量化段曾漏掉「复评加权」，合计对但明细查不到来源）

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const MOCK_A = path.join(ROOT, '..', '02-原型设计', 'mock')
const MOCK_B = path.join(SRC, 'mock')

let failed = 0
const ok = (t, d) => console.log(`\x1b[32m✔\x1b[0m ${t}${d ? `　${d}` : ''}`)
const bad = (t, d) => { failed++; console.log(`\x1b[31m✘\x1b[0m ${t}${d ? `　${d}` : ''}`) }

const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name)
    if (f.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/* ---------- ① 禁用字面量 ---------- */
const FORBIDDEN = [
  { text: '部分缴费', why: '账单口径只有「部分缴」，写错会让欠费统计漏算（第 9 批事故）' },
  { text: '进场', why: '通行方向只有「入场 / 出场」' },
  { text: 'min-min-width', why: '非法属性，列宽不会生效' }
]
const files = walk(SRC).filter(f => /\.(vue|js)$/.test(f) && !f.includes(`${path.sep}mock${path.sep}`))
let hit = 0
for (const f of files) {
  const rel = path.relative(SRC, f)
  // 这两处是"讲述历史事故的文档页 / 枚举单一来源"，允许出现被禁字面量
  if (['utils/enums.js', path.join('views', 'e', 'Audit.vue')].includes(rel)) continue
  const text = fs.readFileSync(f, 'utf8')
  for (const rule of FORBIDDEN) {
    if (text.includes(rule.text)) {
      hit++
      bad(`禁用字面量「${rule.text}」出现在 ${rel}`, rule.why)
    }
  }
}
if (!hit) ok('禁用字面量扫描', `${files.length} 个文件无「部分缴费 / 进场 / min-min-width」`)

/* ---------- ② 双份 mock 一致 ---------- */
const md5 = p => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')
if (!fs.existsSync(MOCK_A)) {
  bad('找不到 02-原型设计/mock', MOCK_A)
} else {
  const names = fs.readdirSync(MOCK_A).filter(n => /\.(json|js)$/.test(n))
  const diff = names.filter(n => {
    const b = path.join(MOCK_B, n)
    return !fs.existsSync(b) || md5(path.join(MOCK_A, n)) !== md5(b)
  })
  if (diff.length) bad('mock 双份不一致', `需同步：${diff.join('、')}`)
  else ok('mock 双份一致', `${names.length} 个文件逐字节相同`)

  // 维修价目表是手工维护的（seed 不生成），源文件在 02-原型设计/repairPrices.json。
  // 它必须一起同步：否则 03 改了价目、02 没改，重跑 seed 后工单金额与价目又对不上。
  const priceA = path.join(ROOT, '..', '02-原型设计', 'repairPrices.json')
  const priceB = path.join(MOCK_B, 'repairPrices.json')
  if (!fs.existsSync(priceA) || !fs.existsSync(priceB) || md5(priceA) !== md5(priceB)) {
    bad('维修价目未同步', '02-原型设计/repairPrices.json 与 src/mock/repairPrices.json 不一致')
  } else {
    ok('维修价目已同步', 'repairPrices.json 逐字节相同')
  }
}

/* ---------- ③ 路由 → 组件 ---------- */
const pagesFile = path.join(SRC, 'router', 'pages.js')
const pagesSrc = fs.readFileSync(pagesFile, 'utf8')
const comps = [...pagesSrc.matchAll(/import\(['"]@\/([^'"]+)['"]\)/g)].map(m => m[1])
const missing = comps.filter(rel => !fs.existsSync(path.join(SRC, rel)))
if (missing.length) bad('路由指向的组件缺失', missing.join('、'))
else ok('路由 → 组件', `${comps.length} 个懒加载页面全部存在`)

/* ---------- ③ 适配层委托的 mock 函数必须存在 ----------
 * 为什么加这条：`src/api/*.js` 在 mock 模式下是「转调 utils/api」，
 * 函数名写错时 build 照过、页面照开，直到点了那个按钮才报 `(void 0) is not a function`
 * （第 23 批真的踩了一次：reportRecalcTask 被写成 recalcReportTask）。
 * 这里静态比对一遍，把这类错挡在提交前。
 */
const apiDir = path.join(SRC, 'api')
const apiFiles = fs.existsSync(apiDir) ? walk(apiDir).filter(f => f.endsWith('.js')) : []
const utilsApi = fs.readFileSync(path.join(SRC, 'utils', 'api.js'), 'utf8')
const exported = new Set([
  ...[...utilsApi.matchAll(/export (?:async )?function (\w+)/g)].map(m => m[1]),
  ...[...utilsApi.matchAll(/export (?:const|let) (\w+)/g)].map(m => m[1])
])
const missingMock = []
for (const f of apiFiles) {
  const text = fs.readFileSync(f, 'utf8')
  for (const m of text.matchAll(/mock\.(\w+)/g)) {
    if (!exported.has(m[1])) missingMock.push(`${path.relative(SRC, f)} → mock.${m[1]}`)
  }
}
if (missingMock.length) bad('适配层调用了不存在的 mock 函数', [...new Set(missingMock)].join('、'))
else ok('适配层 → mock 函数', `${apiFiles.length} 个域文件全部对得上（${exported.size} 个导出）`)

/* ---------- ④ 权限码存在性 ----------
 * 页面里手写的权限码拼错一个字母，按钮就永远禁用/永远显示，而且**构建能过、页面能开**，
 * 只有点到那个按钮才发现（或者一直不发现）。这里把写死的权限码逐个核对一遍。
 */
const perms = JSON.parse(fs.readFileSync(path.join(SRC, 'mock', 'permissions.json'), 'utf8'))
const permCodes = new Set(perms.map(p => p.code))
/* 第三段必须是已知操作（view/edit/exec…）：否则 `d.house.houseId` 这类字段名会被误报。
   域字母：a 资产 / b 费用 / c 办公 / d 物联 / e 平台 / f 现场 / n 邻里（第 68 批）*/
const permOps = new Set(perms.map(p => p.op))
const CODE_RE = /['"`]([a-fn]\.[A-Za-z0-9]+\.[a-z][A-Za-z]*)['"`]/g
const unknownPerm = []
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  for (const m of text.matchAll(CODE_RE)) {
    const op = m[1].split('.')[2]
    if (!permOps.has(op)) continue
    if (!permCodes.has(m[1])) unknownPerm.push(`${path.relative(SRC, f)} → ${m[1]}`)
  }
}
if (unknownPerm.length) bad('权限码不存在（拼错？）', [...new Set(unknownPerm)].slice(0, 6).join('、'))
else ok('权限码存在性', `${permCodes.size} 个权限码，页面引用全部命中`)

/* ---------- ⑥ 计划详情三段表格的列头必须齐全 ----------
 * 为什么加这条：第 55 批重写详情页时，三段表格的列是**各自手写的**。
 * 量化段漏了「复评加权」，而合计卡是对的、页面能正常打开、e2e 也全绿 ——
 * 只有人眼对着截图才能发现。这里把每段必备的加权列静态断死。
 *
 * 另外禁止裸的 `label="加权"`：量化段和重点段是「分 × 权重」，监控段是「扣分本身」，
 * 三个「加权」摆在一起会让人以为算法相同。
 */
const detailFile = path.join(SRC, 'views', 'f', 'PlanDetail.vue')
const detailSrc = fs.readFileSync(detailFile, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const PLAN_SECTIONS = [
  { key: '量化', start: '一、量化指标', need: ['自评加权', '复评加权'] },
  { key: '监控', start: '二、监控指标', need: ['自评扣分', '复评扣分'] },
  { key: '重点', start: '三、重点工作计划', need: ['自评加权', '复评加权'] }
]
const secStart = PLAN_SECTIONS.map(s => detailSrc.indexOf(s.start))
const secMissing = PLAN_SECTIONS.filter((_, i) => secStart[i] < 0).map(s => s.start)
if (secMissing.length) {
  bad('计划详情三段标题缺失', secMissing.join('、'))
} else {
  const colMissing = []
  PLAN_SECTIONS.forEach((sec, i) => {
    const from = secStart[i]
    const to = i + 1 < secStart.length ? secStart[i + 1] : detailSrc.length
    const labels = [...detailSrc.slice(from, to).matchAll(/label="([^"]+)"/g)].map(m => m[1])
    for (const name of sec.need) {
      if (!labels.includes(name)) colMissing.push(`${sec.key}段缺「${name}」`)
    }
  })
  if (colMissing.length) bad('计划详情三段表头不一致', colMissing.join('、'))
  else ok('计划详情三段表头', PLAN_SECTIONS.map(s => `${s.key}段 ${s.need.join(' + ')}`).join('　'))
}
if (/label="加权"/.test(detailSrc)) {
  bad('列名「加权」语义不明', '量化 / 重点段应写「自评加权」，监控段用「自评扣分」')
} else {
  ok('加权列命名', '三段都用「自评加权 / 复评加权 / 自评扣分 / 复评扣分」，无裸「加权」')
}

/* ---------- ⑦ 计划模板不得再配置权重（第 60 批） ----------
 * 权重已经从模板搬到计划上：模板只定「考什么」，每项占多少由提报人填、审核可调。
 * 这条静态检查防的是"改回来一半"：模板页还留着权重输入框、或者 api 的模板条目又长出
 * weight 字段，页面照样能开、保存也照样成功，但两套权重会同时存在，谁也说不清哪个算数。
 */
const tplFile = path.join(SRC, 'views', 'f', 'PlanTemplateList.vue')
const tplSrc = fs.readFileSync(tplFile, 'utf8')
const API_SRC = fs.readFileSync(path.join(SRC, 'utils', 'api.js'), 'utf8')
const tplDomain = API_SRC.slice(
  API_SRC.indexOf('T 域 · 计划模板'),
  API_SRC.indexOf('G 域 · 部门计划管理')
)
const weightLeak = []
if (/v-model="(row|ed)\.weight"/.test(tplSrc)) weightLeak.push('模板页仍有权重输入框')
if (/ed\.wq|ed\.wk|row\.wq|row\.wk/.test(tplSrc)) weightLeak.push('模板页仍有段权重 wq/wk')
if (/\bweight:/.test(tplDomain)) weightLeak.push('T 域模板条目又长了 weight 字段')
if (/\bwq:|\bwk:/.test(tplDomain)) weightLeak.push('T 域又出现段权重 wq/wk')
if (weightLeak.length) bad('计划模板又出现权重配置', weightLeak.join('、'))
else ok('模板不配权重', '权重只在计划上（模板页无输入、T 域无 weight/wq/wk）')

/* ---------- ⑧ 权重只能按 5% 调（第 60 批补充口径） ----------
 * 这条约束有三处落点：常量、页面输入框的 step、step-strictly（手输 12 自动归到 10）。
 * 少任何一处都会出现"界面能填 12、提交被拦"的死角，或者反过来"填了 12 也能提交"。
 *
 * 必须**逐个输入框**检查：只判断"文件里出现过"的话，量化表改回 step=1、重点表还留着，
 * 整体检查仍然通过 —— 第一版规则就是这么漏的。
 */
const planFormSrc = fs.readFileSync(path.join(SRC, 'views', 'f', 'PlanForm.vue'), 'utf8')
const stepLeak = []
if (!/PLAN_WEIGHT_STEP\s*=\s*5\b/.test(API_SRC)) stepLeak.push('api.js 的 PLAN_WEIGHT_STEP 不是 5')
const weightInputsOf = src => [...src.matchAll(/<el-input-number\b[^>]*>/g)]
  .map(m => m[0])
  .filter(tag => /v-model="row\.weight"/.test(tag))
for (const [name, src] of [['PlanForm.vue', planFormSrc], ['PlanDetail.vue', detailSrc]]) {
  const tags = weightInputsOf(src)
  if (!tags.length) stepLeak.push(`${name} 找不到权重输入框（权重列还在吗？）`)
  tags.forEach((tag, i) => {
    if (!/:step="WEIGHT_STEP"/.test(tag)) stepLeak.push(`${name} 第 ${i + 1} 个权重输入框没用 WEIGHT_STEP`)
    if (!/step-strictly/.test(tag)) stepLeak.push(`${name} 第 ${i + 1} 个权重输入框没开 step-strictly`)
  })
}
if (stepLeak.length) bad('权重 5% 步长约束被破坏', stepLeak.join('、'))
else ok('权重 5% 步长', `常量 5 + ${weightInputsOf(planFormSrc).length + weightInputsOf(detailSrc).length} 个权重输入框都是 step=WEIGHT_STEP + step-strictly`)

/* ---------- ⑨ 邻里投票不得产出「通过 / 不通过」的结论（第 68 批） ----------
 * 投票只做意见征询，不做《民法典》278 条的业主共同决定。一旦结果里出现 passed /
 * approved 这类字段，或者页面上写「已通过」，它就会被当成业主大会决议来主张 ——
 * 而正式表决要人数 + 专有部分面积双过半、要公示期、要能出纸质票，小程序替代不了。
 * 这条检查防的是"顺手加一个结论字段"，因为那正好是产品经理最想要的那一个字段。
 */
const NV_DOMAIN = API_SRC.slice(API_SRC.indexOf('N 域 · 邻里运营'))
const NV_LEAK = []
if (/\bpassed\s*:/.test(NV_DOMAIN)) NV_LEAK.push('api.js N 域出现 passed 字段')
if (/\bapproved\s*:/.test(NV_DOMAIN)) NV_LEAK.push('api.js N 域出现 approved 字段')
/* 只看结果抽屉那一段：说明文案里写「不给是否通过」是对的，页面上写「已通过」才是问题 */
const voteSrc = fs.readFileSync(path.join(SRC, 'views', 'n', 'VoteManage.vue'), 'utf8')
const resFrom = voteSrc.indexOf('res.visible')
const resBlock = resFrom < 0 ? '' : voteSrc.slice(resFrom, voteSrc.indexOf('</el-drawer>', resFrom))
if (!resBlock) NV_LEAK.push('VoteManage.vue 找不到结果抽屉（结果区被删了？）')
else if (/通过/.test(resBlock)) NV_LEAK.push('VoteManage.vue 结果抽屉出现「通过」字样')
if (NV_LEAK.length) bad('邻里投票产出了表决结论', NV_LEAK.join('、'))
else ok('投票不给结论', 'N 域无 passed/approved 字段，结果抽屉无「通过」字样')

/* ---------- ⑤ 骨架一致性（信息项） ---------- */
const viewFiles = walk(path.join(SRC, 'views')).filter(f => f.endsWith('.vue'))
const withTree = viewFiles.filter(f => fs.readFileSync(f, 'utf8').includes('<SpaceTree'))
const withQuick = viewFiles.filter(f => fs.readFileSync(f, 'utf8').includes('<QuickViews'))
console.log(`\x1b[36mℹ\x1b[0m 骨架：A 型（树）${withTree.length} 页 / B 型（快捷视图）${withQuick.length} 页`)
const neither = viewFiles.filter(f => !withTree.includes(f) && !withQuick.includes(f) && !f.includes(`${path.sep}form`) && !f.includes(`${path.sep}shell`))
console.log(`\x1b[36mℹ\x1b[0m 其余页面（表单 / 详情 / 模板）${neither.length} 页`)

console.log(failed ? `\n\x1b[31m${failed} 项未通过\x1b[0m` : '\n\x1b[32m全部通过\x1b[0m')
process.exit(failed ? 1 : 0)
