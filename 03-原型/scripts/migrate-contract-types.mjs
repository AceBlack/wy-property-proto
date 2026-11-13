/**
 * 合同分类迁移（2026-11-13）
 * ------------------------------------------------------------
 * 旧：5 个一级（劳动 / 物业服务 / 外包服务 / 租赁 / 采购），子类是「数据里出现过什么就是什么」
 * 新：6 个一级 + 20 个子类（配置在 utils/api.js 的 CONTRACT_TYPE_TREE）
 *
 * 映射原则：
 *   ① 能一一对应的直接改（电梯维保、消防设施维保等）；
 *   ② 外包里的**整包服务**（保洁/绿化/秩序/垃圾清运）在新分类里没有对应项，
 *      归入「劳动合同 / 劳务协议」—— 它们的性质就是劳务外包；
 *      `contractCategoryOf` 会按合同名把它们再分到「合同支出」，不会全算成人工成本；
 *   ③ 商铺租赁是联营性质 → 多种经营 / 场地联营；广告位 → 多种经营 / 广告合作；
 *      房屋与车位是出租 → 租赁协议；
 *   ④ 节能改造工程按「设施设备检修」处理（工程类支出的落点）。
 *
 * 幂等：已全是新类型的文件直接跳过。
 * 三个文件一起写：03 原型 mock、02 设计 mock、04 契约 fixture —— 三份不一致会让联调对不上。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FILES = [
  path.join(ROOT, '03-原型', 'src', 'mock', 'contracts.json'),
  path.join(ROOT, '02-原型设计', 'mock', 'contracts.json'),
  path.join(ROOT, '04-契约', 'fixtures', 'contracts.json')
]

const NEW_TYPES = ['劳动合同', '物业服务协议', '运维服务', '多种经营', '租赁协议', '采购协议']

const MAP = {
  '劳动/劳动合同': ['劳动合同', '员工劳动合同'],
  '劳动/劳务协议': ['劳动合同', '劳务协议'],
  '劳动/实习协议': ['劳动合同', '劳务协议'],

  '物业服务/物业服务合同': ['物业服务协议', '项目物业服务合同'],
  '物业服务/前期物业服务合同': ['物业服务协议', '项目物业服务合同'],
  '物业服务/物业顾问服务合同': ['物业服务协议', '项目物业服务合同'],

  '外包服务/电梯维保': ['运维服务', '电梯维保'],
  '外包服务/二次供水设施维保': ['运维服务', '供水供电设施维保'],
  '外包服务/消防设施维保': ['运维服务', '消防系统运维'],
  '外包服务/保洁服务外包': ['劳动合同', '劳务协议'],
  '外包服务/垃圾清运': ['劳动合同', '劳务协议'],
  '外包服务/绿化养护外包': ['劳动合同', '劳务协议'],
  '外包服务/安保服务外包': ['劳动合同', '劳务协议'],

  '租赁/广告位租赁': ['多种经营', '广告合作'],
  '租赁/商铺租赁': ['多种经营', '场地联营'],
  '租赁/房屋租赁': ['租赁协议', '房屋租赁'],
  '租赁/车位租赁': ['租赁协议', '车位租赁'],

  '采购/办公用品采购': ['采购协议', '耗材采购'],
  '采购/维修材料采购': ['采购协议', '物资采购'],
  '采购/设施设备采购': ['采购协议', '设备采购'],
  '采购/安防设备采购': ['采购协议', '设备采购'],
  '采购/节能改造工程': ['运维服务', '设施设备检修']
}

let changed = 0
for (const file of FILES) {
  if (!fs.existsSync(file)) { console.log('跳过（不存在）', file); continue }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (rows.every(r => NEW_TYPES.includes(r.type))) {
    console.log('已是新分类，跳过', path.relative(ROOT, file))
    continue
  }
  let n = 0
  for (const r of rows) {
    const hit = MAP[`${r.type}/${r.subtype}`]
    if (!hit) {
      throw new Error(`没有映射：${r.type}/${r.subtype}（${r.contractNo}）—— 补 MAP 后再跑`)
    }
    r.type = hit[0]
    r.subtype = hit[1]
    n += 1
  }
  fs.writeFileSync(file, JSON.stringify(rows, null, 2) + '\n')
  changed += n
  const g = {}
  for (const r of rows) g[r.type] = (g[r.type] || 0) + 1
  console.log(path.relative(ROOT, file), '迁移', n, '条 →', g)
}

console.log('合计迁移', changed, '条')
