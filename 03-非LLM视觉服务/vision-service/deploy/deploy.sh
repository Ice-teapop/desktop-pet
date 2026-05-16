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

echo "→ chown deskpet:deskpet"
ssh "$REMOTE" "chown -R deskpet:deskpet $REMOTE_DIR"

# —— systemd unit 同步：检测 repo 内 unit 是否与已安装的不同 ——
# rsync 只到 /opt/deskpet/vision-service，但 systemd 读 /etc/systemd/system/。
# 如果 repo 改了 unit 而这步不同步，systemctl restart 会用旧 unit，硬化失效。
echo "→ 检测 systemd unit 差异（/etc/systemd/system vs repo）"
unit_changed=$(ssh "$REMOTE" "
  if ! cmp -s '$REMOTE_DIR/deploy/$SERVICE.service' '/etc/systemd/system/$SERVICE.service' 2>/dev/null; then
    echo 'CHANGED'
  else
    echo 'SAME'
  fi
")

if [ "$unit_changed" = "CHANGED" ]; then
  echo "  unit 已变更 → install + daemon-reload"
  ssh "$REMOTE" "
    install -m 644 '$REMOTE_DIR/deploy/$SERVICE.service' '/etc/systemd/system/$SERVICE.service'
    systemctl daemon-reload
  "
else
  echo "  unit 未变，跳过 install"
fi

echo "→ systemctl restart $SERVICE"
ssh "$REMOTE" "
  systemctl restart $SERVICE
  sleep 1
  systemctl --no-pager status $SERVICE | head -8
"

# —— 健康检查（带重试 —— pix2tex 预热 ~15s 才能接受连接）——
echo "→ 健康检查 GET /v1/health（最多等 30s pix2tex 预热）"
ssh "$REMOTE" "
  for i in \$(seq 1 30); do
    if curl -fsS http://localhost:8800/v1/health 2>/dev/null; then
      echo
      exit 0
    fi
    sleep 1
  done
  echo '健康检查超时 —— 查 journalctl -u $SERVICE -n 30'
  exit 1
"

echo "✓ 完成"
