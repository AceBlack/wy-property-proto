#!/usr/bin/env bash
# ============================================================
# 建库全流程：建表 → 静态检查 → 约束冒烟 → 每日自检
#
# 用法：
#   ./sql/run-all.sh                       # 默认库 wy_property
#   ./sql/run-all.sh mydb                  # 指定库名
#   PGHOST=127.0.0.1 PGUSER=wy ./sql/run-all.sh   # 强制本地 psql
#   USE_DOCKER=1 ./sql/run-all.sh          # 强制走 docker
#
# 数据通道自动选择：
#   1. 本地有 psql        → 直接用
#   2. 否则有 docker 容器 → docker compose exec（不需要本机装 psql）
#
# 特性：每个文件独立执行，失败即停；全部幂等，可反复跑
# ============================================================
set -euo pipefail

DB="${1:-wy_property}"
DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(cd "$DIR/.." && pwd)"          # 08-开发设计/
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
SERVICE="${PG_SERVICE:-db}"
PGUSER_DOCKER="${PGUSER_DOCKER:-wy}"

# ---------- 选通道 ----------
MODE=""
if [ "${USE_DOCKER:-0}" = "1" ]; then
  MODE="docker"
elif command -v psql >/dev/null 2>&1; then
  MODE="local"
elif command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
  MODE="docker"
else
  cat <<'MSG'
❌ 既没有 psql，也没有可用的 docker。

   二选一：
     A. 装 Docker 后：docker compose up -d && ./sql/run-all.sh
     B. 装本地 PG 后：brew install postgresql@16 && createdb wy_property && ./sql/run-all.sh

   详见 00-开发环境准备.md
MSG
  exit 1
fi

# ---------- 执行器：统一从 stdin 读 SQL，两边逻辑一致 ----------
run_sql() {          # run_sql <file> [额外 psql 参数...]
  local file="$1"; shift
  if [ "$MODE" = "local" ]; then
    psql -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB" "$@" < "$file"
  else
    docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
      psql -v ON_ERROR_STOP=1 --no-psqlrc -U "$PGUSER_DOCKER" -d "$DB" "$@" < "$file"
  fi
}

echo "=============================================="
echo " 建库：${DB}  （通道：${MODE}）"
echo "=============================================="

if [ "$MODE" = "docker" ]; then
  # 容器没起就先起
  if ! docker compose -f "$COMPOSE_FILE" ps --status running 2>/dev/null | grep -q "$SERVICE"; then
    echo "→ 容器未运行，先起库"
    docker compose -f "$COMPOSE_FILE" up -d
    for _ in $(seq 1 30); do
      docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" pg_isready -U "$PGUSER_DOCKER" >/dev/null 2>&1 && break
      sleep 2
    done
  fi
  # 库不存在则建（首次）
  docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
    psql -U "$PGUSER_DOCKER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 || {
      echo "→ 创建数据库 $DB"
      docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
        psql -U "$PGUSER_DOCKER" -d postgres -c "CREATE DATABASE \"$DB\""
    }
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
  21-app-role
  30-seed-minimal
)

for f in "${ORDER[@]}"; do
  printf '\n→ %s\n' "$f"
  run_sql "$DIR/$f.sql" -q
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
set +e
SMOKE_OUT="$( { run_sql "$DIR/90-smoke.sql"; } 2>&1 )"
SMOKE_RC=$?
set -e
echo "$SMOKE_OUT" | grep -E '✅|❌|冒烟结束' || echo "$SMOKE_OUT" | tail -20

echo ""
echo "=============================================="
echo " 每日自检（每段都应 0 行）"
echo "=============================================="
run_sql "$DIR/daily-check.sql" -q

echo ""
if [ $SMOKE_RC -ne 0 ]; then
  echo "⚠️  冒烟脚本返回非零（${SMOKE_RC}），请检查上面是否有 ❌"
  exit $SMOKE_RC
fi
echo "✅ 全部完成"
