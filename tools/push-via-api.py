#!/usr/bin/env python3
"""
通过 GitHub REST API 推送本地提交 —— 仅在 `git push` 不通时使用。

为什么需要它：本机代理只放行了 `api.github.com`，`github.com:443` 会返回
`CONNECT tunnel failed, response 502`，于是 git push / ls-remote 全部失败。
这个脚本走 API 完成等价推送：上传 blob → 以父提交的 tree 为 base 建 tree →
用与本地**完全相同**的 message / author / committer 建 commit → 更新 ref。
因为元数据一致，生成的 commit SHA 与本地相同，推完 `git status` 仍然干净，
后续用普通 `git push` 也不会出现 non-fast-forward。

用法：
    python3 tools/push-via-api.py            # 推送 origin 未包含的本地提交
    python3 tools/push-via-api.py --dry-run  # 只打印要推哪些提交

token 从 `git credential-osxkeychain` 读取（与 git 用的是同一个），脚本不落盘、不打印。
前置条件：本地 `origin` 指向 github.com 的同一个仓库（owner/repo 见下方常量）。

排查顺序：先看 github.com 是否可达（`curl -m 10 https://github.com` 返回 000 即被拦），
通了就直接 `git push`，不要用本脚本——API 推送只在被拦时兜底。

关键点：路径必须用 core.quotePath=false 取，否则中文路径会被转义成 "04-\\345..." 形式，
blob 会传到错误路径（tree 哈希对不上）。每个文件都校验 blob/tree 哈希与本地一致，
不一致立刻中止，不产生半成品提交。
"""
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request

DRY = '--dry-run' in sys.argv

OWNER, REPO, BRANCH = 'AceBlack', 'wy-property-proto', 'main'
API = f'https://api.github.com/repos/{OWNER}/{REPO}'


def token():
    out = subprocess.run(['git', 'credential-osxkeychain', 'get'],
                         input='protocol=https\nhost=github.com\n\n',
                         capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1]
    sys.exit('没拿到 token')


TOKEN = token()


def api(method, path, body=None):
    r = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={'Authorization': f'Bearer {TOKEN}', 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
                 'User-Agent': 'wydoc-api-push'})
    try:
        with urllib.request.urlopen(r, timeout=180) as resp:
            return json.loads(resp.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        sys.exit(f'✗ {method} {path} -> {e.code} {e.read().decode("utf-8", "ignore")[:400]}')


G = ['git', '-c', 'core.quotePath=false']


def git(*args, text=True):
    out = subprocess.run(G + list(args), capture_output=True).stdout
    return out.decode('utf-8').strip() if text else out


def changed(parent, commit):
    rows = []
    for line in git('diff', '--name-status', f'{parent}..{commit}').splitlines():
        parts = line.split('\t')
        if len(parts) >= 2:
            rows.append((parts[0][0], parts[-1]))
    return rows


def push_commit(parent, commit, label):
    files = changed(parent, commit)
    print(f'\n== {label}：{len(files)} 个文件（{parent[:7]} → {commit[:7]}）')
    if not files:
        sys.exit('✗ 没有文件变更，中止（父提交链不对）')

    entries = []
    for i, (status, path) in enumerate(files, 1):
        content = git('show', f'{commit}:{path}', text=False)
        sha = api('POST', '/git/blobs',
                  {'content': base64.b64encode(content).decode(), 'encoding': 'base64'})['sha']
        local = git('rev-parse', f'{commit}:{path}')
        if sha != local:
            sys.exit(f'✗ blob 不一致：{path}')
        entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': sha})
        if i % 20 == 0 or i == len(files):
            print(f'   blob {i}/{len(files)} ✓')

    base_tree = api('GET', f'/git/commits/{parent}')['tree']['sha']
    tree = api('POST', '/git/trees', {'base_tree': base_tree, 'tree': entries})['sha']
    local_tree = git('rev-parse', f'{commit}^{{tree}}')
    if tree != local_tree:
        sys.exit(f'✗ tree 不一致：api={tree[:7]} local={local_tree[:7]}')
    print(f'   tree {tree[:7]} ✓')

    fmt = git('log', '-1', '--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI', commit)
    an, ae, ad, cn, ce, cd = fmt.split('\x00', 5)
    # 消息取原始提交对象里的字节：%B 会多/少一个换行，差一个字节 SHA 就不同
    raw = git('cat-file', 'commit', commit, text=False)
    msg = raw[raw.find(b'\n\n') + 2:].decode('utf-8')
    new = api('POST', '/git/commits', {
        'message': msg, 'tree': tree, 'parents': [parent],
        'author': {'name': an, 'email': ae, 'date': ad},
        'committer': {'name': cn, 'email': ce, 'date': cd},
    })['sha']
    if new != commit:
        sys.exit(f'✗ commit 不一致：api={new[:7]} local={commit[:7]}')
    print(f'   commit {new[:7]} ✓')
    return new


remote = api('GET', f'/git/ref/heads/{BRANCH}')['object']['sha']
local = git('rev-parse', 'HEAD')
print(f'远程 {remote[:7]} / 本地 {local[:7]}')

commits = git('rev-list', '--reverse', f'{remote}..{local}').splitlines()
print(f'待推 {len(commits)} 个提交')
if DRY:
    for c in commits:
        print('  ', git('log', '-1', '--format=%h %s', c))
    print('（--dry-run：没有上传任何内容）')
    sys.exit(0)
for c in commits:
    print('  ', git('log', '-1', '--format=%h %s', c))

parent = remote
for i, c in enumerate(commits, 1):
    parent = push_commit(parent, c, f'提交 {i}/{len(commits)}')

api('PATCH', f'/git/refs/heads/{BRANCH}', {'sha': parent, 'force': False})
after = api('GET', f'/git/ref/heads/{BRANCH}')['object']['sha']
print(f'\n远程 {after[:7]} / 本地 {local[:7]} → {"完全一致 ✓" if after == local else "有差异"}')
