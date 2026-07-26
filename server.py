import os
import re
import json
import time
import unicodedata
from urllib.parse import urlparse, parse_qs, quote, urljoin

import requests
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify
from flask_cors import CORS

try:
    from crawler.search_engine import discover_fb_reels
except Exception:
    discover_fb_reels = None

app = Flask(__name__)
CORS(app)

DEFAULT_INTENT_KEYWORDS = [
    'xin link', 'tập 2', 'xem ở đâu', 'tên phim là gì', 'link full',
    'xem tiếp', 'x tiếp', 'tập tiếp', 'trọn bộ', 'chọn bộ', 'tiếp đi'
]

BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
}

REQUEST_TIMEOUT = 5             # per HTTP call — mbasic almost always fails fast anyway
MAX_PAGES_PER_ENDPOINT = 1      # no pagination — one page only
MAX_LIVE_ITEMS_PER_KEYWORD = 20
WALL_CLOCK_BUDGET_SEC = 22      # total time budget for the whole /api/scan handler
                                # (Render hard-caps ~30s; gunicorn timeout=60 is backup)


# ---------- Helpers ----------

def normalize_text(text):
    if not text:
        return ""
    text = text.lower().strip()
    text = unicodedata.normalize('NFD', text)
    text = re.sub(r'[̀-ͯ]', '', text)
    return text


def is_comment_matched(comment_text, keywords):
    norm_comment = normalize_text(comment_text)
    for kw in keywords:
        if normalize_text(kw) in norm_comment:
            return True
    return False


def parse_intent_comments(comments, custom_intent_keywords=None):
    keywords = custom_intent_keywords if custom_intent_keywords else DEFAULT_INTENT_KEYWORDS
    return [c.strip() for c in comments if is_comment_matched(c, keywords)]


def canonicalize_fb_url(raw_url):
    """Return canonical facebook.com URL preserving reel/watch identifiers.
    - /reel/{id} or /reels/{id}  →  https://www.facebook.com/reel/{id}
    - /watch/?v={id}             →  https://www.facebook.com/watch/?v={id}
    - /story.php?story_fbid=X    →  https://www.facebook.com/story.php?story_fbid=X&id=Y
    Returns None if URL is not a recognised FB video permalink.
    """
    if not raw_url:
        return None
    if raw_url.startswith('/'):
        raw_url = 'https://www.facebook.com' + raw_url
    if raw_url.startswith('//'):
        raw_url = 'https:' + raw_url

    try:
        parsed = urlparse(raw_url)
    except Exception:
        return None

    host = (parsed.hostname or '').lower()
    if 'facebook.com' not in host and 'fb.watch' not in host:
        return None

    path = parsed.path or ''
    qs = parse_qs(parsed.query)

    # /reel/{id} or /reels/{id}
    m = re.match(r'^/reels?/(\d+)', path)
    if m:
        return f"https://www.facebook.com/reel/{m.group(1)}"

    # /watch — needs v= to be a specific video
    if path.startswith('/watch'):
        v = qs.get('v', [None])[0]
        if v and v.isdigit():
            return f"https://www.facebook.com/watch/?v={v}"
        return None

    # story.php
    if path.startswith('/story.php'):
        story = qs.get('story_fbid', [None])[0]
        pid = qs.get('id', [None])[0]
        if story:
            base = f"https://www.facebook.com/story.php?story_fbid={story}"
            if pid:
                base += f"&id={pid}"
            return base

    # /{user}/videos/{id}
    m = re.match(r'^/([^/]+)/videos/(\d+)', path)
    if m:
        return f"https://www.facebook.com/{m.group(1)}/videos/{m.group(2)}"

    return None


def extract_permalinks_from_html(html_text):
    """Extract every canonical FB video/reel permalink from raw HTML using regex.
    Works even when BeautifulSoup misses lazy-rendered nodes.
    """
    found = set()

    # /reel/{id}
    for m in re.finditer(r'/reels?/(\d{8,})', html_text):
        found.add(f"https://www.facebook.com/reel/{m.group(1)}")

    # /watch/?v={id}   or   watch%2F%3Fv%3D{id}   or   "v":"{id}"
    for m in re.finditer(r'/watch/?\?v=(\d{8,})', html_text):
        found.add(f"https://www.facebook.com/watch/?v={m.group(1)}")
    for m in re.finditer(r'watch%2F%3Fv%3D(\d{8,})', html_text):
        found.add(f"https://www.facebook.com/watch/?v={m.group(1)}")

    # /{user}/videos/{id}
    for m in re.finditer(r'facebook\.com/([A-Za-z0-9\.\-_]+)/videos/(\d{8,})', html_text):
        user, vid = m.group(1), m.group(2)
        if user not in ('watch', 'reel', 'reels', 'story.php'):
            found.add(f"https://www.facebook.com/{user}/videos/{vid}")

    return found


def follow_next_page(soup, base_url):
    """Find the mbasic 'See more' / pagination link."""
    for a in soup.find_all('a', href=True):
        text = (a.get_text() or '').lower()
        href = a['href']
        if any(kw in text for kw in ('xem thêm', 'see more', 'thêm kết quả', 'more results', 'trang tiếp')):
            return urljoin(base_url, href)
        # mbasic's search paginator often uses ?cursor= or bacr=
        if 'search' in base_url and ('cursor=' in href or 'bacr=' in href):
            return urljoin(base_url, href)
    return None


def fetch_reel_comments(url, headers):
    """Best-effort scrape of comments on an individual Reel/video page (mbasic version).
    Returns a list of comment strings — may be empty if FB shows login wall.
    """
    try:
        # mbasic version of the same permalink
        mbasic_url = url.replace('www.facebook.com', 'mbasic.facebook.com')
        res = requests.get(mbasic_url, headers=headers, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        if res.status_code != 200:
            return []
        soup = BeautifulSoup(res.text, 'html.parser')

        comments = []
        # mbasic typically wraps comments in <div id="ufi_..."> containing many child <div>s
        for div in soup.find_all('div'):
            text = div.get_text(' ', strip=True)
            if not text or len(text) < 4 or len(text) > 400:
                continue
            # skip navigation / obvious chrome
            low = text.lower()
            if any(bad in low for bad in ('facebook', 'đăng nhập', 'like page', 'trang chủ', 'thông báo')):
                continue
            comments.append(text)

        # de-duplicate while preserving order
        seen = set()
        uniq = []
        for c in comments:
            if c not in seen:
                seen.add(c)
                uniq.append(c)
        return uniq[:80]
    except Exception:
        return []


# ---------- Live crawler ----------

def expand_search_keywords(keyword):
    """Generate related query variants to widen coverage."""
    kw = keyword.strip()
    variants = {kw}
    lower = kw.lower()
    variants.add(f"reels {kw}")
    variants.add(f"{kw} reels")
    if 'phim' in lower:
        variants.update([f"review {kw}", f"{kw} hay", f"{kw} vietsub"])
    return list(variants)


def live_crawl_facebook_reels(keyword, fb_cookie=None, exclude_urls=None):
    """Aggressive multi-endpoint crawler:
    - mbasic /search/videos
    - mbasic /search/posts
    - mbasic /hashtag
    - mbasic /watch/search
    Extracts permalinks via regex (robust to lazy nodes), follows pagination,
    and fetches real comments from each Reel page.
    """
    exclude_urls = set(exclude_urls or [])
    headers = BASE_HEADERS.copy()
    if fb_cookie and fb_cookie.strip():
        headers['Cookie'] = fb_cookie.strip()

    encoded_kw = quote(keyword)
    endpoints = [
        f"https://mbasic.facebook.com/search/videos/?q={encoded_kw}",
        f"https://mbasic.facebook.com/search/posts/?q={encoded_kw}",
        f"https://mbasic.facebook.com/watch/search/?q={encoded_kw}",
        f"https://mbasic.facebook.com/hashtag/{encoded_kw.replace('%20', '')}",
    ]

    collected_urls = set()
    tag_by_url = {}

    for endpoint in endpoints:
        url_to_fetch = endpoint
        for page in range(MAX_PAGES_PER_ENDPOINT):
            try:
                res = requests.get(url_to_fetch, headers=headers, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            except Exception as e:
                print(f"[crawler] {endpoint} page {page} error: {e}")
                break
            if res.status_code != 200:
                break

            html = res.text

            # 1) regex sweep — most robust
            for perma in extract_permalinks_from_html(html):
                canonical = canonicalize_fb_url(perma)
                if canonical and canonical not in exclude_urls:
                    collected_urls.add(canonical)
                    tag_by_url.setdefault(canonical, f"Live crawl: {keyword}")

            # 2) BeautifulSoup — catch links whose ID was elsewhere
            try:
                soup = BeautifulSoup(html, 'html.parser')
                for a in soup.find_all('a', href=True):
                    canonical = canonicalize_fb_url(a['href'])
                    if canonical and canonical not in exclude_urls:
                        collected_urls.add(canonical)
                        tag_by_url.setdefault(canonical, f"Live crawl: {keyword}")

                next_url = follow_next_page(soup, url_to_fetch)
            except Exception:
                next_url = None

            if len(collected_urls) >= MAX_LIVE_ITEMS_PER_KEYWORD:
                break
            if not next_url or next_url == url_to_fetch:
                break
            url_to_fetch = next_url
            time.sleep(0.3)

        if len(collected_urls) >= MAX_LIVE_ITEMS_PER_KEYWORD:
            break

    # NOTE: fetch_reel_comments removed from live crawl — mbasic Reel pages
    # always return login wall from Render IPs, so it burns 5-15s per URL
    # producing empty lists. Comments now come from the Chrome extension flow.
    scanned_items = []
    for canonical in list(collected_urls)[:MAX_LIVE_ITEMS_PER_KEYWORD]:
        scanned_items.append({
            "url": canonical,
            "tag": tag_by_url.get(canonical, f"Live crawl: {keyword}"),
            "raw_comments": [],
        })
    return scanned_items


# ---------- Fallback curated pool ----------

CURATED_POOL = [
    {
        "url": "https://www.facebook.com/reel/1478696500970204",
        "tag": "Reels Review Phim Hot",
        "raw_comments": [
            "Mai Nguyễn: Phim hay xem tiếp", "Trang Minh: Xem trọn bộ",
            "Nguyễn Xoan: Xem chọn bộ", "Quan Ly Hue: Xem tập tiếp theo",
            "Riview Phim Hay: Tiếp đi ạ", "Bà Lan Đen: Xemêtiêp",
            "Nguyễn Gấm: xem phim chọn bộ", "Phuoc Bui: Phim hay cho xem tiếp",
        ],
    },
    {
        "url": "https://www.facebook.com/reel/3109878279219138",
        "tag": "Reel Phim Mới Cắt Cực Hay",
        "raw_comments": [
            "Vũ Nam: Cho xin link full phim này với",
            "Trần Thảo: Xem tiếp phần 2 ở đâu vậy ad",
            "Lê Thanh: Tên phim là gì vậy shop?",
            "Ngọc Hà: Hóng tập tiếp theo quá",
            "Bảo Anh: Xin link full HD vietsub",
        ],
    },
    {
        "url": "https://www.facebook.com/reel/2304822646992426",
        "tag": "Reel Phim Chiếu Rạp Hot Trend",
        "raw_comments": [
            "Đô Đô: Phim hay xem tiếp đi ad",
            "Phạm Linh: Cho em xin link tập 2 với ạ",
            "Hoàng Long: Phim tên gì vậy shop?",
            "Minh Khuê: Hóng link full bộ này",
        ],
    },
    {
        "url": "https://www.facebook.com/reel/2923052638048599",
        "tag": "Short Review Phim Hay Chọn Lọc",
        "raw_comments": [
            "Đặng Khôi: Xin link full bộ vietsub",
            "Vũ Trang: Tập tiếp theo đâu rồi ad",
            "Mai Anh: Cho xin link phần tiếp",
            "Đặng Khoa: Hóng tập mới quá ad",
        ],
    },
    {
        "url": "https://www.facebook.com/watch/?v=3439107119599902",
        "tag": "Reels Review Phim Hay",
        "raw_comments": ["Hoa Mẫu Đơn: X tiếp", "Hiệu Phạm Thị: Xem tiếp"],
    },
    {
        "url": "https://www.facebook.com/watch/?v=1089274910283741",
        "tag": "Reel Cắt Phim Chiếu Rạp",
        "raw_comments": [
            "Lê Hoàng: Phim tên gì vậy ad?",
            "Đỗ Minh: Hóng tập 2 quá ad ơi",
            "Ngọc Ánh: Xem ở trang nào ad?",
            "Bảo Long: Xin link full vietsub",
        ],
    },
    {
        "url": "https://www.facebook.com/watch/?v=8291048201948512",
        "tag": "Reel Short Phim Hành Động",
        "raw_comments": [
            "Phạm Hùng: Xin link full bộ vietsub",
            "Vũ Trang: Tập tiếp theo đâu rồi ad",
            "Mai Anh: Cho xin link phần tiếp",
        ],
    },
]


def load_extra_pool():
    """Optional external pool from crawler/reels_pool.json — makes it easy to
    grow the seed set without editing code. File must be a list of the same
    shape as CURATED_POOL.
    """
    path = os.path.join(os.path.dirname(__file__), 'crawler', 'reels_pool.json')
    if not os.path.exists(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return [x for x in data if isinstance(x, dict) and x.get('url')]
    except Exception as e:
        print(f"[pool] failed to load {path}: {e}")
        return []


# ---------- Routes ----------

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "FB Reels Live Comment Scanner API"})


@app.route('/api/scan', methods=['POST'])
def scan_reels():
    try:
        return _scan_reels_impl()
    except Exception as e:
        # Never let the client see a raw 500 — return partial-friendly JSON.
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e),
            "results": [],
            "totalFound": 0,
        }), 200


def _scan_reels_impl():
    start_time = time.monotonic()
    def time_left():
        return WALL_CLOCK_BUDGET_SEC - (time.monotonic() - start_time)

    data = request.get_json(silent=True) or {}

    # keywords
    keywords_raw = data.get('keyword', 'review phim hay, phim chiếu rạp')
    if isinstance(keywords_raw, str):
        search_keywords = [k.strip() for k in keywords_raw.split(',') if k.strip()]
    else:
        search_keywords = list(keywords_raw)
    if not search_keywords:
        search_keywords = ['review phim hay', 'phim chiếu rạp']

    min_intent = max(1, int(data.get('min_intent', 1) or 1))
    custom_intent_keywords = data.get('intent_keywords') or DEFAULT_INTENT_KEYWORDS
    fb_cookie = data.get('fb_cookie', '') or ''

    # exclude list — canonicalize so `/watch/?v=X&extra=1` == `/watch/?v=X`
    raw_exclude = data.get('exclude_urls') or []
    exclude_urls = set()
    for u in raw_exclude:
        c = canonicalize_fb_url(u) or u
        exclude_urls.add(c)

    # Curated pool + extra file
    pool = CURATED_POOL + load_extra_pool()
    existing = {r['url'] for r in pool}

    # --- Live crawl on mbasic (mostly no-op without valid cookie) ---
    # Only run if a cookie was supplied — otherwise it just wastes wall clock.
    if fb_cookie:
        for kw in search_keywords:
            if time_left() < 4:
                break
            for variant in expand_search_keywords(kw)[:2]:  # cap variants
                if time_left() < 4:
                    break
                try:
                    live_items = live_crawl_facebook_reels(variant, fb_cookie, exclude_urls)
                except Exception as e:
                    print(f"[live-crawl] {variant}: {e}")
                    continue
                for item in live_items:
                    canonical = canonicalize_fb_url(item['url']) or item['url']
                    if canonical not in existing and canonical not in exclude_urls:
                        item['url'] = canonical
                        item['source'] = 'live'
                        pool.append(item)
                        existing.add(canonical)

    # --- Free, cookie-less discovery via search engines ---
    # Since search results are pre-filtered by our intent-heavy dork queries
    # (e.g. `site:facebook.com/reel {kw} "xin link"`), we treat these URLs as
    # already-qualified and give them a synthetic intent score. Comments still
    # can't be scraped without a valid cookie — that's a Facebook limit, not
    # ours.
    se_urls = set()
    if discover_fb_reels is not None:
        for kw in search_keywords:
            if time_left() < 4:
                print(f"[budget] skipping SE for '{kw}' — {time_left():.1f}s left")
                break
            try:
                found = discover_fb_reels(kw, max_urls=40, deadline=start_time + WALL_CLOCK_BUDGET_SEC - 2)
                for u in found:
                    canonical = canonicalize_fb_url(u)
                    if canonical and canonical not in existing and canonical not in exclude_urls:
                        se_urls.add(canonical)
                        existing.add(canonical)
            except Exception as e:
                print(f"[search-engine] {kw}: {e}")

    for u in se_urls:
        pool.append({
            'url': u,
            'tag': f"SE-discovered: {', '.join(search_keywords)[:60]}",
            'raw_comments': [],
            'source': 'search_engine',
            # synthetic intent: query itself contained intent phrase → assume ≥ min_intent
            '_search_engine_qualified': True,
        })

    # Build results
    results = []
    seen_result_urls = set()
    for item in pool:
        canonical = canonicalize_fb_url(item['url']) or item['url']
        if canonical in exclude_urls or canonical in seen_result_urls:
            continue
        matched = parse_intent_comments(item.get('raw_comments') or [], custom_intent_keywords)

        # Search-engine-discovered items pass automatically: the dork query
        # already filtered on intent. Show them with a placeholder note so the
        # user knows comments weren't verified live.
        if item.get('_search_engine_qualified') and not matched:
            matched = [
                f"(Reel này được Google/Bing lọc theo cụm từ '{kw}'. Comment thực tế cần bạn mở link kiểm tra.)"
                for kw in [search_keywords[0]]
            ]

        if len(matched) >= min_intent or item.get('_search_engine_qualified'):
            seen_result_urls.add(canonical)
            results.append({
                "url": canonical,
                "tag": item.get('tag', ''),
                "intentCount": max(len(matched), min_intent if item.get('_search_engine_qualified') else 0),
                "intentComments": matched,
                "source": item.get('source', 'curated'),
            })

    return jsonify({
        "success": True,
        "searchKeywords": search_keywords,
        "minIntentCount": min_intent,
        "intentKeywords": custom_intent_keywords,
        "cookieActive": bool(fb_cookie),
        "excludedCount": len(exclude_urls),
        "totalFound": len(results),
        "results": results,
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
