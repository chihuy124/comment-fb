"""Free, automatic FB Reel discovery via search-engine dorking.

Uses DuckDuckGo HTML, Bing, and Google as sources. No FB cookie required,
no paid API — search engines already index public Reels.
"""
import re
import time
from urllib.parse import quote, urlparse, parse_qs, unquote

import requests
from bs4 import BeautifulSoup

REQUEST_TIMEOUT = 12

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


def duckduckgo_search(query, max_pages=3):
    """DuckDuckGo HTML endpoint — no JS, no captcha, generous limits."""
    urls = set()
    base = "https://html.duckduckgo.com/html/"
    session = requests.Session()
    s = 0
    for page in range(max_pages):
        try:
            data = {'q': query, 's': str(s), 'dc': str(s + 30)}
            r = session.post(base, data=data, headers=_headers(page), timeout=REQUEST_TIMEOUT)
            if r.status_code != 200:
                break
            found_this_page = _extract_fb_urls(r.text)
            # also parse <a class="result__a"> and follow /l/ wrapper
            soup = BeautifulSoup(r.text, 'html.parser')
            for a in soup.select('a.result__a, a.result__url'):
                href = a.get('href', '')
                real = _clean_ddg_href(href)
                found_this_page |= _extract_fb_urls(real)
            if not found_this_page:
                break
            urls |= found_this_page
            s += 30
            time.sleep(0.5)
        except Exception as e:
            print(f"[ddg] {e}")
            break
    return urls


def bing_search(query, max_pages=3):
    """Bing web search HTML."""
    urls = set()
    for page in range(max_pages):
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
            time.sleep(0.5)
        except Exception as e:
            print(f"[bing] {e}")
            break
    return urls


def google_search(query, max_pages=2):
    """Google web search HTML — kept as best-effort backup. Often 429s."""
    urls = set()
    for page in range(max_pages):
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
            time.sleep(1.0)
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


def discover_fb_reels(keyword, max_urls=100):
    """Aggregate results across engines and queries. Fully free, no cookie."""
    all_urls = set()
    for query in build_dork_queries(keyword):
        if len(all_urls) >= max_urls:
            break
        all_urls |= duckduckgo_search(query, max_pages=2)
        if len(all_urls) >= max_urls:
            break
        all_urls |= bing_search(query, max_pages=2)
    # Google as light backup only — heavy 429 risk
    if len(all_urls) < 15:
        all_urls |= google_search(f'site:facebook.com/reel {keyword}', max_pages=1)
    return list(all_urls)[:max_urls]
