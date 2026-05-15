#!/usr/bin/env bash
# DeskPet 视觉服务一键部署
# 前提：已按《部署文档》完成首次部署（systemd 服务、deskpet 用户、.venv 都已就绪）
# 用法：
#   ./deploy.sh                # 同步代码 → 重启服务 → 健康检查
#   ./deploy.sh --with-deps    # 同步后再 pip install -r requirements.txt 再重启（依赖有改动时用）
# 不会同步：__pycache__、.venv、.careful-coder、本脚本自身、/etc/deskpet-vision.env（token 留服务器）

set -euo pipefail

# 切到 vision-service/ 目录（无论从哪里执行）
cd "$(dirname "$0")/.."

REMOTE="deskpet-prod"
REMOTE_DIR="/opt/deskpet/vision-service"
SERVICE="deskpet-vision"

echo "→ rsync 同步代码到 $REMOTE:$REMOTE_DIR"
rsync -avz --delete \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='.pytest_cache/' \
  --exclude='.venv/' \
  --exclude='.careful-coder/' \
  --exclude='.DS_Store' \
  --exclude='deploy/deploy.sh' \
  ./ "$REMOTE:$REMOTE_DIR/"

if [ "${1-}" = "--with-deps" ]; then
  echo "→ pip install -r requirements.txt"
  ssh "$REMOTE" "cd $REMOTE_DIR && .venv/bin/pip install -r requirements.txt"
fi

echo "→ chown deskpet:deskpet + systemctl restart"
ssh "$REMOTE" "
  chown -R deskpet:deskpet $REMOTE_DIR
  systemctl restart $SERVICE
  sleep 1
  systemctl --no-pager status $SERVICE | head -8
"

echo "→ 健康检查 GET /v1/health"
ssh "$REMOTE" "curl -fsS http://localhost:8800/v1/health" && echo

echo "✓ 完成"
