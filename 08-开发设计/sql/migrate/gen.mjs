#!/usr/bin/env node
/**
 * fixture → PostgreSQL 迁移生成器
 *
 * 为什么不直连数据库：不引入 pg 依赖，SQL 可审阅、可 diff、可重跑。
 * 生成物在 out/ 下，由 run-migrate.sh 用 psql 执行。
 *
 * 三条铁律：
 *   1. 金额一律 toFixed(2) 后再拼，不经过浮点运算（JSON 的 322.39 是 double）
 *   2. 表顺序按外键依赖排，先父后子
 *   3. 主键显式指定（bill.id ← BL003536 的数字部分），保证 allocation 能引用
 *
 * 用法：node gen.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../../')
const OUT = join(HERE, 'out')

const SRC = [
  join(ROOT, '04-契约/fixtures'),
  join(ROOT, '03-原型/src/mock'),
]

// ---------- 工具 ----------
const strip = s => String(s).replace(/^\uFEFF/, '')
function load(name) {
  for (const dir of SRC) {
    try {
      const d = JSON.parse(strip(readFileSync(join(dir, `${name}.json`), 'utf8')))
      return Array.isArray(d) ? d : Object.values(d)
    } catch { /* 试下一个源 */ }
  }
  throw new Error(`找不到 ${name}.json`)
}

const S = v => (v === null || v === undefined || v === '' ? 'NULL'
  : `'${String(v).replace(/'/g, "''").replace(/\u0000/g, '')}'`)
const N = (v, d = 2) => (v === null || v === undefined || v === '' ? 'NULL' : Number(v).toFixed(d))
const I = v => (v === null || v === undefined || v === '' ? 'NULL' : String(Math.trunc(Number(v))))
const B = v => (v === true || v === 1 || v === 'true' ? 'true' : 'false')
const D = v => (v ? `'${String(v).slice(0, 10)}'` : 'NULL')
const T = v => (v ? `'${String(v).slice(0, 10)} 00:00:00+08'` : 'NULL')
const idNum = code => Math.trunc(Number(String(code).replace(/\D/g, '')))

function insertSQL(table, cols, rows, chunk = 400) {
  if (!rows.length) return `-- ${table}: 无数据\n`
  const parts = []
  for (let k = 0; k < rows.length; k += chunk) {
    const slice = rows.slice(k, k + chunk)
    parts.push(
      `INSERT INTO wy.${table} (${cols.join(', ')}) VALUES\n` +
      slice.map(r => '  (' + r.join(', ') + ')').join(',\n') + ';'
    )
  }
  return `-- ${table}: ${rows.length} 行\n` + parts.join('\n\n') + '\n'
}

const write = (file, body) => writeFileSync(join(OUT, file), `SET search_path TO wy, public;\n${body}`)
const log = []

// ---------- 读源数据 ----------
const communities = load('communities')
const buildings   = load('buildings')
const units       = load('units')
const houses      = load('houses')
const parkings    = load('parkings')
const owners      = load('owners')
const tenants     = load('tenants')
const feeItems    = load('feeItems')
const bills       = load('bills')
const payments    = load('payments')
const deposits    = load('deposits')
const meters      = load('meters')
const readings    = load('meter-readings')

const TENANT = 1

// ---------- 值映射（原型口径 → 库口径，只做必要的语义归一）----------
const billStatus = s => ({ 未缴: '待缴', 逾期: '待缴' }[s] ?? s)
const payMethod  = s => ({ 微信支付: '微信', POS刷卡: 'POS', POS机: 'POS' }[s] ?? s)
const payPoint   = s => ({ 线上: '线上支付' }[s] ?? s)
const feeDirection = s => ({ liability: 'deposit' }[s] ?? (s || 'billable'))
const parkCategory = s => ({
  产权车位: '产权', 租赁车位: '租赁', 公共车位: '公摊', 充电车位: '产权',
}[s] ?? '产权')
const meterType = s => ({ 电表: 'elec', 水表: 'water', 燃气表: 'gas' }[s] ?? s)
const meterStatus = s => ({ 已停用: '已停用' }[s] ?? (s || '正常'))

// ---------- 清理 ----------
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// ---------- 00 清空 ----------
write('00-truncate.sql', `
-- 清空业务数据（保留 tenant 与 permission 这类全局表）
TRUNCATE
  wy.bill_share, wy.bill_adjust, wy.bill,
  wy.payment_allocation, wy.payment, wy.prepay_flow, wy.prepay_account,
  wy.invoice_item, wy.invoice,
  wy.deposit_txn, wy.deposit,
  wy.meter_share, wy.meter_reading, wy.meter,
  wy.lease, wy.lessee, wy.house_owner, wy.house, wy.parking, wy.parking_change_log,
  wy.unit, wy.building, wy.community, wy.owner_member, wy.owner_tag_rel, wy.owner_tag, wy.owner,
  wy.fee_item_price, wy.fee_item,
  wy.wo_attachment, wy.wo_log, wy.work_order,
  wy.rectify_order, wy.inspect_task, wy.inspect_plan,
  wy.maintenance_record, wy.asset, wy.asset_category,
  wy.contract, wy.notice,
  wy.expense, wy.expense_category, wy.budget,
  wy.employee_role, wy.role_permission, wy.role, wy.employee, wy.org, wy.payroll
CASCADE;
`)

// ---------- 10 社区 ----------
{
  const areaOf = c => houses
    .filter(h => h.communityId === c.communityId)
    .reduce((s, h) => s + (Number(h.area) || 0), 0)
  const rows = communities.map(c => [
    TENANT, S(c.communityId), S(c.name), S(c.name), S(c.address),
    N(areaOf(c)), I(c.houseCount || houses.filter(h => h.communityId === c.communityId).length),
    I(0), S('meter'), S('meter'),
    S(c.status || '在管'),
  ])
  write('10-community.sql', insertSQL('community',
    ['tenant_id', 'community_id', 'name', 'short_name', 'address',
      'build_area', 'house_count', 'park_count', 'elec_mode', 'water_mode', 'status'],
    rows))
  log.push(`community ${rows.length}`)
}

// ---------- 11 楼栋 ----------
{
  const rows = buildings.map(x => [
    TENANT, S(x.buildingId), S(x.communityId), S(x.name || x.buildingNo),
    S(null), I(x.floorCount), I(x.unitCount), N(null),
  ])
  write('11-building.sql', insertSQL('building',
    ['tenant_id', 'building_id', 'community_id', 'name',
      'building_type', 'floor_count', 'unit_count', 'build_area'], rows))
  log.push(`building ${rows.length}`)
}

// ---------- 12 单元 ----------
{
  const rows = units.map(x => [
    TENANT, S(x.unitId), S(x.communityId), S(x.buildingId), S(x.name || x.unitNo), I(0),
  ])
  write('12-unit.sql', insertSQL('unit',
    ['tenant_id', 'unit_id', 'community_id', 'building_id', 'name', 'sort'], rows))
  log.push(`unit ${rows.length}`)
}

// ---------- 13 业主 ----------
{
  const rows = owners.map(x => [
    TENANT, S(x.ownerId), S(x.name), S(x.phone), S(x.idCard), S(x.gender),
    S(x.ownerType || '业主'), B(x.certified), B(x.faceRegistered), B(x.appRegistered),
    D(x.registerDate), S(x.creditLevel || 'B'),
    S(x.ownerCategory), S(x.economicLevel), S(x.politicalStatus), D(x.weddingDate),
    S(x.employer), S(x.jobTitle), S(x.occupation), S(x.workAddress),
    S(x.hobbies), S(x.pets), S(x.positiveNotes), S(x.negativeNotes),
    S(x.emergencyContact), S(x.emergencyPhone), S(x.remark),
  ])
  write('13-owner.sql', insertSQL('owner',
    ['tenant_id', 'owner_id', 'name', 'phone', 'id_card', 'gender',
      'owner_type', 'certified', 'face_registered', 'app_registered', 'register_date', 'credit_level',
      'owner_category', 'economic_level', 'political_status', 'wedding_date',
      'employer', 'job_title', 'occupation', 'work_address',
      'hobbies', 'pets', 'positive_notes', 'negative_notes',
      'emergency_contact', 'emergency_phone', 'remark'], rows))
  log.push(`owner ${rows.length}`)
}

// ---------- 14 房屋 ----------
{
  const rows = houses.map(x => [
    TENANT, S(x.houseId), S(x.communityId), S(x.buildingId), S(x.unitId), S(x.room),
    I(x.floor), S(x.fullName), S(x.shortName),
    N(x.area), N(x.innerArea),
    S(x.usage || '住宅'), S(x.houseType), S(x.orientation),
    S(x.useStatus), S(x.propertyStatus), S(x.deliverStatus), D(x.deliverDate),
    S(x.stewardEmpId), B(x.decorationViolation), S(x.remark),
  ])
  write('14-house.sql', insertSQL('house',
    ['tenant_id', 'house_id', 'community_id', 'building_id', 'unit_id', 'room',
      'floor', 'full_name', 'short_name', 'build_area', 'inner_area',
      'usage_type', 'house_type', 'orientation',
      'use_status', 'property_status', 'deliver_status', 'deliver_date',
      'steward_emp_id', 'decoration_violation', 'remark'], rows))
  log.push(`house ${rows.length}`)
}

// ---------- 15 车位 ----------
{
  // 账单里用了 448 个车位，但车位台账只有 45 个 —— 原型数据缺口 403 个。
  // 不补建的话 bill.parking_id 外键挂不上。这里按账单里出现的 parkId 补最小档案，
  // 台账里已有的保留原信息，补建的标记 remark 便于以后清理。
  const known = new Set(parkings.map(p => p.parkId))
  const billParks = new Map()
  for (const b of bills) {
    if (b.parkId && !known.has(b.parkId) && !billParks.has(b.parkId)) {
      billParks.set(b.parkId, b)
    }
  }
  const synthetic = [...billParks.entries()].map(([parkId, b]) => ({
    parkId, communityId: b.communityId, ownerId: b.ownerId,
    parkNo: parkId, parkType: '未知', category: '产权车位',
    status: '已售', _synthetic: true,
  }))
  const allParks = [...parkings, ...synthetic]

  const rows = allParks.map(x => [
    TENANT, S(x.parkId), S(x.communityId), S(x.parkNo),
    S(x.parkType),                        // 地下 / 地面 / 未知
    S(x.category === '充电车位' ? '充电桩' : '标准'),
    S(parkCategory(x.category)),
    N(x.area), B(x.chargePile),
    S(x.ownerId), S(x.plateNo),
    S(x.bindStatus === '已绑定' ? '产权' : null), D(x.expireDate),
    S(x.status || '空闲'),
    S(x._synthetic ? '由车位费账单补建（原台账缺失）' : null),
  ])
  write('15-parking.sql', insertSQL('parking',
    ['tenant_id', 'parking_id', 'community_id', 'park_no', 'zone', 'park_type', 'usage_type',
      'area', 'has_charger', 'owner_id', 'plate_no', 'bind_type', 'expire_date', 'status', 'remark'], rows))
  log.push(`parking ${rows.length}（台账 ${parkings.length} + 账单补建 ${synthetic.length}）`)
}

// ---------- 16 产权关系 ----------
{
  const rows = houses.filter(h => h.ownerId).map(h => [
    TENANT, S(h.houseId), S(h.ownerId), S('产权人'), N(100), D('2020-01-01'), S(null),
  ])
  write('16-house-owner.sql', insertSQL('house_owner',
    ['tenant_id', 'house_id', 'owner_id', 'relation', 'share_ratio', 'start_date', 'reason'], rows))
  log.push(`house_owner ${rows.length}`)
}

// ---------- 20 承租人 ----------
{
  const rows = tenants.map((x, k) => [
    TENANT, String(k + 1), S(x.tenantType || '个人'), S(x.name), S(x.phone), S(x.idCard),
    S(x.houseId), S(x.source), S(x.verifyStatus || '待核验'),
    B(x.certified), B(x.faceRegistered), S(x.status || '在住'),
  ])
  write('20-lessee.sql', insertSQL('lessee',
    ['tenant_id', 'lessee_id', 'lessee_type', 'name', 'phone', 'id_card',
      'house_id', 'source', 'verify_status', 'certified', 'face_registered', 'status'], rows))
  log.push(`lessee ${rows.length}`)

  // ---------- 21 租约 ----------
  const ls = tenants.map((x, k) => [
    TENANT, S('LS' + String(k + 1).padStart(6, '0')), S(x.houseId), String(k + 1), S(x.ownerId),
    D(x.leaseStart), D(x.leaseEnd), N(x.rent), N(null),
    S('业主自收'), S('生效'),
  ])
  write('21-lease.sql', insertSQL('lease',
    ['tenant_id', 'lease_no', 'house_id', 'lessee_id', 'owner_id',
      'start_date', 'end_date', 'monthly_rent', 'deposit_amount', 'collect_by', 'status'], ls))
  log.push(`lease ${ls.length}`)
}

// ---------- 30 收费项 ----------
{
  const rows = feeItems.map(x => [
    String(idNum(x.itemId)), TENANT, S(x.itemId), S(x.name),
    S(categoryOf(x)), S(x.calcType), S(x.cycle || '月'), S(x.unit),
    N(x.price, 4), N(x.taxRate, 2), S(null), S(feeDirection(x.direction)),
    S(x.meterType), S(x.status || '启用'), I(0),
  ])
  write('30-fee-item.sql', insertSQL('fee_item',
    ['id', 'tenant_id', 'item_code', 'name', 'category', 'calc_type', 'cycle', 'unit',
      'ref_price', 'tax_rate', 'tax_category', 'direction', 'meter_type', 'status', 'sort'], rows))
  log.push(`fee_item ${rows.length}`)

  // 每个收费项 × 每个社区 一条单价（fixture 没有分项目定价，按 ref_price 铺）
  const pr = []
  for (const c of communities) {
    for (const f of feeItems) {
      pr.push([TENANT, S(c.communityId), String(idNum(f.itemId)), S('住宅'), N(f.price, 4), D('2026-01-01')])
    }
  }
  write('31-fee-item-price.sql', insertSQL('fee_item_price',
    ['tenant_id', 'community_id', 'item_id', 'biz_type', 'price', 'effective_from'], pr))
  log.push(`fee_item_price ${pr.length}`)
}

function categoryOf(x) {
  if (x.itemId === 'FI03' || x.itemId === 'FI05' || x.itemId === 'FI06') return '能耗'
  if (x.itemId === 'FI08') return '押金'
  if (x.itemId === 'FI09') return '经营性'
  if (x.itemId === 'FI10') return '工本费'
  return '常规服务费'
}

// ---------- 40 账单 ----------
{
  const taxOf = new Map(feeItems.map(f => [f.itemId, Number(f.taxRate) || 0]))
  // 原型有两类脏数据，迁移时一次性修掉，否则下游算法验证会被污染：
  //   a) 11 张已作废账单挂着已收金额（作废了钱应已退，不该留已收）
  //   b) 28 张「待缴」却已有已收金额（有回款就该是部分缴/已缴）
  // 用「分」做整数比较：210.64 >= 300.92 - 90.28 在 double 下会算成 false
  // （210.6400000000000005 < 210.640000000000015），15 张账单因此被误判成部分缴。
  const cents = v => Math.round((Number(v) || 0) * 100)
  const fixBill = x => {
    const netCents = cents(x.payable) - cents(x.discount)
    let paidCents = cents(x.paidAmount)
    let status = billStatus(x.status)
    if (status === '已作废') { paidCents = 0 }
    else if (paidCents > 0) {
      status = paidCents >= netCents ? '已缴' : '部分缴'
    }
    return { paid: paidCents / 100, status }
  }

  const rows = bills.map(x => {
    const f = fixBill(x)
    return [
    String(idNum(x.billId)), TENANT, S(x.billId), S(x.communityId),
    x.houseId ? S(x.houseId) : 'NULL',
    x.parkId ? S(x.parkId) : 'NULL',
    String(idNum(x.itemId)), S(x.period),
    N(x.quantity, 4), S(x.unit), N(x.price, 4),
    N(x.amount), N(x.discount || 0), N(x.lateFee || 0), N(x.payable), N(f.paid),
    S(x.ownerId), S(x.itemName), N(taxOf.get(x.itemId) ?? 0, 2),
    S(f.status), D(x.dueDate), D(x.createTime),
  ]})
  write('40-bill.sql', insertSQL('bill',
    ['id', 'tenant_id', 'bill_no', 'community_id', 'house_id', 'parking_id',
      'item_id', 'period', 'quantity', 'unit', 'price',
      'amount', 'waive_amount', 'late_fee', 'payable', 'paid_amount',
      'owner_id', 'item_name', 'tax_rate', 'status', 'due_date', 'created_at'], rows))
  log.push(`bill ${rows.length}`)
}

// ---------- 50 收款 ----------
{
  const billById = new Map(bills.map(b => [b.billId, b]))

  // 84 张账单有已收金额却没有收款流水（原型回款记录不全）。
  // 不补的话「账单已收 = Σ分摊」这条不变式永远红，报表也少这 1.5 万。
  const paidBillIds = new Set(payments.map(x => x.billId))
  const extra = bills
    .filter(b => !paidBillIds.has(b.billId)
      && Number(b.paidAmount) > 0
      && billStatus(b.status) !== '已作废')
    .map((b, k) => ({
      payId: 'PM9' + String(k + 1).padStart(5, '0'),   // id 从 900001 起，避开真实号段
      billId: b.billId,
      ownerId: b.ownerId,
      amount: b.paidAmount,
      method: '现金',
      channel: '线下',
      payPoint: '前台',
      transNo: null,
      payTime: b.dueDate || b.createTime,
      operator: '历史补录',
      _synthetic: true,
    }))
  const allPayments = [...payments, ...extra]

  // 451 张已作废账单还挂着收款（原型没做退款）。作废即退款：
  // 收款标为已冲红，且不生成分摊 —— 否则「账单已收 = Σ分摊」永远不平。
  const isVoidPay = x => {
    const b = billById.get(x.billId)
    return !!b && billStatus(b.status) === '已作废'
  }
  // 89 条减免账单的 payment.amount 填的是减免前价（造数脚本的缺陷）。
  // 真实业务里客户只付减免后的钱，所以以账单的 paidAmount 为准。
  const realAmt = (b, x) => (b.paidAmount !== undefined && b.paidAmount !== null)
    ? b.paidAmount : x.amount
  const rows = allPayments.map(x => {
    const b = billById.get(x.billId) || {}
    return [
      String(idNum(x.payId)), TENANT, S(x.payId), S(b.communityId || 'P01'),
      S('owner'), S(x.ownerId), S(null), N(realAmt(b, x)),
      S(payMethod(x.method)), S(x.channel || '线下'), S(payPoint(x.payPoint)),
      S(x.transNo), T(x.payTime), S(b.period || null),
      S(null), S(x.operator), S(isVoidPay(x) ? '已冲红' : '正常'),
    ]
  })
  write('50-payment.sql', insertSQL('payment',
    ['id', 'tenant_id', 'pay_no', 'community_id', 'payer_type', 'payer_id', 'payer_name', 'amount',
      'method', 'channel', 'pay_point', 'channel_txn_no', 'paid_at', 'period',
      'operator_id', 'operator_name', 'status'], rows))
  log.push(`payment ${rows.length}`)

  // ---------- 51 分摊（一笔收款对一张账单）----------
  const al = allPayments.filter(x => !isVoidPay(x)).map(x => {
    const b = billById.get(x.billId) || {}
    return [
      TENANT, String(idNum(x.payId)), String(idNum(x.billId)),
      S(b.period || '2026-08'), String(idNum(b.itemId || 'FI01')), N(realAmt(b, x)),
    ]
  })
  write('51-payment-allocation.sql', insertSQL('payment_allocation',
    ['tenant_id', 'payment_id', 'bill_id', 'period', 'item_id', 'amount'], al))
  log.push(`payment_allocation ${al.length}`)
}

// ---------- 60 押金 + 61 押金流水 ----------
{
  const rows = deposits.map(x => {
    const bal = (Number(x.amount) || 0) - (Number(x.deductAmount) || 0) - (Number(x.refundAmount) || 0)
    return [
      String(idNum(x.depositId)), TENANT, S(x.depositId), S(x.type || '装修'),
      S(x.communityId), S(x.houseId), S(x.ownerId),
      N(x.amount), N(bal), S(x.status || '在押'),
      D(x.startDate || x.paidDate), D(x.planEndDate || null), S(x.remark),
    ]
  })
  write('60-deposit.sql', insertSQL('deposit',
    ['id', 'tenant_id', 'deposit_no', 'type_id', 'community_id', 'house_id', 'owner_id',
      'amount', 'balance', 'status', 'start_date', 'plan_end_date', 'remark'], rows))
  log.push(`deposit ${rows.length}`)

  const tx = []
  for (const x of deposits) {
    const id = String(idNum(x.depositId))
    if (x.paidDate && Number(x.amount) > 0) {
      tx.push([TENANT, id, S('I'), N(x.amount), S(payMethod(x.payMethod) || null),
        S(payPoint(x.payPoint) || null), T(x.paidDate), S(null), S(null), S(x.operator)])
    }
    if (x.refundDate && Number(x.refundAmount) > 0) {
      tx.push([TENANT, id, S('O'), N(x.refundAmount), S(payMethod(x.refundMethod) || null),
        S(payPoint(x.refundPoint) || null), T(x.refundDate), S('退还押金'), S(null), S(x.operator)])
    }
    if (Number(x.deductAmount) > 0) {
      tx.push([TENANT, id, S('D'), N(x.deductAmount), 'NULL', 'NULL',
        T(x.checkDate || x.paidDate), S(x.deductReason || '验收扣款'), S(null), S(x.operator)])
    }
  }
  write('61-deposit-txn.sql', insertSQL('deposit_txn',
    ['tenant_id', 'deposit_id', 'direction', 'amount', 'method', 'pay_point',
      'occurred_at', 'reason', 'ref_no', 'operator_id'], tx))
  log.push(`deposit_txn ${tx.length}`)
}

// ---------- 70 表计 + 71 读数 ----------
{
  const rows = meters.map(x => [
    TENANT, S(x.meterId), S(x.meterNo || x.meterId), S(meterType(x.type)), S(x.unit || 'kWh'),
    S(x.communityId), x.houseId ? S(x.houseId) : 'NULL', 'NULL', B(!x.houseId),
    String(idNum(x.itemId || 'FI05')), N(x.factor || 1, 4),
    D(x.installDate), N(x.lastReading, 4), D(x.lastReadDate), S(meterStatus(x.status)),
  ])
  write('70-meter.sql', insertSQL('meter',
    ['tenant_id', 'meter_id', 'meter_no', 'meter_type', 'unit', 'community_id',
      'house_id', 'parking_id', 'is_public', 'item_id', 'factor',
      'install_date', 'last_reading', 'last_read_date', 'status'], rows))
  log.push(`meter ${rows.length}`)

  // 1218 条读数里有 165 条 currentReading 为空 —— 那是"待抄任务"不是读数，
  // 迁进来会污染用量统计。只迁有实际读数的。
  const validReadings = readings.filter(x =>
    x.currentReading !== null && x.currentReading !== undefined && x.currentReading !== '')
  const rd = validReadings.map(x => {
    const usage = (x.usage !== null && x.usage !== undefined && x.usage !== '')
      ? x.usage
      : (Number(x.currentReading) - Number(x.lastReading || 0))
    const readDate = x.readDate || (x.period ? `${x.period}-15` : null)
    return [
      TENANT, S(x.meterId), S(x.period),
      N(x.lastReading, 4), N(x.currentReading, 4), N(usage, 4),
      D(readDate), S(x.reader), B(x.abnormal), S(null),
      x.billId ? String(idNum(x.billId)) : 'NULL',
    ]
  })
  write('71-meter-reading.sql', insertSQL('meter_reading',
    ['tenant_id', 'meter_id', 'period', 'last_reading', 'current_reading', 'usage_qty',
      'read_date', 'reader_id', 'is_abnormal', 'abnormal_note', 'bill_id'], rd))
  log.push(`meter_reading ${rd.length}（跳过未抄 ${readings.length - validReadings.length} 条）`)
}

// ---------- 99 序列修正 ----------
write('99-setval.sql', `
-- 显式指定主键后，序列必须推到 max，否则后续自增会撞号
SELECT setval(pg_get_serial_sequence('wy.bill', 'id'),                COALESCE((SELECT max(id) FROM wy.bill), 1));
SELECT setval(pg_get_serial_sequence('wy.payment', 'id'),             COALESCE((SELECT max(id) FROM wy.payment), 1));
SELECT setval(pg_get_serial_sequence('wy.deposit', 'id'),             COALESCE((SELECT max(id) FROM wy.deposit), 1));
SELECT setval(pg_get_serial_sequence('wy.deposit_txn', 'id'),         COALESCE((SELECT max(id) FROM wy.deposit_txn), 1));
SELECT setval(pg_get_serial_sequence('wy.payment_allocation', 'id'),  COALESCE((SELECT max(id) FROM wy.payment_allocation), 1));
SELECT setval(pg_get_serial_sequence('wy.fee_item', 'id'),            COALESCE((SELECT max(id) FROM wy.fee_item), 1));
SELECT setval(pg_get_serial_sequence('wy.house_owner', 'id'),         COALESCE((SELECT max(id) FROM wy.house_owner), 1));
SELECT setval(pg_get_serial_sequence('wy.lease', 'id'),               COALESCE((SELECT max(id) FROM wy.lease), 1));
SELECT setval(pg_get_serial_sequence('wy.meter_reading', 'id'),       COALESCE((SELECT max(id) FROM wy.meter_reading), 1));
`)

console.log('生成完成：')
for (const l of log) console.log('  ' + l)
console.log(`\n输出目录：${OUT}`)
