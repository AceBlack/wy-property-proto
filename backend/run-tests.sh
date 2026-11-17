#!/usr/bin/env bash
# 跑收费域验收测试（含对真库的逐分比对）。
# 前置：08-开发设计/docker-compose.yml 的 wy-pg 已启动，且已跑过 sql/run-all.sh + sql/migrate/run-migrate.sh。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# 本机 JDK / Maven 不在系统路径里（无 Homebrew），用本地安装的位置；已配置则沿用环境变量。
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="${HOME}/.jdks/jdk-17.0.21+9/Contents/Home"
fi
export JAVA_HOME

# 优先用仓库自带的 Maven Wrapper（版本锁在 .mvn/wrapper 里），没有才退回全局 mvn
if [ -x "${HERE}/mvnw" ]; then
  MVN="${HERE}/mvnw"
elif command -v mvn >/dev/null 2>&1; then
  MVN="mvn"
else
  MVN="${HOME}/.tools/apache-maven-3.9.16/bin/mvn"
fi

echo "JAVA_HOME=${JAVA_HOME}"
"${JAVA_HOME}/bin/java" -version 2>&1 | head -1

cd "${HERE}"
exec "${MVN}" -B test "$@"
