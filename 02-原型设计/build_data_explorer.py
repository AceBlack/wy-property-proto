# -*- coding: utf-8 -*-
"""生成《演示数据集浏览器》：实体关系、字段字典、采样数据、演示剧本、数据口径"""
import json, os, html
D = os.path.dirname(os.path.abspath(__file__))
M = os.path.join(D, 'mock')

ENTITIES = ['orgs', 'communities', 'buildings', 'units', 'houses', 'owners', 'members', 'tenants',
            'parkings', 'vehicles', 'feeItems', 'bills', 'payments', 'workOrders', 'devices',
            'alarms', 'inspectPlans', 'inspectTasks', 'inspectTemplates', 'employees']

EN_NAME = {
    'orgs': '组织', 'communities': '项目/小区', 'buildings': '楼栋', 'units': '单元', 'houses': '房屋',
    'owners': '业主', 'members': '家庭成员', 'tenants': '租户', 'parkings': '车位', 'vehicles': '车辆',
    'feeItems': '收费项目', 'bills': '账单', 'payments': '缴费记录', 'workOrders': '工单',
    'devices': '设备', 'alarms': '告警', 'inspectPlans': '巡检计划', 'inspectTasks': '巡检任务',
    'inspectTemplates': '巡检表单模板', 'employees': '员工', 'metrics': '看板聚合指标',
}

FIELD = {
    'orgId': '组织ID', 'name': '名称', 'parentId': '上级组织', 'type': '类型', 'leader': '负责人', 'sort': '排序',
    'communityId': '项目ID', 'bizType': '业态', 'address': '地址', 'buildYear': '建成年份',
    'deliverDate': '交付日期', 'landArea': '占地面积', 'buildArea': '建筑面积', 'greenRate': '绿化率',
    'plotRatio': '容积率', 'manager': '项目经理', 'phone': '电话', 'houseCount': '房屋数', 'parkCount': '车位数',
    'propertyFee': '物业费标准', 'feeUnit': '计费单位', 'status': '状态', 'contractStart': '合同开始', 'contractEnd': '合同结束',
    'buildingId': '楼栋ID', 'buildingNo': '楼栋号', 'usage': '用途', 'unitCount': '单元数', 'floorCount': '层数',
    'structure': '结构', 'hasElevator': '有电梯', 'unitId': '单元ID', 'unitNo': '单元号', 'housePerFloor': '每层户数',
    'elevatorCount': '电梯数', 'houseId': '房屋ID', 'room': '房号', 'floor': '楼层', 'seq': '同层序号',
    'fullName': '完整名称', 'shortName': '短编码', 'houseType': '户型', 'area': '建筑面积', 'innerArea': '套内面积',
    'orientation': '朝向', 'decoration': '装修', 'deliverStatus': '交付状态', 'useStatus': '使用状态',
    'propertyStatus': '产权状态', 'ownerId': '业主ID', 'tenantId': '租户ID', 'checkinDate': '入住日期', 'certNo': '产权证号',
    'ownerType': '业主类型', 'certified': '已认证', 'faceRegistered': '已录人脸', 'appRegistered': '已注册App',
    'wechatBound': '已绑微信', 'gender': '性别', 'birthday': '生日', 'idCard': '身份证', 'email': '邮箱',
    'emergencyContact': '紧急联系人', 'emergencyPhone': '紧急联系电话', 'houseIds': '名下房屋', 'parkIds': '名下车位',
    'tags': '标签', 'creditLevel': '信用等级', 'registerDate': '建档日期', 'remark': '备注',
    'memberId': '成员ID', 'relation': '关系', 'isOwnerAppUser': '独立App用户',
    'leaseStart': '租期开始', 'leaseEnd': '租期结束', 'rent': '月租金',
    'parkId': '车位ID', 'parkNo': '车位编号', 'zone': '区域', 'parkType': '地上/地下', 'category': '车位类别',
    'bindStatus': '绑定状态', 'plateNo': '车牌', 'feeStandard': '管理费标准', 'expireDate': '到期日',
    'chargePile': '充电桩', 'vehicleId': '车辆ID', 'vehicleType': '车辆类型', 'brand': '品牌', 'color': '颜色',
    'cardNo': '卡号', 'authStatus': '授权状态', 'inOutType': '通行类型',
    'itemId': '科目ID', 'itemName': '科目名称', 'category': '科目类别', 'calcType': '计费方式', 'price': '单价',
    'unit': '单位', 'cycle': '计费周期', 'taxRate': '税率',
    'billId': '账单ID', 'period': '账期', 'quantity': '计费量', 'amount': '应收金额', 'lateFee': '滞纳金',
    'discount': '减免', 'payable': '应缴合计', 'paidAmount': '已缴金额', 'unpaid': '欠费', 'dueDate': '缴费截止',
    'overdueDays': '逾期天数', 'payTime': '缴费时间', 'payMethod': '缴费方式', 'invoiceNo': '票据号',
    'createTime': '生成时间', 'meterReading': '本期读数', 'lastReading': '上期读数',
    'payId': '缴费ID', 'transNo': '交易流水', 'operator': '操作员', 'invoiceStatus': '开票状态', 'channel': '支付渠道',
    'woId': '工单ID', 'woNo': '工单号', 'houseName': '位置/房屋', 'ownerName': '业主姓名', 'ownerPhone': '业主电话',
    'title': '标题', 'description': '描述', 'images': '图片数', 'priority': '优先级', 'source': '来源',
    'dispatchMode': '派单方式', 'assignee': '处理人', 'assigneePhone': '处理人电话', 'acceptTime': '接单时间',
    'arriveTime': '到场时间', 'finishTime': '完工时间', 'durationHours': '耗时', 'slaHours': 'SLA时限',
    'isOverdue': '已超时', 'feeType': '收费/免费', 'materialFee': '材料费', 'laborFee': '工时费', 'totalFee': '合计',
    'payStatus': '支付状态', 'score': '评分', 'evalTags': '评价标签', 'evaluate': '评价内容', 'isPublic': '公共区域',
    'deviceId': '设备ID', 'deviceCode': '设备编码', 'brand': '品牌', 'model': '型号', 'online': '在线',
    'lastHeartbeat': '最后心跳', 'ip': 'IP', 'firmware': '固件版本', 'installDate': '安装日期',
    'warrantyEnd': '保修截止', 'location': '安装位置', 'vendor': '厂商', 'qrCode': '二维码', 'maintainCycle': '维保周期',
    'nextMaintain': '下次维保', 'alarmCount': '告警次数',
    'alarmId': '告警ID', 'deviceName': '设备名称', 'level': '等级', 'content': '内容', 'occurTime': '发生时间',
    'handleBy': '处理人', 'handleTime': '处理时间', 'dispatchWoId': '派发工单', 'duration': '处理时长(分)',
    'planId': '计划ID', 'planName': '计划名称', 'post': '岗位', 'cycle': '周期', 'templateId': '表单模板',
    'executor': '执行人', 'items': '检查项数', 'taskId': '任务ID', 'scheduledDate': '计划日期',
    'scheduledTime': '计划时间', 'doneTime': '完成时间', 'itemCount': '应检项', 'normalCount': '正常项',
    'issueCount': '问题项', 'photos': '照片数', 'checkinType': '到位方式', 'checkedIn': '已到位', 'gps': '定位',
    'reviewer': '复核人', 'reviewScore': '复核得分', 'reviewTime': '复核时间', 'refWoId': '转出工单',
    'templateId': '模板ID', 'version': '版本', 'fields': '字段定义', 'label': '字段名', 'required': '必填',
    'standard': '标准', 'options': '选项', 'visibleWhen': '显示条件', 'min': '最小', 'max': '最大',
    'empId': '员工ID', 'empNo': '工号', 'orgId': '所属组织', 'position': '岗位', 'level': '职级',
    'empType': '用工类型', 'entryDate': '入职日期', 'regularDate': '转正日期', 'contractStart': '合同开始',
    'contractEnd': '合同结束', 'probationMonths': '试用期(月)', 'baseSalary': '基本工资', 'monthlySalary': '月薪合计',
    'bankCard': '银行卡', 'socialSecurity': '缴社保', 'certificates': '证书', 'attendance': '考勤', 'score': '绩效分',
    'manager': '直属上级', 'expire': '到期日', 'no': '编号', 'late': '迟到次数', 'leaveDays': '请假天数',
    'overtimeHours': '加班小时',
}

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:#F2F3F5;
 color:#303133;font-size:14px;line-height:1.6}
.wrap{max-width:1400px;margin:0 auto;padding:0 24px 80px}
header{background:#fff;border-bottom:1px solid #EBEEF5;padding:26px 0 22px;margin-bottom:22px}
header .inner{max-width:1400px;margin:0 auto;padding:0 24px}
h1{font-size:24px;font-weight:500}.sub{color:#909399;font-size:13px;margin-top:6px}
.stats{display:flex;gap:12px;margin-top:16px;flex-wrap:wrap}
.stat{background:#F5F7FA;border-radius:8px;padding:10px 16px;min-width:104px}
.stat b{display:block;font-size:20px;font-weight:500;color:#409EFF;font-family:'SF Mono',Menlo,monospace}
.stat span{font-size:12px;color:#909399}
.layout{display:flex;gap:24px;align-items:flex-start}
nav{position:sticky;top:16px;width:196px;flex:none;background:#fff;border-radius:8px;padding:10px;
 box-shadow:0 1px 3px rgba(0,0,0,.06);max-height:calc(100vh - 40px);overflow:auto}
nav a{display:block;padding:6px 10px;color:#606266;text-decoration:none;font-size:12.5px;border-radius:4px}
nav a:hover{background:#F5F7FA;color:#409EFF}
nav .g{font-size:11px;color:#C0C4CC;padding:10px 10px 4px}
main{flex:1;min-width:0}
section{background:#fff;border-radius:8px;padding:22px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h2{font-size:18px;font-weight:500;margin-bottom:6px;display:flex;align-items:center;gap:8px}
h2 .no{display:inline-flex;width:24px;height:24px;border-radius:6px;background:#409EFF;color:#fff;font-size:12px;
 align-items:center;justify-content:center}
h3{font-size:14px;font-weight:500;margin:18px 0 8px}
p{color:#606266;font-size:13px;margin:8px 0}.mut{color:#909399;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}
th,td{border:1px solid #EBEEF5;padding:6px 9px;text-align:left;vertical-align:top}
th{background:#F5F7FA;color:#606266;font-weight:500;white-space:nowrap}
td{color:#606266}tr:nth-child(even) td{background:#FAFAFA}
.k{font-family:'SF Mono',Menlo,Consolas,monospace;color:#303133;font-size:12px}
.num{font-family:'SF Mono',Menlo,Consolas,monospace}
details{margin-top:8px}summary{cursor:pointer;font-size:12.5px;color:#409EFF;padding:4px 0;outline:none}
pre{background:#F5F7FA;border:1px solid #EBEEF5;border-radius:6px;padding:10px 12px;overflow:auto;
 font-family:'SF Mono',Menlo,Consolas,monospace;font-size:11.5px;line-height:1.65;max-height:340px}
code{background:#F5F7FA;border-radius:3px;padding:1px 5px;font-family:'SF Mono',Menlo,monospace;font-size:12px;color:#E6A23C}
.note{background:#FDF6EC;border:1px solid #FAE1B0;border-radius:6px;padding:10px 14px;font-size:13px;
 color:#854F0B;margin:12px 0}.note b{font-weight:500}
.note.ok{background:#F0F9EB;border-color:#C2E7B0;color:#3B6D11}
.er{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px}
.er .box{border:1px solid #DCDFE6;border-radius:8px;padding:10px;background:#FAFBFC}
.er .box b{font-size:13px;font-weight:500;display:block;margin-bottom:4px}
.er .box .n{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:#409EFF}
.er .box .r{font-size:11px;color:#909399;margin-top:4px;line-height:1.5}
.pill{display:inline-block;background:#ECF5FF;color:#409EFF;border-radius:4px;padding:1px 7px;font-size:11.5px;margin:2px 3px 0 0}
.pill.g{background:#F0F9EB;color:#67C23A}.pill.o{background:#FDF6EC;color:#E6A23C}.pill.r{background:#FEF0F0;color:#F56C6C}
.card{border:1px solid #EBEEF5;border-radius:8px;padding:14px;margin-top:10px}
.card h4{font-size:14px;font-weight:500;margin-bottom:2px}
.gold{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:12px}
.gold .g{border:1px solid #DCDFE6;border-left:3px solid #409EFF;border-radius:8px;padding:12px}
.gold .g.r{border-left-color:#F56C6C}.gold .g.o{border-left-color:#E6A23C}.gold .g.gr{border-left-color:#67C23A}
.gold .g .nm{font-size:15px;font-weight:500;margin-bottom:2px}
.gold .g .ds{font-size:12px;color:#909399;margin-bottom:8px}
.gold .g .rw{font-size:12.5px;color:#606266;display:flex;gap:6px}
.gold .g .rw b{flex:none;width:66px;color:#909399;font-weight:400}
.steps{counter-reset:s;margin-top:10px}
.step{position:relative;padding-left:34px;margin-bottom:14px}
.step::before{counter-increment:s;content:counter(s);position:absolute;left:0;top:0;width:22px;height:22px;
 border-radius:50%;background:#409EFF;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center}
.step b{font-size:13.5px;font-weight:500}.step p{margin:2px 0 0;font-size:12.5px}
"""

# 同名字段在不同实体含义不同，按实体覆盖
OVERRIDE = {
    ('communities', 'manager'): '项目经理', ('employees', 'manager'): '直属上级',
    ('workOrders', 'score'): '满意度评分', ('employees', 'score'): '绩效分',
    ('alarms', 'level'): '告警等级', ('employees', 'level'): '职级',
    ('workOrders', 'type'): '工单类型', ('devices', 'type'): '设备类型',
    ('orgs', 'type'): '组织类型', ('communities', 'type'): '—',
    ('parkings', 'category'): '车位类别', ('feeItems', 'category'): '科目类别',
    ('bills', 'unit'): '计价单位', ('employees', 'unit'): '—',
    ('owners', 'phone'): '手机号', ('communities', 'phone'): '物业电话',
    ('inspectPlans', 'cycle'): '执行周期', ('feeItems', 'cycle'): '计费周期',
    ('owners', 'name'): '姓名', ('employees', 'name'): '姓名',
    ('inspectTemplates', 'name'): '模板名称', ('workOrders', 'name'): '—',
}

def esc(x): return html.escape(str(x))

def fmt_val(v):
    if isinstance(v, (list, dict)):
        s = json.dumps(v, ensure_ascii=False)
        return esc(s[:90] + ('…' if len(s) > 90 else ''))
    return esc(v)

# ---------- 载入统计与采样
meta = json.load(open(os.path.join(M, '_meta.json'), encoding='utf-8'))
data = {}
for e in ENTITIES:
    data[e] = json.load(open(os.path.join(M, e + '.json'), encoding='utf-8'))
metrics = json.load(open(os.path.join(M, 'metrics.json'), encoding='utf-8'))

# ---------- 1 概览
total_items = sum(len(v) for v in data.values())
er = [('项目 community', 'communities', '3', '翡翠城 / 锦绣家园 / 星光天地（2 住宅 + 1 商业）'),
      ('楼栋 building', 'buildings', str(len(data['buildings'])), 'belongs to 项目'),
      ('单元 unit', 'units', str(len(data['units'])), 'belongs to 楼栋'),
      ('房屋 house', 'houses', str(len(data['houses'])), '全系统主实体，所有业务围绕它'),
      ('业主 owner', 'owners', str(len(data['owners'])), '一人可多房；house.ownerId 关联'),
      ('车位 parking', 'parkings', str(len(data['parkings'])), 'ownerId + plateNo 绑定'),
      ('车辆 vehicle', 'vehicles', str(len(data['vehicles'])), '进出场与车闸授权对象'),
      ('账单 bill', 'bills', str(len(data['bills'])), 'houseId / parkId + period + itemId'),
      ('工单 workOrder', 'workOrders', str(len(data['workOrders'])), 'houseId 可空（公共区域）'),
      ('设备 device', 'devices', str(len(data['devices'])), '物联接入主体'),
      ('巡检任务 inspectTask', 'inspectTasks', str(len(data['inspectTasks'])), 'planId + templateId'),
      ('员工 employee', 'employees', str(len(data['employees'])), 'orgId + position + level')]
er_html = ''.join('<div class="box"><b>%s</b><div class="n">%s · %s 条</div><div class="r">%s</div></div>' % t for t in er)

S1 = """
<p>这份数据用于原型演示与评审，不是生产数据。所有实体用显式 ID 关联，<b>跨页数据一致</b>——不会出现「资产页说欠费 3200、收银台说 5800」。</p>
<div class="er">%s</div>
<div class="hr" style="height:1px;background:#EBEEF5;margin:16px 0"></div>
<h3>实体清单</h3>
<table><thead><tr><th>实体</th><th>中文</th><th>条数</th><th>主要字段（前 6）</th></tr></thead><tbody>%s</tbody></table>
<div class="note ok"><b>可复现：</b><code>seed_dataset.py</code> 使用固定随机种子 <code>20261021</code>，任何人重跑得到完全一致的数据。要改数据请改脚本再重跑，不要手改 JSON。</div>
""" % (er_html, ''.join(
    '<tr><td class="k">%s</td><td>%s</td><td class="num">%d</td><td class="k">%s</td></tr>'
    % (e, EN_NAME.get(e, e), len(data[e]), ', '.join(list(data[e][0].keys())[:6])) for e in ENTITIES))

# ---------- 2 演示剧本
def owner(n): return next(x for x in data['owners'] if x['name'] == n)
def owner_debt(oid): return round(sum(b['unpaid'] for b in data['bills'] if b.get('ownerId') == oid), 2)
def owner_maxod(oid): return max([b['overdueDays'] for b in data['bills'] if b.get('ownerId') == oid] + [0])
def house(hid): return next((x for x in data['houses'] if x['houseId'] == hid), None)
def park(pid): return next((x for x in data['parkings'] if x['parkId'] == pid), None)

gold = []
for nm, cls in [('张建国', ''), ('李秀兰', 'r'), ('王浩然', 'o'), ('赵春梅', 'gr')]:
    o = owner(nm)
    hs = [house(h) for h in o['houseIds']]
    ps = [park(p) for p in o['parkIds']]
    gold.append('<div class="g %s"><div class="nm">%s　<span class="k" style="font-size:12px">%s</span></div>'
                '<div class="ds">%s</div>'
                '<div class="rw"><b>房产</b><span>%s</span></div>'
                '<div class="rw"><b>车位</b><span>%s</span></div>'
                '<div class="rw"><b>欠费</b><span class="num" style="color:#F56C6C">¥ %s</span></div>'
                '<div class="rw"><b>最长逾期</b><span class="num">%d 天</span></div>'
                '<div class="rw"><b>手机</b><span class="num">%s</span></div></div>'
                % (cls, nm, o['ownerId'], o['remark'] or '—',
                   '；'.join(x['fullName'] + ('（%.2f㎡）' % x['area']) for x in hs if x) or '—',
                   '；'.join('%s %s 到期 %s' % (x['parkNo'], x['plateNo'], x['expireDate']) for x in ps if x) or '—',
                   '{:,.2f}'.format(owner_debt(o['ownerId'])), owner_maxod(o['ownerId']), o['phone']))

steps = [
    ('业主来电说「主卫漏水」', '客服搜手机号 13800138001 → 命中张建国 → 看到 2 套房 + 1 车位、欠费 ¥2,031、1 条在途工单 WO20260001（处理中）→ 点「新建工单」，房号与业主信息自动带入 → 选「入户维修 · 水管漏水」→ 系统给出预估费用区间'),
    ('业主到前台交费', '收银台搜「13800138001」→ 出业主卡片：2 套房 3 笔待缴 → 跨房产勾选合并结算 → 一次收款 ¥2,031.01，票据按房号分行 → 打印'),
    ('业主要换绑车牌', '业主 360 → 车位卡「川B·SFV7D 到期 2026-10-26」→ 点换绑 → 填新牌 → 校验占用 → 提交审批 → 审批通过下发车场 → 显示厂商回执'),
    ('催缴逾期大户', '欠费台账筛「逾期 > 180 天」→ 命中李秀兰（逾期 189 天，¥3,390）→ 生成催缴任务 → 短信 + 电话留痕 → 升级停服审批'),
    ('巡检发现问题转工单', '保洁日检 → 电梯轿厢环节「异常」→ 拍照 + 描述 → 一键转工单 → 工单来源标记「巡检」→ 进度回写任务卡片'),
]
S2 = """
<h3>四个固定演示对象（不走随机，保证每次演示一致）</h3>
<div class="gold">%s</div>
<div class="hr" style="height:1px;background:#EBEEF5;margin:18px 0"></div>
<h3>五个评审剧本 —— 原型必须能一屏走完</h3>
<div class="steps">%s</div>
<div class="note"><b>验收标准：</b>这五个剧本任何一条需要「切到别的菜单才能完成」，说明该页面没做完。例如剧本 2 如果需要退出收银台再去收费管理查账单，就是不合格。</div>
""" % (''.join(gold), ''.join('<div class="step"><b>%s</b><p>%s</p></div>' % (a, b) for a, b in steps))

# ---------- 3 字段字典
field_html = ''
for e in ENTITIES:
    rows = data[e]
    if not rows: continue
    keys = list(rows[0].keys())
    trs = ''
    for k in keys:
        sample = rows[0].get(k)
        cover = sum(1 for r in rows[:200] if r.get(k) not in (None, '', [], {}))
        cn = OVERRIDE.get((e, k)) or FIELD.get(k, '<span style="color:#C0C4CC">—</span>')
        trs += ('<tr><td class="k">%s</td><td>%s</td><td class="k">%s</td>'
                '<td class="k" style="color:#909399">%s</td><td class="num">%s</td></tr>'
                % (esc(k), cn,
                   esc(type(sample).__name__), fmt_val(sample),
                   ('%.0f%%' % (cover / min(200, len(rows)) * 100)) if rows else '-'))
    samp = json.dumps(rows[:2], ensure_ascii=False, indent=1)
    field_html += ('<div class="card"><h4>%s　<span class="k" style="font-size:12px;color:#909399">%s · %d 条</span></h4>'
                   '<table><thead><tr><th>字段</th><th>中文</th><th>类型</th><th>示例值</th><th>填充率</th></tr></thead>'
                   '<tbody>%s</tbody></table>'
                   '<details><summary>查看前 2 条原始 JSON</summary><pre>%s</pre></details></div>'
                   % (EN_NAME.get(e, e), e, len(rows), trs, esc(samp)))

S3 = """
<p class="mut">字段名为最终 API 契约候选，原型阶段先按此实现；后端确定后以接口文档为准。填充率基于前 200 条样本。</p>
%s
""" % field_html

# ---------- 4 口径
S4 = """
<div class="note"><b>口径不一致是评审时最容易吵起来的地方，这里先写死。</b>任何页面出现第二套算法，以本页为准。</div>
<table><thead><tr><th>指标 / 概念</th><th>口径</th><th>为什么</th></tr></thead><tbody>
<tr><td><b>欠费</b></td><td>已出账未收款金额（<code>bill.unpaid</code>），<b>不含未出账应收</b></td><td>把未来几个月的应收算进欠费，业主一查就吵架</td></tr>
<tr><td><b>逾期天数</b></td><td>按最早一期未缴账期的 <code>dueDate</code> 起算，不是按最后一期</td><td>否则长期欠费户的账龄被低估</td></tr>
<tr><td><b>收缴率</b></td><td>本期已收 ÷ 本期应收 × 100%，分母含减免与作废</td><td>分母剔除减免会让收缴率虚高</td></tr>
<tr><td><b>空置率</b></td><td>空置房屋 ÷ 房屋总数，<b>分母不含车位与配套用房</b></td><td>车位空置是另一个指标，混算无法指导经营</td></tr>
<tr><td><b>在册人口</b></td><td>按身份证去重，不以「房屋数 × 3」上报</td><td>一人多房会被重复统计</td></tr>
<tr><td><b>门禁 vs 车场</b></td><td>门禁记<b>人次</b>、车场记<b>车次</b>，<b>两者不能相加</b></td><td>量纲不同，相加没有业务含义</td></tr>
<tr><td><b>设备在线率</b></td><td>心跳超时阈值按设备类型区分（摄像头 3min、门禁 5min、表计 30min）</td><td>统一阈值会让低频上报的表计长期「离线」</td></tr>
<tr><td><b>房屋总数</b></td><td>= 楼栋 × 单元 × 层数 × 每层户数，本数据集 736</td><td>与项目卡片的 houseCount 必须一致</td></tr>
<tr><td><b>一人多房收费</b></td><td>按业主聚合，票据按房号分行，金额合并计一次</td><td>业主要求一张票，财务要求分房核算</td></tr>
<tr><td><b>工单是否超时</b></td><td>以 <code>createTime + slaHours</code> 判断，公共区域 24h、入户 12h</td><td>两类工单响应要求不同</td></tr>
</tbody></table>
<div class="hr" style="height:1px;background:#EBEEF5;margin:18px 0"></div>
<h3>脱敏规则（个人信息保护法硬要求）</h3>
<table><thead><tr><th>字段</th><th>列表默认</th><th>查看详情</th><th>导出</th></tr></thead><tbody>
<tr><td>手机号</td><td>138****8001</td><td>需二次验证并写日志</td><td>需审批</td></tr>
<tr><td>身份证</td><td>5101**********1234</td><td>需二次验证并写日志</td><td>需审批</td></tr>
<tr><td>银行卡</td><td>6222****1234</td><td>仅本人与财务主管</td><td>禁止导出</td></tr>
<tr><td>人脸 / 照片</td><td>不显示</td><td>仅门禁授权页，带水印</td><td>禁止导出</td></tr>
</tbody></table>
"""

# ---------- 5 使用
S5 = """
<h3>在 Vue 项目里使用</h3>
<pre>// 全量引入（原型阶段方便，生产请改用 API）
import { houses, owners, bills } from '@/mock'

// 按业主聚合欠费（业主 360 / 收银台都用它）
const debtOf = (ownerId) =>
  bills.filter(b => b.ownerId === ownerId && b.status !== '已缴')
       .reduce((s, b) => s + b.unpaid, 0)

// 一人多房：王浩然 3 套房
const wang = owners.find(o => o.name === '王浩然')
const hisHouses = houses.filter(h => wang.houseIds.includes(h.houseId))</pre>
<h3>各实体的典型用途</h3>
<table><thead><tr><th>页面</th><th>主要取数</th></tr></thead><tbody>
<tr><td>资产驾驶舱</td><td>houses / buildings / parkings / communities + metrics.asset</td></tr>
<tr><td>物联驾驶舱</td><td>devices / alarms + metrics.iot</td></tr>
<tr><td>费用驾驶舱</td><td>bills / payments / feeItems + metrics.fee</td></tr>
<tr><td>办公工作台</td><td>metrics.workbench + workOrders + inspectTasks</td></tr>
<tr><td>业主 360</td><td>owners + houses + members + parkings + vehicles + bills + workOrders（一次聚合）</td></tr>
<tr><td>PC 收银台</td><td>owners（检索）+ houses + bills（勾选结算）+ payments（写回）</td></tr>
<tr><td>报修工单</td><td>workOrders + houses + owners + feeItems</td></tr>
<tr><td>巡检执行</td><td>inspectPlans + inspectTasks + inspectTemplates</td></tr>
<tr><td>人力资源</td><td>employees + orgs</td></tr>
</tbody></table>
<div class="note"><b>性能提示：</b><code>bills.json</code> 约 2.4MB、<code>payments.json</code> 约 1.2MB。原型阶段按需 import 即可；正式开发请一律改为接口分页，不要把全量账单塞进前端。</div>
<h3>文件清单</h3>
<table><thead><tr><th>文件</th><th>说明</th></tr></thead><tbody>
<tr><td class="k">mock/*.json</td><td>21 个实体数据文件</td></tr>
<tr><td class="k">mock/index.js</td><td>统一导出，<code>import { houses } from '@/mock'</code></td></tr>
<tr><td class="k">mock/_meta.json</td><td>生成时间、随机种子、各实体条数</td></tr>
<tr><td class="k">seed_dataset.py</td><td>生成器（仓库外，不进前端项目）</td></tr>
<tr><td class="k">本页</td><td>字段字典、演示剧本、数据口径</td></tr>
</tbody></table>
"""

NAV = [('1', '概览与实体关系'), ('2', '演示剧本'), ('3', '字段字典'), ('4', '数据口径'), ('5', '使用方式')]
nav_html = ('<div class="g">数据集</div>' + ''.join('<a href="#s%s">%s %s</a>' % (i, i, n) for i, n in NAV)
            + '<div class="g">实体</div>' + ''.join('<a href="#e-%s">%s</a>' % (e, EN_NAME.get(e, e)) for e in ENTITIES))
# 给实体卡加锚点
field_html2 = field_html.replace('<div class="card"><h4>', '<div class="card" id="e-__E__"><h4>')
for e in ENTITIES:
    field_html2 = field_html2.replace('<div class="card" id="e-__E__">', '<div class="card" id="e-%s">' % e, 1)
S3 = S3.replace(field_html, field_html2)

HTML = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1400">
<title>智慧物业 V2 · 演示数据集</title><style>%s</style></head><body>
<header><div class="inner"><h1>智慧物业 V2 · 演示数据集</h1>
<div class="sub">跨页一致的原型数据 · 与《设计系统规范》《页面设计稿》配套使用 · 生成于 %s</div>
<div class="stats">
<div class="stat"><b>%d</b><span>实体</span></div>
<div class="stat"><b>%s</b><span>数据条数</span></div>
<div class="stat"><b>%d</b><span>房屋</span></div>
<div class="stat"><b>%d</b><span>业主</span></div>
<div class="stat"><b>%d</b><span>账单</span></div>
<div class="stat"><b>%d</b><span>车位</span></div>
<div class="stat"><b>6.6</b><span>MB</span></div>
</div></div></header>
<div class="wrap"><div class="layout"><nav>%s</nav><main>
%s%s%s%s%s
</main></div></div></body></html>""" % (CSS, meta['generatedAt'], len(ENTITIES), '{:,}'.format(total_items),
                                        len(data['houses']), len(data['owners']), len(data['bills']),
                                        len(data['parkings']), nav_html,
                                        '<section id="s1"><h2><span class="no">1</span>概览与实体关系</h2>%s</section>' % S1,
                                        '<section id="s2"><h2><span class="no">2</span>演示剧本</h2>%s</section>' % S2,
                                        '<section id="s3"><h2><span class="no">3</span>字段字典</h2>%s</section>' % S3,
                                        '<section id="s4"><h2><span class="no">4</span>数据口径</h2>%s</section>' % S4,
                                        '<section id="s5"><h2><span class="no">5</span>使用方式</h2>%s</section>' % S5)

open(os.path.join(D, '演示数据集.html'), 'w', encoding='utf-8').write(HTML)
open(os.path.join(D, 'dataset.html'), 'w', encoding='utf-8').write(HTML)
print('saved', len(HTML))
