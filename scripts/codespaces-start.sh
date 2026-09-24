#!/usr/bin/env bash
# GitHub Codespaces에서 LiveTemplate 서버를 켜고, 다른 사람과 공유할 주소를 알려준다.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3001}"
export PORT

[ -d node_modules ] || npm ci
[ -f client/dist/index.html ] || npm run build

# 이미 켜져 있으면 주소만 다시 안내
if curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
  ALREADY=1
else
  ALREADY=0
  npm start &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1 && break
    sleep 1
  done
fi

if [ -n "${CODESPACE_NAME:-}" ]; then
  DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  URL="https://${CODESPACE_NAME}-${PORT}.${DOMAIN}"
  # 다른 사람도 접속할 수 있게 포트를 Public으로 (권한이 없으면 Ports 탭에서 직접 바꿔야 함)
  if command -v gh >/dev/null 2>&1 && gh codespace ports visibility "${PORT}:public" -c "${CODESPACE_NAME}" >/dev/null 2>&1; then
    VISIBILITY="Public · 링크를 받은 누구나 접속할 수 있습니다"
  else
    VISIBILITY="Private · 팀원과 함께 쓰려면 아래 'Ports' 탭에서 ${PORT} 포트를 우클릭 → Port Visibility → Public"
  fi
  PAGES=""
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    OWNER="$(echo "${GITHUB_REPOSITORY%%/*}" | tr '[:upper:]' '[:lower:]')"
    REPO="${GITHUB_REPOSITORY#*/}"
    PAGES="https://${OWNER}.github.io/${REPO}/?server=${URL}"
  fi
  cat <<MSG

  ┌──────────────────────────────────────────────────────────────
  │  LiveTemplate 이 GitHub Codespaces에서 실행 중입니다
  │
  │  앱 주소        ${URL}
  │  공개 상태      ${VISIBILITY}
MSG
  [ -n "$PAGES" ] && echo "  │  GitHub Pages   ${PAGES}"
  cat <<MSG
  │
  │  · 사용하지 않으면 Codespace가 잠들고, 다시 열면 서버가 자동으로 켜집니다.
  │  · 데이터는 이 Codespace의 data/ 폴더에 저장됩니다.
  └──────────────────────────────────────────────────────────────

MSG
else
  echo "LiveTemplate: http://localhost:${PORT}"
fi

[ "$ALREADY" = "1" ] && exit 0
wait "$SERVER_PID"
