#!/bin/sh
# 店舗の開通スクリプトの練習（製品化レビュー 4-24）
#
#   sh tools/test-provision.sh
#
# Firebase のエミュレータ（Authentication＋Firestore）を立ち上げ、
# tools/provision-store.js を本番と同じ手順で流します。
# **本番のプロジェクトには何も起きません。** Java が必要です。
set -e
cd "$(dirname "$0")/.."
if [ ! -d node_modules/firebase-admin ] || [ ! -d node_modules/firebase-tools ]; then
  echo "必要なものを入れます（初回だけ・1〜2分）…"
  npm install --no-audit --no-fund --no-save firebase-admin firebase-tools >/dev/null
fi
npx --no-install firebase-tools emulators:exec --only auth,firestore --project demo-frontalk \
  "node tests/run-provision-tests.js"
