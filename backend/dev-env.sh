#!/usr/bin/env bash
# 本机开发环境变量：source 一次即可（不改 ~/.zshrc，也不动系统目录）
#
#   source backend/dev-env.sh
#   ./backend/run-tests.sh
#
# 本机没有 Homebrew，JDK 与 Maven 是解压安装的，位置固定：
set -a
if [ -z "${JAVA_HOME:-}" ]; then
  export JAVA_HOME="${HOME}/.jdks/jdk-17.0.21+9/Contents/Home"
fi
export PATH="${JAVA_HOME}/bin:${HOME}/.tools/apache-maven-3.9.16/bin:${PATH}"
export PATH="${HOME}/.docker/bin:${PATH}"   # docker CLI 不在默认 PATH（交接单 §一）
set +a

echo "JAVA_HOME = ${JAVA_HOME}"
java -version 2>&1 | head -1
mvn -v 2>&1 | head -1 || echo "（未找到全局 mvn，用 backend/mvnw 代替）"
docker compose version 2>/dev/null | head -1 || true
