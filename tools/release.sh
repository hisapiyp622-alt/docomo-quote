#!/bin/sh
# リリースを1本のコマンドで行う（製品化レビュー 4-27／4-33）
#
#   sh tools/release.sh            … 確認だけして、配信はしない（下ごしらえ）
#   sh tools/release.sh --pr       … 配信用リポジトリに枝 release/v<版> を作って push し、版のタグを打つ
#                                    （配信用の main へは直接 push しない。PR → マージで反映する）
#
# やること:
#   1. テストを全部通す
#   2. リリースの決まりを確認（版の一致・キャッシュ名・生成物の鮮度）
#   3. 出荷用（独自ドメイン版）を作る
#   4. --pr のとき: 配信用リポジトリ（frontalk）の枝に入れて push し、git tag を打つ
#
# --ship（配信用 main へ直接 push）は 2026-09-08 に止めた（引っ越しの指示書: main へ直接 push しない）。
# 引っ越し後の配信は CI（.github/workflows/ci.yml の deploy）が Cloudflare Pages へ行う。
# 「配った版に戻す」手順は非公開リポジトリの OPERATIONS.md にあります。
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

SHIP=0
if [ "$1" = "--ship" ]; then
  echo "--ship（配信用 main への直接 push）は使えません。--pr で枝に入れて、PR → マージで反映してください。" >&2
  exit 1
fi
[ "$1" = "--pr" ] && SHIP=1

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
node tests/run-sync-tests.js
node tests/run-diag-tests.js
node tests/run-touch-tests.js
node tests/run-lines-tests.js
node tests/run-device-master-tests.js
node tests/run-template-tests.js
node tests/run-fresh-tests.js
node tests/run-move-tests.js
node tools/build-agents.js --check
node tests/run-product-layout-test.js
node tests/run-internal-layout-test.js
node tests/run-oldsite-stub-test.js

echo "-- 2. リリースの決まり"
node tools/release-check.js

echo "-- 3. 出荷用を作る"
rm -rf "$DIST"
node tools/build-product.js "$DIST" >/dev/null
echo "出荷用: $DIST（$(sed -n 's/.*var APP_VERSION = "\([^"]*\)".*/\1/p' "$DIST/app.js" | head -1)）"

if [ "$SHIP" -eq 0 ]; then
  echo ""
  echo "ここまでで問題なし。配信用リポジトリの枝に入れるには:"
  echo "  sh tools/release.sh --pr"
  exit 0
fi

if [ ! -d "$FRONTALK/.git" ]; then
  echo "配信用リポジトリが $FRONTALK にありません（FRONTALK_DIR で場所を指定できます）" >&2
  exit 1
fi

echo "-- 4. 配信用リポジトリの枝へ入れる（main へは直接 push しない）"
BR="release/v$VER"
cd "$FRONTALK"
# 指す先が本当に配信用リポジトリ（frontalk）か。違う場所を指していると、その中身を丸ごと消してしまう
case "$(git remote get-url origin 2>/dev/null)" in
  */frontalk|*/frontalk.git) ;;
  *) echo "$FRONTALK は配信用リポジトリ（frontalk）ではありません（origin: $(git remote get-url origin 2>/dev/null)）。FRONTALK_DIR を確かめてください" >&2; exit 1 ;;
esac
git fetch -q origin main
git checkout -q -B "$BR" origin/main
find . -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +
cp -a "$DIST/." .
git add -A
if git diff --cached --quiet; then
  echo "配信用に変更はありません（すでに $VER が入っています）"
  git checkout -q main 2>/dev/null || true
else
  git commit -q -m "$VER"
  git push -q -u origin "$BR" --force-with-lease
  echo "配信用リポジトリに枝 $BR を push しました。"
  echo "  次: frontalk で $BR → main の PR を作り、CI が通ったらマージする（マージで公開される）"
  git checkout -q main 2>/dev/null || true
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
