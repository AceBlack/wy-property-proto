"""生成契约样例 fixtures/org-leaders.json（组织负责人关系）

从 `fixtures/orgs.json` 的 `leaderEmpId` 迁移出正职记录，再补三条演示数据：
副职、在期代理（正职已离任）、已结束的代理（到期自动失效）。
用法：python3 scripts/gen-org-leaders-fixture.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
orgs = json.load(open(os.path.join(ROOT, 'fixtures/orgs.json'), encoding='utf-8'))
emps = {e['empId']: e for e in json.load(open(os.path.join(ROOT, 'fixtures/employees.json'), encoding='utf-8'))}
TODAY = '2026-10-21'

# 这个部门用显式记录（正职离任 + 代理在期），不生成默认正职
OVERRIDE = {'O-P01-T3'}

records = []
for o in orgs:
    if o.get('leaderEmpId') and o['orgId'] not in OVERRIDE:
        records.append({
            'orgId': o['orgId'], 'empId': o['leaderEmpId'], 'duty': '正职',
            'startDate': '', 'endDate': '', 'note': ''
        })

# 演示：正职离任 → 代理在期（审批人要自动切到代理）
sec = [e['empId'] for e in emps.values() if e.get('position') == '安保主管' and e.get('orgId') == 'O-P01']
deputy = [e['empId'] for e in emps.values() if e.get('position') == '环境主管' and e.get('orgId') == 'O-P01']
records.append({
    'orgId': 'O-P01-T3', 'empId': sec[0] if sec else 'EM0001', 'duty': '正职',
    'startDate': '2025-06-01', 'endDate': '2026-10-15', 'note': '正职调岗离任'
})
records.append({
    'orgId': 'O-P01-T3', 'empId': sec[1] if len(sec) > 1 else 'EM0002', 'duty': '代理',
    'startDate': '2026-10-16', 'endDate': '2026-12-31', 'note': '正职空缺期间代理，到期自动失效'
})
# 项目部副职：采购类会签需要正职 + 副职共同签署
pm_list = [e['empId'] for e in emps.values()
           if e.get('position') == '项目经理' and e.get('orgId') == 'O-P01' and e['empId'] != 'EM0008']
if pm_list:
    records.append({
        'orgId': 'O-P01', 'empId': pm_list[0], 'duty': '副职',
        'startDate': '2026-02-01', 'endDate': '', 'note': '分管工程与采购，采购类会签需与正职共同签署'
    })

if deputy:
    records.append({
        'orgId': 'O-P01-T4', 'empId': deputy[-1], 'duty': '副职',
        'startDate': '2026-03-01', 'endDate': '', 'note': '分管绿化，不参与审批'
    })
# 已结束的代理：留档不删
records.append({
    'orgId': 'O-P02-T4', 'empId': (deputy[0] if deputy else 'EM0003'), 'duty': '代理',
    'startDate': '2026-08-01', 'endDate': '2026-09-30', 'note': '休假期间代理，已结束'
})

out = []
for i, r in enumerate(records, 1):
    out.append({
        'id': 'OL%04d' % i,
        'orgId': r['orgId'],
        'empId': r['empId'],
        'duty': r['duty'],
        'startDate': r['startDate'],
        'endDate': r['endDate'],
        'note': r['note']
    })

with open(os.path.join(ROOT, 'fixtures/org-leaders.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

print('生成 %d 条负责关系' % len(out))
for r in out:
    print('  %-11s %-5s %-4s %s ~ %s' % (
        r['orgId'], r['empId'], r['duty'], r['startDate'] or '—', r['endDate'] or '—'))
