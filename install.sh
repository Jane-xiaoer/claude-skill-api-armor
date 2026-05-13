#!/usr/bin/env bash
# api-armor skill installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/Jane-xiaoer/claude-skill-api-armor/main/install.sh)

set -e

SKILLS_DIR="${SKILLS_DIR:-$HOME/.shared-skills}"
TARGET="$SKILLS_DIR/api-armor"
REPO="https://github.com/Jane-xiaoer/claude-skill-api-armor.git"

echo "→ Installing api-armor to $TARGET"
mkdir -p "$SKILLS_DIR"

if [ -d "$TARGET/.git" ]; then
  echo "→ Already installed, pulling latest"
  cd "$TARGET" && git pull --ff-only
else
  if [ -d "$TARGET" ]; then
    echo "→ $TARGET exists but is not a git checkout. Backing up to $TARGET.bak.$(date +%s)"
    mv "$TARGET" "$TARGET.bak.$(date +%s)"
  fi
  git clone --depth 1 "$REPO" "$TARGET"
fi

echo ""
echo "✓ Installed at $TARGET"
echo ""
echo "→ To register the trigger keywords in SKILLS_MAP.md (optional):"
echo "  add a row to $SKILLS_DIR/SKILLS_MAP.md under '## 开发工具':"
echo ""
echo "  | API key 泄漏/防白嫖/限流/三层鉴权/保护我的 API/给项目加固 | api-armor | 后端代理 + Upstash 限流 |"
echo ""
echo "→ Then in Claude Code, just say:"
echo "  「这个项目要上线，里面有 API，帮我加固」"
echo ""
