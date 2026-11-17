#!/usr/bin/env bash
# ============================================================
# 建库全流程：建表 → 静态检查 → 约束冒烟 → 每日自检
#
# 用法：
#   ./sql/run-all.sh                       # 用默认库 wy_property
#   ./sql/run-all.sh mydb                  # 指定库名
#   PGHOST=127.0.0.1 PGUSER=wy ./sql/run-all.sh
#
# 前置：psql 可用；库已存在（docker compose up -d 会自动建）
# 特性：每个 SQL 文件独立执行，失败即停；可重跑（全部幂等）
# ============================================================
set -euo pipefail

DB="${1:-wy_property}"
DIR="$(cd "$(dirname "$0")" && pwd)"

PSQL=(psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB")

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ 找不到 psql。macOS 可 brew install postgresql@16，或 docker compose up -d 后用 docker exec"
  exit 1
fi

ORDER=(
  00-init
  01-tenant-space
  02-subject
  03-billing
  04-payment
  05-meter-expense
  06-workorder-asset
  07-hr-audit-system
  20-rls
  30-seed-minimal
)

echo "=============================================="
echo " 建库：$DB"
echo "=============================================="

for f in "${ORDER[@]}"; do
  echo ""
  echo "→ $f"
  "${PSQL[@]}" -q -f "$DIR/$f.sql"
done

echo ""
echo "=============================================="
echo " 静态检查（不依赖数据库）"
echo "=============================================="
node "$DIR/check-ddl.mjs"

echo ""
echo "=============================================="
echo " 约束冒烟（每条都应被拒绝）"
echo "=============================================="
"${PSQL[@]}" -f "$DIR/90-smoke.sql" 2>&1 | grep -E '✅|❌|冒烟结束'

echo ""
echo "=============================================="
echo " 每日自检（每段都应 0 行）"
echo "=============================================="
"${PSQL[@]}" -f "$DIR/daily-check.sql"

echo ""
echo "✅ 全部完成"
