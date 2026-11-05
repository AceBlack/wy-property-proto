/** `@pc` 字段契约自检（CI / 构建前跑）：缺字段退出码 1 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPcSchema, formatSchemaErrors } from '../src/config/pcSchema.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MOCK = path.resolve(ROOT, '../03-原型/src/mock')
const read = n => JSON.parse(fs.readFileSync(path.join(MOCK, `${n}.json`), 'utf8'))

const data = {
  workOrders: read('workOrders'),
  approvals: read('approvals'),
  employees: read('employees'),
  orgs: read('orgs'),
  repairPrices: read('repairPrices'),
  ownerTags: read('ownerTags'),
  owners: read('owners'),
  tenants: read('tenants')
}
const bad = checkPcSchema(data)
if (bad.length) {
  console.error(formatSchemaErrors(bad))
  process.exit(1)
}
console.log(
  `✓ @pc 字段契约完整（${data.workOrders.length} 工单 / ${data.approvals.length} 审批 / ${data.employees.length} 员工 / ` +
    `${data.owners.length} 业主 / ${data.tenants.length} 租户 / ${data.ownerTags.length} 标签）`
)
