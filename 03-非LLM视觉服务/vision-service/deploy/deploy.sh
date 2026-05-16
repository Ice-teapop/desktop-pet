#!/usr/bin/env bash
# DeskPet 视觉服务一键部署
# 前提：已按《部署文档》完成首次部署（systemd 服务、deskpet 用户、.venv 都已就绪）
# 用法：
#   ./deploy.sh                # 同步代码 → 同步配置 → 重启 → 健康检查
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

# —— 系统级配置同步（systemd unit / Caddy / journald）——
# rsync 只到 /opt/deskpet/vision-service，但 systemd / Caddy / journald 读其他路径。
# 这里检测 repo 内对应文件与已安装版本差异，需要时 install 并触发 reload/restart。
# 各 source 独立检测以便精确知道触发什么动作。
echo "→ 系统级配置差异检测 + 同步"
ssh "$REMOTE" "set -e

# 记录哪些发生了变化 —— 决定 daemon-reload / 各 service reload 是否需要
need_daemon_reload=0
need_vision_restart=0
need_caddy_reload=0
need_journald_restart=0

# 1) deskpet-vision systemd unit
if ! cmp -s '$REMOTE_DIR/deploy/$SERVICE.service' '/etc/systemd/system/$SERVICE.service' 2>/dev/null; then
  echo '  [chg] /etc/systemd/system/$SERVICE.service'
  install -m 644 '$REMOTE_DIR/deploy/$SERVICE.service' '/etc/systemd/system/$SERVICE.service'
  need_daemon_reload=1
  need_vision_restart=1
fi

# 2) Caddyfile（chmod 640 + group caddy 让 caddy 进程可读但全局不可读）
if ! cmp -s '$REMOTE_DIR/deploy/Caddyfile' '/etc/caddy/Caddyfile' 2>/dev/null; then
  echo '  [chg] /etc/caddy/Caddyfile'
  install -m 640 -g caddy '$REMOTE_DIR/deploy/Caddyfile' '/etc/caddy/Caddyfile'
  need_caddy_reload=1
fi

# 3) Caddy systemd drop-in
mkdir -p /etc/systemd/system/caddy.service.d
for f in '$REMOTE_DIR'/deploy/caddy.service.d/*.conf; do
  [ -f \"\$f\" ] || continue
  name=\$(basename \"\$f\")
  if ! cmp -s \"\$f\" \"/etc/systemd/system/caddy.service.d/\$name\" 2>/dev/null; then
    echo \"  [chg] /etc/systemd/system/caddy.service.d/\$name\"
    install -m 644 \"\$f\" \"/etc/systemd/system/caddy.service.d/\$name\"
    need_daemon_reload=1
    need_caddy_reload=1
  fi
done

# 4) journald drop-in
mkdir -p /etc/systemd/journald.conf.d
for f in '$REMOTE_DIR'/deploy/journald.conf.d/*.conf; do
  [ -f \"\$f\" ] || continue
  name=\$(basename \"\$f\")
  if ! cmp -s \"\$f\" \"/etc/systemd/journald.conf.d/\$name\" 2>/dev/null; then
    echo \"  [chg] /etc/systemd/journald.conf.d/\$name\"
    install -m 644 \"\$f\" \"/etc/systemd/journald.conf.d/\$name\"
    need_journald_restart=1
  fi
done

# 应用变化（daemon-reload 必须先于 restart）
[ \$need_daemon_reload -eq 1 ] && { echo '  → systemctl daemon-reload'; systemctl daemon-reload; }
[ \$need_journald_restart -eq 1 ] && { echo '  → systemctl restart systemd-journald'; systemctl restart systemd-journald; }
[ \$need_caddy_reload -eq 1 ] && { echo '  → systemctl reload caddy'; systemctl reload caddy; }
# vision-restart 在下面统一做（无论 unit 是否变都要 restart 让新代码生效）

if [ \$need_daemon_reload -eq 0 ] && [ \$need_caddy_reload -eq 0 ] && [ \$need_journald_restart -eq 0 ]; then
  echo '  无系统配置变化'
fi
"

echo "→ systemctl restart ${SERVICE}（让新代码生效）"
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
