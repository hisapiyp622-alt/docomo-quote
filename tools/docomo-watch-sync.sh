#!/bin/sh
# ドコモ新着ウォッチのカーソル（tools/docomo-watch-state.json）を
# ブランチ docomo-watch-state と同期する。mainの履歴を汚さないための置き場。
#   pull … ブランチから取得（無ければ空のカーソル）
#   push … いまのカーソルをブランチへ保存（履歴は持たない・毎回作り直し）
set -e
cd "$(dirname "$0")/.."
BR=docomo-watch-state
F=tools/docomo-watch-state.json
case "$1" in
  pull)
    if git fetch origin "$BR" 2>/dev/null; then
      git show "origin/$BR:state.json" > "$F"
      echo "pull: ブランチから取得しました"
    else
      echo '{"lastSeen":{}}' > "$F"
      echo "pull: ブランチがまだ無いので空のカーソルにしました"
    fi ;;
  push)
    REMOTE=$(git remote get-url origin)
    T=$(mktemp -d)
    git init -q "$T"
    cp "$F" "$T/state.json"
    git -C "$T" add state.json
    git -C "$T" -c user.name="docomo-watch" -c user.email="watch@frontalk.local" commit -qm "ドコモ新着ウォッチ: カーソル更新"
    git -C "$T" push -f "$REMOTE" HEAD:refs/heads/"$BR"
    rm -rf "$T"
    echo "push: カーソルを保存しました" ;;
  *)
    echo "使い方: docomo-watch-sync.sh pull|push"; exit 1 ;;
esac
