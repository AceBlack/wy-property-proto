"""办公资产样例（2026-11-04 第 58 批）

5 个大类 + 15 个小类 + 40 件资产。数量刻意小于原型（120 件）——
契约样例只用来说明**结构与边界**，不是业务数据。
重复运行结果相同（用索引取模，不引入随机）。
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMPS = json.load(open(os.path.join(ROOT, 'fixtures', 'employees.json'), encoding='utf-8'))
ORGS = json.load(open(os.path.join(ROOT, 'fixtures', 'orgs.json'), encoding='utf-8'))
O = {o['orgId']: o for o in ORGS}

CATS = [
    ('办公设备', '', 'BG', [('电脑', 'BG-01'), ('显示器', 'BG-02'), ('打印机/复印机', 'BG-03'), ('投影设备', 'BG-04'), ('网络设备', 'BG-05')]),
    ('办公家具', '', 'JJ', [('桌椅', 'JJ-01'), ('文件柜', 'JJ-02'), ('沙发茶几', 'JJ-03')]),
    ('电子电器', '', 'DZ', [('空调', 'DZ-01'), ('饮水机', 'DZ-02'), ('冰箱微波炉', 'DZ-03')]),
    ('工具器具', '', 'GJ', [('维修工具', 'GJ-01'), ('电工工具', 'GJ-02'), ('测量仪器', 'GJ-03')]),
]

cats = []
n = 0
for top, _, prefix, kids in CATS:
    n += 1
    top_id = 'AC%04d' % n
    cats.append({'catId': top_id, 'name': top, 'parentId': '', 'prefix': prefix, 'sort': n * 10,
                 'note': '', 'enabled': True, 'createdAt': '2026-01-01 00:00'})
    for i, (kid, kprefix) in enumerate(kids):
        n += 1
        cats.append({'catId': 'AC%04d' % n, 'name': kid, 'parentId': top_id, 'prefix': kprefix,
                     'sort': (i + 1) * 10, 'note': '', 'enabled': True, 'createdAt': '2026-01-01 00:00'})

ITEMS = {
    '电脑': [('联想 ThinkPad E14', '联想', 'E14 Gen4', 5899), ('戴尔 Latitude 5440', '戴尔', '5440', 6299)],
    '显示器': [('戴尔 24 寸显示器', '戴尔', 'P2422H', 1099)],
    '打印机/复印机': [('惠普激光打印机', '惠普', 'M403d', 1899)],
    '投影设备': [('爱普生投影仪', '爱普生', 'CB-X50', 4299)],
    '网络设备': [('华为交换机', '华为', 'S5720', 2899)],
    '桌椅': [('人体工学办公椅', '西昊', 'M18', 1199), ('主管办公桌 1.6m', '震旦', 'D16', 2499)],
    '文件柜': [('钢制文件柜四门', '得力', 'FC-4', 899)],
    '沙发茶几': [('接待沙发三人位', '全友', 'SF-3', 2899)],
    '空调': [('格力挂机 1.5 匹', '格力', 'KFR-35GW', 3199)],
    '饮水机': [('沁园商用饮水机', '沁园', 'QY-2', 1699)],
    '冰箱微波炉': [('海尔双门冰箱', '海尔', 'BCD-216', 2199)],
    '维修工具': [('世达工具套装 46 件', '世达', '09014', 899)],
    '电工工具': [('数字万用表', '优利德', 'UT61E', 469)],
    '测量仪器': [('激光测距仪', '博世', 'GLM50', 599)],
}
LEAF = [c for c in cats if c['parentId']]

POOL = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'


def tok(i):
    """16 位随机 token：与编号无关，编号能顺序推、token 不能"""
    x = 20261104 + i * 7919
    out = ''
    for _ in range(16):
        x = (x * 1103515245 + 12345) % 2147483648
        out += POOL[x % len(POOL)]
    return out


STATUS = ['在用'] * 24 + ['闲置'] * 10 + ['报废'] * 6
LOCS = ['总部 3F 财务部', '总部 2F 行政办公室', '翡翠城项目部办公室', '锦绣家园项目部办公室', '总部 B1 库房']
active = [e for e in EMPS if e.get('status') != '离职']

assets = []
for i in range(40):
    cat = LEAF[i % len(LEAF)]
    specs = ITEMS[cat['name']]
    nm, brand, model, price = specs[i % len(specs)]
    emp = active[i % len(active)] if i % 5 != 4 else None
    org = (emp or {}).get('orgId') or 'O-HEAD'
    buy = '202%d-%02d-%02d' % (1 + i % 5, 1 + i % 12, 1 + i % 28)
    assets.append({
        'assetId': 'AS%04d' % (i + 1),
        'assetNo': 'ZC2026%04d' % (i + 1),
        'name': nm,
        'catId': cat['catId'],
        'catName': cat['name'],
        'catPath': next(t['name'] for t in cats if t['catId'] == cat['parentId']) + ' / ' + cat['name'],
        'assetCode': '%s-%03d' % (cat['prefix'], i + 1),
        'brand': brand,
        'model': model,
        'sn': '%s%06d' % (brand[:2].upper(), 100000 + i * 7919 % 900000),
        'buyDate': buy,
        'price': price,
        'vendor': ['成都联创科技有限公司', '京东企业购', '本地供应商'][i % 3],
        'warrantyEnd': '2027-%02d-%02d' % (1 + i % 12, 1 + i % 28),
        'holderEmpId': (emp or {}).get('empId', ''),
        'orgId': org,
        'location': LOCS[i % len(LOCS)],
        'status': STATUS[i],
        'remark': '',
        'files': [],
        'qrToken': tok(i),
        'createdAt': '2026-01-05 09:%02d' % (i % 60),
        'createdBy': '人事专员',
        '_ver': 1,
    })

json.dump(cats, open(os.path.join(ROOT, 'fixtures', 'asset-categories.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
json.dump(assets, open(os.path.join(ROOT, 'fixtures', 'assets.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('分类 %d（%d 大类 + %d 小类）· 资产 %d' % (len(cats), len(cats) - len(LEAF), len(LEAF), len(assets)))
print('状态分布：', {s: sum(1 for a in assets if a['status'] == s) for s in set(STATUS)})
print('样例 token：', assets[0]['qrToken'], '｜编号', assets[0]['assetNo'])
