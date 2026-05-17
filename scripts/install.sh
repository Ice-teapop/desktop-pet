#!/usr/bin/env bash
# DeskPet 一键终端安装脚本（macOS）—— Phase 1（unsigned zip 自动 unquarantine）
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/Ice-teapop/desktop-pet/main/scripts/install.sh | bash
#
# 跑完：
#   /Applications/DeskPet.app  装好（已脱 quarantine，下次双击直接打开不报警）
#   桌宠自动启动一次让用户配 Anthropic API key
#
# 卸载：rm -rf /Applications/DeskPet.app ~/Library/Application\ Support/DeskPet

set -euo pipefail

REPO="Ice-teapop/desktop-pet"
APP_NAME="DeskPet"
INSTALL_DIR="/Applications"
TMP_DIR="$(mktemp -d -t deskpet-install.XXXXXX)"

# 颜色 —— 让脚本输出读着不那么干
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERR ]${NC} $*" >&2; }

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# —— Step 1：检测平台 ——
if [[ "$(uname)" != "Darwin" ]]; then
  err "本脚本仅支持 macOS（你跑在 $(uname) 上）"
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  ZIP_PATTERN="arm64-mac.zip" ;;
  x86_64) ZIP_PATTERN="mac.zip" ;; # x64 zip 名字里就叫 "-mac.zip"，没 arch 后缀
  *)
    err "不支持的架构：$ARCH（只支持 arm64 / x86_64）"
    exit 1
    ;;
esac
info "检测到 macOS / $ARCH，匹配 release asset *-${ZIP_PATTERN}"

# —— Step 2：查最新 release ——
info "查询 GitHub Releases 最新版本..."
API_URL="https://api.github.com/repos/$REPO/releases/latest"

# 若 repo 是 private，需要 GH_TOKEN 环境变量
AUTH_HEADER=()
if [[ -n "${GH_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer $GH_TOKEN")
  info "使用 GH_TOKEN 访问 API（适用于 private repo）"
fi

RELEASE_JSON=$(curl -fsSL "${AUTH_HEADER[@]}" "$API_URL" 2>/dev/null || true)
if [[ -z "$RELEASE_JSON" ]]; then
  err "无法获取 release 信息。可能原因："
  err "  1. repo 是 private —— 需要 export GH_TOKEN=<your-token> 后重跑"
  err "  2. 网络问题或还没发布任何 release"
  err "查看可用 release: https://github.com/$REPO/releases"
  exit 1
fi

# 解析 tag + asset URL —— 不依赖 jq（用 python 通用）
TAG=$(echo "$RELEASE_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin).get('tag_name', ''))")
if [[ -z "$TAG" ]]; then
  err "无法解析 release tag"
  echo "$RELEASE_JSON" | head -20 >&2
  exit 1
fi
info "最新版本：$TAG"

ZIP_URL=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for a in d.get('assets', []):
    if a['name'].endswith('$ZIP_PATTERN'):
        print(a['browser_download_url'])
        break
")
if [[ -z "$ZIP_URL" ]]; then
  err "release $TAG 里找不到 *-${ZIP_PATTERN} asset"
  err "可用 assets:"
  echo "$RELEASE_JSON" | python3 -c "
import sys, json
for a in json.load(sys.stdin).get('assets', []):
    print('  -', a['name'])
" >&2
  exit 1
fi
info "下载 URL：$ZIP_URL"

# —— Step 3：下载 ——
ZIP_FILE="$TMP_DIR/deskpet.zip"
info "下载中..."
curl -fL --progress-bar "${AUTH_HEADER[@]}" -o "$ZIP_FILE" "$ZIP_URL"
ok "下载完成 ($(du -h "$ZIP_FILE" | cut -f1))"

# —— Step 4：解压 ——
info "解压..."
unzip -q "$ZIP_FILE" -d "$TMP_DIR"
APP_PATH="$TMP_DIR/${APP_NAME}.app"
if [[ ! -d "$APP_PATH" ]]; then
  err "zip 解压后找不到 ${APP_NAME}.app"
  ls -la "$TMP_DIR" >&2
  exit 1
fi

# —— Step 5：如果已有旧版，备份/替换 ——
TARGET="$INSTALL_DIR/${APP_NAME}.app"
if [[ -d "$TARGET" ]]; then
  warn "已存在旧版 $TARGET，覆盖（你的设置 / 对话历史 / API key 都在 ~/Library/Application Support/DeskPet 不会丢）"
  rm -rf "$TARGET"
fi

# —— Step 6：拷贝 ——
info "安装到 $TARGET..."
cp -R "$APP_PATH" "$TARGET"

# —— Step 7：脱 quarantine（绕过 Gatekeeper "无法验证开发者" 警告） ——
# 这一步是关键 —— xattr 移除 com.apple.quarantine attr 后 macOS 不再首次拦截
# 因为是用户主动执行的本地脚本，不是 .app 自己脱标，属于合法 workflow
info "脱 quarantine（让 macOS 信任本 app）..."
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
ok "DeskPet 已安装到 $TARGET"

# —— Step 8：完成提示 ——
cat <<EOF

$(echo -e "${GREEN}✓ 安装完成${NC}")

下一步：
  1. 在 Spotlight (⌘+空格) 输 DeskPet 启动，或双击 /Applications/DeskPet.app
  2. 首次启动会引导你配置 Anthropic API key —— 必需
     注册：https://console.anthropic.com
  3. （可选）想用 AI 看屏幕：系统设置 → 隐私与安全性 → 屏幕录制 → 加上 DeskPet
  4. （可选）想用 AI 联网搜索：DeskPet 设置面板里填 Tavily API key
     注册：https://tavily.com（免费 1000 次/月）

文档：https://github.com/$REPO

EOF
