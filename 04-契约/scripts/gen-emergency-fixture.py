"""给契约样例补紧急联系人（2026-11-04）

规则与原型种子一致：姓名不能和本人重名，配偶取异性，父亲/母亲按性别取。
这里用固定池 + 索引取模，保证**重复运行结果完全相同**（样例进版本库，不能每次生成都变）。
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'fixtures', 'employees.json')
emps = json.load(open(P, encoding='utf-8'))

MALE = ['建华', '志强', '国强', '建军', '文博', '晓东', '振华', '浩然', '子轩', '天佑']
FEMALE = ['秀英', '桂英', '玉兰', '淑珍', '丽华', '海燕', '春梅', '秀芳', '雅静', '若曦']
SUR = '王李张刘陈杨黄赵吴周徐孙马朱胡林郭何高罗'

RELATIONS = ['配偶', '母亲', '父亲', '配偶', '母亲', '子女', '兄弟姐妹', '父亲', '配偶', '其他']

changed = 0
for i, e in enumerate(emps):
    # 幂等：已有且格式合法就跳过；格式不合法（比如写错过位数）要重生成
    if e.get('emergencyContact') and re.fullmatch(r'1[3-9]\d{9}', str(e.get('emergencyPhone') or '')):
        continue
    rel = RELATIONS[i % len(RELATIONS)]
    sur = SUR[i % len(SUR)]
    # 配偶取异性；父亲取男名、母亲取女名
    if rel == '父亲':
        given = MALE[(i * 3) % len(MALE)]
    elif rel == '母亲':
        given = FEMALE[(i * 3) % len(FEMALE)]
    elif rel == '配偶':
        given = (FEMALE if e.get('gender') == '男' else MALE)[(i * 5) % 10]
    else:
        given = (MALE + FEMALE)[(i * 7) % 20]
    name = sur + given
    # 万一同名就换一个字，不引入随机
    if name == e['name']:
        name = sur + (FEMALE if given in MALE else MALE)[0]
    e['emergencyContact'] = name
    e['emergencyRelation'] = rel
    # 11 位：1 + 第二位(3-9) + 9 位流水
    e['emergencyPhone'] = '1%d%09d' % (3 + (i % 7), 100000000 + i * 137)
    changed += 1

json.dump(emps, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'补齐 {changed} 人 → {P}')
for e in emps[:5]:
    print(' ', e['empId'], e['gender'], e['name'], '→', e['emergencyRelation'], e['emergencyContact'], e['emergencyPhone'])
