#!/bin/bash
# 智慧物业 V2 原型 → GitHub 一键部署
#
# 用法：
#   GH_TOKEN=ghp_xxxxxxxx ./deploy-github.sh [仓库名]
#
# 行为：
#   1. 用 token 在 AceBlack 名下创建 public 仓库（已存在则跳过）
#   2. 推送当前 main 分支（token 只用于本次传输，推完即从 remote 移除）
#   3. 开启 GitHub Pages（源 = GitHub Actions，由 .github/workflows/deploy-pages.yml 构建）
#   4. 输出 Pages 地址
#
# 安全：token 从环境变量读取，不写入任何文件；脚本结束前清除 remote 中的 token。

set -euo pipefail

TOKEN="${GH_TOKEN:-}"
REPO="${1:-wy-property-proto}"
OWNER="${GH_OWNER:-AceBlack}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

if [ -z "$TOKEN" ]; then
  echo "✗ 缺少 GH_TOKEN。用法：GH_TOKEN=ghp_xxx ./deploy-github.sh [仓库名]" >&2
  exit 1
fi

API="https://api.github.com"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

echo "== 0/4 校验 token 与账号 =="
LOGIN=$(curl -s "${AUTH[@]}" "$API/user" | grep -o '"login":[^,]*' | head -1 | cut -d'"' -f4)
if [ -z "$LOGIN" ]; then
  echo "✗ token 无效或无 user 读取权限" >&2
  exit 1
fi
echo "   账号：$LOGIN"
[ "$LOGIN" != "$OWNER" ] && echo "   ⚠ 与实际账号不一致，改用 $LOGIN" && OWNER="$LOGIN"

echo "== 1/4 创建仓库 $OWNER/$REPO (public) =="
CODE=$(curl -s -o /tmp/gh-repo.json -w "%{http_code}" "${AUTH[@]}" -X POST "$API/user/repos" \
  -d "{\"name\":\"$REPO\",\"private\":false,\"auto_init\":false,\"description\":\"智慧物业 V2 高保真原型 · Vue3 + Vite + Element Plus\"}")
if [ "$CODE" = "201" ]; then
  echo "   已创建"
elif grep -q "already exists" /tmp/gh-repo.json 2>/dev/null; then
  echo "   仓库已存在，复用"
else
  echo "   创建返回 HTTP $CODE：$(grep -o '"message":"[^"]*"' /tmp/gh-repo.json | head -1)"
fi

echo "== 2/4 推送 main =="
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:$TOKEN@github.com/$OWNER/$REPO.git"
git -c user.name="WYDoc Prototype" -c user.email="prototype@local" \
    push -u origin main 2>&1 | tail -3

echo "== 3/4 开启 Pages（源 = GitHub Actions，需 token 带 workflow 权限）=="
CODE=$(curl -s -o /tmp/gh-pages.json -w "%{http_code}" "${AUTH[@]}" -X POST "$API/repos/$OWNER/$REPO/pages" \
  -d '{"build_type":"workflow"}')
if [ "$CODE" = "201" ] || [ "$CODE" = "204" ]; then
  echo "   Pages 已启用（workflow 模式）"
else
  BODY=$(grep -o '"message":"[^"]*"' /tmp/gh-pages.json | head -1)
  echo "   HTTP $CODE $BODY"
  echo "   → 若提示已启用，去仓库 Settings → Pages 把 Source 设为「GitHub Actions」即可"
fi

echo "== 4/4 触发首次构建并等待 =="
curl -s -o /dev/null "${AUTH[@]}" -X POST "$API/repos/$OWNER/$REPO/actions/workflows/deploy-pages.yml/dispatches" \
  -d '{"ref":"main"}' 2>/dev/null || true

echo
echo "仓库：https://github.com/$OWNER/$REPO"
echo "Pages：https://$(echo "$OWNER" | tr '[:upper:]' '[:lower:]').github.io/$REPO/"
echo "构建状态：https://github.com/$OWNER/$REPO/actions"
echo
echo "首次构建约需 1-2 分钟。若 Pages 404，检查 Settings → Pages 的 Source 是否为 GitHub Actions。"

# 清除 remote 中的 token
git remote set-url origin "https://github.com/$OWNER/$REPO.git" 2>/dev/null || true
rm -f /tmp/gh-repo.json /tmp/gh-pages.json
echo "已清除本地 remote 中的 token。"
