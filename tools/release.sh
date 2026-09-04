#!/bin/sh
# リリースを1本のコマンドで行う（製品化レビュー 4-27／4-33）
#
#   sh tools/release.sh            … 確認だけして、配信はしない（下ごしらえ）
#   sh tools/release.sh --ship     … 配信用リポジトリへ反映し、版のタグを打つ
#
# やること:
#   1. テストを全部通す
#   2. リリースの決まりを確認（版の一致・キャッシュ名・生成物の鮮度）
#   3. 出荷用（独自ドメイン版）を作る
#   4. --ship のとき: 配信用リポジトリ（frontalk）へ反映し、git tag を打つ
#
# 「配った版に戻す」手順は非公開リポジトリの OPERATIONS.md にあります。
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

SHIP=0
[ "$1" = "--ship" ] && SHIP=1

# 配信用リポジトリの場所（無ければ --ship はできない）
FRONTALK=${FRONTALK_DIR:-/workspace/frontalk}
DIST=${DIST_DIR:-/tmp/frontalk-dist}

VER=$(sed -n 's/.*var APP_VERSION = "\([^"]*\)".*/\1/p' keitai-app/app.js | head -1)
echo "== フロントーク $VER のリリース準備 =="

echo "-- 1. テスト"
node tests/run-calc-tests.js
node tests/run-bill-tests.js
node tests/run-ienaka-tests.js
node tests/run-master-update-tests.js
node tests/run-migrate-tests.js
node tests/run-wording-tests.js
node tests/run-diag-tests.js
node tests/run-product-layout-test.js

echo "-- 2. リリースの決まり"
node tools/release-check.js

echo "-- 3. 出荷用を作る"
rm -rf "$DIST"
node tools/build-product.js "$DIST" >/dev/null
echo "出荷用: $DIST（$(sed -n 's/.*var APP_VERSION = "\([^"]*\)".*/\1/p' "$DIST/app.js" | head -1)）"

if [ "$SHIP" -eq 0 ]; then
  echo ""
  echo "ここまでで問題なし。配信するには:"
  echo "  sh tools/release.sh --ship"
  exit 0
fi

if [ ! -d "$FRONTALK/.git" ]; then
  echo "配信用リポジトリが $FRONTALK にありません（FRONTALK_DIR で場所を指定できます）" >&2
  exit 1
fi

echo "-- 4. 配信用リポジトリへ反映"
cd "$FRONTALK"
git pull -q origin main
find . -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +
cp -a "$DIST/." .
git add -A
if git diff --cached --quiet; then
  echo "配信用に変更はありません（すでに $VER が入っています）"
else
  git commit -q -m "$VER"
  git push -q origin main
  echo "配信しました（frontalk main）"
fi

cd "$ROOT"
echo "-- 5. 版の目印"
# 配ったものがどのコミットかを、あとから確実にたどれるようにする（戻すときに使う）
if git rev-parse "v$VER" >/dev/null 2>&1; then
  echo "タグ v$VER はすでにあります（手元）"
else
  git tag -a "v$VER" -m "フロントーク $VER"
fi
if git push -q origin "v$VER" 2>/dev/null; then
  echo "タグ v$VER を打ちました（戻すときの目印）"
else
  # タグを送れない環境がある（権限が絞られた自動実行など）。
  # そのときは同じ意味の「目印のブランチ」を作る。戻す手順はどちらでも同じ。
  if git push -q origin "HEAD:refs/heads/release/v$VER" 2>/dev/null; then
    echo "目印のブランチ release/v$VER を作りました（タグは送れなかったため）"
  else
    echo "※ 版の目印を送れませんでした。手元のタグ v$VER だけがあります。"
  fi
fi

echo ""
echo "公開の確認（数分かかります）:"
echo "  curl -s https://frontalk.curacon.co.jp/app.js | grep -m1 APP_VERSION"
