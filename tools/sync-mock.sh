#!/usr/bin/env bash
# 把 02-原型设计 的数据产物同步到 03-原型/src/mock
# ------------------------------------------------------------
# 为什么需要这一步：数据源在 02-原型设计（seed_dataset.py 生成 mock/*.json），
# 而 PC 与员工端读的是 03-原型/src/mock。两个目录曾经各改各的，
# 结果「重跑 seed 就把口径修回去」—— 所以固定成一条单向同步。
#
# 用法：
#   bash tools/sync-mock.sh          # 同步
#   bash tools/sync-mock.sh --check  # 只比对，不写（CI 可用，不一致退出码 1）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/02-原型设计"
DST="$ROOT/03-原型/src/mock"
PRICE="$SRC/repairPrices.json"

if [ ! -d "$SRC/mock" ]; then
  echo "找不到 $SRC/mock，先跑：python3 02-原型设计/seed_dataset.py" >&2
  exit 2
fi

MODE="${1:-sync}"

if [ "$MODE" = "--check" ]; then
  rc=0
  for f in "$SRC"/mock/*.json "$SRC"/mock/index.js; do
    base="$(basename "$f")"
    if ! cmp -s "$f" "$DST/$base"; then
      echo "不一致：$base"
      rc=1
    fi
  done
  if ! cmp -s "$PRICE" "$DST/repairPrices.json" 2>/dev/null; then
    echo "不一致：repairPrices.json"
    rc=1
  fi
  [ "$rc" -eq 0 ] && echo "✓ 02 与 03 的数据完全一致"
  exit "$rc"
fi

# 同步：mock 全量 + 手工维护的价目表（它在 mock 目录外，seed 不生成）
mkdir -p "$DST"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "$SRC/mock/" "$DST/"
else
  cp -R "$SRC"/mock/. "$DST"/
fi
cp "$PRICE" "$DST/repairPrices.json"

echo "✓ 已同步到 $DST"
echo "  文件 $(ls "$DST" | wc -l | tr -d ' ') 个 · 工单 $(node -e "console.log(require('$DST/workOrders.json').length)" 2>/dev/null || echo '?') 张"
