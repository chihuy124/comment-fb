"""Free, automatic FB Reel discovery via search-engine dorking.

Uses DuckDuckGo HTML, Bing, and Google as sources. No FB cookie required,
no paid API — search engines already index public Reels.
"""
import re
import time
from urllib.parse import quote, urlparse, parse_qs, unquote

import requests
from bs4 import BeautifulSoup

REQUEST_TIMEOUT = 6

UA_POOL = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
]

REEL_ID_RE = re.compile(r'facebook\.com/reels?/(\d{8,})')
WATCH_ID_RE = re.compile(r'facebook\.com/watch/?\?(?:[^"\']*&)?v=(\d{8,})')
FBWATCH_SHORT_RE = re.compile(r'fb\.watch/([A-Za-z0-9_-]{6,})')


def _headers(i=0):
    return {
        'User-Agent': UA_POOL[i % len(UA_POOL)],
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }


def _extract_fb_urls(html):
    """Pull every facebook.com reel/watch permalink out of raw HTML."""
    urls = set()
    for m in REEL_ID_RE.finditer(html):
        urls.add(f"https://www.facebook.com/reel/{m.group(1)}")
    for m in WATCH_ID_RE.finditer(html):
        urls.add(f"https://www.facebook.com/watch/?v={m.group(1)}")
    # fb.watch short links – resolve later if needed; keep raw for dedupe fallback
    for m in FBWATCH_SHORT_RE.finditer(html):
        urls.add(f"https://fb.watch/{m.group(1)}")
    return urls


def _clean_ddg_href(href):
    """DuckDuckGo wraps external links in /l/?uddg=<url>&…"""
    try:
        parsed = urlparse(href)
        if parsed.path.startswith('/l/'):
            uddg = parse_qs(parsed.query).get('uddg', [None])[0]
            if uddg:
                return unquote(uddg)
    except Exception:
        pass
    return href


def _deadline_ok(deadline):
    return deadline is None or time.monotonic() < deadline


def duckduckgo_search(query, max_pages=1, deadline=None):
    urls = set()
    base = "https://html.duckduckgo.com/html/"
    session = requests.Session()
    s = 0
    for page in range(max_pages):
        if not _deadline_ok(deadline):
            break
        try:
            data = {'q': query, 's': str(s), 'dc': str(s + 30)}
            r = session.post(base, data=data, headers=_headers(page), timeout=REQUEST_TIMEOUT)
            if r.status_code != 200:
                break
            found_this_page = _extract_fb_urls(r.text)
            soup = BeautifulSoup(r.text, 'html.parser')
            for a in soup.select('a.result__a, a.result__url'):
                real = _clean_ddg_href(a.get('href', ''))
                found_this_page |= _extract_fb_urls(real)
            if not found_this_page:
                break
            urls |= found_this_page
            s += 30
        except Exception as e:
            print(f"[ddg] {e}")
            break
    return urls


def bing_search(query, max_pages=1, deadline=None):
    urls = set()
    for page in range(max_pages):
        if not _deadline_ok(deadline):
            break
        first = page * 10 + 1
        try:
            r = requests.get(
                f"https://www.bing.com/search?q={quote(query)}&first={first}",
                headers=_headers(page + 1),
                timeout=REQUEST_TIMEOUT,
            )
            if r.status_code != 200:
                break
            found = _extract_fb_urls(r.text)
            if not found:
                break
            urls |= found
        except Exception as e:
            print(f"[bing] {e}")
            break
    return urls


def google_search(query, max_pages=1, deadline=None):
    urls = set()
    for page in range(max_pages):
        if not _deadline_ok(deadline):
            break
        start = page * 10
        try:
            r = requests.get(
                f"https://www.google.com/search?q={quote(query)}&start={start}&hl=vi",
                headers=_headers(page + 2),
                timeout=REQUEST_TIMEOUT,
            )
            if r.status_code != 200:
                break
            urls |= _extract_fb_urls(r.text)
        except Exception as e:
            print(f"[google] {e}")
            break
    return urls


def build_dork_queries(keyword):
    """Generate a spread of dork queries — different phrasings surface
    different Reels because search engines rank very differently.
    """
    kw = keyword.strip()
    intent_phrases = ['xin link', 'tập 2', 'link full', 'xem tiếp', 'tên phim gì', 'trọn bộ']
    q = [
        f'site:facebook.com/reel {kw}',
        f'site:facebook.com/watch {kw}',
        f'"facebook.com/reel" {kw}',
        f'"facebook.com/reel" {kw} review',
    ]
    for ip in intent_phrases:
        q.append(f'site:facebook.com/reel {kw} "{ip}"')
    return q


def discover_fb_reels(keyword, max_urls=40, deadline=None):
    """Aggregate results across engines and queries. Respects deadline.
    Query fan-out is capped tight so we don't burn the Render 30s budget.
    """
    all_urls = set()
    # Only 3 highest-signal dork queries — full list was too expensive
    queries = [
        f'site:facebook.com/reel {keyword}',
        f'site:facebook.com/watch {keyword}',
        f'site:facebook.com/reel {keyword} "xin link"',
    ]
    for query in queries:
        if len(all_urls) >= max_urls or not _deadline_ok(deadline):
            break
        all_urls |= duckduckgo_search(query, max_pages=1, deadline=deadline)
        if len(all_urls) >= max_urls or not _deadline_ok(deadline):
            break
        all_urls |= bing_search(query, max_pages=1, deadline=deadline)
    if len(all_urls) < 5 and _deadline_ok(deadline):
        all_urls |= google_search(f'site:facebook.com/reel {keyword}', max_pages=1, deadline=deadline)
    return list(all_urls)[:max_urls]
