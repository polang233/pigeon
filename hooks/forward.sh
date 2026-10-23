#!/bin/sh
# 把 Claude Code hook 的 JSON 原样转给 Meerkat。
# 在后台发送、最多等 1 秒，Meerkat 没开时静默失败，不会拖慢或打断 Claude Code。
body=$(cat)
(printf '%s' "$body" | curl -s -m 1 -o /dev/null -X POST \
  -H 'content-type: application/json' --data-binary @- \
  "http://127.0.0.1:${MEERKAT_PORT:-47321}/ev" >/dev/null 2>&1 &)
exit 0
