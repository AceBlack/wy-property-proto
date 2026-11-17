#!/usr/bin/env bash
# 跑收费域四条查询的 psql 基线，输出用于与后端实现逐分比对。
# 依赖：08-开发设计/docker-compose.yml 里的 wy-pg 已启动且已迁移数据。
set -euo pipefail

export PATH="$HOME/.docker/bin:$PATH"

HERE="$(cd "$(dirname "$0")" && pwd)"
DEV_DIR="$(cd "${HERE}/../../08-开发设计" && pwd)"

# wy_app：非超级用户，受 RLS 约束。换成 wy 会让隔离相关的结论全部失真。
URL="postgres://wy_app:wy_app_pass@127.0.0.1:5432/wy_property?options=-c%20search_path%3Dwy%2Cpublic%20-c%20TimeZone%3DAsia%2FShanghai"

cd "${DEV_DIR}"
echo "通道：psql 基线（wy_app / tenant_id=1）"
docker compose exec -T db psql "${URL}" -v ON_ERROR_STOP=1 -f - < "${HERE}/four-queries.sql"
