#!/bin/sh
# Firestore ルールのテスト（製品化レビュー 4-25）
#
#   sh tools/test-rules.sh
#
# エミュレータ（本物と同じルール実行エンジン）を立ち上げ、
# tests/rules/run-rules-tests.js を流します。Java が必要です。
# 必要なパッケージが無ければ、その場で入れます（node_modules は残ります）。
set -e
cd "$(dirname "$0")/.."
if [ ! -d node_modules/@firebase/rules-unit-testing ] || [ ! -d node_modules/firebase-tools ]; then
  echo "必要なものを入れます（初回だけ・1分ほど）…"
  npm install --no-audit --no-fund --no-save @firebase/rules-unit-testing firebase-tools >/dev/null
fi
npx --no-install firebase-tools emulators:exec --only firestore --project demo-frontalk \
  "node tests/rules/run-rules-tests.js"
