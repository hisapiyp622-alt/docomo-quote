#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ドコモ新着ウォッチ（フロントーク料金ウォッチ）
毎日の定期実行（Routine）が使う。手で試すときは python3 tools/docomo-watch.py。
カーソルの保存・取得は tools/docomo-watch-sync.sh pull / push で（ブランチ docomo-watch-state）。
ドコモ公式のRSSフィード8本（通信障害専用の network を除く全部）を読み、
前回カーソル（docomo-watch-state.json）より新しい記事を出す。
料金に関係しそうなキーワードに掛かる記事と、タイトルに「重要」を含む記事は
HIT として印を付ける。
（2026-09-01 教訓: 「お知らせ」だけに載った重要な料金改定を、フィード2本
　だけの監視で見落とした。以後、カテゴリの取りこぼしをしない。）
- 引数なし: 読み取りのみ（stateは書き換えない）
- --write : 新しいカーソルを docomo-watch-state.json に書き込む
判断・修正・PR作成はこのスクリプトの外（Routineのセッション）で行う。
"""
import json, re, sys, os, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, "docomo-watch-state.json")
FEEDS = {
    "whatsnew":     "https://www.docomo.ne.jp/info/rss/whatsnew.rdf",      # 新着情報
    "news_release": "https://www.docomo.ne.jp/info/rss/news_release.rdf",  # 報道発表
    "notice":       "https://www.docomo.ne.jp/info/rss/notice.rdf",        # お知らせ（【重要】の料金改定はここに載る）
    "charge":       "https://www.docomo.ne.jp/info/rss/charge.rdf",        # 料金・割引（2024年から更新停止中だが復活に備えて監視）
    "service":      "https://www.docomo.ne.jp/info/rss/service.rdf",       # サービス・機能
    "support":      "https://www.docomo.ne.jp/info/rss/support.rdf",       # お客様サポート（手続き・手数料の変更が載りうる）
    "product":      "https://www.docomo.ne.jp/info/rss/product.rdf",       # 製品
    "other":        "https://www.docomo.ne.jp/info/rss/other.rdf",         # その他
}
# 拾うキーワード（RSS_WATCH.md と揃える）
KEYWORDS = [
    "料金プラン", "新料金", "料金改定", "改定", "値上げ", "値下げ", "見直し",
    "提供開始", "提供終了", "受付終了", "新設",
    "割引", "キャンペーン", "特典", "還元",
    "爆アゲ", "ポイ活", "dカード", "dポイント", "あんしん", "補償",
    "eximo", "irumo", "ahamo", "ドコモ MAX", "ドコモMAX", "ドコモ mini", "ドコモmini",
    "ギガホ", "ギガライト", "U15", "U22", "はじめてスマホ", "キッズケータイ",
    "データプラス", "いつでもカエドキ", "事務手数料", "手数料", "頭金",
    "年会費", "進呈", "解約金", "違約金", "月額",
    "ドコモ光", "home 5G", "ドコモでんき", "ドコモガス",
]
# タイトルにこれが入っていたら機械的に除外（機種のソフトウェア更新などの定型ノイズ）
EXCLUDE = ["ソフトウェアアップデート情報", "通信障害", "復旧", "サービス安定化"]

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "frontalk-watch/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")

def parse(xml):
    items = []
    for it in re.findall(r"<item[^>]*>(.*?)</item>", xml, re.S):
        def tag(name):
            m = re.search(r"<%s>(.*?)</%s>" % (name, name), it, re.S)
            if not m:
                return ""
            v = m.group(1).strip()
            v = re.sub(r"^<!\[CDATA\[(.*)\]\]>$", r"\1", v, flags=re.S)
            return v.strip()
        items.append({"title": tag("title"), "link": tag("link"), "date": tag("dc:date") or tag("pubDate")})
    return items

def main():
    write = "--write" in sys.argv
    try:
        state = json.load(open(STATE, encoding="utf-8"))
    except Exception:
        state = {"lastSeen": {}}
    new_items, errors = [], []
    seen_links = set()
    new_cursor = dict(state.get("lastSeen", {}))
    # 既読の記事（リンク）。同じ時刻の記事を取りこぼさないため、時刻だけでなく
    # リンクでも既読を判定する（製品化レビュー 4-15。9/1のお知らせは先頭2件が同時刻だった）
    old_seen = state.get("seenLinks", {}) or {}
    new_seen = dict((k, list(v)) for k, v in old_seen.items())
    for name, url in FEEDS.items():
        try:
            xml = fetch(url)
        except Exception as e:
            errors.append("%s: 取得失敗 %s" % (name, e))
            continue
        items = parse(xml)
        if not items:
            errors.append("%s: 記事を1件も読めない（形式が変わった可能性）" % name)
            continue
        cursor = state.get("lastSeen", {}).get(name, "")
        newest = max(i["date"] for i in items if i["date"])
        if not cursor or newest > cursor:
            new_cursor[name] = newest
        seen_feed = set(old_seen.get(name, []))
        # 今回見たリンクを既読に足す（最大300件・新しいものから）
        links_now = [i["link"] for i in items if i.get("link")]
        new_seen[name] = (links_now + [l for l in new_seen.get(name, []) if l not in set(links_now)])[:300]
        for i in items:
            if not i["date"]:
                continue
            # カーソルより古いものは飛ばす。同時刻（==）は既読リンクで判断する
            if cursor and i["date"] < cursor:
                continue
            if i["link"] in seen_feed:
                continue
            if i["link"] in seen_links:
                continue
            seen_links.add(i["link"])
            title = i["title"]
            if any(x in title for x in EXCLUDE):
                continue
            # 「重要」と銘打たれた記事は、キーワードに関わらず必ずHITにする
            hit = ("重要" in title) or any(k in title for k in KEYWORDS)
            new_items.append({"feed": name, "date": i["date"], "hit": hit, "title": title, "link": i["link"]})
    new_items.sort(key=lambda x: x["date"])
    for i in new_items:
        print("NEW\t%s\t%s\t%s\t%s" % (i["date"][:16], "HIT" if i["hit"] else "-", i["title"], i["link"]))
    for e in errors:
        print("ERROR\t" + e)
    hits = sum(1 for i in new_items if i["hit"])
    print("SUMMARY\tnew=%d\thits=%d\terrors=%d" % (len(new_items), hits, len(errors)))
    if write:
        json.dump({"lastSeen": new_cursor, "seenLinks": new_seen}, open(STATE, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        print("STATE\tカーソルと既読一覧を更新しました")
    # 取得に失敗したフィードがあるときは 0 以外で終わる（気づけるように・4-14）
    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main())
