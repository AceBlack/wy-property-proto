"""部门计划样例（第 56 批 · 与原型 items 结构对齐）

一份计划 = 模板铺开的考核项 + 填报数据。四份覆盖四种状态：

  PL202610001  O-P01      审批中   （项目经理模板，5/5/5）
  PL202610002  O-P02      执行中   （项目经理模板）
  PL202610003  O-P01-T4   待复评   （环境组模板，2/5/8）
  PL202609001  O-P02      已结案   （上月，供统计对比）

口径（与 03-原型 utils/api.js 同一套，改一处必须改另一处）：
  否决 = 目标 × 95%，挑战 = 目标 × 105%（逆向镜像）；
  自评 = 5 ×（实际 − 否决）/（挑战 − 否决），夹 1–5；
  加权 = 分 × 权重/100；
  总分 = 自评合计 × 20% + 复评合计 × 80%。

**第 60 批起权重不在模板里**（模板 fixture 已经没有 weight）：
  样例计划按条目数把 100% 平均分给量化 + 重点项（余数给前面的项），
  这正是提报页打开时的预填值。样例里不做手工调权，保持"平均起点"这一口径。
"""
import json
import os
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = json.load(open(os.path.join(ROOT, 'fixtures', 'plan-templates.json'), encoding='utf-8'))
ORGS = json.load(open(os.path.join(ROOT, 'fixtures', 'orgs.json'), encoding='utf-8'))
EMPS = {e['empId']: e for e in json.load(open(os.path.join(ROOT, 'fixtures', 'employees.json'), encoding='utf-8'))}
O = {o['orgId']: o for o in ORGS}


def r2(n):
    return round(float(n) + 0.0, 2)


# 重点工作项的「计划内容」与「实际完成」文案池。
# 不填的话，已结案的样例在页面上只有名称和分数、看不到做了什么 ——
# 评审时被问「这项凭什么打 4 分」答不出来。与原型 PLAN_K_PLAN / PLAN_K_DONE 同口径。
K_PLAN = [
    lambda n: f'制定「{n}」月度推进表，明确责任人与完成节点',
    lambda n: f'按周跟踪「{n}」进展，月中复盘一次偏差',
    lambda n: f'梳理「{n}」现状问题，形成整改清单并逐项闭环',
    lambda n: f'组织「{n}」相关岗位对齐口径，输出统一执行模板',
    lambda n: f'对「{n}」开展一次专项检查，问题当场交办到人',
    lambda n: f'结合上月问题清单，对「{n}」做一轮回头看',
    lambda n: f'编制「{n}」操作指引，完成一次岗位培训',
]
K_DONE = [
    lambda n: '已完成，推进表下发到 4 个班组，按周跟踪无遗漏',
    lambda n: '已完成，月中复盘发现 2 处偏差，已调整后续安排',
    lambda n: '已完成，整改清单 6 项全部闭环，无遗留',
    lambda n: '已完成，模板已下发各班组统一使用',
    lambda n: '已完成，检查发现 3 个问题，当日交办并整改完毕',
    lambda n: '已完成，上月 5 个问题复核通过，新增 1 项纳入下月',
    lambda n: '已完成，指引已上墙，培训覆盖 12 人并签到留档',
]


def target_of(t, direction):
    if not t or t <= 0:
        return None, None
    return (r2(t * 0.95), r2(t * 1.05)) if direction > 0 else (r2(t * 1.05), r2(t * 0.95))


def self_score(it):
    if it['section'] != 'q':
        return it.get('selfScore') or 0
    rej, cha = target_of(it.get('target'), it.get('direction', 1))
    if rej is None:
        return it.get('selfScore') or 0
    a = it.get('actual')
    if a in ('', None):
        return 0
    den = abs(cha - rej)
    if not den:
        return 0
    num = (rej - a) if it.get('direction', 1) < 0 else (a - rej)
    return min(5, max(1, 5 * num / den))


def weighted(score, w):
    return r2((score or 0) * (w or 0) / 100)


def build(plan_id, month, org_id, status, q, review=0.0):
    tpl = next(t for t in TPL if t['tplId'] == {
        'O-P01': 'PT01', 'O-P02': 'PT01', 'O-P01-T4': 'PT05'
    }.get(org_id, 'PT06'))
    org = O[org_id]
    lead = EMPS.get(org.get('leaderEmpId', ''), {})
    due = f'{month}-{28 if month.endswith(("02",)) else 30 if month.endswith(("04", "06", "09", "11")) else 31}'

    items = []
    for idx, it in enumerate([i for i in tpl['items'] if i.get('enabled', True)]):
        sec = it['section']
        row = {
            'taskId': f'{plan_id}-I{idx + 1:02d}',
            'itemId': it['itemId'],
            'section': sec,
            'name': it['name'],
            'content': '',
            'standard': it.get('standard', ''),
            'weight': 0,   # 下面按条目平均分配，模板里没有权重
            'direction': it.get('direction', 1),
            'unit': it.get('unit', ''),
            'target': it.get('targetDefault', '') if sec == 'q' else '',
            'dueDate': due,
            'files': [],
            'actual': '',
            'actualNote': '',
            'selfScore': None,
            'selfWeighted': 0,
            'reviewScore': None,
            'reviewWeighted': 0,
            'remark': '',
            'progress': 0,
            'execStatus': '未开始',
            'finishAt': '',
            'score': 0,
            'evalRemark': ''
        }
        filled = status in ('执行中', '待复评', '已结案')
        # 重点工作：计划内容提报时就该写（草稿也有），实际完成要等执行后才填
        if sec == 'k':
            row['content'] = K_PLAN[idx % len(K_PLAN)](it['name'])
            if filled:
                row['actual'] = K_DONE[idx % len(K_DONE)](it['name'])
        if filled:
            k = q * (1 + ((idx % 5) - 2) * 0.03)
            if sec == 'q' and row['target'] not in ('', 0):
                ratio = (2 - k) if row['direction'] < 0 else k
                row['actual'] = r2(float(row['target']) * max(0.7, ratio))
            elif sec in ('q', 'k'):
                row['selfScore'] = min(5, max(1, r2(5 * k)))
            elif sec == 'm':
                row['actual'] = '发生 1 起' if idx % 4 == 0 else '无'
                row['selfWeighted'] = -0.05 if idx % 4 == 0 else 0
                if status == '已结案':
                    row['reviewWeighted'] = row['selfWeighted']
            if status in ('待复评', '已结案'):
                row['execStatus'] = '已完成'
                row['progress'] = 100
                row['finishAt'] = f'{month}-{min(20 + idx, 28):02d}'
        if status == '已结案' and sec != 'm':
            base = self_score(row) if sec == 'q' else (row['selfScore'] or 0)
            row['reviewScore'] = min(5, max(1, r2(base + review)))
        items.append(row)

    # 把 100% 平均分给计分项（量化 + 重点），监控项恒 0。
    # **按 5% 为单位分**（100/5 = 20 份）：先给每项 floor(20/n) 份，余下的份数给前面几项。
    # 直接按 100/n 分会算出 11%、12% 这种不合规的预填值 —— 提报页一打开就红着。
    scorable = [r for r in items if r['section'] in ('q', 'k')]
    if scorable:
        total_units = 100 // 5
        base = total_units // len(scorable)
        rest = total_units - base * len(scorable)
        for r in scorable:
            u = base + (1 if rest > 0 else 0)
            if rest > 0:
                rest -= 1
            r['weight'] = u * 5
    for r in items:
        if r['section'] == 'm':
            r['weight'] = 0

    def calc(it):
        if it['section'] == 'm':
            return r2(it['selfWeighted']), r2(it['reviewWeighted'])
        s = self_score(it)
        rv = it['reviewScore'] or 0
        return weighted(s, it['weight']), weighted(rv, it['weight'])

    self_total = 0.0
    review_total = 0.0
    for it in items:
        a, b = calc(it)
        self_total += a
        review_total += b
    self_total = r2(self_total)
    review_total = r2(review_total)
    total = r2(self_total * 0.2 + review_total * 0.8)
    grade = 'A' if total >= 4.5 else ('B' if total >= 3.75 else ('C' if total >= 3.0 else 'D'))

    return {
        'planId': plan_id,
        'planMonth': month,
        'orgId': org_id,
        'orgName': org['name'],
        'orgPath': ' / '.join([org['name']]) if org.get('parentId') is None else ' / '.join(
            [O[org['parentId']]['name'], org['name']] if org.get('parentId') in O else [org['name']]),
        'orgType': org['type'],
        'projectId': org_id if org['type'] == '项目' else (org.get('parentId') if org['type'] == '班组' else ''),
        'headcount': 12,
        'tplId': tpl['tplId'],
        'tplName': tpl['name'],
        'tplVersion': tpl['version'],
        'submitterEmpId': lead.get('empId', ''),
        'submitterName': lead.get('name', ''),
        'submitterPosition': lead.get('position', ''),
        'submitterDuty': '正职',
        'submitterOrgId': lead.get('orgId', org_id),
        'submitterOrgName': (O.get(lead.get('orgId', ''), {}) or {}).get('name', ''),
        'submitAt': f'{month}-03 09:20',
        'status': status,
        'oaId': 'AP00097' if status == '审批中' else '',
        'approveAt': '', 'approveBy': '', 'approveNote': '',
        'reviseLog': [],
        'items': items,
        'weightTotal': round(sum(i['weight'] for i in items if i['section'] != 'm'), 2),
        'weightOk': abs(sum(i['weight'] for i in items if i['section'] != 'm') - 100) < 0.01,
        'finishRate': r2(min(100, self_total / 5 * 100)),
        'selfTotal': self_total,
        'reviewTotal': review_total,
        'totalScore': total if status == '已结案' else 0,
        'score': total if status == '已结案' else 0,
        'grade': grade if status == '已结案' else '',
        'evalAt': f'{month}-28 16:30' if status == '已结案' else '',
        'evalBy': '运营管理部' if status == '已结案' else '',
        'summary': '',
        'logs': [{'at': f'{month}-03 09:20', 'by': lead.get('name', ''),
                  'action': '提报计划', 'note': f'以{org["name"]}负责人身份提报（模板 {tpl["name"]}）'}]
    }


plans = [
    build('PL202610001', '2026-10', 'O-P01', '审批中', 1.0),
    build('PL202610002', '2026-10', 'O-P02', '执行中', 0.95),
    build('PL202610003', '2026-10', 'O-P01-T4', '待复评', 1.05),
    build('PL202609001', '2026-09', 'O-P02', '已结案', 1.0, review=-0.05),
]

out = os.path.join(ROOT, 'fixtures', 'dept-plans.json')
json.dump(plans, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

for p in plans:
    print(f"{p['planId']} {p['orgName']:<12} {p['status']:<5} "
          f"条目 {len(p['items']):>2} · 权重 {p['weightTotal']:>5}% · "
          f"自评 {p['selfTotal']:>5} · 复评 {p['reviewTotal']:>5} · 总分 {p['totalScore']:>5} {p['grade']}")
print(f'已生成 {len(plans)} 份计划 → {out}')
