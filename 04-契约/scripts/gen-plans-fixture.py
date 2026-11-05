"""生成契约样例 fixtures/dept-plans.json（部门计划）

数据取自 fixtures/orgs.json 与 fixtures/employees.json，保证计划里的
orgId / 提报人 / 项目归属与契约其他样例一致。
用法：python3 scripts/gen-plans-fixture.py
"""
import json
import os
import calendar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orgs = json.load(open(os.path.join(ROOT, 'fixtures/orgs.json'), encoding='utf-8'))
emps = {e['empId']: e for e in json.load(open(os.path.join(ROOT, 'fixtures/employees.json'), encoding='utf-8'))}
O = {o['orgId']: o for o in orgs}


def path_of(oid):
    chain = []
    cur = O.get(oid)
    while cur:
        chain.insert(0, cur['name'])
        cur = O.get(cur.get('parentId'))
    return ' / '.join(chain)


def project_of(oid):
    cur = O.get(oid)
    while cur:
        if cur['type'] == '项目':
            return cur['orgId']
        cur = O.get(cur.get('parentId'))
    return ''


def tpl_key(oid):
    if oid in ('O-P01', 'O-P02', 'O-P03'):
        return '项目'
    if oid.endswith('-T1'):
        return '客服'
    if oid.endswith('-T2'):
        return '工程'
    if oid.endswith('-T3'):
        return '安保'
    if oid.endswith('-T4'):
        return '环境'
    return '项目'


TPL = {
    '项目': [('月度收费目标达成', '当期应收收缴率 ≥ 92%，欠费清收完成当月任务', 30),
             ('安全生产零事故', '月度安全巡查全覆盖，隐患整改闭环率 100%', 25),
             ('客户满意度', '有效投诉 48 小时内响应，月度满意度 ≥ 90 分', 25),
             ('团队建设与培训', '完成 2 次岗位培训，员工流失率 ≤ 2%', 20)],
    '客服': [('报修受理及时率', '来电 3 声内接起，工单 10 分钟内派单', 30),
             ('投诉闭环', '一般投诉 48 小时内回访，重复投诉率 ≤ 3%', 30),
             ('档案与台账', '业主信息完整率 ≥ 98%，当月新增档案 100% 归档', 20),
             ('服务礼仪检查', '每周抽检 1 次，问题当场纠正并记录', 20)],
    '工程': [('设备设施巡检', '按巡检计划完成率 100%，发现隐患当日上报', 30),
             ('维修及时率', '一般维修 24 小时内完工，及时率 ≥ 95%', 30),
             ('公共能耗管控', '公共电耗环比不高于上月 5%', 20),
             ('工具与备件管理', '月底盘点一次，账实相符率 100%', 20)],
    '环境': [('保洁质量标准', '公共区域每日两扫，抽检合格率 ≥ 95%', 30),
             ('绿化养护', '修剪、施肥按季节计划执行，无枯死植株', 25),
             ('垃圾分类与清运', '垃圾日产日清，分类正确率 ≥ 90%', 25),
             ('物料与设备', '清洁设备保养到位，物料消耗不超预算 5%', 20)],
    '安保': [('门岗与访客管理', '外来人员登记率 100%，无未登记入内', 30),
             ('巡逻到位率', '按时段巡逻，漏巡点为 0', 30),
             ('消防设施检查', '灭火器、消火栓月度全覆盖检查', 25),
             ('应急演练', '组织 1 次消防或突发事件演练', 15)],
}


def month_end(m):
    y, mm = map(int, m.split('-'))
    return '%d-%02d-%02d' % (y, mm, calendar.monthrange(y, mm)[1])


def status_of(p):
    if p >= 100:
        return '已完成'
    return '未开始' if p == 0 else '进行中'


def mk(pid, month, oid, status, day, progress=None, scores=None):
    emp = emps[O[oid]['leaderEmpId']]
    end = month_end(month)
    rows = TPL[tpl_key(oid)]
    tasks = []
    for i, (n, s, w) in enumerate(rows):
        p = (progress or [0, 0, 0, 0])[i]
        sc = (scores or [0, 0, 0, 0])[i]
        tasks.append({
            'taskId': '%s-T%02d' % (pid, i + 1), 'name': n, 'standard': s, 'dueDate': end,
            'weight': w, 'files': [], 'progress': p, 'execStatus': status_of(p),
            'finishAt': ('%s-%02d' % (month, min(day + 5 + i, 28))) if p >= 100 else '',
            'remark': '', 'score': float(sc), 'evalRemark': ''
        })
    home = emp['orgId']
    total_w = sum(t['weight'] for t in tasks)
    finish = round(sum(t['weight'] * t['progress'] for t in tasks) / 100, 1)
    score = round(sum(t['score'] * t['weight'] for t in tasks) / 100, 1) if status == '已结案' else 0
    return {
        'planId': pid, 'planMonth': month, 'orgId': oid, 'orgName': O[oid]['name'],
        'orgPath': path_of(oid), 'orgType': O[oid]['type'], 'projectId': project_of(oid),
        'headcount': 12,
        'submitterEmpId': emp['empId'], 'submitterName': emp['name'],
        'submitterPosition': emp['position'],
        'submitterDuty': '正职' if oid == home else '兼管',
        'submitterOrgId': home, 'submitterOrgName': O.get(home, {}).get('name', ''),
        'submitAt': '%s-%02d 09:20' % (month, day), 'status': status,
        'oaId': 'AP00097' if status == '审批中' else '',
        'approveAt': '', 'approveBy': '', 'approveNote': '', 'summary': '',
        'tasks': tasks, 'weightTotal': total_w, 'finishRate': finish,
        'score': score, 'grade': '', 'evalAt': '', 'evalBy': '',
        'logs': [{'at': '%s-%02d 09:20' % (month, day), 'by': emp['name'],
                  'action': '提报计划', 'note': '以%s负责人身份提报' % O[oid]['name']}]
    }


plans = [
    mk('PL202610001', '2026-10', 'O-P01', '审批中', 3),
    mk('PL202610002', '2026-10', 'O-P02', '执行中', 4, progress=[100, 50, 30, 0]),
    mk('PL202610003', '2026-10', 'O-P01-T4', '草稿', 5),
    mk('PL202609001', '2026-09', 'O-P02', '已结案', 2, progress=[100, 100, 100, 100], scores=[92, 88, 86, 85]),
]
for p in plans:
    if p['status'] == '已结案':
        s = p['score']
        p['grade'] = 'A' if s >= 90 else ('B' if s >= 80 else ('C' if s >= 70 else 'D'))
        p['evalAt'] = '2026-10-05 16:30'
        p['evalBy'] = O['O-QS']['leader']
        p['logs'].append({'at': '2026-10-05 16:30', 'by': p['evalBy'],
                          'action': '结案评分', 'note': '总分 %s（%s）' % (s, p['grade'])})

with open(os.path.join(ROOT, 'fixtures/dept-plans.json'), 'w', encoding='utf-8') as f:
    json.dump(plans, f, ensure_ascii=False, indent=1)

print('生成 %d 份计划' % len(plans))
for p in plans:
    print('  %s %s %s 权重%s 完成%s 评分%s %s' % (
        p['planId'], p['orgName'], p['status'], p['weightTotal'], p['finishRate'], p['score'], p['grade']))
