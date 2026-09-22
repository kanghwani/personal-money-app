#!/bin/zsh
# 맥용 eventsync: /api/events 를 받아 미리알림 "이벤트" 목록에 [지원](마감 전날 09:00)·[결과](발표일 09:00) 를 만든다.
# launchd(~/Library/LaunchAgents/com.hwan.eventsync.plist)가 매일 09:00 + 로그인 시 돌린다.
#   ALL=1 scripts/eventsync.sh   → 서버에 남은 이벤트 전부 다시 받아 만든다(미리알림을 지웠을 때). 이미 있는 제목은 건너뜀.
# 단축어 대신 AppleScript 를 쓰는 이유: 단축어의 "미리알림 추가"가 기한을 안 넣고 반복 중 일부를 조용히 빠뜨렸다(2026-09-22, 80개 중 59개).
set -u
DIR=${0:A:h}
TOKEN=$(grep '^VITE_SYNC_TOKEN=' "$DIR/../.env" | cut -d= -f2- | tr -d '[:space:]')
URL="https://personal-money-app-seven.vercel.app/api/events?t=$TOKEN${ALL:+&all=1}"
tmp=$(mktemp -t eventsync).json
/usr/bin/curl -sf --max-time 90 "$URL" -o "$tmp" || { echo "$(date '+%F %T') 서버 실패"; rm -f "$tmp"; exit 1 }
/usr/bin/osascript -l JavaScript "$DIR/eventsync.js" "$tmp"
rm -f "$tmp"
