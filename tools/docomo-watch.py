#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ドコモ新着ウォッチ（フロントーク料金ウォッチ）
毎日の定期実行（Routine）が使う。手で試すときは python3 tools/docomo-watch.py。
カーソルの保存・取得は tools/docomo-watch-sync.sh pull / push で（ブランチ docomo-watch-state）。
RSSフィード2本を読み、前回カーソル（docomo-watch-state.json）より新しい記事を出す。
料金に関係しそうなキーワードに掛かる記事は HIT として印を付ける。
- 引数なし: 読み取りのみ（stateは書き換えない）
- --write : 新しいカーソルを docomo-watch-state.json に書き込む
判断・修正・PR作成はこのスクリプトの外（Routineのセッション）で行う。
"""
import json, re, sys, os, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, "docomo-watch-state.json")
FEEDS = {
    "whatsnew":     "https://www.docomo.ne.jp/info/rss/whatsnew.rdf",
    "news_release": "https://www.docomo.ne.jp/info/rss/news_release.rdf",
}
# 拾うキーワード（RSS_WATCH.md と揃える）
KEYWORDS = [
    "料金プラン", "新料金", "料金改定", "改定", "値上げ", "値下げ", "見直し",
    "提供開始", "提供終了", "受付終了", "新設",
    "割引", "キャンペーン", "特典", "還元",
    "爆アゲ", "ポイ活", "dカード", "dポイント", "あんしん", "補償",
    "eximo", "irumo", "ahamo", "ドコモ MAX", "ドコモMAX", "ドコモ mini", "ドコモmini",
    "ギガホ", "ギガライト", "U15", "U22", "はじめてスマホ", "キッズケータイ",
    "データプラス", "いつでもカエドキ", "事務手数料", "頭金",
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
        for i in items:
            if not i["date"] or (cursor and i["date"] <= cursor):
                continue
            if i["link"] in seen_links:
                continue
            seen_links.add(i["link"])
            title = i["title"]
            if any(x in title for x in EXCLUDE):
                continue
            hit = any(k in title for k in KEYWORDS)
            new_items.append({"feed": name, "date": i["date"], "hit": hit, "title": title, "link": i["link"]})
    new_items.sort(key=lambda x: x["date"])
    for i in new_items:
        print("NEW\t%s\t%s\t%s\t%s" % (i["date"][:16], "HIT" if i["hit"] else "-", i["title"], i["link"]))
    for e in errors:
        print("ERROR\t" + e)
    hits = sum(1 for i in new_items if i["hit"])
    print("SUMMARY\tnew=%d\thits=%d\terrors=%d" % (len(new_items), hits, len(errors)))
    if write:
        json.dump({"lastSeen": new_cursor}, open(STATE, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        print("STATE\tカーソルを更新しました")
    return 0

if __name__ == "__main__":
    sys.exit(main())
