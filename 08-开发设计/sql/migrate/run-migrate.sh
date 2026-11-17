#!/usr/bin/env bash
# ============================================================
# fixture → PostgreSQL 迁移
#
# 用法：
#   ./sql/migrate/run-migrate.sh            # 默认库 wy_property
#   USE_DOCKER=1 ./sql/migrate/run-migrate.sh
#
# 前置：库已按最新 DDL 建好（先跑 ../run-all.sh）
# 特性：幂等。每次先 TRUNCATE 再全量导入，可反复跑
# ============================================================
set -euo pipefail

DB="${1:-wy_property}"
DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_DIR="$(cd "$DIR/.." && pwd)"
COMPOSE_FILE="$(cd "$SQL_DIR/.." && pwd)/docker-compose.yml"
SERVICE="${PG_SERVICE:-db}"
PGUSER_DOCKER="${PGUSER_DOCKER:-wy}"

# ---------- 通道 ----------
if [ "${USE_DOCKER:-0}" = "1" ]; then MODE="docker"
elif command -v psql >/dev/null 2>&1; then MODE="local"
elif command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then MODE="docker"
else echo "❌ 需要 psql 或 docker"; exit 1; fi

run_file() {
  if [ "$MODE" = "local" ]; then
    psql -v ON_ERROR_STOP=1 --no-psqlrc -q -d "$DB" < "$1"
  else
    docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
      psql -v ON_ERROR_STOP=1 --no-psqlrc -q -U "$PGUSER_DOCKER" -d "$DB" < "$1"
  fi
}
run_query() {
  if [ "$MODE" = "local" ]; then
    psql -v ON_ERROR_STOP=1 --no-psqlrc -tA -d "$DB" -c "$1"
  else
    docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
      psql -v ON_ERROR_STOP=1 --no-psqlrc -tA -U "$PGUSER_DOCKER" -d "$DB" -c "$1"
  fi
}

echo "=============================================="
echo " 迁移 fixture → $DB  （通道：${MODE}）"
echo "=============================================="

# ---------- 生成 ----------
echo ""
echo "→ 生成 SQL"
node "$DIR/gen.mjs"

# ---------- 执行 ----------
echo ""
echo "→ 清空业务数据"
run_file "$DIR/out/00-truncate.sql"

for f in $(ls "$DIR/out"/*.sql | grep -v '00-truncate' | grep -v '99-setval' | sort); do
  printf '→ %s\n' "$(basename "$f")"
  run_file "$f"
done

echo ""
echo "→ 修正序列"
run_file "$DIR/out/99-setval.sql"

# ---------- 校验 ----------
echo ""
echo "=============================================="
echo " 迁移后行数"
echo "=============================================="
run_query "
SELECT relname AS 表, n_live_tup AS 行数
FROM pg_stat_user_tables
WHERE schemaname='wy' AND n_live_tup > 0
ORDER BY n_live_tup DESC;" | column -t -s'|'

echo ""
echo "=============================================="
echo " 每日自检（每段都应 0 行）"
echo "=============================================="
run_file "$SQL_DIR/daily-check.sql"

echo ""
echo "✅ 迁移完成"
