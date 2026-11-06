#!/usr/bin/env python3
"""
开票设置 fixture —— 契约与原型必须同口径（改一处要改另一处）

与 `03-原型/src/utils/api.js` 的 `_seedInvoiceProfiles()` 一一对应：
  · 个人抬头取业主 3 / 27 / 末位（原型数据集 682 人取 101，
    契约数据集只有 60 人，所以末位回落到 -1；结构与条数保持一致即可）
  · 企业抬头取前 4 个「有统一社会信用代码的公司租户」
  · 另外 3 条纯手工档：业主表里没有这些单位，正是临时收费的真实场景

幂等：不引随机，重跑只改这个文件。
"""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent.parent
FIX = HERE / 'fixtures'

owners = json.loads((FIX / 'owners.json').read_text(encoding='utf-8'))
houses = json.loads((FIX / 'houses.json').read_text(encoding='utf-8'))
tenants = json.loads((FIX / 'tenants.json').read_text(encoding='utf-8'))

HOUSE_OF_OWNER = {}
for h in houses:
    if h.get('ownerId'):
        HOUSE_OF_OWNER.setdefault(h['ownerId'], h.get('houseId', ''))

ITEM_SPECS = [
    ('摆摊费', 6, '现代服务 · 其他现代服务', '外来摊贩按次 / 按天收取，与物业费无关'),
    ('场地租用', 9, '不动产经营租赁', '公共区域、大堂、车位的场地对外出租'),
    ('赔偿款', 0, '不征税项目', '损坏赔偿、违约金；不征增值税，开收据即可'),
    ('押金', 0, '代收款项', '装修 / 门禁卡押金；代收不确认收入，退还时冲回'),
    ('其他', 6, '现代服务 · 其他现代服务', '未列明的临时收费，开票时写清具体事由'),
]

items = []
for i, (name, rate, tax_class, remark) in enumerate(ITEM_SPECS, start=1):
    items.append({
        'itemId': 'II%02d' % i,
        'name': name,
        'taxRate': rate,
        'taxClass': tax_class,
        'builtin': True,
        'enabled': True,
        'sort': i * 10,
        'remark': remark,
        'createdAt': '2026-01-01 00:00',
        'updatedAt': '2026-01-01 00:00',
    })


def seed(p, idx, title_type, tax_no=''):
    return {
        'profileId': 'IP%04d' % idx,
        'titleType': title_type,
        'title': p['title'],
        'taxNo': tax_no,
        'bankName': p.get('bankName', ''),
        'bankAccount': p.get('bankAccount', ''),
        'regAddress': p.get('regAddress', ''),
        'regPhone': p.get('regPhone', ''),
        'contactName': p.get('contactName', ''),
        'contactPhone': p.get('contactPhone', ''),
        'contactEmail': p.get('contactEmail', ''),
        'sourceType': p.get('sourceType', '手动'),
        'sourceId': p.get('sourceId', ''),
        'sourceName': p.get('sourceName', ''),
        'houseId': p.get('houseId', ''),
        'isDefault': bool(p.get('isDefault')),
        'enabled': True,
        'remark': p.get('remark', ''),
        'createdAt': p.get('createdAt', '2026-10-12 10:00'),
        'updatedAt': p.get('updatedAt', '2026-10-12 10:00'),
        'createdBy': p.get('createdBy', '财务部'),
    }


profiles = []
seq = 0
for oi, is_def, remark in ((3, True, '经常来前台开票，已存为默认'), (27, False, ''), (len(owners) - 1, False, '')):
    if oi >= len(owners):
        continue
    o = owners[oi]
    seq += 1
    profiles.append(seed({
        'title': o['name'],
        'contactName': o['name'],
        'contactPhone': o.get('phone', ''),
        'sourceType': '业主',
        'sourceId': o['ownerId'],
        'sourceName': o['name'],
        'houseId': HOUSE_OF_OWNER.get(o['ownerId'], ''),
        'isDefault': is_def,
        'remark': remark,
    }, seq, '个人'))

companies = [t for t in tenants if t.get('tenantType') == '公司' and t.get('creditCode')][:4]
for t in companies:
    seq += 1
    profiles.append(seed({
        'title': t.get('companyName') or t['name'],
        'regAddress': t.get('regAddress', ''),
        'regPhone': t.get('phone', ''),
        'contactName': t.get('agentName') or t.get('legalPerson') or t['name'],
        'contactPhone': t.get('agentPhone') or t.get('phone', ''),
        'sourceType': '租户',
        'sourceId': t['tenantId'],
        'sourceName': t.get('companyName') or t['name'],
        'houseId': t.get('houseId', ''),
        'remark': '企业承租，开票信息从租户档案带入',
    }, seq, '企业', t['creditCode']))

manual = [
    {
        'title': '成都锦江夜市管理有限公司', 'taxNo': '91510104MA6C8X2K3P',
        'regAddress': '成都市锦江区东大街 88 号', 'regPhone': '028-86661234',
        'contactName': '刘敏', 'contactPhone': '13880001234',
        'remark': '摆摊费月结客户，与业主无关',
    },
    {
        'title': '四川会展服务有限公司', 'taxNo': '91510100MA61YQ7N2B',
        'regAddress': '成都市武侯区人民南路四段 1 号',
        'contactName': '陈立', 'contactPhone': '13908012345',
        'remark': '场地租用，按次开票',
    },
    {
        'title': '王秀兰', 'contactName': '王秀兰', 'contactPhone': '13550123456',
        'remark': '临时摊位个人缴费',
    },
]
for m in manual:
    seq += 1
    title_type = '企业' if m.get('taxNo') else '个人'
    profiles.append(seed(m, seq, title_type, m.get('taxNo', '')))

template = {
    'tplId': 'IT01',
    'name': '通用收款票据模板',
    'title': '收 款 收 据',
    'paper': {'width': 241, 'height': 140},
    'margin': {'top': 12, 'right': 10, 'bottom': 8, 'left': 10},
    'offset': {'x': 0, 'y': 0},
    'font': {'family': '宋体', 'size': 10, 'lineHeight': 1.7},
    'copies': 3,
    'copyTitles': ['存根联', '客户联', '财务联'],
    'showStub': True,
    'showQr': False,
    'footerLeft': '收款人：',
    'footerRight': '复核：',
    'note': '本收据仅作收款凭证，不作报销凭证。',
    'updatedAt': '2026-11-01 09:00',
    'updatedBy': '财务部',
}

out = {'items': items, 'profiles': profiles, 'template': template}
dest = FIX / 'invoice-settings.json'
dest.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('wrote', dest, '| items', len(items), '| profiles', len(profiles))
