#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 fixtures/temp-charges.json（第 63 批 · 临时收费）

幂等：固定内容，不引随机，重跑逐字节一致。

口径与 03-原型 src/utils/api.js 的 `_tcSeed()` 同一套（改一处必须改另一处）：
  · 付款方三选一：业主 / 租户 / 外部（外来单位或个人）；
  · **项目必填** —— 收入要按项目入账；
  · 状态：待收款 / 已收款 / 已作废；已作废必须写原因；
  · **不进收缴率**（没有应收），但计入营业收入（按 itemName 汇总）。

条数与原型一致（11 条），但业主/租户单按契约数据集（60 人 / 60 户）重新挑，
不硬编码 id —— 换数据集不会生成空单据。
"""
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(BASE, 'fixtures')


def load(name):
    with open(os.path.join(FIX, name), encoding='utf-8') as f:
        return json.load(f)


owners = load('owners.json')
tenants = load('tenants.json')
communities = load('communities.json')

cm_ids = [c['communityId'] for c in communities]

# 外部缴费人：摆摊 / 场地 / 赔偿，名字来自真实场景（不是张三李四）
EXTERNAL = [
    ('陈记糖油果子', '13800002101', '摆摊费', 320.00, '2026-09-12 10:20'),
    ('王姐手工艺品摊', '13800002102', '摆摊费', 260.00, '2026-09-18 15:40'),
    ('社区便民集市 · 周三场', '13800002105', '场地租用', 1500.00, '2026-10-08 09:15'),
    ('阳光健身（小区中庭推广）', '13800002106', '场地租用', 1800.00, '2026-10-14 14:05'),
    ('李师傅修鞋配钥匙', '13800002103', '摆摊费', 180.00, '2026-10-05 09:30'),
    ('快递柜占地费（丰巢）', '', '场地租用', 2400.00, '2026-10-02 11:00'),
    ('电动车充电桩场地费', '13800002109', '场地租用', 960.00, '2026-10-16 16:20'),
    ('公共区域损坏赔偿（电梯门）', '', '赔偿款', 680.00, '2026-10-19 10:10'),
]

rows = []
seq = 0
for i, (name, phone, reason, amount, at) in enumerate(EXTERNAL):
    seq += 1
    day = at[:10]
    rows.append({
        'chargeId': 'TC%05d' % seq,
        'chargeNo': 'LSF%s-%03d' % (day.replace('-', ''), i + 1),
        'partyType': '外部',
        'partyName': name,
        'partyPhone': phone,
        'ownerId': '', 'tenantId': '', 'houseId': '',
        'communityId': cm_ids[i % len(cm_ids)],
        'reason': reason,
        'itemName': reason,
        'amount': amount,
        'status': '待收款',
        'method': '', 'splits': [], 'payTime': '', 'payId': '', 'batchNo': '',
        'operator': '', 'remark': '',
        'createdAt': at,
        'createdBy': '张丽（收银员）',
        'voidReason': '', 'voidAt': '', 'voidBy': '',
    })

# 两条业主单 + 一条租户单：能挂房屋，开票时走"档案下拉"
for i, o in enumerate(owners[:2]):
    seq += 1
    houses = o.get('houseIds') or []
    hid = houses[0] if houses else ''
    rows.append({
        'chargeId': 'TC%05d' % seq,
        'chargeNo': 'LSF20261019-%03d' % (9 + i),
        'partyType': '业主',
        'partyName': o['name'],
        'partyPhone': o.get('phone', ''),
        'ownerId': o['ownerId'], 'tenantId': '', 'houseId': hid,
        'communityId': cm_ids[0],
        'reason': '押金',
        'itemName': '押金',
        'amount': 500.00 if i == 0 else 800.00,
        'status': '待收款',
        'method': '', 'splits': [], 'payTime': '', 'payId': '', 'batchNo': '',
        'operator': '', 'remark': '业主自用场地',
        'createdAt': '2026-10-19 10:%02d' % (20 + i * 10),
        'createdBy': '张丽（收银员）',
        'voidReason': '', 'voidAt': '', 'voidBy': '',
    })

t = tenants[0]
seq += 1
rows.append({
    'chargeId': 'TC%05d' % seq,
    'chargeNo': 'LSF20261020-011',
    'partyType': '租户',
    'partyName': t.get('companyName') or t['name'],
    'partyPhone': t.get('phone', ''),
    'ownerId': '', 'tenantId': t['tenantId'], 'houseId': t.get('houseId', ''),
    'communityId': cm_ids[0],
    'reason': '其他',
    'itemName': '其他收入',
    'amount': 300.00,
    'status': '待收款',
    'method': '', 'splits': [], 'payTime': '', 'payId': '', 'batchNo': '',
    'operator': '', 'remark': '',
    'createdAt': '2026-10-20 15:10',
    'createdBy': '张丽（收银员）',
    'voidReason': '', 'voidAt': '', 'voidBy': '',
})

# 前 5 条设为已收款（写 method/splits/payTime；payId 由 mock 侧关联，不在这里编）
METHODS = ['微信支付', '现金', '支付宝']
for i in range(5):
    r = rows[i]
    m = METHODS[i % len(METHODS)]
    r['status'] = '已收款'
    r['method'] = m
    r['splits'] = [{'method': m, 'amount': r['amount']}]
    r['payTime'] = r['createdAt']
    r['operator'] = '张丽（收银员）'

# 最后一条作废：台账要能解释"为什么没收钱"
last = rows[-1]
last['status'] = '已作废'
last['voidReason'] = '缴费人取消，改为下周再来'
last['voidAt'] = '2026-10-20 17:30'
last['voidBy'] = '张丽（收银员）'

out = os.path.join(FIX, 'temp-charges.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)
    f.write('\n')

paid = [r for r in rows if r['status'] == '已收款']
print('temp-charges.json：%d 条（已收 %d / 待收 %d / 作废 %d），已收合计 %.2f' % (
    len(rows), len(paid), len([r for r in rows if r['status'] == '待收款']),
    len([r for r in rows if r['status'] == '已作废']), sum(r['amount'] for r in paid)))
