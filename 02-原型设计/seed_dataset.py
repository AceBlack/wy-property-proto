# -*- coding: utf-8 -*-
"""智慧物业 V2 演示数据集生成器
固定随机种子，保证每次生成结果一致；所有实体用显式 ID 关联，保证跨页数据对得上。
输出：mock/*.json  +  mock/index.js（供 Vue 项目直接 import）
"""
import json, os, random
from datetime import date, datetime, timedelta

SEED = 20261021
random.seed(SEED)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock')
os.makedirs(OUT, exist_ok=True)

TODAY = date(2026, 10, 21)
PERIODS = ['2026-08', '2026-09', '2026-10']          # 账期
CUR = '2026-10'

def d(s):  # 'YYYY-MM-DD' -> date
    y, m, dd = s.split('-')
    return date(int(y), int(m), int(dd))

def ds(x): return x.isoformat()

def rint(a, b): return random.randint(a, b)
def pick(seq): return random.choice(seq)
def pickw(pairs):  # [(value, weight)]
    tot = sum(w for _, w in pairs)
    x = random.uniform(0, tot)
    for v, w in pairs:
        x -= w
        if x <= 0: return v
    return pairs[-1][0]

SUR = '王李张刘陈杨黄赵吴周徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡余杜叶程苏魏吕丁任卢姚沈姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤'
GIVEN = ['伟','芳','娜','秀英','敏','静','丽','强','磊','军','洋','勇','艳','杰','娟','涛','明','超','秀兰','霞','平','刚','桂英','建国','建华','文','辉','红','玉兰','鹏','宇','浩','晨','雪','婷','嘉','欣','悦','子轩','梓涵','雨欣','浩然','思远','若曦','一鸣','子墨','佳怡','志强','淑珍','国强','丽华','海燕','晓东','春梅','振华','秀芳','建军','秀珍','文博','雅静','天佑','瑞','琳','博','坤','鑫','淼','淼然']

def person_name():
    return pick(SUR) + pick(GIVEN)

def phone():
    return '1' + pick(['3', '5', '7', '8', '9']) + str(rint(0, 9)) + ''.join(str(rint(0, 9)) for _ in range(8))

def idcard():
    # 仅演示用，非真实身份证
    return '5101%02d%02d%02d%04d%04d' % (rint(60, 99), rint(1, 12), rint(1, 28), rint(1000, 9999), rint(1000, 9999))

def plate():
    pre = pick(['川A', '川B', '渝A', '粤B', '京N', '沪C', '苏E', '浙B'])
    return pre + '·' + ''.join(pick('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789') for _ in range(5))

def money(x): return round(float(x), 2)

# ============================================================ 1. 组织与项目
ORGS = [
    {'orgId': 'O-ROOT', 'name': '嘉合物业服务集团', 'parentId': '', 'type': '集团', 'leader': '周建国', 'sort': 1},
    {'orgId': 'O-HEAD', 'name': '总部职能中心', 'parentId': 'O-ROOT', 'type': '部门', 'leader': '周建国', 'sort': 2},
    {'orgId': 'O-FIN', 'name': '财务管理部', 'parentId': 'O-HEAD', 'type': '部门', 'leader': '何淑珍', 'sort': 3},
    {'orgId': 'O-HR', 'name': '人力资源部', 'parentId': 'O-HEAD', 'type': '部门', 'leader': '谢文博', 'sort': 4},
    {'orgId': 'O-QS', 'name': '品质管理部', 'parentId': 'O-HEAD', 'type': '部门', 'leader': '梁雅静', 'sort': 5},
    {'orgId': 'O-ENG', 'name': '工程管理部', 'parentId': 'O-HEAD', 'type': '部门', 'leader': '罗天佑', 'sort': 6},
    {'orgId': 'O-P01', 'name': '翡翠城项目部', 'parentId': 'O-ROOT', 'type': '项目', 'leader': '张振华', 'sort': 7},
    {'orgId': 'O-P02', 'name': '锦绣家园项目部', 'parentId': 'O-ROOT', 'type': '项目', 'leader': '李春梅', 'sort': 8},
    {'orgId': 'O-P03', 'name': '星光天地项目部', 'parentId': 'O-ROOT', 'type': '项目', 'leader': '陈瑞', 'sort': 9},
]

COMMUNITIES = [
    {'communityId': 'P01', 'name': '翡翠城', 'orgId': 'O-P01', 'bizType': '住宅', 'address': '成都市高新区天府大道南段 1288 号',
     'buildYear': 2015, 'deliverDate': '2015-06-30', 'landArea': 68000, 'buildArea': 186000, 'greenRate': 35.2,
     'plotRatio': 2.7, 'manager': '张振华', 'phone': '028-8866****', 'houseCount': 0, 'parkCount': 0,
     'propertyFee': 2.80, 'feeUnit': '元/㎡·月', 'status': '在管', 'contractStart': '2021-01-01', 'contractEnd': '2026-12-31'},
    {'communityId': 'P02', 'name': '锦绣家园', 'orgId': 'O-P02', 'bizType': '住宅', 'address': '成都市武侯区武侯大道 566 号',
     'buildYear': 2020, 'deliverDate': '2020-09-28', 'landArea': 42000, 'buildArea': 128000, 'greenRate': 38.6,
     'plotRatio': 3.0, 'manager': '李春梅', 'phone': '028-8877****', 'houseCount': 0, 'parkCount': 0,
     'propertyFee': 3.20, 'feeUnit': '元/㎡·月', 'status': '在管', 'contractStart': '2021-09-01', 'contractEnd': '2026-08-31'},
    {'communityId': 'P03', 'name': '星光天地', 'orgId': 'O-P03', 'bizType': '商业', 'address': '成都市锦江区红星路三段 88 号',
     'buildYear': 2019, 'deliverDate': '2019-03-15', 'landArea': 18000, 'buildArea': 62000, 'greenRate': 12.0,
     'plotRatio': 3.4, 'manager': '陈瑞', 'phone': '028-8899****', 'houseCount': 0, 'parkCount': 0,
     'propertyFee': 8.50, 'feeUnit': '元/㎡·月', 'status': '在管', 'contractStart': '2022-03-01', 'contractEnd': '2027-02-28'},
]

BUILDINGS = []   # 楼栋
UNITS = []       # 单元
HOUSES = []      # 房屋
bid = 0
SPEC = {'P01': (8, 2, 11, 2, '住宅'), 'P02': (6, 2, 11, 2, '住宅'), 'P03': (2, 1, 4, 15, '商业')}
for c in COMMUNITIES:
    cid = c['communityId']
    nb, nu, nf, nper, usage = SPEC[cid]
    for b in range(1, nb + 1):
        bid += 1
        bcode = '%02d' % b
        BUILDINGS.append({
            'buildingId': 'B' + bcode + cid[-2:], 'communityId': cid, 'buildingNo': bcode,
            'name': '%d栋' % b, 'usage': usage, 'unitCount': nu, 'floorCount': nf,
            'houseCount': nu * nf * nper, 'structure': pick(['剪力墙', '框架']),
            'hasElevator': True if usage == '商业' else b % 2 == 1 or cid == 'P02',
            'deliverDate': c['deliverDate'], 'buildArea': round(nu * nf * nper * (95 if usage == '住宅' else 130), 1),
        })
        for u in range(1, nu + 1):
            ucode = '%d' % u
            UNITS.append({
                'unitId': 'U' + bcode + ucode + cid[-2:], 'buildingId': 'B' + bcode + cid[-2:],
                'communityId': cid, 'unitNo': ucode, 'name': '%s单元' % ucode,
                'floorCount': nf, 'housePerFloor': nper, 'elevatorCount': 2 if usage == '商业' else (1 if b % 2 == 1 else 0),
            })
            for f in range(1, nf + 1):
                for s in range(1, nper + 1):
                    room = '%02d%02d' % (f, s)
                    area = round(random.uniform(78, 142), 2) if usage == '住宅' else round(random.uniform(45, 320), 2)
                    HOUSES.append({
                        'houseId': 'H%s%s%s%s' % (cid[-2:], bcode, ucode, room),
                        'communityId': cid, 'buildingId': 'B' + bcode + cid[-2:],
                        'unitId': 'U' + bcode + ucode + cid[-2:],
                        'room': room, 'floor': f, 'seq': s,
                        'fullName': '%s %s栋%s单元%s' % (c['name'], b, ucode, room),
                        'shortName': '%s-%s%s-%s' % (cid, bcode, ucode, room),
                        'usage': usage, 'houseType': pick(['两室一厅', '三室两厅', '四室两厅', '一室一厅', '跃层']) if usage == '住宅' else pick(['零售铺', '餐饮铺', '办公', '配套']),
                        'area': area, 'innerArea': round(area * 0.82, 2),
                        'orientation': pick(['朝南', '朝东南', '朝西南', '朝东', '朝北']),
                        'decoration': pick(['精装修', '简装修', '毛坯']),
                        'deliverStatus': '已交付',
                        'useStatus': None,      # 后面按规则填
                        'propertyStatus': None,
                        'ownerId': None,        # 后面绑定
                        'tenantId': None,
                        'checkinDate': None,
                        'certNo': '',
                    })

# ---- 使用状态 / 产权状态 ----
USE_W = [('自住', 62), ('出租', 20), ('空置', 11), ('装修中', 5), (' restricted', 2)]
for h in HOUSES:
    h['useStatus'] = pickw([('自住', 62), ('出租', 20), ('空置', 11), ('装修中', 5), ('限制使用', 2)])
    h['propertyStatus'] = pickw([('已办证', 78), ('办理中', 14), ('未办理', 6), ('抵押中', 2)])
    if h['useStatus'] != '空置':
        h['checkinDate'] = ds(d(COMMUNITIES[0]['deliverDate'] if h['communityId'] == 'P01' else
                                ('2020-09-28' if h['communityId'] == 'P02' else '2019-03-15')) + timedelta(days=rint(0, 400)))
    if h['propertyStatus'] == '已办证':
        h['certNo'] = '成房权证监证字第' + str(rint(2000000, 5999999)) + '号'

for c in COMMUNITIES:
    c['houseCount'] = sum(1 for h in HOUSES if h['communityId'] == c['communityId'])

# ============================================================ 2. 业主 / 成员 / 租户
OWNERS = []
MEMBERS = []
oid = 0

# ---- 四个固定演示对象（golden records），评审反复用到 ----
GOLDEN = [
    # (姓名, 手机, 序号, 绑定房屋 shortName 列表, 说明)
    ('张建国', '13800138001', ['P01-011-0501', 'P01-031-1102'], '一人多房 + 车位 + 欠费 + 在途报修', ['配偶', '子女']),
    ('李秀兰', '13900139002', ['P01-021-0302'], '欠费大户，逾期 182 天，走催缴流程', ['配偶']),
    ('王浩然', '13700137003', ['P02-011-0601', 'P02-022-0902', 'P01-051-0701'], '一人三房，用于演示合并收费', []),
    ('赵春梅', '13600136004', ['P03-011-0205'], '商业业主，自营餐饮，租约 60 天内到期需续约跟进', []),
]
MEMBER_NAMES = {'配偶': ['刘芳', '陈静', '杨丽', '何霞'], '子女': ['张小雨', '李小磊', '王小雪'], '父母': ['张德福', '李桂芳']}

def mk_owner(name, phone_no, tag):
    global oid
    oid += 1
    return {
        'ownerId': 'OW%05d' % oid, 'name': name, 'phone': phone_no, 'idCard': idcard(),
        'gender': pick(['男', '女']), 'birthday': ds(date(rint(1958, 2002), rint(1, 12), rint(1, 28))),
        'ownerType': tag, 'certified': True, 'faceRegistered': pickw([(True, 72), (False, 28)]),
        'appRegistered': pickw([(True, 81), (False, 19)]), 'wechatBound': pickw([(True, 68), (False, 32)]),
        'email': '', 'emergencyContact': person_name(), 'emergencyPhone': phone(),
        'houseIds': [], 'parkIds': [], 'tags': [], 'creditLevel': pickw([('A', 70), ('B', 22), ('C', 8)]),
        'registerDate': ds(date(rint(2015, 2025), rint(1, 12), rint(1, 28))),
        'remark': '',
    }

H_BY_SHORT = {h['shortName']: h for h in HOUSES}
golden_owners = []
for name, ph, shorts, desc, mem in GOLDEN:
    o = mk_owner(name, ph, '业主')
    o['remark'] = desc
    for sn in shorts:
        h = H_BY_SHORT.get(sn)
        if h:
            h['ownerId'] = o['ownerId']
            o['houseIds'].append(h['houseId'])
    # 家庭成员
    for kind in mem:
        MEMBERS.append({
            'memberId': 'MB%05d' % (len(MEMBERS) + 1), 'ownerId': o['ownerId'],
            'name': pick(MEMBER_NAMES.get(kind, ['李某某'])), 'relation': kind,
            'phone': phone(), 'idCard': idcard(), 'certified': pick([True, False]),
            'faceRegistered': pick([True, False]), 'isOwnerAppUser': pick([True, False]),
            'remark': '',
        })
    OWNERS.append(o)
    golden_owners.append(o)

# ---- 其余房屋随机分配业主（允许一人多房，约 6%）----
rest = [h for h in HOUSES if not h['ownerId']]
i = 0
while i < len(rest):
    o = mk_owner(person_name(), phone(), '业主')
    n = 1 if random.random() > 0.06 else rint(2, 3)
    for h in rest[i:i + n]:
        h['ownerId'] = o['ownerId']
        o['houseIds'].append(h['houseId'])
        if random.random() < 0.22:
            MEMBERS.append({
                'memberId': 'MB%05d' % (len(MEMBERS) + 1), 'ownerId': o['ownerId'],
                'name': person_name(), 'relation': pick(['配偶', '子女', '父母', '其他']),
                'phone': phone(), 'idCard': idcard(), 'certified': pick([True, False]),
                'faceRegistered': pick([True, False]), 'isOwnerAppUser': pick([True, False]), 'remark': '',
            })
    OWNERS.append(o)
    i += n

# ---- 租户 ----
TENANTS = []
tid = 0
for h in HOUSES:
    if h['useStatus'] == '出租':
        tid += 1
        t = {'tenantId': 'TN%05d' % tid, 'name': person_name(), 'phone': phone(), 'idCard': idcard(),
             'houseId': h['houseId'], 'ownerId': h['ownerId'], 'leaseStart': ds(TODAY - timedelta(days=rint(60, 900))),
             'leaseEnd': ds(TODAY + timedelta(days=rint(30, 600))), 'rent': money(random.uniform(1200, 5200)),
             'certified': pickw([(True, 66), (False, 34)]), 'faceRegistered': pick([True, False])}
        # P4 租户口径改造（2026-10-29）：租户由业主出租产生、信息主要由业主维护，物业只做核验与补充。
        # 以下四个字段由既有值静态派生，不消耗 PRNG（保证后续表逐字不变）：
        #   source 数据来源 / verifyStatus 核验状态 / relation 与业主关系 / residents 居住人数
        t['source'] = '物业补录' if tid % 11 == 0 else '业主自助'
        t['verifyStatus'] = ('已核验' if (t['certified'] and t['faceRegistered'])
                             else ('待核验' if not t['certified'] else '信息不全'))
        t['relation'] = ['承租人', '业主亲属', '业主朋友', '企业宿舍'][tid % 4]
        t['residents'] = 1 + tid % 3
        t['status'] = '在住'
        h['tenantId'] = t['tenantId']
        TENANTS.append(t)

# ---- 业主标签 ----
for o in OWNERS:
    tags = []
    if random.random() < 0.08: tags.append('重点关怀')
    if random.random() < 0.05: tags.append('投诉频繁')
    if random.random() < 0.06: tags.append('长期欠费')
    if random.random() < 0.04: tags.append('意见领袖')
    o['tags'] = tags

# ============================================================ 3. 车位与车辆
PARKINGS = []
pid = 0
PARK_SPEC = {'P01': [('地下', 'B1', 130), ('地下', 'B2', 70), ('地面', 'G', 80)],
             'P02': [('地下', 'B1', 150), ('地面', 'G', 60)],
             'P03': [('地下', 'B1', 100), ('地下', 'B2', 50)]}
for cid, groups in PARK_SPEC.items():
    for ptype, zone, cnt in groups:
        for k in range(1, cnt + 1):
            pid += 1
            PARKINGS.append({
                'parkId': 'PK%05d' % pid, 'communityId': cid, 'parkNo': '%s-%03d' % (zone, k),
                'zone': zone, 'parkType': ptype,
                'category': pickw([('产权车位', 45), ('租赁车位', 38), ('公共车位', 12), ('充电车位', 5)]),
                'area': round(random.uniform(12.5, 16.8), 2),
                'status': pickw([('已售', 40), ('已租', 35), ('闲置', 21), ('不可用', 4)]),
                'ownerId': None, 'plateNo': '', 'bindStatus': '未绑定',
                'feeStandard': 120 if ptype == '地下' else (80 if cid != 'P03' else 200),
                'expireDate': '', 'chargePile': False, 'remark': '',
            })
for c in COMMUNITIES:
    c['parkCount'] = sum(1 for p in PARKINGS if p['communityId'] == c['communityId'])

# 车位绑定：把车位分给业主
avail = [p for p in PARKINGS if p['status'] in ('已售', '已租')]
random.shuffle(avail)
VEHICLES = []
vid = 0

def bind_vehicle(p, o, expire_days=None):
    global vid
    p['ownerId'] = o['ownerId']
    o['parkIds'].append(p['parkId'])
    pl = plate()
    p['plateNo'] = pl
    p['bindStatus'] = '已绑定'
    p['expireDate'] = ds(TODAY + timedelta(days=expire_days if expire_days is not None else rint(-40, 400)))
    if p['category'] == '充电车位': p['chargePile'] = True
    vid += 1
    VEHICLES.append({
        'vehicleId': 'VH%05d' % vid, 'plateNo': pl, 'ownerId': o['ownerId'],
        'parkId': p['parkId'], 'communityId': p['communityId'],
        'vehicleType': pickw([('小型车', 88), ('新能源', 12)]),
        'brand': pick(['大众', '丰田', '本田', '比亚迪', '吉利', '宝马', '奔驰', '奥迪', '长安', '特斯拉']),
        'color': pick(['白', '黑', '银', '灰', '蓝', '红']),
        'cardNo': 'IC%08d' % rint(10000000, 99999999),
        'authStatus': pickw([('正常', 88), ('欠费停用', 7), ('黑名单', 2), ('待审核', 3)]),
        'inOutType': pickw([('月卡', 62), ('产权', 28), ('临时', 10)]),
    })

# golden 演示对象优先占位，保证评审剧本可复现
for gname, gcid, gdays in [('张建国', 'P01', 5), ('李秀兰', 'P01', -32), ('王浩然', 'P02', 120),
                           ('王浩然', 'P01', 260), ('赵春梅', 'P03', 45)]:
    go = next((x for x in OWNERS if x['name'] == gname), None)
    if not go: continue
    cand = next((p for p in avail if p['communityId'] == gcid), None)
    if cand:
        avail.remove(cand)
        bind_vehicle(cand, go, gdays)

for o in OWNERS:
    if not avail: break
    if o['parkIds']: continue          # golden 已精确分配，不再随机加
    if random.random() < 0.62:
        n = 1 if random.random() < 0.78 else 2
        for _ in range(n):
            if not avail: break
            bind_vehicle(avail.pop(), o)

# ============================================================ 3b. 停车场进出场流水
# 车位台账只存「当前绑定状态」，进出场是流水，必须单独建模：
# 否则只能看到「最近一条」，无法做客流统计、临停计费、异常滞留追查。
# 注意：这里用独立随机流，避免消耗全局 PRNG 导致下游实体（账单/工单/员工）整体漂移。
GATE_POOL = [('南门', '车牌识别'), ('北门', '车牌识别'), ('地库A入口', 'ETC'), ('地库A出口', 'ETC'), ('地库B入口', '人工')]
PASS_RECORDS = []
_pid = 0
_rng = random.Random(SEED + 31)
for _back in range(7, -1, -1):                      # 近 8 天
    _day = TODAY - timedelta(days=_back)
    for _v in _rng.sample(VEHICLES, 24):
        _pk = next((x for x in PARKINGS if x['parkId'] == _v['parkId']), None)
        _gate_in, _ch_in = _rng.choice(GATE_POOL)
        _t_in = datetime(_day.year, _day.month, _day.day, _rng.randint(6, 19), _rng.randint(0, 59))
        _pid += 1
        PASS_RECORDS.append({
            'passId': 'PS%06d' % _pid, 'communityId': _v['communityId'],
            'parkId': _v['parkId'], 'parkNo': _pk['parkNo'] if _pk else '',
            'plateNo': _v['plateNo'], 'vehicleType': _v['vehicleType'], 'ownerId': _v['ownerId'],
            'direction': '入场', 'passTime': _t_in.strftime('%Y-%m-%d %H:%M'),
            'gate': _gate_in, 'channel': _ch_in, 'stayMinutes': 0, 'fee': 0.0,
            'operator': '系统自动',
        })
        # 出场：临停 5 元/小时（首 30 分钟免费），月卡/产权免费
        _stay = _rng.randint(25, 560)
        _t_out = _t_in + timedelta(minutes=_stay)
        if _t_out.date() != _t_in.date():           # 不跨天，便于按日统计
            _stay = _rng.randint(20, 200)
            _t_out = _t_in + timedelta(minutes=_stay)
        _gate_out, _ch_out = _rng.choice(GATE_POOL)
        _fee = money(max(0, _stay - 30) / 60 * 5) if _v['inOutType'] == '临时' else 0.0
        _pid += 1
        PASS_RECORDS.append({
            'passId': 'PS%06d' % _pid, 'communityId': _v['communityId'],
            'parkId': _v['parkId'], 'parkNo': _pk['parkNo'] if _pk else '',
            'plateNo': _v['plateNo'], 'vehicleType': _v['vehicleType'], 'ownerId': _v['ownerId'],
            'direction': '出场', 'passTime': _t_out.strftime('%Y-%m-%d %H:%M'),
            'gate': _gate_out, 'channel': _ch_out, 'stayMinutes': _stay, 'fee': _fee,
            'operator': '系统自动' if _ch_out != '人工' else '岗亭值班员',
        })

# ============================================================ 4. 收费项目 / 账单 / 缴费
FEE_ITEMS = [
    {'itemId': 'FI01', 'name': '物业服务费', 'category': '常规服务费', 'calcType': '按面积',
     'price': 2.80, 'unit': '元/㎡·月', 'cycle': '月', 'bizType': '住宅', 'taxRate': 6, 'status': '启用',
     'remark': '住宅 2.80；商业按项目标准 8.50'},
    {'itemId': 'FI02', 'name': '电梯运行维护费', 'category': '常规服务费', 'calcType': '按面积',
     'price': 0.50, 'unit': '元/㎡·月', 'cycle': '月', 'bizType': '住宅', 'taxRate': 6, 'status': '启用', 'remark': '首层住户减半'},
    {'itemId': 'FI03', 'name': '公共能耗分摊', 'category': '公摊费用', 'calcType': '按户',
     'price': 30.00, 'unit': '元/户·月', 'cycle': '月', 'bizType': '通用', 'taxRate': 6, 'status': '启用', 'remark': '按户数均摊，每月公示'},
    {'itemId': 'FI04', 'name': '生活垃圾清运费', 'category': '代收费用', 'calcType': '按户',
     'price': 6.00, 'unit': '元/户·月', 'cycle': '月', 'bizType': '通用', 'taxRate': 0, 'status': '启用', 'remark': '环卫部门代收'},
    {'itemId': 'FI05', 'name': '水费', 'category': '能耗费用', 'calcType': '按用量',
     'price': 4.20, 'unit': '元/吨', 'cycle': '月', 'bizType': '通用', 'taxRate': 3, 'status': '启用',
     'remark': '阶梯：0-15 吨 4.20；15-25 吨 5.60；25 吨以上 7.35'},
    {'itemId': 'FI06', 'name': '电费', 'category': '能耗费用', 'calcType': '按用量',
     'price': 0.62, 'unit': '元/度', 'cycle': '月', 'bizType': '通用', 'taxRate': 13, 'status': '启用',
     'remark': '阶梯：0-200 度 0.62；200-400 度 0.68；400 度以上 0.92'},
    {'itemId': 'FI07', 'name': '车位管理服务费', 'category': '常规服务费', 'calcType': '按车位',
     'price': 120.00, 'unit': '元/位·月', 'cycle': '月', 'bizType': '通用', 'taxRate': 6, 'status': '启用',
     'remark': '地下 120；地面 80；商业 200'},
    {'itemId': 'FI08', 'name': '装修押金', 'category': '押金', 'calcType': '固定',
     'price': 3000.00, 'unit': '元/次', 'cycle': '一次性', 'bizType': '住宅', 'taxRate': 0, 'status': '启用', 'remark': '验收合格后 30 日内退还'},
    {'itemId': 'FI09', 'name': '临时停车费', 'category': '经营性收入', 'calcType': '按次',
     'price': 5.00, 'unit': '元/小时', 'cycle': '按次', 'bizType': '通用', 'taxRate': 6, 'status': '启用', 'remark': '前 30 分钟免费，24 小时上限 40 元'},
    {'itemId': 'FI10', 'name': '门禁卡工本费', 'category': '工本费', 'calcType': '固定',
     'price': 20.00, 'unit': '元/张', 'cycle': '一次性', 'bizType': '通用', 'taxRate': 13, 'status': '启用', 'remark': '补办 20 元/张'},
]

BILLS = []
PAYMENTS = []
bid_seq = 0
pay_seq = 0
PAY_RATE = {'2026-08': 0.96, '2026-09': 0.88, '2026-10': 0.62}
# 历史账期（仅用于制造李秀兰这类长期欠费的演示样本）
PERIOD_END = {'2026-03': d('2026-03-31'), '2026-04': d('2026-04-30'), '2026-05': d('2026-05-31'),
              '2026-06': d('2026-06-30'), '2026-07': d('2026-07-31'),
              '2026-08': d('2026-08-31'), '2026-09': d('2026-09-30'), '2026-10': d('2026-10-31')}

def add_bill(**kw):
    global bid_seq
    bid_seq += 1
    b = {'billId': 'BL%06d' % bid_seq, 'period': kw['period'], 'status': '未缴', 'paidAmount': 0.0,
         'payTime': '', 'payMethod': '', 'invoiceNo': '', 'lateFee': 0.0, 'discount': 0.0}
    b.update(kw)
    b['dueDate'] = ds(PERIOD_END[kw['period']] + timedelta(days=15))
    b['amount'] = money(b['amount'])
    b['payable'] = money(b['amount'] + b['lateFee'] - b['discount'])
    if b['status'] == '已缴':
        b['paidAmount'] = b['payable']
    elif b['status'] == '部分缴':
        b['paidAmount'] = money(b['payable'] * random.uniform(0.3, 0.7))
    b['unpaid'] = money(b['payable'] - b['paidAmount'])
    # 逾期
    if b['status'] in ('未缴', '部分缴') and TODAY > d(b['dueDate']):
        b['status'] = '逾期'
        b['overdueDays'] = (TODAY - d(b['dueDate'])).days
        b['lateFee'] = money(b['amount'] * 0.0005 * b['overdueDays'])
        b['payable'] = money(b['amount'] + b['lateFee'] - b['discount'])
        b['unpaid'] = money(b['payable'] - b['paidAmount'])
    else:
        b['overdueDays'] = 0
    BILLS.append(b)
    return b

def mk_pay(b, method, no):
    global pay_seq
    pay_seq += 1
    PAYMENTS.append({
        'payId': 'PM%06d' % pay_seq, 'billId': b['billId'], 'houseId': b.get('houseId', ''),
        'ownerId': b.get('ownerId', ''), 'amount': b['paidAmount'], 'method': method,
        'payTime': b['payTime'], 'transNo': 'TXN' + str(rint(10 ** 13, 10 ** 14 - 1)),
        'operator': no, 'invoiceStatus': pickw([('已开票', 62), ('未开票', 30), ('已冲红', 8)]),
        'invoiceNo': ('INV' + str(rint(10 ** 9, 10 ** 10 - 1))) if random.random() < 0.62 else '',
        'channel': pickw([('微信支付', 42), ('支付宝', 26), ('现金', 12), ('POS刷卡', 9), ('银行代扣', 8), ('预存抵扣', 3)]),
    })

OPERATORS = ['收银员·刘婷', '收银员·陈敏', '客服·王芳', '线上自助']
for h in HOUSES:
    oid_ = h['ownerId']
    for p in PERIODS:
        # 物业服务费
        rate = 8.50 if h['usage'] == '商业' else (2.80 if h['communityId'] == 'P01' else 3.20)
        st = '已缴' if random.random() < PAY_RATE[p] else pickw([('未缴', 82), ('部分缴', 12), ('已减免', 4), ('已作废', 2)])
        b = add_bill(communityId=h['communityId'], houseId=h['houseId'], ownerId=oid_, itemId='FI01',
                     itemName='物业服务费', period=p, amount=money(h['area'] * rate),
                     quantity=h['area'], price=rate, unit='元/㎡·月', status=st,
                     createTime=ds(PERIOD_END[p] - timedelta(days=18)))
        if st == '已缴':
            b['payTime'] = ds(PERIOD_END[p] - timedelta(days=rint(0, 25)))
            b['payMethod'] = pickw([('微信支付', 42), ('支付宝', 26), ('现金', 12), ('POS刷卡', 9), ('银行代扣', 8), ('预存抵扣', 3)])
            mk_pay(b, b['payMethod'], pick(OPERATORS))
        # 水电（60% 房屋）
        if random.random() < 0.6:
            if random.random() < 0.5:
                use = round(random.uniform(6, 32), 1)
                amt = money(use * (4.20 if use <= 15 else (5.60 if use <= 25 else 7.35)))
                it, nm, q, u, un = 'FI05', '水费', use, 4.20, '吨'
            else:
                use = round(random.uniform(80, 520), 0)
                amt = money(use * (0.62 if use <= 200 else (0.68 if use <= 400 else 0.92)))
                it, nm, q, u, un = 'FI06', '电费', use, 0.62, '度'
            st2 = '已缴' if random.random() < PAY_RATE[p] else pickw([('未缴', 88), ('部分缴', 12)])
            b2 = add_bill(communityId=h['communityId'], houseId=h['houseId'], ownerId=oid_, itemId=it,
                          itemName=nm, period=p, amount=amt, quantity=q, price=u, unit='元/' + un,
                          status=st2, createTime=ds(PERIOD_END[p] - timedelta(days=16)),
                          meterReading=str(use), lastReading=str(round(use - random.uniform(5, 40), 1)))
            if st2 == '已缴':
                b2['payTime'] = ds(PERIOD_END[p] - timedelta(days=rint(0, 24)))
                b2['payMethod'] = pickw([('微信支付', 46), ('支付宝', 30), ('现金', 10), ('银行代扣', 14)])
                mk_pay(b2, b2['payMethod'], pick(OPERATORS))

# 车位管理费
for p in PARKINGS:
    if p['ownerId'] and p['bindStatus'] == '已绑定':
        for per in PERIODS:
            st = '已缴' if random.random() < PAY_RATE[per] else pickw([('未缴', 86), ('部分缴', 14)])
            b = add_bill(communityId=p['communityId'], houseId='', ownerId=p['ownerId'], itemId='FI07',
                         itemName='车位管理服务费', period=per, amount=p['feeStandard'], quantity=1,
                         price=p['feeStandard'], unit='元/位·月', status=st, parkId=p['parkId'],
                         createTime=ds(PERIOD_END[per] - timedelta(days=18)))
            if st == '已缴':
                b['payTime'] = ds(PERIOD_END[per] - timedelta(days=rint(0, 25)))
                b['payMethod'] = pickw([('微信支付', 44), ('支付宝', 28), ('现金', 12), ('银行代扣', 16)])
                mk_pay(b, b['payMethod'], pick(OPERATORS))

# ---- golden 演示对象：强制账单状态，保证评审剧本可复现 ----
def force_unpaid(owner_name, periods):
    o = next((x for x in OWNERS if x['name'] == owner_name), None)
    if not o: return
    ids = set()
    for b in BILLS:
        if b.get('ownerId') == o['ownerId'] and b['period'] in periods:
            ids.add(b['billId'])
            od = max(0, (TODAY - d(b['dueDate'])).days)
            b.update({'status': '未缴', 'paidAmount': 0.0, 'payTime': '', 'payMethod': '',
                      'invoiceNo': '', 'discount': 0.0, 'overdueDays': od,
                      'lateFee': money(b['amount'] * 0.0005 * od)})
            b['payable'] = money(b['amount'] + b['lateFee'])
            b['unpaid'] = b['payable']
            if od > 0: b['status'] = '逾期'
    if ids:
        PAYMENTS[:] = [p for p in PAYMENTS if p['billId'] not in ids]

# 李秀兰：补 2026-03 ~ 2026-07 历史欠费，演示长期欠费 / 催缴 / 停服 / 法务流程
lx = next(x for x in OWNERS if x['name'] == '李秀兰')
lxh = next(h for h in HOUSES if h['ownerId'] == lx['ownerId'])
for per in ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07']:
    add_bill(communityId=lxh['communityId'], houseId=lxh['houseId'], ownerId=lx['ownerId'],
             itemId='FI01', itemName='物业服务费', period=per, amount=money(lxh['area'] * 2.80),
             quantity=lxh['area'], price=2.80, unit='元/㎡·月', status='未缴',
             createTime=ds(PERIOD_END[per] - timedelta(days=18)))

force_unpaid('李秀兰', ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
force_unpaid('张建国', ['2026-09', '2026-10'])   # 演示：欠费 + 在途报修 + 车位即将到期
force_unpaid('王浩然', ['2026-10'])               # 演示：一人三房合并收费
force_unpaid('赵春梅', ['2026-10'])               # 演示：商铺租约即将到期

# ============================================================ 5. 工单
WO_TYPE = [('公共区域维修', 38), ('入户维修', 27), ('投诉建议', 13), ('咨询', 10), ('报事', 8), ('其他', 4)]
WO_STATUS = [('待派单', 7), ('已派单', 10), ('处理中', 20), ('待确认', 8), ('已完工', 15), ('已评价', 28), ('已关闭', 8), ('已取消', 4)]
REPAIR_CAT = ['水管漏水', '电路故障', '门窗损坏', '墙面开裂', '下水道堵塞', '照明不亮', '电梯异常', '门锁故障', '空调不制冷', '瓷砖空鼓']
WORK_ORDERS = []
for i in range(1, 151):
    typ = pickw(WO_TYPE)
    st = pickw(WO_STATUS)
    h = pick(HOUSES)
    created = TODAY - timedelta(days=rint(0, 60), hours=rint(0, 23))
    is_paid = typ == '入户维修'
    fee = money(random.uniform(60, 480)) if is_paid else 0.0
    wo = {
        'woId': 'WO%06d' % i, 'woNo': 'BX2026%05d' % i, 'communityId': h['communityId'],
        'houseId': h['houseId'] if typ == '入户维修' else '',
        'houseName': h['fullName'] if typ == '入户维修' else pick(['3栋单元大堂', '地下车库B1', '小区中庭', '2栋电梯', '儿童游乐区', '垃圾收集点']),
        'ownerId': h['ownerId'], 'ownerName': (next((o['name'] for o in OWNERS if o['ownerId'] == h['ownerId']), '')),
        'ownerPhone': (next((o['phone'] for o in OWNERS if o['ownerId'] == h['ownerId']), '')),
        'type': typ, 'category': pick(REPAIR_CAT), 'source': pickw([('小程序', 58), ('电话', 22), ('前台', 12), ('巡检转单', 8)]),
        'priority': pickw([('普通', 62), ('紧急', 24), ('特急', 14)]), 'status': st,
        'title': pick(REPAIR_CAT) + pick(['，请尽快处理', '，影响正常生活', '，已持续多日', '']),
        'description': '业主反馈：' + pick(REPAIR_CAT) + pick(['，现场有明显痕迹。', '，之前维修过一次未彻底解决。', '，希望今天上门。', '。']),
        'images': rint(0, 4), 'createTime': ds(created) + ' %02d:%02d' % (rint(8, 21), rint(0, 59)),
        'dispatchMode': pickw([('自动派单', 46), ('后台指派', 34), ('抢单', 20)]),
        'assignee': '', 'assigneePhone': '', 'acceptTime': '', 'arriveTime': '', 'finishTime': '',
        'durationHours': 0, 'slaHours': 24 if typ != '入户维修' else 12, 'isOverdue': False,
        'feeType': '收费' if is_paid else '免费', 'materialFee': money(random.uniform(0, 260)) if is_paid else 0.0,
        'laborFee': money(random.uniform(40, 200)) if is_paid else 0.0, 'totalFee': fee,
        'payStatus': pick(['未支付', '已支付', '已挂账']) if is_paid else '无需支付',
        'score': 0, 'evalTags': [], 'evaluate': '', 'remark': '', 'isPublic': typ == '公共区域维修',
    }
    wo['totalFee'] = money(wo['materialFee'] + wo['laborFee'])
    if st not in ('待派单', '已取消'):
        wo['assignee'] = person_name()
        wo['assigneePhone'] = phone()
        wo['acceptTime'] = ds(created + timedelta(hours=rint(1, 8)))
    if st in ('处理中', '待确认', '已完工', '已评价', '已关闭'):
        wo['arriveTime'] = ds(created + timedelta(hours=rint(3, 24)))
    if st in ('已完工', '已评价', '已关闭'):
        wo['finishTime'] = ds(created + timedelta(hours=rint(6, 48)))
        wo['durationHours'] = round(random.uniform(0.5, 26), 1)
    if st in ('已评价', '已关闭'):
        wo['score'] = pickw([(5, 58), (4, 24), (3, 9), (2, 5), (1, 4)])
        wo['evalTags'] = random.sample(['响应快', '态度好', '技术好', '收费透明', '已解决'], rint(1, 3)) if wo['score'] >= 4 else random.sample(['响应慢', '未彻底解决', '收费偏高', '态度一般'], rint(1, 2))
        wo['evaluate'] = pick(['师傅很专业，已解决。', '处理及时，满意。', '问题解决了但现场没清理。', '希望提前电话联系。', ''])
    if st == '已取消':
        wo['remark'] = pick(['业主自行处理', '重复报单', '业主取消', '误报'])
    wo['isOverdue'] = st in ('待派单', '已派单', '处理中') and (TODAY - created).days > 1
    WORK_ORDERS.append(wo)

# 固定一条：张建国的在途报修（演示用）
g = WORK_ORDERS[0]
zh = next(o for o in OWNERS if o['name'] == '张建国')
zh_house = H_BY_SHORT['P01-011-0501']
g.update({'communityId': 'P01', 'houseId': zh_house['houseId'], 'houseName': zh_house['fullName'],
          'ownerId': zh['ownerId'], 'ownerName': '张建国', 'ownerPhone': zh['phone'],
          'type': '入户维修', 'category': '水管漏水', 'title': '主卫水管漏水，请尽快处理',
          'description': '业主反馈：主卫角阀处持续渗水，地面积水，希望今天上门。',
          'status': '处理中', 'source': '小程序', 'priority': '紧急', 'feeType': '收费', 'isPublic': False,
          'materialFee': 120.0, 'laborFee': 80.0, 'totalFee': 200.0, 'payStatus': '未支付',
          'assignee': '孙德海', 'assigneePhone': '13512345678', 'dispatchMode': '自动派单',
          'createTime': '2026-10-21 09:12', 'acceptTime': '2026-10-21 09:38',
          'arriveTime': '2026-10-21 10:05', 'images': 3, 'isOverdue': False})

# ============================================================ 6. 设备 / 物联
DEV_TYPE = [('门禁', 18), ('车闸', 8), ('摄像头', 26), ('电梯', 12), ('消防主机', 3), ('水电表', 7), ('环境传感器', 5), ('边缘网关', 3)]
DEV_STATUS = [('在线', 74), ('离线', 10), ('告警', 10), ('故障', 3), ('维保中', 3)]
DEVICES = []
for i in range(1, 81):
    t = pickw(DEV_TYPE)
    stt = pickw(DEV_STATUS)
    cid = pickw([('P01', 45), ('P02', 33), ('P03', 22)])
    DEVICES.append({
        'deviceId': 'DV%04d' % i, 'deviceCode': '%s-%03d' % (t[:1].upper(), i), 'name': '%s%s' % (pick(['1栋', '2栋', '3栋', '地下车库', '小区大门', '中庭', '消防控制室', '配电房']), t),
        'type': t, 'communityId': cid, 'brand': pick(['海康', '大华', '宇视', '博世', '西门子', '三菱', '青云']),
        'model': 'M-%d' % rint(100, 999), 'status': stt,
        'online': stt in ('在线', '告警'), 'lastHeartbeat': ds(TODAY) + ' %02d:%02d' % (rint(0, 23), rint(0, 59)) if stt in ('在线', '告警') else ds(TODAY - timedelta(days=rint(1, 9))),
        'ip': '10.0.%d.%d' % (rint(1, 60), rint(2, 250)), 'firmware': 'v%d.%d.%d' % (rint(1, 5), rint(0, 9), rint(0, 20)),
        'installDate': ds(date(rint(2015, 2025), rint(1, 12), rint(1, 28))),
        'warrantyEnd': ds(date(rint(2026, 2029), rint(1, 12), rint(1, 28))),
        'location': pick(['1栋单元门口', '地下车库入口', '小区南门', '中庭', '消防控制室', '配电房', '电梯机房', '楼顶']),
        'vendor': pick(['海康威视', '大华股份', '捷顺', '科拓', '本地集成商']),
        'qrCode': 'QR' + str(rint(10 ** 9, 10 ** 10 - 1)),
        'maintainCycle': pick(['月', '季', '半年', '年']), 'nextMaintain': ds(TODAY + timedelta(days=rint(5, 200))),
        'alarmCount': rint(0, 6) if stt in ('告警', '故障') else 0,
    })

ALARMS = []
for i in range(1, 46):
    dev = pick([x for x in DEVICES if x['status'] in ('告警', '故障', '离线')] or DEVICES)
    lev = pickw([('紧急', 12), ('重要', 28), ('一般', 42), ('提示', 18)])
    t0 = TODAY - timedelta(days=rint(0, 5), hours=rint(0, 23))
    ALARMS.append({
        'alarmId': 'AL%05d' % i, 'deviceId': dev['deviceId'], 'deviceName': dev['name'],
        'communityId': dev['communityId'], 'type': pick(['设备离线', '门禁异常开启', '车闸抬杆失败', '视频遮挡', '电梯困人', '消防报警', '电量异常', '网络中断']),
        'level': lev, 'content': pick(['设备心跳超时 30 分钟', '检测到非法闯入', '抬杆指令无响应', '画面被遮挡', '轿厢内有人滞留超过 5 分钟', '烟感探测器报警', '用电量突增 230%', '上行链路中断']),
        'occurTime': ds(t0) + ' %02d:%02d' % (rint(0, 23), rint(0, 59)),
        'status': pickw([('未处理', 32), ('处理中', 24), ('已关闭', 44)]),
        'handleBy': '', 'handleTime': '', 'dispatchWoId': '', 'duration': 0,
    })
for a in ALARMS:
    if a['status'] != '未处理':
        a['handleBy'] = person_name()
        a['handleTime'] = ds(TODAY - timedelta(days=rint(0, 3)))
        a['duration'] = rint(8, 420)
        if random.random() < 0.4: a['dispatchWoId'] = pick(WORK_ORDERS)['woId']

# ============================================================ 7. 巡检计划与任务
INSPECT_PLANS = [
    {'planId': 'IP01', 'name': '保洁责任区日检', 'post': '保洁', 'cycle': '每日', 'templateId': 'TP-CLEAN', 'communityId': 'P01', 'executor': '孙桂英', 'items': 6, 'status': '启用'},
    {'planId': 'IP02', 'name': '保安夜间巡更', 'post': '保安', 'cycle': '每日', 'templateId': 'TP-GUARD', 'communityId': 'P01', 'executor': '赵铁柱', 'items': 4, 'status': '启用'},
    {'planId': 'IP03', 'name': '电梯日常点检', 'post': '工程', 'cycle': '每周', 'templateId': 'TP-ELEV', 'communityId': 'P01', 'executor': '周明', 'items': 6, 'status': '启用'},
    {'planId': 'IP04', 'name': '消防设施月检', 'post': '工程', 'cycle': '每月', 'templateId': 'TP-FIRE', 'communityId': 'P01', 'executor': '周明', 'items': 6, 'status': '启用'},
    {'planId': 'IP05', 'name': '配电房周检', 'post': '工程', 'cycle': '每周', 'templateId': 'TP-POWER', 'communityId': 'P01', 'executor': '孙德海', 'items': 5, 'status': '启用'},
    {'planId': 'IP06', 'name': '二次供水巡检', 'post': '工程', 'cycle': '每月', 'templateId': 'TP-WATER', 'communityId': 'P01', 'executor': '孙德海', 'items': 5, 'status': '启用'},
    {'planId': 'IP07', 'name': '绿化养护巡检', 'post': '环境', 'cycle': '每周', 'templateId': 'TP-GREEN', 'communityId': 'P02', 'executor': '钱秀芳', 'items': 4, 'status': '启用'},
    {'planId': 'IP08', 'name': '垃圾房消杀检查', 'post': '环境', 'cycle': '每日', 'templateId': 'TP-TRASH', 'communityId': 'P02', 'executor': '冯小花', 'items': 4, 'status': '启用'},
    {'planId': 'IP09', 'name': '地下车库安全巡检', 'post': '保安', 'cycle': '每日', 'templateId': 'TP-PARK', 'communityId': 'P02', 'executor': '蒋大勇', 'items': 5, 'status': '启用'},
    {'planId': 'IP10', 'name': '商业公区品质巡检', 'post': '客服', 'cycle': '每日', 'templateId': 'TP-BIZ', 'communityId': 'P03', 'executor': '韩雪', 'items': 5, 'status': '启用'},
    {'planId': 'IP11', 'name': '屋面与外墙季度检查', 'post': '工程', 'cycle': '每季', 'templateId': 'TP-ROOF', 'communityId': 'P01', 'executor': '周明', 'items': 4, 'status': '启用'},
    {'planId': 'IP12', 'name': '儿童游乐设施周检', 'post': '工程', 'cycle': '每周', 'templateId': 'TP-KIDS', 'communityId': 'P02', 'executor': '孙德海', 'items': 4, 'status': '停用'},
    # —— 监督类计划：由品质督导下达给部门经理（组长），组长只做现场核验，不做一线作业 ——
    {'planId': 'IP13', 'name': '环境组达标监督', 'post': '环境', 'cycle': '每周', 'templateId': 'TP-SUP-ENV', 'communityId': 'P01', 'executor': '周伟', 'items': 5, 'status': '启用'},
    {'planId': 'IP14', 'name': '安保组达标监督', 'post': '安保', 'cycle': '每周', 'templateId': 'TP-SUP-SEC', 'communityId': 'P01', 'executor': '胡建国', 'items': 5, 'status': '启用'},
    {'planId': 'IP15', 'name': '环境组达标监督', 'post': '环境', 'cycle': '每周', 'templateId': 'TP-SUP-ENV', 'communityId': 'P02', 'executor': '钱文博', 'items': 5, 'status': '启用'},
    {'planId': 'IP16', 'name': '安保组达标监督', 'post': '安保', 'cycle': '每周', 'templateId': 'TP-SUP-SEC', 'communityId': 'P02', 'executor': '向建华', 'items': 5, 'status': '启用'},
    {'planId': 'IP17', 'name': '环境组达标监督', 'post': '环境', 'cycle': '每周', 'templateId': 'TP-SUP-ENV', 'communityId': 'P03', 'executor': '段娟', 'items': 5, 'status': '启用'},
    {'planId': 'IP18', 'name': '工程组达标监督', 'post': '工程', 'cycle': '每月', 'templateId': 'TP-SUP-ENG', 'communityId': 'P02', 'executor': '薛淼然', 'items': 5, 'status': '启用'},
    # 2026-10-29 补：三个项目的工程 / 客服组此前没有监督计划，
    # 「主管发现问题数」考核表会缺部门；补齐后每个班组都有直管主管。
    {'planId': 'IP19', 'name': '工程组达标监督', 'post': '工程', 'cycle': '每周', 'templateId': 'TP-SUP-ENG', 'communityId': 'P01', 'executor': '苏春梅', 'items': 5, 'status': '启用'},
    {'planId': 'IP20', 'name': '安保组达标监督', 'post': '安保', 'cycle': '每周', 'templateId': 'TP-SUP-SEC', 'communityId': 'P03', 'executor': '范鑫', 'items': 5, 'status': '启用'},
    {'planId': 'IP21', 'name': '客服组达标监督', 'post': '客服', 'cycle': '每周', 'templateId': 'TP-SUP-CS', 'communityId': 'P01', 'executor': '汪磊', 'items': 5, 'status': '启用'},
    {'planId': 'IP22', 'name': '客服组达标监督', 'post': '客服', 'cycle': '每周', 'templateId': 'TP-SUP-CS', 'communityId': 'P02', 'executor': '段浩', 'items': 5, 'status': '启用'},
    {'planId': 'IP23', 'name': '客服组达标监督', 'post': '客服', 'cycle': '每周', 'templateId': 'TP-SUP-CS', 'communityId': 'P03', 'executor': '梁婷', 'items': 5, 'status': '启用'},
]
# 计划分类：前 12 个是执行类（一线员工作业），后 6 个是监督类（组长核验下属）
_SUP_PLANS = {'IP13', 'IP14', 'IP15', 'IP16', 'IP17', 'IP18', 'IP19', 'IP20', 'IP21', 'IP22', 'IP23'}
_SUP_META = {
    'IP13': ('环境', 'O-P01-T4'), 'IP14': ('安保', 'O-P01-T3'),
    'IP15': ('环境', 'O-P02-T4'), 'IP16': ('安保', 'O-P02-T3'),
    'IP17': ('环境', 'O-P03-T4'), 'IP18': ('工程', 'O-P02-T2'),
    'IP19': ('工程', 'O-P01-T2'), 'IP20': ('安保', 'O-P03-T3'),
    'IP21': ('客服', 'O-P01-T1'), 'IP22': ('客服', 'O-P02-T1'),
    'IP23': ('客服', 'O-P03-T1'),
}
for _p in INSPECT_PLANS:
    if _p['planId'] in _SUP_PLANS:
        _tp, _td = _SUP_META[_p['planId']]
        _p.update({'taskType': '监督', 'targetPost': _tp, 'targetDept': _td})
    else:
        _p.update({'taskType': '执行', 'targetPost': '', 'targetDept': ''})
# 巡检任务归属班组：由「计划岗位 + 计划所属项目」推导。
# 不能靠执行人姓名反查 —— 计划的执行人是运营设定值，未必在员工名册里，
# 反查会让任务在「本部门」视图里整批丢失（这正是 P0-5 实测发现的问题）。
_POST_TEAM = {'保洁': 'T4', '环境': 'T4', '保安': 'T3', '安保': 'T3', '工程': 'T2', '客服': 'T1'}


def org_of_plan(pl):
    return 'O-%s-%s' % (pl['communityId'], _POST_TEAM.get(pl['post'], 'T1'))


INSPECT_TASKS = []
for i in range(1, 241):
    pl = pick([p for p in INSPECT_PLANS if p['status'] == '启用' and p['taskType'] == '执行'])
    day = TODAY - timedelta(days=rint(0, 14))
    stt = pickw([('已完成', 62), ('执行中', 8), ('待执行', 16), ('逾期', 8), ('已转工单', 6)])
    INSPECT_TASKS.append({
        'taskId': 'IT%05d' % i, 'planId': pl['planId'], 'planName': pl['name'], 'post': pl['post'],
        'communityId': pl['communityId'], 'executor': pl['executor'], 'executorOrgId': org_of_plan(pl),
        'templateId': pl['templateId'],
        'taskType': pl['taskType'], 'targetPost': pl['targetPost'], 'targetDept': pl['targetDept'],
        'scheduledDate': ds(day), 'scheduledTime': '%02d:00' % pick([8, 9, 14, 15, 19, 20, 22]),
        'status': stt, 'doneTime': ds(day) + ' %02d:%02d' % (rint(8, 22), rint(0, 59)) if stt in ('已完成', '已转工单') else '',
        'duration': rint(12, 95) if stt in ('已完成', '已转工单') else 0,
        'itemCount': pl['items'], 'normalCount': pl['items'] - rint(0, 2) if stt in ('已完成', '已转工单') else 0,
        'issueCount': rint(0, 2) if stt in ('已完成', '已转工单') else 0,
        'photos': rint(3, 12) if stt in ('已完成', '已转工单') else 0,
        'checkinType': pick(['扫码', 'GPS围栏', 'NFC']), 'checkedIn': stt in ('已完成', '执行中', '已转工单'),
        'gps': '104.06%d,30.5%d' % (rint(1000, 9999), rint(1000, 9999)),
        'score': rint(88, 100) if stt == '已完成' else 0, 'refWoId': pick(WORK_ORDERS)['woId'] if stt == '已转工单' else '',
        'reviewer': '', 'reviewScore': 0, 'reviewTime': '',
    })
for t in INSPECT_TASKS:
    if t['status'] == '已完成' and random.random() < 0.45:
        t['reviewer'] = pick(['梁雅静', '张振华', '李春梅'])
        t['reviewScore'] = rint(80, 100)
        t['reviewTime'] = ds(d(t['scheduledDate']) + timedelta(days=rint(0, 2)))

# 巡检表单模板
INSPECT_TEMPLATES = [
    # ===== 执行类模板：给一线员工用，告诉「做什么、什么算合格」 =====
    {'templateId': 'TP-CLEAN', 'name': '保洁责任区日检表', 'type': '执行', 'post': '保洁', 'targetPost': '', 'version': 'v2.1',
     'fields': [{'label': '大堂地面', 'type': '拍照', 'required': True, 'standard': '无积尘、无水渍'},
                {'label': '电梯轿厢', 'type': '拍照', 'required': True, 'standard': '内壁无手印、地面无杂物'},
                {'label': '楼梯间', 'type': '拍照', 'required': True, 'standard': '扶手无灰、无堆物'},
                {'label': '扶梯', 'type': '拍照', 'required': False, 'standard': '踏板无异物'},
                {'label': '公共卫生间', 'type': '拍照', 'required': True, 'standard': '无异味、纸品充足'},
                {'label': '垃圾收集点', 'type': '拍照', 'required': True, 'standard': '桶盖闭合、周边无散落'}]},
    {'templateId': 'TP-GUARD', 'name': '保安巡更点位表', 'type': '执行', 'post': '保安', 'targetPost': '', 'version': 'v1.8',
     'fields': [{'label': '点位扫码', 'type': '扫码', 'required': True, 'standard': '现场二维码，禁止相册'},
                {'label': '现场照片', 'type': '拍照', 'required': True, 'standard': '带水印，含时间地点'},
                {'label': '异常情况', 'type': '单选', 'required': False, 'options': ['无', '可疑人员', '设施损坏', '安全隐患']},
                {'label': '异常描述', 'type': '文本', 'required': False, 'visibleWhen': '异常情况≠无'}]},
    {'templateId': 'TP-ELEV', 'name': '电梯日常点检表', 'type': '执行', 'post': '工程', 'targetPost': '', 'version': 'v3.0',
     'fields': [{'label': '运行平稳性', 'type': '评分', 'required': True, 'min': 1, 'max': 5},
                {'label': '轿厢照明', 'type': '单选', 'required': True, 'options': ['正常', '损坏', '闪烁']},
                {'label': '呼梯按钮', 'type': '单选', 'required': True, 'options': ['正常', '卡滞', '失灵']},
                {'label': '五方对讲', 'type': '单选', 'required': True, 'options': ['正常', '无声', '杂音']},
                {'label': '异常描述', 'type': '文本', 'required': False, 'visibleWhen': '任一选项≠正常'},
                {'label': '现场照片', 'type': '拍照', 'required': False, 'max': 3}]},
    {'templateId': 'TP-FIRE', 'name': '消防设施月检表', 'type': '执行', 'post': '工程', 'targetPost': '', 'version': 'v2.4',
     'fields': [{'label': '灭火器压力表', 'type': '单选', 'required': True, 'options': ['正常', '欠压', '超压']},
                {'label': '消火栓箱', 'type': '拍照', 'required': True, 'standard': '配件齐全、无水渍'},
                {'label': '喷淋头', 'type': '拍照', 'required': True, 'standard': '无遮挡、无渗漏'},
                {'label': '疏散指示灯', 'type': '拍照', 'required': True, 'standard': '常亮、无破损'},
                {'label': '防火门闭门器', 'type': '单选', 'required': True, 'options': ['正常', '失效']},
                {'label': '消防通道', 'type': '拍照', 'required': True, 'standard': '无占用、无堆物'}]},
    {'templateId': 'TP-POWER', 'name': '配电房周检表', 'type': '执行', 'post': '工程', 'targetPost': '', 'version': 'v1.6',
     'fields': [{'label': '柜体温度', 'type': '评分', 'required': True, 'min': 1, 'max': 5},
                {'label': '仪表读数', 'type': '拍照', 'required': True, 'standard': '三相电流平衡'},
                {'label': '绝缘工器具', 'type': '单选', 'required': True, 'options': ['齐备', '缺失', '超期']},
                {'label': '门禁与上锁', 'type': '单选', 'required': True, 'options': ['已上锁', '未上锁']},
                {'label': '现场照片', 'type': '拍照', 'required': True, 'standard': '含整体环境'}]},
    {'templateId': 'TP-WATER', 'name': '二次供水巡检表', 'type': '执行', 'post': '工程', 'targetPost': '', 'version': 'v2.0',
     'fields': [{'label': '水箱水位', 'type': '拍照', 'required': True, 'standard': '液位处于正常区间'},
                {'label': '水质检测记录', 'type': '单选', 'required': True, 'options': ['合格', '待检', '不合格']},
                {'label': '泵组运行', 'type': '单选', 'required': True, 'options': ['正常', '异响', '停机']},
                {'label': '管路渗漏', 'type': '拍照', 'required': True, 'standard': '法兰与阀门无渗水'},
                {'label': '消毒设备', 'type': '单选', 'required': True, 'options': ['运行', '停用']}]},
    {'templateId': 'TP-GREEN', 'name': '绿化养护巡检表', 'type': '执行', 'post': '环境', 'targetPost': '', 'version': 'v1.3',
     'fields': [{'label': '草坪修剪', 'type': '拍照', 'required': True, 'standard': '高度均匀、无斑秃'},
                {'label': '乔灌木长势', 'type': '拍照', 'required': True, 'standard': '无枯枝、无病虫害'},
                {'label': '绿化带杂物', 'type': '拍照', 'required': True, 'standard': '无白色垃圾'},
                {'label': '灌溉设施', 'type': '单选', 'required': False, 'options': ['正常', '堵塞', '损坏']}]},
    {'templateId': 'TP-TRASH', 'name': '垃圾房消杀检查表', 'type': '执行', 'post': '环境', 'targetPost': '', 'version': 'v1.5',
     'fields': [{'label': '桶盖闭合', 'type': '拍照', 'required': True, 'standard': '全部分类桶盖闭合'},
                {'label': '地面冲洗', 'type': '拍照', 'required': True, 'standard': '无污渍、无积水'},
                {'label': '消杀记录', 'type': '拍照', 'required': True, 'standard': '当日已消杀并登记'},
                {'label': '异味控制', 'type': '单选', 'required': True, 'options': ['无', '轻微', '明显']}]},
    {'templateId': 'TP-PARK', 'name': '地下车库安全巡检表', 'type': '执行', 'post': '保安', 'targetPost': '', 'version': 'v1.9',
     'fields': [{'label': '照明与应急灯', 'type': '拍照', 'required': True, 'standard': '全亮、无频闪'},
                {'label': '消防设施', 'type': '拍照', 'required': True, 'standard': '箱体完好、无遮挡'},
                {'label': '车辆停放秩序', 'type': '拍照', 'required': True, 'standard': '无占道、无占用消防位'},
                {'label': '排水沟与集水井', 'type': '单选', 'required': True, 'options': ['畅通', '堵塞', '积水']},
                {'label': '门禁与道闸', 'type': '单选', 'required': True, 'options': ['正常', '故障']}]},
    {'templateId': 'TP-BIZ', 'name': '商业公区品质巡检表', 'type': '执行', 'post': '客服', 'targetPost': '', 'version': 'v1.2',
     'fields': [{'label': '公区卫生', 'type': '拍照', 'required': True, 'standard': '地面无杂物、无污渍'},
                {'label': '商户门前秩序', 'type': '拍照', 'required': True, 'standard': '无占道经营'},
                {'label': '导视标识', 'type': '拍照', 'required': True, 'standard': '完好、无褪色'},
                {'label': '休息区设施', 'type': '单选', 'required': True, 'options': ['完好', '破损']},
                {'label': '投诉与建议收集', 'type': '文本', 'required': False}]},
    {'templateId': 'TP-ROOF', 'name': '屋面与外墙检查表', 'type': '执行', 'post': '工程', 'targetPost': '', 'version': 'v1.1',
     'fields': [{'label': '屋面防水', 'type': '拍照', 'required': True, 'standard': '无起鼓、无渗漏痕迹'},
                {'label': '排水口', 'type': '拍照', 'required': True, 'standard': '无堵塞、无落叶堆积'},
                {'label': '外墙饰面', 'type': '拍照', 'required': True, 'standard': '无空鼓、无脱落'},
                {'label': '避雷带', 'type': '单选', 'required': False, 'options': ['完好', '锈蚀', '断开']}]},
    {'templateId': 'TP-KIDS', 'name': '儿童游乐设施周检表', 'type': '执行', 'post': '工程', 'targetPost': '', 'version': 'v1.4',
     'fields': [{'label': '结构紧固件', 'type': '拍照', 'required': True, 'standard': '无松动、无锈蚀'},
                {'label': '滑梯表面', 'type': '拍照', 'required': True, 'standard': '无毛刺、无破损'},
                {'label': '安全地垫', 'type': '拍照', 'required': True, 'standard': '无缺失、无移位'},
                {'label': '警示标识', 'type': '单选', 'required': True, 'options': ['齐全', '缺失', '字迹模糊']}]},

    # ===== 监督类模板：给部门经理（组长）用，检查「下属责任区实际达标情况」 =====
    # 由品质督导统一维护，组长只读；检查项是达标标准，而不是作业步骤
    {'templateId': 'TP-SUP-ENV', 'name': '环境达标监督表', 'type': '监督', 'post': '', 'targetPost': '环境', 'version': 'v1.0',
     'fields': [{'label': '责任区地面达标', 'type': '拍照', 'required': True, 'standard': '随机抽查 3 处，均无积尘积水'},
                {'label': '电梯与楼道', 'type': '拍照', 'required': True, 'standard': '与员工上报情况一致'},
                {'label': '垃圾点位', 'type': '拍照', 'required': True, 'standard': '桶盖闭合、周边无散落'},
                {'label': '员工在岗情况', 'type': '单选', 'required': True, 'options': ['在岗', '脱岗', '迟到']},
                {'label': '员工上报真实性', 'type': '单选', 'required': True, 'options': ['属实', '不属实', '部分不属实']}]},
    {'templateId': 'TP-SUP-SEC', 'name': '安保达标监督表', 'type': '监督', 'post': '', 'targetPost': '安保', 'version': 'v1.0',
     'fields': [{'label': '巡更点位抽检', 'type': '扫码', 'required': True, 'standard': '随机抽 2 个点位，核对打卡时间'},
                {'label': '门岗值守', 'type': '拍照', 'required': True, 'standard': '无脱岗、着装规范'},
                {'label': '监控室', 'type': '拍照', 'required': True, 'standard': '有人值守、画面正常'},
                {'label': '交接班记录', 'type': '拍照', 'required': True, 'standard': '连续无缺漏'},
                {'label': '员工上报真实性', 'type': '单选', 'required': True, 'options': ['属实', '不属实', '部分不属实']}]},
    {'templateId': 'TP-SUP-ENG', 'name': '工程达标监督表', 'type': '监督', 'post': '', 'targetPost': '工程', 'version': 'v1.0',
     'fields': [{'label': '设备房现场', 'type': '拍照', 'required': True, 'standard': '整洁、上锁、无杂物'},
                {'label': '点检记录核对', 'type': '拍照', 'required': True, 'standard': '与设备实际状态一致'},
                {'label': '故障响应时效', 'type': '单选', 'required': True, 'options': ['达标', '超时']},
                {'label': '工器具与备件', 'type': '单选', 'required': True, 'options': ['齐备', '缺失']},
                {'label': '员工上报真实性', 'type': '单选', 'required': True, 'options': ['属实', '不属实', '部分不属实']}]},
    {'templateId': 'TP-SUP-CS', 'name': '客服达标监督表', 'type': '监督', 'post': '', 'targetPost': '客服', 'version': 'v1.0',
     'fields': [{'label': '前台在岗与服务规范', 'type': '拍照', 'required': True, 'standard': '着装规范、无脱岗'},
                {'label': '工单受理时效', 'type': '单选', 'required': True, 'options': ['达标', '超时']},
                {'label': '投诉回访记录', 'type': '拍照', 'required': True, 'standard': '闭环且有回访'},
                {'label': '员工上报真实性', 'type': '单选', 'required': True, 'options': ['属实', '不属实', '部分不属实']}]},
]

# ============================================================ 8. 人力资源
POSITIONS = [
    ('总经理', 'M2', 1), ('项目经理', 'M1', 3), ('客服主管', 'P6', 3), ('客服专员', 'P4', 12),
    ('安保主管', 'P6', 3), ('保安', 'P3', 22), ('环境主管', 'P5', 3), ('保洁员', 'P3', 18),
    ('工程主管', 'P6', 3), ('维修工', 'P4', 14), ('财务主管', 'P7', 1), ('会计', 'P5', 3),
    ('收银员', 'P4', 6), ('人事专员', 'P5', 2), ('品质专员', 'P5', 3), ('绿化员', 'P3', 6),
]
EMPLOYEES = []
for i in range(1, 121):
    pos, lvl, cnt = POSITIONS[min(i // 8, len(POSITIONS) - 1)]
    cid = pickw([('O-HEAD', 18), ('O-P01', 40), ('O-P02', 27), ('O-P03', 15)])
    entry = date(rint(2016, 2026), rint(1, 12), rint(1, 28))
    EMPLOYEES.append({
        'empId': 'EM%04d' % i, 'empNo': 'J%d%04d' % (entry.year % 100, i), 'name': person_name(),
        'gender': pick(['男', '女']), 'phone': phone(), 'idCard': idcard(),
        'orgId': cid, 'position': pos, 'level': lvl, 'empType': pickw([('正式', 82), ('试用', 8), ('实习', 4), ('劳务', 6)]),
        'entryDate': ds(entry), 'regularDate': ds(entry + timedelta(days=90)) if entry < TODAY else '',
        'status': pickw([('在职', 88), ('试用', 8), ('离职', 4)]),
        'contractStart': ds(entry), 'contractEnd': ds(entry + timedelta(days=365 * rint(1, 3))),
        'probationMonths': rint(2, 6),
        'baseSalary': money(pick([3200, 3800, 4500, 5200, 6000, 7500, 9000, 12000])),
        'monthlySalary': 0, 'bankCard': '6222****' + str(rint(1000, 9999)),
        'socialSecurity': pick([True, True, True, False]),
        'certificates': [], 'attendance': {'late': rint(0, 4), 'leaveDays': rint(0, 3), 'overtimeHours': rint(0, 36)},
        'score': rint(72, 98), 'manager': pick(['张振华', '李春梅', '陈瑞', '周建国']),
    })
for e in EMPLOYEES:
    e['monthlySalary'] = money(e['baseSalary'] * random.uniform(1.15, 1.55))


    if e['position'] in ('维修工', '工程主管') and random.random() < 0.6:
        e['certificates'] = [{'name': pick(['低压电工证', '高压电工证', '电梯安全员', '消防设施操作员']),
                              'no': 'CERT' + str(rint(10 ** 7, 10 ** 8 - 1)),
                              'expire': ds(TODAY + timedelta(days=rint(-60, 700)))}]
    if e['position'] == '保安' and random.random() < 0.4:
        e['certificates'] = [{'name': '保安员证', 'no': 'CERT' + str(rint(10 ** 7, 10 ** 8 - 1)),
                              'expire': ds(TODAY + timedelta(days=rint(-30, 900)))}]


# ---- 楼栋责任范围（楼栋管家）----
# 2026-10-29：业主资料与催缴按「责任范围」隔离。
# 粒度 = 楼栋为主 + 单元可拆 + 房屋例外（房屋级仅 houses.stewardEmpId 覆盖，不单独建表）。
# 做法：5 名客服专员转为「楼栋管家」（不新增员工，避免工资/考勤出现断档），
#       责任表与房屋快照全部静态派生，不消耗 PRNG。
_STEWARD_NAMES = ['莫瑞', '贺文博', '龚文', '武超', '董娜']
for _e in EMPLOYEES:
    if _e['name'] in _STEWARD_NAMES and _e['position'] == '客服专员':
        _e['position'] = '楼栋管家'
_STW_OF = {e['name']: e for e in EMPLOYEES if e['position'] == '楼栋管家'}
_STW_PLAN = {'P01': ['莫瑞', '贺文博'], 'P02': ['龚文', '武超'], 'P03': ['董娜']}
BUILDING_STEWARDS = []
for _b in BUILDINGS:
    _names = _STW_PLAN.get(_b['communityId']) or []
    if not _names:
        continue
    _same = [x['buildingId'] for x in BUILDINGS if x['communityId'] == _b['communityId']]
    _emp = _STW_OF[_names[_same.index(_b['buildingId']) % len(_names)]]
    _b['stewardEmpId'] = _emp['empId']
    BUILDING_STEWARDS.append({
        'stewardId': 'BS%04d' % (len(BUILDING_STEWARDS) + 1),
        'buildingId': _b['buildingId'], 'unitId': '', 'communityId': _b['communityId'],
        'empId': _emp['empId'], 'empName': _emp['name'],
        'scopeType': '楼栋', 'from': '2026-03-01', 'note': '',
    })
# 单元级拆分示例：同一栋楼两位楼管各管一个单元（演示「一栋多楼管」）
for _bid, _uid, _nm in [('B0101', 'U01101', '贺文博'), ('B0201', 'U02101', '贺文博')]:
    _emp = _STW_OF[_nm]
    BUILDING_STEWARDS.append({
        'stewardId': 'BS%04d' % (len(BUILDING_STEWARDS) + 1),
        'buildingId': _bid, 'unitId': _uid, 'communityId': 'P01',
        'empId': _emp['empId'], 'empName': _emp['name'],
        'scopeType': '单元', 'from': '2026-05-01', 'note': '单元拆分共管',
    })
_UNIT_STW = {(x['buildingId'], x['unitId']): x['empId'] for x in BUILDING_STEWARDS if x['unitId']}
_BLD_STW = {x['buildingId']: x['empId'] for x in BUILDING_STEWARDS if not x['unitId']}
for _h in HOUSES:
    _h['stewardEmpId'] = _UNIT_STW.get((_h['buildingId'], _h['unitId'])) or _BLD_STW.get(_h['buildingId'], '')

# --- 监督类任务：静态构造，不消耗 PRNG（保证既有 240 条执行任务逐字不变） ---
# 口径：监督任务由品质督导下达给组长，组长到现场核验下属责任区实际达标情况，
#       发现问题必须指定责任员工（用于考核与整改），因此带 issueItems / hitEmployees。
# 2026-10-29 扩充：每名部门经理覆盖近 6 周（09-14 ~ 10-20），
#       供「主管发现问题数」独立考核报表按自然月统计；责任员工必须属于被检班组。
_SPT_WEEKS = (1, 8, 15, 22, 29, 37)     # 距基准日天数：本周 / 上周 / …… / 六周前
_SPT_BANK = {
    '环境': ['楼道扶手有积尘', '垃圾点位桶盖未闭合', '大堂玻璃有手印', '绿化带落叶未清',
             '电梯厅地面有水渍', '公共区域烟头未清理', '垃圾桶满溢未清运'],
    '安保': ['夜间巡更漏打 2 个点位', '门岗交接记录缺失', '监控室无人值守', '巡更点位二维码破损',
             '访客登记缺项', '消防通道被占用'],
    '工程': ['配电箱门未上锁', '电梯轿厢内壁有污渍', '设备房巡检记录缺项', '消防泵压力不足', '应急照明不亮'],
    '客服': ['前台交接记录不完整', '投诉回访未按时完成', '业主档案未及时更新', '报修回访记录缺失', '钥匙借用登记缺项'],
}
# 各班组可被追责的一线员工（组长本人不进名单：监督任务追的是下属）
_SPT_STAFF = {
    'IP13': ['顾建国', '吴明', '邵磊', '冯嘉'],
    'IP14': ['宋杰'],
    'IP15': ['雷洋', '林浩'],
    'IP16': ['闫宇', '肖秀芳'],
    'IP17': ['姚辉', '唐娜'],
    'IP18': ['曹杰', '刘桂英', '卢佳怡'],
    'IP19': ['邵艳', '吴洋', '朱鑫'],
    'IP20': ['段芳'],
    'IP21': ['莫瑞', '覃海燕', '贺文博'],
    'IP22': ['龚文', '武超'],
    'IP23': ['董娜', '周佳怡'],
}
# 每期发现问题数（近 6 周，由近及远）：不同主管的检出力刻意做出梯度，
# 考核表才有「谁在真查、谁在走过场」的对比，0 表示本期零异常。
_SPT_PATTERN = {
    'IP13': (2, 1, 1, 3, 1, 2),
    'IP14': (1, 0, 2, 1, 0, 1),
    'IP15': (2, 1, 1, 0, 2, 1),
    'IP16': (0, 1, 0, 1, 0, 0),
    'IP17': (2, 2, 1, 2, 1, 2),
    'IP18': (1, 0, 1, 2, 0, 1),
    'IP19': (1, 2, 0, 1, 1, 0),
    'IP20': (1, 1, 2, 0, 1, 1),
    'IP21': (0, 1, 0, 0, 1, 0),
    'IP22': (1, 0, 1, 1, 0, 1),
    'IP23': (0, 0, 1, 0, 0, 1),
}
# 申报冲突：下属当日申报「零异常」，组长现场却查出问题 —— 防作弊重点看这几期
_SPT_CONFLICT = {('IP13', 0), ('IP13', 3), ('IP14', 2), ('IP17', 0), ('IP17', 2), ('IP18', 3), ('IP20', 2)}
# 未完成状态（其余默认已完成）：最近一期留几条在执行，避免「全是历史数据」
_SPT_STATUS = {('IP14', 1): '逾期', ('IP15', 0): '执行中', ('IP18', 0): '待执行', ('IP21', 0): '待执行'}
_SPT_PLAN_OF = {x['planId']: x for x in INSPECT_PLANS}
_spt_seq = 240
for _spt_plan in sorted(_SPT_PATTERN):
    _spt_pl = _SPT_PLAN_OF[_spt_plan]
    _spt_bank = _SPT_BANK[_spt_pl['post']]
    _spt_staff = _SPT_STAFF[_spt_plan]
    for _spt_wk, _spt_n in enumerate(_SPT_PATTERN[_spt_plan]):
        _spt_seq += 1
        _spt_day = TODAY - timedelta(days=_SPT_WEEKS[_spt_wk])
        _spt_stt = _SPT_STATUS.get((_spt_plan, _spt_wk), '已完成')
        _spt_done = _spt_stt in ('已完成', '已转工单')
        _spt_issues = [
            (_spt_bank[(_spt_wk * 2 + _spt_i) % len(_spt_bank)],
             _spt_staff[(_spt_wk + _spt_i) % len(_spt_staff)])
            for _spt_i in range(_spt_n)
        ]
        INSPECT_TASKS.append({
            'taskId': 'IT%05d' % _spt_seq, 'planId': _spt_pl['planId'], 'planName': _spt_pl['name'],
            'post': _spt_pl['post'], 'communityId': _spt_pl['communityId'], 'executor': _spt_pl['executor'],
            'templateId': _spt_pl['templateId'],
            'taskType': '监督', 'targetPost': _spt_pl['targetPost'], 'targetDept': _spt_pl['targetDept'],
            'executorOrgId': _spt_pl['targetDept'],
            'scheduledDate': ds(_spt_day), 'scheduledTime': '09:00',
            'status': _spt_stt, 'doneTime': ds(_spt_day) + ' 10:20' if _spt_done else '',
            'duration': 35 if _spt_done else 0,
            'itemCount': _spt_pl['items'], 'normalCount': (_spt_pl['items'] - _spt_n) if _spt_done else 0,
            'issueCount': _spt_n if _spt_done else 0,
            'photos': (_spt_n + 2) if _spt_done else 0,
            'checkinType': 'GPS围栏', 'checkedIn': _spt_done or _spt_stt == '执行中',
            'gps': '104.06%d,30.5%d' % (6000 + _spt_seq * 37, 6000 + _spt_seq * 41),
            'score': 0, 'refWoId': '',
            'reviewer': '', 'reviewScore': 0, 'reviewTime': '',
            'issueItems': [
                {'item': _spt_it, 'deduct': 2, 'responsibleName': _spt_who,
                 'responsibleEmpId': next((e['empId'] for e in EMPLOYEES if e['name'] == _spt_who), '')}
                for _spt_it, _spt_who in _spt_issues
            ] if _spt_done else [],
            'hitEmployees': [_spt_who for _, _spt_who in _spt_issues] if _spt_done else [],
            'conflictFlag': _spt_done and _spt_n > 0 and (_spt_plan, _spt_wk) in _SPT_CONFLICT,
        })
# ============================================================ 9. 看板聚合指标
def pct(a, b): return round(a / b * 100, 1) if b else 0.0

total_house = len(HOUSES)
vacant = sum(1 for h in HOUSES if h['useStatus'] == '空置')
rent = sum(1 for h in HOUSES if h['useStatus'] == '出租')
cur_amt = sum(b['payable'] for b in BILLS if b['period'] == CUR)
cur_paid = sum(b['paidAmount'] for b in BILLS if b['period'] == CUR)
overdue_amt = sum(b['unpaid'] for b in BILLS if b['status'] == '逾期')
overdue_cnt = sum(1 for b in BILLS if b['status'] == '逾期')

METRICS = {
    'asset': {
        'kpi': [
            {'key': 'buildingCount', 'label': '楼栋总数', 'value': len(BUILDINGS), 'unit': '栋', 'trend': 0, 'suffix': ''},
            {'key': 'houseCount', 'label': '房屋总数', 'value': total_house, 'unit': '套', 'trend': 0.0},
            {'key': 'parkCount', 'label': '车位总数', 'value': len(PARKINGS), 'unit': '个', 'trend': 2.1},
            {'key': 'population', 'label': '在册人口', 'value': total_house * 3 + len(MEMBERS), 'unit': '人', 'trend': 1.4},
            {'key': 'vacantRate', 'label': '空置率', 'value': pct(vacant, total_house), 'unit': '%', 'trend': -0.6, 'good': 'down'},
            {'key': 'certRate', 'label': '产权办理率', 'value': pct(sum(1 for h in HOUSES if h['propertyStatus'] == '已办证'), total_house), 'unit': '%', 'trend': 1.2, 'good': 'up'},
        ],
        'composition': [{'name': '住宅', 'value': sum(1 for h in HOUSES if h['usage'] == '住宅')},
                        {'name': '商业', 'value': sum(1 for h in HOUSES if h['usage'] == '商业')}],
        'useStatus': [{'name': '自住', 'value': sum(1 for h in HOUSES if h['useStatus'] == '自住'), 'color': '#409EFF'},
                      {'name': '出租', 'value': rent, 'color': '#67C23A'},
                      {'name': '空置', 'value': vacant, 'color': '#E6A23C'},
                      {'name': '装修中', 'value': sum(1 for h in HOUSES if h['useStatus'] == '装修中'), 'color': '#909399'},
                      {'name': '限制使用', 'value': sum(1 for h in HOUSES if h['useStatus'] == '限制使用'), 'color': '#F56C6C'}],
        'vacantByBuilding': [{'name': '%d栋' % b, 'rate': round(random.uniform(2.0, 16.0), 1)} for b in range(1, 9)],
        'parkHealth': [{'name': '已售', 'value': sum(1 for p in PARKINGS if p['status'] == '已售')},
                       {'name': '已租', 'value': sum(1 for p in PARKINGS if p['status'] == '已租')},
                       {'name': '闲置', 'value': sum(1 for p in PARKINGS if p['status'] == '闲置')},
                       {'name': '不可用', 'value': sum(1 for p in PARKINGS if p['status'] == '不可用')}],
        'risks': [
            {'level': '高', 'type': '空置集中', 'content': '锦绣家园 5 栋空置率 16.2%，高于项目均值 8.4 个百分点', 'count': 26, 'action': '指派招商/租赁跟进'},
            {'level': '高', 'type': '产权未办', 'content': '翡翠城 42 套交付满 5 年仍未办理产权证', 'count': 42, 'action': '批量发起办证提醒'},
            {'level': '中', 'type': '车位闲置', 'content': '星光天地 B2 层 38 个车位连续 90 天闲置', 'count': 38, 'action': '调整租赁策略'},
            {'level': '中', 'type': '合同到期', 'content': '3 份商铺租约 60 天内到期，未发起续约', 'count': 3, 'action': '推送招商跟进'},
            {'level': '低', 'type': '装修超期', 'content': '7 户装修登记超过 90 天未办结', 'count': 7, 'action': '现场核查'},
        ],
        'updateTime': '2026-10-21 08:00',
    },
    'iot': {
        'kpi': [
            {'key': 'deviceTotal', 'label': '接入设备', 'value': len(DEVICES), 'unit': '台', 'trend': 3.2},
            {'key': 'onlineRate', 'label': '在线率', 'value': pct(sum(1 for x in DEVICES if x['online']), len(DEVICES)), 'unit': '%', 'trend': -1.1, 'good': 'up'},
            {'key': 'alarmToday', 'label': '今日告警', 'value': sum(1 for a in ALARMS if a['occurTime'].startswith('2026-10-21')), 'unit': '条', 'trend': -18.0, 'good': 'down'},
            {'key': 'unclosedAlarm', 'label': '未闭环告警', 'value': sum(1 for a in ALARMS if a['status'] != '已关闭'), 'unit': '条', 'trend': 5.0, 'good': 'down'},
            {'key': 'doorPass', 'label': '今日门禁人次', 'value': 3826, 'unit': '人次', 'trend': 2.4},
            {'key': 'carInOut', 'label': '今日车场车次', 'value': 2148, 'unit': '车次', 'trend': 1.8},
        ],
        'subsystemOnline': [{'name': '门禁', 'rate': 94.4}, {'name': '车场', 'rate': 100.0}, {'name': '视频监控', 'rate': 92.3},
                            {'name': '电梯', 'rate': 100.0}, {'name': '消防', 'rate': 96.7}, {'name': '能耗表计', 'rate': 88.9},
                            {'name': '环境传感', 'rate': 80.0}],
        'alarmTrend': [12, 9, 15, 8, 11, 6, 7],
        'energyTrend': [{'month': '5月', 'water': 4820, 'power': 126400}, {'month': '6月', 'water': 5310, 'power': 148200},
                        {'month': '7月', 'water': 6180, 'power': 172900}, {'month': '8月', 'water': 6420, 'power': 181300},
                        {'month': '9月', 'water': 5740, 'power': 156800}, {'month': '10月', 'water': 4980, 'power': 132100}],
        'scenes': [
            {'name': '消防报警联动', 'trigger': '消防主机报警', 'action': '门禁常开 + 电梯归首层 + 推送值班', 'times': 2, 'status': '启用'},
            {'name': '深夜门禁异常', 'trigger': '23:00-06:00 连续 3 次刷卡失败', 'action': '抓拍 + 推送安保主管', 'times': 17, 'status': '启用'},
            {'name': '车位到期提醒', 'trigger': '车位管理费到期前 7 天', 'action': '推送业主 + 车场临停计费', 'times': 43, 'status': '启用'},
            {'name': '能耗突增告警', 'trigger': '公区用电环比 > 30%', 'action': '生成工单 + 推送工程主管', 'times': 5, 'status': '启用'},
        ],
        'updateTime': '2026-10-21 10:32',
    },
    'fee': {
        'kpi': [
            {'key': 'curReceivable', 'label': '本期应收', 'value': money(cur_amt), 'unit': '元', 'trend': 3.1},
            {'key': 'curReceived', 'label': '本期已收', 'value': money(cur_paid), 'unit': '元', 'trend': 5.6, 'good': 'up'},
            {'key': 'curRate', 'label': '本期收缴率', 'value': pct(cur_paid, cur_amt), 'unit': '%', 'trend': 2.2, 'good': 'up'},
            {'key': 'overdueAmount', 'label': '欠费总额', 'value': money(overdue_amt), 'unit': '元', 'trend': -8.4, 'good': 'down'},
            {'key': 'overdueCount', 'label': '欠费户数', 'value': overdue_cnt, 'unit': '笔', 'trend': -6.1, 'good': 'down'},
            {'key': 'yearRate', 'label': '年度收缴率', 'value': 91.6, 'unit': '%', 'trend': 1.8, 'good': 'up'},
        ],
        'monthlyRate': [{'month': '5月', 'rate': 88.2}, {'month': '6月', 'rate': 90.1}, {'month': '7月', 'rate': 87.6},
                        {'month': '8月', 'rate': 92.4}, {'month': '9月', 'rate': 89.8}, {'month': '10月', 'rate': pct(cur_paid, cur_amt)}],
        'feeComposition': [{'name': '物业服务费', 'value': 62.4}, {'name': '能耗费用', 'value': 21.8},
                           {'name': '车位管理费', 'value': 10.6}, {'name': '其他', 'value': 5.2}],
        'updateTime': '2026-10-21 09:00',
    },
    'workbench': {
        'todo': [
            {'id': 'T1', 'type': '审批', 'title': '张建国 · 车位换绑申请（川A·8K23P）', 'from': '客服·王芳', 'time': '2026-10-19 14:20', 'level': '已超时', 'overdue': True},
            {'id': 'T2', 'type': '审批', 'title': '锦绣家园 10 月采购申请 ¥18,600', 'from': '李春梅', 'time': '2026-10-21 08:40', 'level': '今日到期', 'overdue': False},
            {'id': 'T3', 'type': '工单', 'title': 'WO20260001 主卫水管漏水 · 待确认收费', 'from': '孙德海', 'time': '2026-10-21 11:05', 'level': '紧急', 'overdue': False},
            {'id': 'T4', 'type': '巡检', 'title': '消防设施月检 · 待复核（周明提交）', 'from': '系统', 'time': '2026-10-20 17:30', 'level': '今日到期', 'overdue': False},
            {'id': 'T5', 'type': '抄送', 'title': '关于冬季供暖设备检修的通知', 'from': '工程管理部', 'time': '2026-10-18 09:00', 'level': '普通', 'overdue': True},
        ],
        'kpi': [
            {'label': '我的待办', 'value': 12, 'unit': '项', 'trend': -3},
            {'label': '今日工单', 'value': 26, 'unit': '件', 'trend': 4},
            {'label': '今日收款', 'value': 48260, 'unit': '元', 'trend': 12.4},
            {'label': '在途巡检', 'value': 8, 'unit': '项', 'trend': 0},
            {'label': '设备告警', 'value': 14, 'unit': '条', 'trend': -6},
            {'label': '欠费提醒', 'value': 38, 'unit': '户', 'trend': -5},
        ],
        'teamToday': [
            {'name': '报修响应率', 'value': 94.2, 'unit': '%', 'good': 'up'},
            {'name': '巡检完成率', 'value': 88.6, 'unit': '%', 'good': 'up'},
            {'name': '收费完成率', 'value': 62.4, 'unit': '%', 'good': 'up'},
            {'name': '品质合格率', 'value': 91.3, 'unit': '%', 'good': 'up'},
        ],
        'efficiency': [8, 12, 9, 15, 11, 17, 14],
    },
}

# ============================================================ 补充批次（29–31）：合同 / 公告 / 品质检查记录
# 用独立随机流 SEED+31，保证不扰动上面 22 张表已生成的结果（纯增量）
R = random.Random(SEED + 31)

def r_i(a, b): return R.randint(a, b)
def r_pick(seq): return R.choice(seq)
def r_uniform(a, b): return R.uniform(a, b)
def r_date(days): return ds(TODAY + timedelta(days=days))     # 相对今天的日期
def r_past(days): return ds(TODAY - timedelta(days=days))

def r_pickw(pairs):
    tot = sum(w for _, w in pairs)
    x = R.uniform(0, tot)
    for v, w in pairs:
        x -= w
        if x <= 0: return v
    return pairs[-1][0]

EMP_BY_ORG = {}
for _e in EMPLOYEES:
    EMP_BY_ORG.setdefault(_e['orgId'], []).append(_e)
ACTIVE_EMP = [e for e in EMPLOYEES if e['status'] == '在职'] or EMPLOYEES
QS_EMP = [e for e in ACTIVE_EMP if e['orgId'] == 'O-QS'] or ACTIVE_EMP

HOUSES_OF = {}
for _h in HOUSES:
    HOUSES_OF.setdefault(_h['communityId'], []).append(_h)

# ---------------------------------------------------------- 合同
CITY_PREFIX = ['成都', '四川', '锦江', '蜀都', '天府', '华西', '蓉城', '兴蓉', '中环', '嘉合']
BIZ_WORD = ['洁美', '安康', '绿苑', '恒通', '安泰', '锐驰', '宏信', '智联', '顺达', '景盛', '众信', '诚德']
SUP_SUFFIX = ['服务有限公司', '环境工程有限公司', '机电设备有限公司', '安防科技有限公司',
              '园林绿化有限公司', '物业管理有限公司', '劳务派遣有限公司', '建筑工程有限公司']

CONTRACT_PLAN = [
    ('物业服务', ['前期物业服务合同', '物业服务合同', '物业顾问服务合同'], 7),
    ('外包服务', ['保洁服务外包', '绿化养护外包', '电梯维保', '安保服务外包',
                  '消防设施维保', '垃圾清运', '二次供水设施维保'], 30),
    ('采购', ['设施设备采购', '办公用品采购', '维修材料采购', '安防设备采购', '节能改造工程'], 20),
    ('租赁', ['房屋租赁', '车位租赁', '商铺租赁', '广告位租赁'], 16),
    ('劳动', ['劳动合同', '劳务协议', '实习协议'], 12),
]
AMOUNT_RANGE = {
    '物业服务': (180000, 960000),
    '外包服务': (36000, 420000),
    '采购': (8600, 260000),
    '租赁': (9600, 168000),
    '劳动': (48000, 216000),
}
PAY_CYCLE = {
    '物业服务': ['月付', '季付', '半年付'],
    '外包服务': ['月付', '季付', '验收后付'],
    '采购': ['一次性', '预付 30% + 验收尾款'],
    '租赁': ['月付', '季付', '半年付', '年付'],
    '劳动': ['月付'],
}

def contract_status(start_date, end_date):
    """按起止日期推导履行状态；另留少量流程态（草稿 / 待审批 / 已终止）"""
    s, e = d(start_date), d(end_date)
    if e < TODAY: return '已到期'
    if s > TODAY: return '待生效'
    if (e - TODAY).days <= 90: return '即将到期'
    return '履行中'

CONTRACTS = []
_cid = 0
for _type, _subs, _n in CONTRACT_PLAN:
    for _i in range(_n):
        _cid += 1
        _sub = r_pick(_subs)
        _is_group = (_type == '劳动') or (_type == '采购' and R.random() < 0.3)
        _cid_com = '' if _is_group else r_pick(COMMUNITIES)['communityId']
        _start_off = r_i(-900, 60)
        _span = r_pickw([(365, 5), (730, 4), (1095, 2), (180, 1)])
        _start = r_date(_start_off)
        _end = ds(d(_start) + timedelta(days=_span))
        _status = contract_status(_start, _end)
        if R.random() < 0.08:
            _status = r_pick(['草稿', '待审批']) if _status == '履行中' else _status
        elif R.random() < 0.04:
            _status = '已终止'
        _sign = ds(d(_start) - timedelta(days=r_i(3, 30)))
        _lo, _hi = AMOUNT_RANGE[_type]
        _sup = r_pick(CITY_PREFIX) + r_pick(BIZ_WORD) + r_pick(SUP_SUFFIX)

        # 关联对象：租赁挂房屋/车位，劳动挂员工，其余挂供应商
        _ref_type, _ref_id, _party, _phone = 'supplier', '', _sup, phone()
        if _type == '租赁':
            if _sub == '车位租赁':
                _pk = r_pick(PARKINGS)
                _ref_type, _ref_id = 'parking', _pk['parkId']
                _party = next((o['name'] for o in OWNERS if o['ownerId'] == _pk['ownerId']), person_name())
                _phone = next((o['phone'] for o in OWNERS if o['ownerId'] == _pk['ownerId']), phone())
            else:
                _hs = r_pick(HOUSES)
                _ref_type, _ref_id = 'house', _hs['houseId']
                _own = next((o for o in OWNERS if o['ownerId'] == _hs['ownerId']), None)
                _party = _own['name'] if _own else person_name()
                _phone = _own['phone'] if _own else phone()
        elif _type == '劳动':
            _emp = r_pick(ACTIVE_EMP)
            _ref_type, _ref_id = 'employee', _emp['empId']
            _party, _phone = _emp['name'], _emp['phone']

        CONTRACTS.append({
            'contractId': 'CT%04d' % _cid,
            'contractNo': 'HT-%d-%04d' % (d(_sign).year, r_i(1, 999)),
            'name': '%s%s合同' % (('' if _is_group else next(c['name'] for c in COMMUNITIES if c['communityId'] == _cid_com)),
                                  _sub) if _type != '劳动' else '%s · %s' % (_party, _sub),
            'type': _type,
            'subtype': _sub,
            'communityId': _cid_com,
            'orgId': 'O-HEAD' if _is_group else 'O-' + _cid_com,
            'partyB': _party,
            'contact': person_name(),
            'phone': _phone,
            'amount': money(r_uniform(_lo, _hi)),
            'payCycle': r_pick(PAY_CYCLE[_type]),
            'signDate': _sign,
            'startDate': _start,
            'endDate': _end,
            'status': _status,
            'owner': r_pick(ACTIVE_EMP)['name'],
            'ownerEmpId': r_pick(ACTIVE_EMP)['empId'],
            'attachments': r_i(1, 6),
            'refType': _ref_type,
            'refId': _ref_id,
            'remark': r_pick(['', '按季度考核付款', '含年度调价条款', '续签优先谈判权', '含履约保证金', '']),
        })
CONTRACTS.sort(key=lambda x: (x['type'], x['contractId']))

# ---------------------------------------------------------- 公告通知
NOTICE_PLAN = [
    ('停水停电', ['关于 {c} 计划性停水的通知', '{c} 停电检修通知', '二次供水水箱清洗停水通知'], 2.0),
    ('收费通知', ['{c} 物业费缴纳提醒', '关于调整车位管理费标准的通知', '{c} 能耗费用分摊公示'], 2.4),
    ('安全提示', ['冬季用电安全提示', '关于电动自行车规范停放的通知', '高空抛物危害警示', '消防通道禁止占用提示'], 2.0),
    ('社区活动', ['{c} 中秋邻里节活动邀请', '重阳节敬老活动通知', '社区跳蚤市场报名开始'], 1.2),
    ('政策公告', ['关于启用新版业主 App 的公告', '门禁系统升级公告', '垃圾分类管理实施细则'], 1.4),
    ('维修施工', ['{c} 电梯年检停运通知', '屋面防水施工期间出行提示', '地下车库地坪维修通知'], 1.6),
]
CHANNELS = ['App 推送', '短信', '微信公众号', '公告栏', '上门告知']

NOTICES = []
_nid = 0
for _type, _titles, _w in NOTICE_PLAN:
    _n = int(round(_w * 10))
    for _i in range(_n):
        _nid += 1
        _com = r_pick(COMMUNITIES)
        _title = r_pick(_titles).replace('{c}', _com['name'])
        _pub_off = r_i(0, 120)
        _pub = r_past(_pub_off)
        _is_all = R.random() < 0.12
        _target = len(HOUSES) if _is_all else len(HOUSES_OF.get(_com['communityId'], []))
        _status = r_pickw([('已发布', 7), ('已过期', 2), ('待审核', 1.2), ('草稿', 0.8), ('已撤回', 0.5)])
        if _status in ('草稿', '待审核'):
            _read = 0
        elif _status == '已过期':
            _read = int(_target * r_uniform(0.35, 0.7))
        else:
            _read = int(_target * r_uniform(0.55, 0.95))
        NOTICES.append({
            'noticeId': 'NT%04d' % _nid,
            'title': _title,
            'type': _type,
            'communityId': '' if _is_all else _com['communityId'],
            'channels': R.sample(CHANNELS, r_i(1, 3)),
            'publisher': r_pick(ACTIVE_EMP)['name'],
            'publisherEmpId': r_pick(ACTIVE_EMP)['empId'],
            'publishTime': _pub + ' %02d:%02d' % (r_i(8, 19), r_i(0, 59)),
            'status': _status,
            'targetHouses': _target,
            'readCount': _read,
            'top': R.random() < 0.08,
            'auditBy': r_pick(QS_EMP)['name'] if _status != '草稿' else '',
            'auditTime': (_pub + ' %02d:%02d' % (r_i(8, 18), r_i(0, 59))) if _status not in ('草稿', '待审核') else '',
            'attachments': r_i(0, 3),
            'content': _title + '。' + r_pick([
                '具体安排详见附件，给您带来不便敬请谅解。',
                '如有疑问请联系物业服务中心，服务热线 028-8888 6666。',
                '请各位业主相互转告，感谢配合。',
                '逾期未处理将由服务中心统一安排，费用按公示标准执行。'
            ]),
        })
NOTICES.sort(key=lambda x: x['publishTime'], reverse=True)

# ---------------------------------------------------------- 品质检查记录
AREAS = ['公共区域', '楼栋大堂', '地下车库', '设备房', '绿化带', '电梯机房', '园区外围']
CHECK_TYPES = [('日常', 5), ('专项', 2), ('月度', 2), ('季度', 1)]

QUALITY_CHECKS = []
_qid = 0
for _com in COMMUNITIES:
    for _type, _w in CHECK_TYPES:
        for _i in range(int(round(_w * 3))):
            _qid += 1
            _score = round(r_uniform(62, 99), 1)
            _grade = '优秀' if _score >= 90 else '良好' if _score >= 80 else '合格' if _score >= 70 else '不合格'
            _deduct = 0 if _score >= 95 else r_i(1, 9)
            _veto = R.random() < 0.06
            if _veto:
                _score = round(r_uniform(52, 68), 1)
                _grade = '不合格'
                _deduct = max(_deduct, 3)
            _rect = _deduct if _deduct else 0
            # 整改完成率按 80% 全部闭环 / 20% 部分在办，避免「已超时」占比失真
            _all_done = R.random() < 0.8
            _done = _rect if _all_done else (r_i(0, _rect - 1) if _rect > 1 else 0)
            # 约 30% 落在最近两周内，保证「整改中」有真实在办样本
            _date = r_past(r_i(0, 12)) if R.random() < 0.3 else r_past(r_i(13, 150))
            _due = ds(d(_date) + timedelta(days=r_i(3, 15)))
            if _rect == 0:
                _status = '已闭环'
            elif _done >= _rect:
                _status = r_pick(['已闭环', '待复核'])
            else:
                _status = '整改中' if d(_due) >= TODAY else '已超时'
            QUALITY_CHECKS.append({
                'checkId': 'QC%04d' % _qid,
                'checkNo': 'QZ-%s-%03d' % (_date[:7], r_i(1, 999)),
                'communityId': _com['communityId'],
                'area': r_pick(AREAS),
                'type': _type,
                'checker': r_pick(QS_EMP)['name'],
                'checkerEmpId': r_pick(QS_EMP)['empId'],
                'checkDate': _date,
                'score': _score,
                'grade': _grade,
                'deductCount': _deduct,
                'veto': _veto,
                'rectifyCount': _rect,
                'rectifyDone': _done,
                'dueDate': _due,
                'status': _status,
                'recheck': _status in ('待复核', '已闭环') and R.random() < 0.4,
                'attachments': r_i(0, 8),
                'remark': r_pick(['', '上轮问题本轮未回潮', '需工程部配合整改', '已现场口头提示', '']),
            })
QUALITY_CHECKS.sort(key=lambda x: x['checkDate'], reverse=True)

# ============================================================ 补充批次（2026-10-22 E 域 · 独立随机流 SEED+41）
# 纪律：既有表零改动。orgs 仅【追加】班组节点，原 9 条逐字不变；roles / permissions 为全新表。
R2 = random.Random(SEED + 41)

# --- orgs 第 4 层：3 个项目部各设 4 个班组（树能展开到执行层） ---
def _team_leader(org_id, position):
    names = [e['name'] for e in EMPLOYEES if e['orgId'] == org_id and e['position'] == position]
    return names[0] if names else ''

_TEAM_DEF = [('客服组', '客服主管'), ('工程组', '工程主管'), ('安保组', '安保主管'), ('环境组', '环境主管')]
_sort = 10
for _oid in ['O-P01', 'O-P02', 'O-P03']:
    for _i, (_tname, _pos) in enumerate(_TEAM_DEF, 1):
        ORGS.append({
            'orgId': '%s-T%d' % (_oid, _i),
            'name': _tname,
            'parentId': _oid,
            'type': '班组',
            'leader': _team_leader(_oid, _pos),
            'sort': _sort,
        })
        _sort += 1

# --- 组长补齐（不消耗 PRNG）：seed 的随机分布会让个别项目缺某岗位主管，
#     导致该班组 leader 为空、监督任务没有执行人。从主管富余的项目调岗过来补位。 ---
_fix_leaders = {x['leader'] for x in ORGS if x.get('leader')}
for _tid, _pos, _src in [('O-P02-T3', '安保主管', 'O-P01'), ('O-P03-T2', '工程主管', 'O-P01')]:
    _team = next((x for x in ORGS if x['orgId'] == _tid), None)
    if not _team or _team['leader']:
        continue
    _cand = next((e for e in EMPLOYEES
                  if e['orgId'] == _src and e['position'] == _pos and e['name'] not in _fix_leaders), None)
    if _cand:
        _cand['orgId'] = _tid.split('-T')[0]      # 调到目标项目（组归属由 TEAM_BY_POS 推出）
        _team['leader'] = _cand['name']
        _fix_leaders.add(_cand['name'])

# --- 权限项字典：域 → 功能 → 操作（E 域权限矩阵的列定义，与 pages.js 路由一一对应） ---
PERM_GROUPS = [
    ('a', 'A 房产与业主', [
        ('owners', '业主档案', ('view', 'edit'), '/a/owners'),
        ('houses', '房屋台账', ('view', 'edit'), '/a/houses'),
        ('tenants', '租户管理', ('view', 'edit'), '/a/tenants'),
        ('vehicles', '车位与车辆', ('view', 'edit'), '/a/vehicles'),
        # 2026-10-29：楼栋责任范围（楼管分配 / 项目经理移交）
        ('stewards', '楼栋责任范围', ('view', 'edit'), '/a/stewards'),
        # 2026-10-29 补：敏感字段明文（手机/证件/银行账号）。route 留空 ——
        # 它不是一个页面，而是「在页面里点开脱敏值」的能力，绑路由会抢掉 /a/owners 的页面守卫
        ('sensitive', '敏感字段明文', ('view',), ''),
        # 2026-10-22 补：页面级权限守卫上线后，这两个页此前无权限码（默认放行）
        ('assetDash', '资产驾驶舱', ('view',), '/a/dashboard'),
        ('owner360', '业主360视图', ('view',), '/a/owner360'),
    ]),
    ('b', 'B 费用', [
        ('bills', '账单查询', ('view', 'edit'), '/b/bills'),
        ('payments', '缴费流水', ('view',), '/b/payments'),
        # 2026-10-30：收费日结（现金实点轧账 / 退款冲红核对）
        ('dailyClose', '收费日结', ('view', 'edit'), '/b/daily-close'),
        # 2026-10-30 夜：收费月结（账面封账）。结账是财务动作，edit 只给财务口径的角色
        ('monthClose', '收费月结', ('view', 'edit'), '/b/month-close'),
        ('cashier', 'PC 收银台', ('view', 'edit'), '/b/cashier'),
        ('feeItems', '收费科目', ('view',), '/b/fee-items'),
        ('feeDash', '费用驾驶舱', ('view',), '/b/dashboard'),
    ]),
    ('c', 'C 办公协同', [
        ('employees', '员工档案', ('view', 'edit'), '/c/employee'),
        ('payroll', '工资表', ('view', 'edit'), '/c/payroll'),
        ('contracts', '合同管理', ('view', 'edit'), '/c/contracts'),
        ('notices', '公告通知', ('view', 'edit'), '/c/notices'),
        ('workbench', '办公工作台', ('view',), '/c/workbench'),
    ]),
    ('d', 'D 物联', [
        ('devices', '设备台账', ('view', 'edit'), '/d/devices'),
        ('alarms', '告警中心', ('view', 'edit'), '/d/alarms'),
        ('passRecords', '通行记录', ('view', 'edit'), '/d/pass-records'),
        ('iotDash', '物联驾驶舱', ('view',), '/d/dashboard'),
    ]),
    ('e', 'E 组织与权限', [
        ('org', '组织与权限', ('view', 'edit'), '/e/org'),
        # 2026-10-22 补：报表中心与下载中心（导出统一走异步任务后的新入口）
        ('reports', '报表中心', ('view',), '/e/reports'),
        ('downloads', '下载中心', ('view',), '/e/downloads'),
        # 2026-10-29 补：数据访问日志（敏感字段查看 + 导出留痕，只增不删）
        ('accessLog', '数据访问日志', ('view',), '/e/access-log'),
        # 2026-10-30 补：口径自检（不变量红绿灯，运维/开发用）
        ('audit', '口径自检', ('view',), '/e/audit'),
        # 2026-10-30 夜补：月结反结（推翻已封账结果）。
        # **刻意放 e 域而不是 b 域**：财务专员对 b 域是通配（b.* view/edit），
        # 反结是治理动作，不该被"管收费"这一个事实自动授予 —— 放 b 域会静默给到每个财务。
        # route 留空：它不是一个页面，是月结页上的一个按钮。
        ('monthReopen', '月结反结', ('view', 'edit'), ''),
        # 2026-10-30 夜补：权限变更日志。**只读、只增**——能改权限的人最需要被记录
        ('permLog', '权限变更日志', ('view',), '/e/perm-log'),
        # 2026-10-30 夜补：高敏权限变更的审批（按钮级，无路由）。
        # 只给总经理与财务主管，且**不能审批自己提交的**——双人原则，一个人批不了自己的提权
        ('permApprove', '权限变更审批', ('view', 'edit'), ''),
    ]),
    ('f', 'F 现场运营', [
        ('workorders', '工单列表', ('view', 'edit'), '/f/workorders'),
        ('woDetail', '派单与处理', ('view', 'edit'), '/f/wo-detail'),
        ('inspectPlans', '巡检计划', ('view', 'edit'), '/f/inspect-plans'),
        ('inspectTasks', '巡检任务', ('view', 'edit'), '/f/inspect-tasks'),
        ('inspect', '巡检任务执行', ('view', 'exec'), '/f/inspect'),
        ('inspectTemplates', '巡检模板配置', ('view', 'edit'), '/f/inspect-templates'),
        ('quality', '品质评分卡', ('view', 'edit'), '/f/quality'),
        ('qualityRecords', '品质检查记录', ('view', 'edit'), '/f/quality-records'),
        ('qualityEval', '品质评价', ('view', 'edit'), '/f/quality-eval'),
        # 2026-10-29 补：整改闭环（品质督导开单 → 部门经理整改 → 督导复核）+ 主管发现问题数考核表
        ('rectify', '整改闭环', ('view', 'edit'), '/f/rectify'),
        ('supFinding', '主管发现问题数', ('view',), '/f/sup-finding'),
    ]),
]
PERMISSIONS = []
for _d, _dname, _funcs in PERM_GROUPS:
    for _fn, _fname, _ops, _route in _funcs:
        for _op in _ops:
            PERMISSIONS.append({
                'code': '%s.%s.%s' % (_d, _fn, _op),
                'domain': _d, 'domainName': _dname,
                'func': _fn, 'funcName': _fname,
                'op': _op, 'opName': '查看' if _op == 'view' else '操作',
                'route': _route,
            })

def _expand(rules):
    """(域, '功能|功能', (操作...)) → 权限码列表；'*' 表示全部"""
    out = set()
    for dom, funcs, ops in rules:
        for gdom, _, gfuncs in PERM_GROUPS:
            if dom != '*' and gdom != dom:
                continue
            for fn, _, fops, _ in gfuncs:
                if funcs != '*' and fn not in funcs.split('|'):
                    continue
                for op in ops:
                    if op in fops:
                        out.add('%s.%s.%s' % (gdom, fn, op))
    return sorted(out)

# --- 角色：权限按业务规则显式定义，不用随机（权限是要评审的，不能随机） ---
ROLE_SPEC = [
    ('R-GM', '集团总经理', '集团', '全部项目', [], ['总经理'],
     '集团经营负责人，全量查看与关键审批', [('*', '*', ('view', 'edit'))]),
    ('R-PM', '项目经理', '项目', '本项目', [], ['项目经理'],
     '单项目第一责任人，统筹收费、工单与现场，不含人事与工资',
     [('a', '*', ('view', 'edit')),
      ('e', 'accessLog', ('view',)),
      ('b', 'bills|payments|feeDash|feeItems', ('view',)),
      ('c', 'notices', ('view', 'edit')), ('c', 'contracts', ('view',)),
      ('d', '*', ('view',)),
      ('e', 'reports|downloads', ('view',)),
      ('f', 'workorders|woDetail|inspectTasks|qualityRecords', ('view', 'edit')),
      ('f', 'rectify', ('view', 'edit')),
      ('a', 'stewards', ('view', 'edit')),
      ('e', 'audit', ('view',)),
      ('f', 'quality|inspectPlans|inspect|inspectTemplates|qualityEval|supFinding', ('view',))]),
    ('R-CS', '客服专员', '项目', '本项目', [], ['客服专员'],
     '一线客服：受理业主诉求、执行巡检任务，不含公告发布与档案编辑',
     [('a', 'owners|houses|tenants|vehicles', ('view',)),
      ('a', 'sensitive', ('view',)),
      ('a', 'owner360', ('view',)),
      ('e', 'downloads', ('view',)),
      ('f', 'inspectTasks', ('view',)),
      ('f', 'inspect', ('view', 'exec')),
      ('f', 'workorders|woDetail', ('view', 'edit'))]),
    ('R-CHG', '收银员', '项目', '本项目', [], ['收银员'],
     '前台收费与开票：可收款，不可改账单金额；租户到场代缴时可补充租户信息',
     [('a', 'owners|houses', ('view',)),
      # 2026-10-29：前台收费必须能核对业主/租户手机号 → 给敏感字段明文（每次查看留痕）
      ('a', 'sensitive', ('view',)),
      # 2026-10-29：租户信息由业主维护，但「代缴物业费时补充」落点在前台 → 收银员需要租户读写
      ('a', 'tenants', ('view', 'edit')),
      ('b', 'cashier', ('view', 'edit')), ('b', 'bills', ('view', 'edit')),
      ('b', 'payments|feeItems|feeDash', ('view',)),
      # 2026-10-30：收银员要能自己日结（现金实点 + 差异说明）
      ('b', 'dailyClose', ('view', 'edit')),
      ('e', 'downloads', ('view',))]),
    ('R-FIN', '财务专员', '集团', '全部项目', [], ['财务主管', '会计'],
     '集团财务口径，全项目账目、凭证与冲红',
     [('a', 'houses', ('view',)), ('a', 'sensitive', ('view',)), ('b', '*', ('view', 'edit')),
      ('c', 'contracts', ('view',)), ('c', 'payroll', ('view',)),
      ('e', 'reports|downloads', ('view',))]),
    ('R-FINM', '财务主管', '集团', '全部项目', [], ['财务主管', '财务经理'],
     '封账与反结的授权人：能推翻已月结结果，但每次反结都要写原因并作废该期报表批次',
     [('a', 'houses', ('view',)), ('a', 'sensitive', ('view',)),
      ('b', '*', ('view', 'edit')),
      ('e', 'monthReopen', ('view', 'edit')),
      ('e', 'permApprove', ('view', 'edit')),
      ('e', 'reports|downloads|accessLog|audit|permLog', ('view',)),
      ('c', 'contracts', ('view',)), ('c', 'payroll', ('view',))]),
    ('R-ENG', '工程维修', '项目', '仅本人', [], ['维修工'],
     '只看派给自己的工单与巡检任务，设备可报修',
     [('d', 'devices|alarms', ('view', 'edit')),
      ('e', 'downloads', ('view',)),
      ('f', 'inspectTasks', ('view',)),
      ('f', 'inspect', ('view', 'exec')),
      ('f', 'workorders|woDetail', ('view', 'edit'))]),
    ('R-QS', '品质督导', '集团', '指定项目', ['P01', 'P03'], ['品质专员'],
     '跨项目巡检与评分，负责整改闭环（仅翡翠城 + 星光天地）',
     [('d', '*', ('view',)),
      ('e', 'reports|downloads', ('view',)),
      ('f', 'inspectPlans', ('view', 'edit')),
      ('f', 'inspectTemplates', ('view', 'edit')),
      ('f', 'inspect', ('view',)),
      ('f', 'qualityEval', ('view', 'edit')),
      ('f', 'rectify', ('view', 'edit')),
      ('f', 'supFinding', ('view',)),
      ('f', 'inspectTasks|qualityRecords|quality', ('view', 'edit'))]),
    ('R-HR', '人事专员', '集团', '全部项目', [], ['人事专员'],
     '人事、薪资与合同台账维护，可分配角色',
     [('c', 'employees|payroll|contracts', ('view', 'edit')),
      # 人事维护员工手机/证件，需要明文；同时可查数据访问日志（员工隐私被谁看过）
      ('a', 'sensitive', ('view',)),
      ('e', 'org', ('view', 'edit')), ('e', 'reports|downloads|accessLog|audit|permLog', ('view',))]),
    ('R-STW', '楼栋管家', '项目', '责任范围', [], ['楼栋管家'],
     '按楼栋/单元责任范围管理业主资料、租户信息与欠费催缴；范围外一条不可见',
     [('a', 'owners|houses|tenants', ('view', 'edit')),
      # 楼管要联系业主，范围内必须能看手机号；每一次揭示都写访问日志（范围外仍看不到）
      ('a', 'sensitive', ('view',)),
      ('b', 'bills|payments', ('view',)),
      ('f', 'workorders|woDetail', ('view', 'edit')),
      ('a', 'stewards', ('view',)),
      ('e', 'downloads', ('view',))]),
    ('R-SEC', '部门经理', '项目', '本部门', [], ['客服主管', '工程主管', '安保主管', '环境主管'],
     '班组长级：只做现场核验与监督，不承担一线作业；监督模板与计划由品质督导下发',
     [('a', 'houses|owners|vehicles', ('view',)),
      ('a', 'sensitive', ('view',)),
      ('b', 'bills|payments', ('view',)),
      ('d', 'passRecords|alarms|devices|iotDash', ('view',)),
      ('f', 'inspectTasks', ('view',)),
      ('f', 'inspect', ('view', 'exec')),
      ('f', 'inspectTemplates', ('view',)),
      ('f', 'rectify', ('view', 'edit')),
      ('f', 'supFinding', ('view',)),
      ('a', 'stewards', ('view',)),
      ('e', 'downloads', ('view',))]),
    ('R-CLN', '环境保洁', '项目', '本项目', [], ['保洁员', '绿化员'],
     '环境类巡检与工单执行，不含收费与业主档案',
     [('f', 'inspectTasks', ('view',)),
      ('f', 'inspect', ('view', 'exec')),
      ('f', 'workorders|woDetail', ('view', 'edit')),
      ('d', 'devices', ('view',)),
      ('e', 'downloads', ('view',))]),
    ('R-GRD', '秩序维护员', '项目', '本项目', [], ['保安'],
     '一线秩序维护：巡更打卡、通行与告警处理、执行巡检任务',
     [('a', 'vehicles', ('view',)),
      ('d', 'passRecords|alarms|devices', ('view',)),
      ('f', 'inspectTasks', ('view',)),
      ('f', 'inspect', ('view', 'exec')),
      ('f', 'workorders|woDetail', ('view', 'edit')),
      ('e', 'downloads', ('view',))]),
    # 2026-10-31：补一个「能看档案、不能看工资」的角色样本。
    # 没有它，「员工域不含薪资」这条隔离永远没有反例可验（R-HR / R-VIEW 都带 c.payroll.view）。
    # 岗位「人事助理」刻意不与既有 120 名员工重合：这个角色只做隔离演示，不参与人数统计。
    ('R-HRA', '人事助理（不含薪酬）', '集团', '全部项目', [], ['人事助理'],
     '只管人事档案与合同，不含薪资：能看员工手机/证件（每次揭示留痕），看不到任何工资金额',
     [('a', 'sensitive', ('view',)),
      ('c', 'employees|contracts', ('view', 'edit')),
      ('e', 'org', ('view',)), ('e', 'reports|downloads', ('view',))]),
    ('R-VIEW', '只读观察员', '集团', '全部项目', [], [],
     '外部审计 / 集团巡查，全量只读、不留操作',
     [('*', '*', ('view',))]),
]
ROLES = []
for _rid, _name, _scope, _ds, _comms, _pos, _desc, _rules in ROLE_SPEC:
    _perms = _expand(_rules)
    # 只读观察员 = 外部审计 / 集团巡查：通配 view 会顺带拿到「敏感字段明文」，
    # 按审计口径只给脱敏数据（「看了什么」的留痕他仍然能查）
    if _rid == 'R-VIEW':
        _perms = [x for x in _perms if x != 'a.sensitive.view']
    ROLES.append({
        'roleId': _rid, 'name': _name, 'scope': _scope,
        'dataScope': _ds, 'communities': _comms, 'positions': _pos,
        'desc': _desc, 'builtin': True, 'perms': _perms,
    })

# ============================================================ 补充批次（2026-10-22 押金与权限 · 独立随机流 SEED+51）
# 纪律：既有表零改动。permissions / roles 只【追加】5 条权限码（原 45 条逐字不变）；
#       decorationDeposits 为全新表，不影响上面 28 张表。
# 决策（用户 2026-10-22 确认）：押金场景只保留「装修押金」一种 ——
#   租约押金、车位押金等一律不存在；TenantForm 的押金字段同步移除，口径收敛到装修押金。
R3 = random.Random(SEED + 51)

def r3_i(a, b): return R3.randint(a, b)
def r3_pick(seq): return R3.choice(seq)
def r3_pickw(pairs):
    # 权重按百分比书写（合计 100），此处归一后再比较
    x = R3.random() * sum(w for _, w in pairs); acc = 0.0
    for v, w in pairs:
        acc += w
        if x <= acc: return v
    return pairs[-1][0]

_OWNER_OF = {o['ownerId']: o for o in OWNERS}
_COMM_NAME = {c['communityId']: c['name'] for c in COMMUNITIES}
# 楼栋管家由客服专员转岗而来，仍属一线运营操作人，必须留在池子里：
# 否则这个名单长度变化会让后面的随机流整体偏移（approvals / 押金 等表会莫名变动）
_OPERATORS = [e['name'] for e in EMPLOYEES if e['position'] in ('客服主管', '客服专员', '楼栋管家', '项目经理')]
if not _OPERATORS:
    _OPERATORS = [e['name'] for e in EMPLOYEES[:30]]

# 扣除原因：只出现在「部分扣除 / 已没收」，退押金时才说得清为什么少退
_DEDUCT_REASON = [
    '破坏承重墙未恢复原状', '占用公共通道堆放装修垃圾', '超时施工引发多次投诉',
    '损坏电梯轿厢未赔偿', '违规改动燃气管道', '装修垃圾未清运', '超出申请范围拆改阳台'
]
_FORFEIT_REASON = ['违规拆改承重结构且拒不整改', '装修期间造成公共设施重大损坏', '擅自改变房屋用途且未复原']

DECORATION_DEPOSITS = []
_dp = 0
# 覆盖约 38% 的房屋：只有实际发生装修的房屋才收押金，符合真实小区分布
for _h in HOUSES:
    if R3.random() > 0.38:
        continue
    _ow = _OWNER_OF.get(_h.get('ownerId') or '')
    _dp += 1
    _amount = 2000.0 if _h['area'] < 90 else (3000.0 if _h['area'] < 140 else 5000.0)
    if _h['usage'] != '住宅':
        _amount = 5000.0                                   # 商铺 / 办公统一 5000
    _status = r3_pickw([('已退还', 58), ('部分扣除', 12), ('已没收', 3), ('装修中', 17), ('已逾期', 10)])
    _check = None; _refund = 0.0; _refund_date = None; _deduct = 0.0; _reason = ''
    # 时间链必须自洽：缴费 < 开工 < 工期截止 < 验收 < 退款，且均不得晚于今天
    if _status in ('已退还', '部分扣除', '已没收'):
        _check = TODAY - timedelta(days=r3_i(15, 1080))             # 验收日：距今 15 天 ~ 3 年
        _over = r3_pickw([(0, 62), (r3_i(1, 30), 30), (r3_i(31, 90), 8)])   # 超期完工天数
        _plan_end = _check - timedelta(days=_over)
        _start = _plan_end - timedelta(days=r3_i(60, 150))
        _paid = _start - timedelta(days=r3_i(1, 7))
        if _status == '已退还':
            _refund = _amount
        elif _status == '部分扣除':
            _deduct = money(min(float(r3_pick([300, 500, 800, 1000, 1500])), _amount * 0.4))
            _refund = money(_amount - _deduct)
            _reason = r3_pick(_DEDUCT_REASON)
        else:
            _deduct = _amount; _refund = 0.0
            _reason = r3_pick(_FORFEIT_REASON)
        _refund_date = _check + timedelta(days=r3_i(1, 15))
        if _refund_date > TODAY:                            # 退款日不得晚于今天
            _refund_date = TODAY - timedelta(days=r3_i(0, 3))
        _refund_date = ds(_refund_date)
    elif _status == '已逾期':
        _plan_end = TODAY - timedelta(days=r3_i(1, 180))    # 工期已过但未验收
        _start = _plan_end - timedelta(days=r3_i(60, 150))
        _paid = _start - timedelta(days=r3_i(1, 7))
    else:                                                   # 装修中：工期还没到
        _start = TODAY - timedelta(days=r3_i(5, 90))
        _span = r3_i(max(60, (TODAY - _start).days + 10), 180)
        _plan_end = _start + timedelta(days=_span)
        _paid = _start - timedelta(days=r3_i(1, 7))

    _balance = money(_amount - _refund - _deduct)
    _overdue = 0
    if _status == '已逾期':
        _overdue = max(0, (TODAY - _plan_end).days)
    elif _check and _check > _plan_end:
        _overdue = (_check - _plan_end).days                # 超期完工天数

    DECORATION_DEPOSITS.append({
        'depositId': 'DP%05d' % _dp,
        'applyNo': 'ZX%d-%04d' % (_paid.year, _dp),
        'communityId': _h['communityId'],
        'communityName': _COMM_NAME.get(_h['communityId'], _h['communityId']),
        'houseId': _h['houseId'],
        'houseName': _h['fullName'],
        'ownerId': _h.get('ownerId') or '',
        'ownerName': _ow['name'] if _ow else '',
        'phone': _ow['phone'] if _ow else '',
        'type': '装修押金',                                  # 唯一押金类型（场景已收敛）
        'amount': money(_amount),
        'paidDate': ds(_paid),
        'startDate': ds(_start),
        'planEndDate': ds(_plan_end),
        'checkDate': ds(_check) if _check else None,
        'status': _status,
        'deductAmount': money(_deduct),
        'deductReason': _reason,
        'refundAmount': money(_refund),
        'refundDate': _refund_date,
        'balance': _balance,
        'overdueDays': _overdue,
        'operator': r3_pick(_OPERATORS),
        'remark': '',
    })
DECORATION_DEPOSITS.sort(key=lambda x: x['paidDate'], reverse=True)

# ============================================================ 补充批次（2026-10-22 收尾轮 · 独立随机流 SEED+61）
# 纪律：既有 29 张表零改动，本段只【新增】8 张表，供未执行事项的页面使用。
#   approvals 审批实例（C1 待办中心与审批处理）
#   collectionRecords 催缴记录（B1）、invoices 票据台账（B2）
#   meters / meterReadings 表具与抄表（B3）
#   attendance 月度考勤（C3）、operationLogs 操作日志（E3）
#   prepayAccounts 预存账户（B5）、maintenanceRecords 设备维保（D1）
R4 = random.Random(SEED + 61)

def r4_i(a, b): return R4.randint(a, b)
def r4_pick(seq): return R4.choice(seq)
def r4_pickw(pairs):
    x = R4.random() * sum(w for _, w in pairs); acc = 0.0
    for v, w in pairs:
        acc += w
        if x <= acc: return v
    return pairs[-1][0]

_EMP = [e for e in EMPLOYEES if e['status'] == '在职']
_EMP_NAME = [e['name'] for e in _EMP]
_EMP_BY_ID = {e['empId']: e for e in EMPLOYEES}
_LEADERS = [e['name'] for e in _EMP if e['position'] in ('项目经理', '客服主管', '工程主管', '财务主管')] or _EMP_NAME[:20]
_FINANCE = [e['name'] for e in _EMP if e['position'] in ('财务主管', '会计', '收银员')] or _EMP_NAME[:20]

# ---------- approvals：审批实例（不含合同 / 租约审批 —— Q2 口径未定，维持现状） ----------
# 四类场景：费用减免、报修验收、押金退还、公告发布
_APP_STATUS = r4_pickw
_APPROVALS = []
_ap = 0
_FLOW_TPL = {
    '费用减免': ['客服主管审核', '项目经理审批', '财务复核'],
    '报修验收': ['工程主管验收', '客服主管复核'],
    '押金退还': ['客服主管核实', '项目经理审批', '财务复核'],
    '公告发布': ['客服主管编辑', '项目经理审批'],
}
for _bt, _node_tpl in _FLOW_TPL.items():
    for _ in range(r4_i(18, 28)):
        _ap += 1
        _apply = TODAY - timedelta(days=r4_i(0, 60))
        if _bt == '费用减免':
            _src = r4_pick(BILLS)
            _title = '%s 费用减免 ¥%s' % (_src['houseName'] if _src.get('houseName') else _src['billId'], format(money(_src['payable'] * 0.2), ','))
            _amount = money(_src['payable'] * 0.2); _cm = _src['communityId']; _biz = _src['billId']
        elif _bt == '报修验收':
            _src = r4_pick([w for w in WORK_ORDERS if w['status'] in ('已完工', '已评价', '已关闭')])
            _title = '%s：%s' % (_src['houseName'] or _src['woNo'], _src['title'][:22])
            _amount = money(_src.get('totalFee') or 0); _cm = _src['communityId']; _biz = _src['woId']
        elif _bt == '押金退还':
            _src = r4_pick([d for d in DECORATION_DEPOSITS if d['status'] in ('已退还', '部分扣除')])
            _title = '%s 装修押金退还 ¥%s' % (_src['houseName'], format(_src['refundAmount'], ','))
            _amount = _src['refundAmount']; _cm = _src['communityId']; _biz = _src['depositId']
        else:
            _src = r4_pick(NOTICES)
            _title = '发布公告：%s' % _src['title'][:24]
            _amount = 0.0; _cm = _src['communityId']; _biz = _src['noticeId']
        _st = r4_pickw([('待审批', 26), ('审批中', 18), ('已通过', 38), ('已驳回', 12), ('已撤回', 6)])
        _flow = []; _cur = ''
        _t = _apply
        for _k, _node in enumerate(_node_tpl):
            _t = _t + timedelta(hours=r4_i(2, 48))
            if _st == '待审批' and _k == 0:
                _cur = _node; _flow.append({'node': _node, 'handler': '', 'action': '待处理', 'time': '', 'comment': ''})
                break
            if _st == '审批中' and _k == len(_node_tpl) - 1:
                _cur = _node; _flow.append({'node': _node, 'handler': '', 'action': '待处理', 'time': '', 'comment': ''})
                break
            if _st == '已驳回' and _k == len(_node_tpl) - 1:
                _flow.append({'node': _node, 'handler': r4_pick(_LEADERS), 'action': '驳回',
                              'time': _t.strftime('%Y-%m-%d %H:%M'), 'comment': r4_pick(['不符合减免条件', '材料不全，请补充', '金额超出授权范围'])})
                break
            if _st == '已撤回' and _k == 0:
                _flow.append({'node': _node, 'handler': r4_pick(_EMP_NAME), 'action': '撤回',
                              'time': _t.strftime('%Y-%m-%d %H:%M'), 'comment': '申请人撤回'})
                break
            _flow.append({'node': _node, 'handler': r4_pick(_LEADERS), 'action': '同意',
                          'time': _t.strftime('%Y-%m-%d %H:%M'), 'comment': r4_pick(['同意', '情况属实，同意', '已核实，同意', ''])})
        if _cur == '' and _st in ('待审批', '审批中'):
            _cur = _node_tpl[0]
        _APPROVALS.append({
            'approvalId': 'AP%05d' % _ap,
            'approvalNo': 'SP-%d-%04d' % (_apply.year, _ap),
            'bizType': _bt, 'bizId': _biz, 'title': _title,
            'communityId': _cm, 'communityName': _COMM_NAME.get(_cm, _cm),
            'amount': money(_amount),
            'applicant': r4_pick(_EMP_NAME),
            'applicantRole': r4_pick(['客服专员', '工程主管', '维修工', '客服主管']),
            'applyTime': _apply.strftime('%Y-%m-%d %H:%M'),
            'status': _st, 'currentNode': _cur if _st in ('待审批', '审批中') else '已完成',
            'urgency': r4_pickw([('普通', 78), ('紧急', 22)]),
            'waitHours': 0 if _st not in ('待审批', '审批中') else r4_i(1, 96),
            'flow': _flow,
        })
_APPROVALS.sort(key=lambda x: x['applyTime'], reverse=True)

# ---------- collectionRecords：催缴记录（B1） ----------
_DEBT_BILLS = [b for b in BILLS if b['unpaid'] > 0]
_HOUSE_NAME = {h['houseId']: h['fullName'] for h in HOUSES}
_HOUSE_CM = {h['houseId']: h['communityId'] for h in HOUSES}
_OWNER_NAME = {o['ownerId']: o['name'] for o in OWNERS}
_OWNER_PHONE = {o['ownerId']: o['phone'] for o in OWNERS}
COLLECTION_RECORDS = []
_cr = 0
_batch = 0
_METHOD = [('短信', 44), ('电话', 24), ('上门', 18), ('律师函', 8), ('公告催缴', 6)]
for _round in range(3):                                    # 三轮催缴：温和 → 加强 → 法务
    _batch += 1
    _batch_no = 'CJ2026%02d' % _batch
    _pool = _DEBT_BILLS if _round == 0 else [b for b in _DEBT_BILLS if b['overdueDays'] > 30 * _round]
    _pool = _pool[:r4_i(90, 140)]
    for _b in _pool:
        _cr += 1
        _m = r4_pickw(_METHOD) if _round < 2 else r4_pickw([('律师函', 45), ('上门', 35), ('电话', 20)])
        _t = TODAY - timedelta(days=r4_i(1, 20 + _round * 25))
        _st = r4_pickw([('已还款', 22), ('已承诺还款', 20), ('已送达', 30), ('已发送', 20), ('联系无效', 8)])
        COLLECTION_RECORDS.append({
            'recordId': 'CR%05d' % _cr,
            'batchNo': _batch_no, 'round': _round + 1,
            'billId': _b['billId'], 'period': _b['period'],
            'communityId': _b['communityId'], 'communityName': _COMM_NAME.get(_b['communityId'], _b['communityId']),
            'houseId': _b['houseId'], 'houseName': _HOUSE_NAME.get(_b['houseId'], _b['houseId']),
            'ownerId': _b['ownerId'], 'ownerName': _OWNER_NAME.get(_b['ownerId'], ''),
            'phone': _OWNER_PHONE.get(_b['ownerId'], ''),
            'itemName': _b['itemName'],
            'amount': money(_b['unpaid']), 'overdueDays': _b['overdueDays'],
            'method': _m, 'status': _st,
            'operator': r4_pick(_FINANCE + _EMP_NAME[:40]),
            'collectTime': _t.strftime('%Y-%m-%d %H:%M'),
            'promiseDate': ds(_t + timedelta(days=r4_i(3, 20))) if _st == '已承诺还款' else None,
            'remark': r4_pick(['业主表示近期缴纳', '电话无人接听', '业主对费用有异议', '已上门沟通',
                               '业主承诺月底前缴清', '长期空置，需跟进', '']) if _st != '已还款' else '已缴清',
        })
COLLECTION_RECORDS.sort(key=lambda x: x['collectTime'], reverse=True)

# ---------- invoices：票据台账（B2） ----------
INVOICES = []
_iv = 0
for _p in PAYMENTS:
    if R4.random() > 0.13:                                  # 约 13% 的收款开票，符合真实开票率
        continue
    _iv += 1
    _kind = r4_pickw([('电子发票', 62), ('增值税普通发票', 22), ('收据', 16)])
    _t = _p['payTime'] + ' ' + '%02d:%02d' % (r4_i(8, 19), r4_i(0, 59))
    _st = r4_pickw([('已开具', 88), ('已红冲', 7), ('开具失败', 5)])
    _amt = money(_p['amount'])
    INVOICES.append({
        'invoiceId': 'IV%06d' % _iv,
        'invoiceNo': ('0264' + str(r4_i(10000000, 99999999))) if _kind != '收据' else ('SJ%08d' % r4_i(10000000, 99999999)),
        'type': _kind, 'status': _st,
        'payId': _p['payId'], 'billId': _p['billId'],
        'communityId': _HOUSE_CM.get(_p['houseId'], 'P01'),
        'communityName': _COMM_NAME.get(_HOUSE_CM.get(_p['houseId'], 'P01'), 'P01'),
        'houseId': _p['houseId'], 'houseName': _HOUSE_NAME.get(_p['houseId'], _p['houseId']),
        'ownerId': _p['ownerId'], 'ownerName': _OWNER_NAME.get(_p['ownerId'], ''),
        'itemName': r4_pick(['物业服务费', '车位服务费', '水费', '电费']),
        'amount': _amt,
        'taxAmount': money(_amt * 0.06) if _kind != '收据' else 0.0,
        'issueTime': _t, 'issuer': r4_pick(_FINANCE),
        'channel': r4_pickw([('线上自助', 58), ('前台开具', 42)]),
        'redReason': r4_pick(['业主要求拆分票据', '金额录入错误', '票据类型开错']) if _st == '已红冲' else '',
        'redTime': (TODAY - timedelta(days=r4_i(1, 40))).strftime('%Y-%m-%d') if _st == '已红冲' else '',
        'failReason': '税控设备离线，请稍后重试' if _st == '开具失败' else '',
    })
INVOICES.sort(key=lambda x: x['issueTime'], reverse=True)

# ---------- meters / meterReadings：表具与抄表（B3） ----------
METERS = []
_mt = 0
for _h in HOUSES:
    if R4.random() > 0.35:
        continue
    for _ty, _unit in (('水表', '吨'), ('电表', '度')):
        if R4.random() > 0.72:
            continue
        _mt += 1
        _base = r4_i(120, 2600) if _ty == '水表' else r4_i(1500, 12000)
        METERS.append({
            'meterId': 'MT%05d' % _mt,
            'meterNo': ('S%d' if _ty == '水表' else 'D%d') % (90000 + _mt),
            'type': _ty, 'unit': _unit,
            'communityId': _h['communityId'], 'communityName': _COMM_NAME.get(_h['communityId'], _h['communityId']),
            'houseId': _h['houseId'], 'houseName': _h['fullName'],
            'ownerId': _h.get('ownerId') or '', 'ownerName': _OWNER_NAME.get(_h.get('ownerId') or '', ''),
            'itemId': 'FI05' if _ty == '水表' else 'FI06',
            'itemName': '水费' if _ty == '水表' else '电费',
            'installDate': ds(TODAY - timedelta(days=r4_i(400, 2500))),
            'lastReading': _base, 'lastReadDate': '2026-07-31',
            'status': r4_pickw([('正常', 88), ('故障', 6), ('已停用', 6)]),
            'factor': 1.0,
        })
METER_READINGS = []
_rd = 0
_PERIODS3 = ['2026-08', '2026-09', '2026-10']
for _m in METERS:
    _cur = _m['lastReading']
    for _pi, _p in enumerate(_PERIODS3):
        _rd += 1
        _last = _cur
        _usage = r4_i(4, 28) if _m['type'] == '水表' else r4_i(60, 420)
        if _m['status'] == '已停用':
            _usage = 0
        _cur = _last + _usage
        _day = {'2026-08': '2026-08-01', '2026-09': '2026-09-01', '2026-10': '2026-10-01'}[_p]
        _is_last = _pi == len(_PERIODS3) - 1
        METER_READINGS.append({
            'readingId': 'RD%06d' % _rd,
            'meterId': _m['meterId'], 'meterNo': _m['meterNo'], 'type': _m['type'], 'unit': _m['unit'],
            'period': _p, 'communityId': _m['communityId'], 'communityName': _m['communityName'],
            'houseId': _m['houseId'], 'houseName': _m['houseName'],
            'ownerName': _m['ownerName'],
            'lastReading': _last, 'currentReading': _cur, 'usage': _usage,
            'readDate': _day, 'reader': r4_pick(_EMP_NAME[:60]),
            'status': (r4_pickw([('待录入', 40), ('待复核', 26), ('已计费', 34)]) if _is_last else '已计费'),
            'abnormal': _usage > (330 if _m['type'] == '电表' else 24),
            'billId': ('BL%06d' % r4_i(1, len(BILLS))) if not _is_last else '',
        })
METER_READINGS.sort(key=lambda x: (x['period'], x['houseName']), reverse=True)

# ---------- attendance：月度考勤（C3） ----------
ATTENDANCE = []
_at = 0
_SHIFT = r4_pickw
for _e in EMPLOYEES:
    if _e['status'] != '在职':
        continue
    for _mi, _month in enumerate(['2026-08', '2026-09', '2026-10']):
        _at += 1
        _should = r4_i(21, 23)
        _late = r4_i(0, 4); _early = r4_i(0, 2); _absent = 0 if r4_i(0, 9) else r4_i(1, 2)
        _leave = r4_i(0, 3)
        _ot = r4_i(0, 36)
        _actual = max(0, _should - _absent - _leave)
        _bad = _late + _early + _absent
        ATTENDANCE.append({
            'attId': 'AT%05d' % _at,
            'empId': _e['empId'], 'empName': _e['name'], 'empNo': _e['empNo'],
            'orgId': _e['orgId'], 'position': _e['position'],
            'communityId': ('P01', 'P02', 'P03')[_mi % 3],
            'month': _month,
            'shift': _SHIFT([('行政班', 42), ('早班', 24), ('晚班', 20), ('轮班', 14)]),
            'shouldDays': _should, 'actualDays': _actual,
            'late': _late, 'earlyLeave': _early, 'absent': _absent, 'leaveDays': _leave,
            'overtimeHours': _ot,
            'attRate': round(_actual / _should * 100, 1) if _should else 0.0,
            'status': '异常' if _bad >= 3 else ('待确认' if _bad else '正常'),
            'appealCount': r4_i(1, 2) if _bad >= 3 and r4_i(0, 2) == 0 else 0,
            'appealResult': r4_pick(['申诉通过', '申诉驳回', '待处理']) if _bad >= 3 and r4_i(0, 2) == 0 else '',
        })

# 后处理：收紧「异常 / 待确认」口径 ——
#   异常：有旷工，或迟到+早退+旷工累计 ≥5 次；申诉只挂在异常记录上
#   待确认：累计 3~4 次（有异常苗头，需员工核对）；其余为正常
# 注意：此段不消耗任何随机数，保证 R4 流与后续表（operationLogs / prepayAccounts / maintenanceRecords）零影响。
for _a in ATTENDANCE:
    _b = _a['late'] + _a['earlyLeave'] + _a['absent']
    _a['status'] = '异常' if (_a['absent'] > 0 or _b >= 5) else ('待确认' if _b >= 3 else '正常')
    if _a['status'] != '异常':
        _a['appealCount'] = 0
        _a['appealResult'] = ''

# ---------- operationLogs：操作日志（E3） ----------
OPERATION_LOGS = []
_lg = 0
_LOG_TPL = [
    ('A 资产', ['新增业主', '编辑房屋', '导出业主档案', '绑定车位']),
    ('B 费用', ['生成账单', '收款入账', '开具发票', '费用减免', '导出报表']),
    ('C 办公', ['发布公告', '新建合同', '提交审批', '考勤申诉']),
    ('D 物联', ['设备巡检', '处理告警', '同步门禁']),
    ('E 底座', ['修改角色权限', '登录系统', '修改参数配置', '下载导出文件']),
    ('F 现场', ['派发工单', '完成巡检', '提交品质检查']),
]
for _ in range(420):
    _lg += 1
    _mod, _acts = r4_pick(_LOG_TPL)
    _ok = r4_i(0, 24) != 0
    _t = TODAY - timedelta(days=r4_i(0, 30), hours=r4_i(0, 23), minutes=r4_i(0, 59))
    OPERATION_LOGS.append({
        'logId': 'LG%06d' % _lg,
        'operator': r4_pick(_EMP_NAME), 'operatorEmpId': r4_pick(_EMP)['empId'],
        'module': _mod, 'action': r4_pick(_acts),
        'target': r4_pick(['OW%05d' % r4_i(1, 682), 'BL%06d' % r4_i(1, 4884), 'WO%06d' % r4_i(1, 150), 'NT%04d' % r4_i(1, 106)]),
        'ip': '10.0.%d.%d' % (r4_i(1, 60), r4_i(2, 250)),
        'time': _t.strftime('%Y-%m-%d %H:%M:%S'),
        'result': '成功' if _ok else '失败',
        'detail': '' if _ok else r4_pick(['无权限：当前角色未开通该操作位', '参数校验未通过', '目标记录不存在', '服务超时']),
    })
OPERATION_LOGS.sort(key=lambda x: x['time'], reverse=True)

# ---------- prepayAccounts：预存账户（B5） ----------
PREPAY_ACCOUNTS = []
_pa = 0
for _o in OWNERS:
    if R4.random() > 0.2:
        continue
    _pa += 1
    _recharge = money(r4_pick([500, 1000, 2000, 3000, 5000]))
    _deduct = money(min(_recharge, r4_i(0, int(_recharge))))
    PREPAY_ACCOUNTS.append({
        'accountId': 'PA%05d' % _pa,
        'ownerId': _o['ownerId'], 'ownerName': _o['name'], 'phone': _o['phone'],
        'communityId': _o.get('communityId') or 'P01',
        'houseId': (_o['houseIds'][0] if _o.get('houseIds') else ''),
        'houseName': _HOUSE_NAME.get(_o['houseIds'][0], '') if _o.get('houseIds') else '',
        'balance': money(_recharge - _deduct),
        'totalRecharge': _recharge, 'totalDeduct': _deduct,
        'lastRechargeDate': ds(TODAY - timedelta(days=r4_i(5, 500))),
        'lastDeductDate': ds(TODAY - timedelta(days=r4_i(1, 200))) if _deduct else None,
        'status': r4_pickw([('正常', 84), ('冻结', 8), ('已销户', 8)]),
        'autoDeduct': R4.random() < 0.6,
    })

# ---------- maintenanceRecords：设备维保（D1） ----------
MAINTENANCE_RECORDS = []
_mr = 0
for _d in DEVICES:
    for _ in range(r4_i(1, 3)):
        _mr += 1
        _ty = r4_pickw([('日常保养', 56), ('故障维修', 28), ('年检', 16)])
        _plan = TODAY - timedelta(days=r4_i(-40, 600))
        _done = _plan < TODAY - timedelta(days=1)
        _st = (r4_pickw([('已完成', 82), ('已逾期', 10), ('待跟进', 8)]) if _done
               else r4_pickw([('计划中', 70), ('待派工', 30)]))
        MAINTENANCE_RECORDS.append({
            'recordId': 'MR%05d' % _mr,
            'deviceId': _d['deviceId'], 'deviceName': _d['name'], 'deviceCode': _d['deviceCode'],
            'communityId': _d['communityId'], 'communityName': _COMM_NAME.get(_d['communityId'], _d['communityId']),
            'type': _ty,
            'planDate': ds(_plan),
            'actualDate': ds(_plan + timedelta(days=r4_i(0, 6))) if _st == '已完成' else None,
            'vendor': _d.get('vendor') or r4_pick(['大华股份', '海康威视', '青云智能', '本地维保商']),
            'engineer': r4_pick(_EMP_NAME[:60]),
            'cost': money(r4_i(0, 20) * 50 + 100) if _st == '已完成' else 0.0,
            'result': r4_pick(['运行正常', '更换配件后恢复', '需二次跟进', '清洁除尘、紧固接线']) if _st == '已完成' else '',
            'status': _st,
            'nextDate': ds(_plan + timedelta(days=180)),
            'remark': '',
        })
MAINTENANCE_RECORDS.sort(key=lambda x: x['planDate'], reverse=True)

print('  [SEED+61] 审批 %d / 催缴 %d / 票据 %d / 表具 %d / 抄表 %d / 考勤 %d / 日志 %d / 预存 %d / 维保 %d'
      % (len(_APPROVALS), len(COLLECTION_RECORDS), len(INVOICES), len(METERS), len(METER_READINGS),
         len(ATTENDANCE), len(OPERATION_LOGS), len(PREPAY_ACCOUNTS), len(MAINTENANCE_RECORDS)))

# ============================================================ 输出
DATA = {
    'orgs': ORGS, 'communities': COMMUNITIES, 'buildings': BUILDINGS, 'units': UNITS, 'houses': HOUSES,
    'owners': OWNERS, 'members': MEMBERS, 'tenants': TENANTS, 'parkings': PARKINGS, 'vehicles': VEHICLES,
    # 楼栋责任范围（2026-10-29 · 楼管按范围管业主资料与催缴）
    'buildingStewards': BUILDING_STEWARDS,
    'passRecords': PASS_RECORDS,
    'feeItems': FEE_ITEMS, 'bills': BILLS, 'payments': PAYMENTS, 'workOrders': WORK_ORDERS,
    'devices': DEVICES, 'alarms': ALARMS, 'inspectPlans': INSPECT_PLANS, 'inspectTasks': INSPECT_TASKS,
    'inspectTemplates': INSPECT_TEMPLATES, 'employees': EMPLOYEES, 'metrics': METRICS,
    # 补充批次（2026-10-22 追加 · 独立随机流 SEED+31，不动既有 22 张表）
    'contracts': CONTRACTS, 'notices': NOTICES, 'qualityChecks': QUALITY_CHECKS,
    # 补充批次（2026-10-22 E 域 · 独立随机流 SEED+41，orgs 仅追加班组）
    'roles': ROLES, 'permissions': PERMISSIONS,
    # 补充批次（2026-10-22 押金与权限 · 独立随机流 SEED+51：装修押金为唯一押金场景）
    'decorationDeposits': DECORATION_DEPOSITS,
    # 补充批次（2026-10-22 收尾轮 · 独立随机流 SEED+61：8 张新表，既有表零改动）
    'approvals': _APPROVALS, 'collectionRecords': COLLECTION_RECORDS, 'invoices': INVOICES,
    'meters': METERS, 'meterReadings': METER_READINGS, 'attendance': ATTENDANCE,
    'operationLogs': OPERATION_LOGS, 'prepayAccounts': PREPAY_ACCOUNTS,
    'maintenanceRecords': MAINTENANCE_RECORDS,
}
META = {'generatedAt': '2026-10-21', 'seed': SEED,
        'counts': {k: len(v) if isinstance(v, list) else 'object' for k, v in DATA.items()}}

for k, v in DATA.items():
    with open(os.path.join(OUT, k + '.json'), 'w', encoding='utf-8') as f:
        json.dump(v, f, ensure_ascii=False)
with open(os.path.join(OUT, '_meta.json'), 'w', encoding='utf-8') as f:
    json.dump(META, f, ensure_ascii=False, indent=1)

# index.js（ESM，供 Vue 项目直接 import）
names = list(DATA.keys())
idx = ['// 智慧物业 V2 演示数据集 · 自动生成，勿手改（改 seed_dataset.py 后重跑）',
       '// 用法：import { houses, owners } from "@/mock"', '']
for n in names:
    idx.append('import %s from "./%s.json";' % (n, n))
idx.append('')
idx.append('export { %s };' % ', '.join(names))
idx.append('export const meta = %s;' % json.dumps(META, ensure_ascii=False))
idx.append('')
idx.append('export default { %s, meta };' % ', '.join(names))
open(os.path.join(OUT, 'index.js'), 'w', encoding='utf-8').write('\n'.join(idx))

print('=== 生成完成 ===')
for k, v in DATA.items():
    print('  %-18s %s' % (k, len(v) if isinstance(v, list) else 'dict'))
print('\n关键校验：')
print('  房屋 %d / 业主 %d / 车位 %d / 车辆 %d' % (len(HOUSES), len(OWNERS), len(PARKINGS), len(VEHICLES)))
print('  账单 %d 条，总额 ¥%s' % (len(BILLS), format(money(sum(b['payable'] for b in BILLS)), ',')))
print('  本期(2026-10)应收 ¥%s，已收 ¥%s，收缴率 %.1f%%' % (format(money(cur_amt), ','), format(money(cur_paid), ','), pct(cur_paid, cur_amt)))
print('  逾期 %d 笔，欠费 ¥%s' % (overdue_cnt, format(money(overdue_amt), ',')))
print('  空置 %d 套，空置率 %.1f%%' % (vacant, pct(vacant, total_house)))
_dp_amt = money(sum(x['amount'] for x in DECORATION_DEPOSITS))
_dp_ref = money(sum(x['refundAmount'] for x in DECORATION_DEPOSITS))
_dp_ded = money(sum(x['deductAmount'] for x in DECORATION_DEPOSITS))
_dp_bal = money(sum(x['balance'] for x in DECORATION_DEPOSITS))
print('  装修押金 %d 笔：收 ¥%s / 退 ¥%s / 扣 ¥%s / 在账 ¥%s'
      % (len(DECORATION_DEPOSITS), format(_dp_amt, ','), format(_dp_ref, ','),
         format(_dp_ded, ','), format(_dp_bal, ',')))
print('  权限码 %d 条（新增 5 条：资产驾驶舱 / 业主360 / 巡检执行 / 报表中心 / 下载中心）'
      % len(PERMISSIONS))
tb = next(o for o in OWNERS if o['name'] == '张建国')
for nm in ['张建国', '李秀兰', '王浩然', '赵春梅']:
    o = next(x for x in OWNERS if x['name'] == nm)
    up = money(sum(b['unpaid'] for b in BILLS if b['ownerId'] == o['ownerId']))
    od = max([b['overdueDays'] for b in BILLS if b['ownerId'] == o['ownerId']] or [0])
    print('  [演示] %-4s %s：%d 房 / %d 车位 / 欠费 ¥%s / 最长逾期 %d 天'
          % (nm, o['ownerId'], len(o['houseIds']), len(o['parkIds']), format(up, ','), od))
    for pd_ in o['parkIds']:
        pk = next(x for x in PARKINGS if x['parkId'] == pd_)
        print('         车位 %s 车牌 %s 到期 %s' % (pk['parkNo'], pk['plateNo'], pk['expireDate']))
