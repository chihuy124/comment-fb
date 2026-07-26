// Runs on every facebook.com page. Asks background what its mission is,
// then acts on it. Two missions:
//   - 'discover' : scroll feed, collect Reel/Watch URLs, send back
//   - 'scrape'   : scrape comments on a single Reel/Watch permalink
// (Previously used URL hash to signal mode; FB's SPA strips the hash via
// history.replaceState during navigation, so we now query background over
// chrome.runtime instead.)

(async function () {
  try {
    console.log('[FB Seeding CS] loaded on', location.href);
    // Give the tab a moment to settle so sender.tab.id is stable
    await sleep(200);
    const mission = await chrome.runtime.sendMessage({
      type: 'GET_MISSION',
      url: location.href,
    });
    console.log('[FB Seeding CS] mission =', mission);
    if (!mission || !mission.mode) return;

    if (mission.mode === 'discover') {
      await discoverMode(mission.durationMs || 45000);
      return;
    }
    if (mission.mode === 'scrape') {
      await sleep(2000);
      const comments = await scrapeComments();
      chrome.runtime.sendMessage({ type: 'SCRAPE_RESULT', url: location.href, comments });
      return;
    }
  } catch (e) {
    console.error('[FB Seeding CS] top-level error:', e);
    try {
      chrome.runtime.sendMessage({ type: 'CS_ERROR', url: location.href, error: String(e) });
    } catch (_) {}
  }
})();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- URL canonicalization ----------

function canonicalize(href) {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://www.facebook.com');
    const path = u.pathname;
    let m = path.match(/^\/reels?\/(\d{8,})/);
    if (m) return `https://www.facebook.com/reel/${m[1]}`;
    if (path.startsWith('/watch')) {
      const v = u.searchParams.get('v');
      if (v && /^\d{8,}$/.test(v)) return `https://www.facebook.com/watch/?v=${v}`;
    }
    m = path.match(/^\/([^/]+)\/videos\/(\d{8,})/);
    if (m) return `https://www.facebook.com/${m[1]}/videos/${m[2]}`;
  } catch (e) {}
  return null;
}

// ---------- DISCOVER MODE ----------

async function discoverMode(durationMs) {
  console.log('[FB Seeding CS] discover mode start, duration =', durationMs);
  const foundUrls = new Set();
  const endTime = Date.now() + durationMs;
  let lastReport = 0;

  // Tell background we started (also keeps SW alive)
  try {
    chrome.runtime.sendMessage({ type: 'DISCOVER_PROGRESS', count: 0, phase: 'start' });
  } catch (_) {}

  const extract = () => {
    // Current URL as feed navigates (SPA push-state)
    const currentCanon = canonicalize(location.href);
    if (currentCanon) foundUrls.add(currentCanon);

    // Every <a href> on page
    document.querySelectorAll('a[href]').forEach((a) => {
      const canon = canonicalize(a.getAttribute('href'));
      if (canon) foundUrls.add(canon);
    });

    // Regex the raw HTML — catches React fiber props / lazy-loaded reels
    // (Bounded to first 500KB to avoid huge DOMs killing perf)
    const html = document.documentElement.outerHTML.slice(0, 500_000);
    const reelMatches = html.match(/\/reels?\/(\d{8,})/g) || [];
    for (const m of reelMatches) {
      const id = m.replace(/^\/reels?\//, '');
      foundUrls.add(`https://www.facebook.com/reel/${id}`);
    }
    const watchMatches = html.match(/\/watch\/?\?v=(\d{8,})/g) || [];
    for (const m of watchMatches) {
      const id = m.match(/(\d{8,})/)[1];
      foundUrls.add(`https://www.facebook.com/watch/?v=${id}`);
    }
  };

  // Initial extract, then scroll / advance / re-extract loop
  extract();

  while (Date.now() < endTime) {
    // Two nudges: arrow-down (works on /reel/ vertical feed) + scroll (works on /watch/)
    try {
      const evOpts = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true };
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', evOpts));
      window.dispatchEvent(new KeyboardEvent('keydown', evOpts));
    } catch (e) {}
    window.scrollBy(0, window.innerHeight * 0.9);
    await sleep(2200);
    extract();

    // Progress heartbeat every 5s
    if (Date.now() - lastReport > 5000) {
      lastReport = Date.now();
      chrome.runtime.sendMessage({ type: 'DISCOVER_PROGRESS', count: foundUrls.size });
    }
  }

  console.log('[FB Seeding CS] discover done, urls =', foundUrls.size);
  chrome.runtime.sendMessage({ type: 'DISCOVER_RESULT', urls: Array.from(foundUrls) });
}

// ---------- SCRAPE MODE (comments on a single Reel) ----------

async function scrapeComments() {
  console.log('[FB Seeding CS] scrape start on', location.href);
  await dismissLoginNags();

  // Desktop Reel UI: comments live in a side panel that opens on click.
  // Force-open the panel before doing anything else.
  await openCommentPanel();
  await sleep(1500);

  await switchToAllComments();

  // Scroll the comment panel itself (not the window). Fallback to window scroll.
  const panel = findCommentScrollContainer();
  for (let i = 0; i < 8; i++) {
    if (panel) {
      panel.scrollTop = panel.scrollHeight;
    } else {
      window.scrollBy(0, 900);
    }
    await sleep(1200);
    await clickMoreCommentsButtons();
  }

  const collected = collectCommentText();
  console.log('[FB Seeding CS] scrape collected', collected.length, 'comment candidates');

  const seen = new Set();
  const uniq = [];
  for (const c of collected) {
    if (!seen.has(c)) {
      seen.add(c);
      uniq.push(c);
    }
  }
  return uniq.slice(0, 200);
}

async function openCommentPanel() {
  // Look for any button/link whose text or aria-label references comments.
  // Desktop Reel page has a "Comment" button on the right rail; clicking opens the panel.
  const nodes = Array.from(document.querySelectorAll(
    'div[role="button"], a[role="link"], span, [aria-label]'
  ));
  const isCommentTrigger = (el) => {
    const label = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
    const text = (el.innerText || '').toLowerCase().trim();
    return (
      /^comment$/.test(label) || /^bình luận$/.test(label) ||
      /^\d+\s*(comment|bình luận)/.test(label) ||
      /^\d+\s*(comment|bình luận)/.test(text) ||
      label === 'leave a comment' || label === 'viết bình luận' ||
      (text.includes('comment') && text.length < 30) ||
      (text.includes('bình luận') && text.length < 30)
    );
  };
  for (const el of nodes) {
    if (isCommentTrigger(el)) {
      try {
        el.click();
        console.log('[FB Seeding CS] clicked comment trigger:', el.getAttribute('aria-label') || el.innerText?.slice(0, 40));
        return;
      } catch (e) {}
    }
  }
  console.log('[FB Seeding CS] no comment trigger found');
}

function findCommentScrollContainer() {
  // Heuristic: pick the tallest scrollable div in the viewport that isn't the body.
  const all = Array.from(document.querySelectorAll('div'));
  let best = null;
  let bestScore = 0;
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowY)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.height < 200) continue;
    if (el.scrollHeight <= el.clientHeight + 10) continue; // not actually scrollable
    const score = rect.height * (rect.width || 1);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) console.log('[FB Seeding CS] scroll container found, h=', best.scrollHeight);
  return best;
}

async function dismissLoginNags() {
  document.querySelectorAll('div[aria-label="Close"], div[aria-label="Đóng"]').forEach((b) => {
    try { b.click(); } catch (e) {}
  });
  await sleep(300);
}

async function switchToAllComments() {
  const candidates = Array.from(document.querySelectorAll('div[role="button"], span')).filter((el) => {
    const t = (el.innerText || '').toLowerCase();
    return t === 'most relevant' || t === 'phù hợp nhất' || t === 'all comments' || t === 'tất cả bình luận';
  });
  for (const el of candidates.slice(0, 1)) {
    try {
      el.click();
      await sleep(700);
      const menuOpts = Array.from(document.querySelectorAll('div[role="menuitem"], span'));
      const all = menuOpts.find((m) => {
        const t = (m.innerText || '').toLowerCase();
        return t === 'all comments' || t === 'tất cả bình luận';
      });
      if (all) {
        all.click();
        await sleep(1200);
      }
    } catch (e) {}
  }
}

async function clickMoreCommentsButtons() {
  const btns = Array.from(document.querySelectorAll('div[role="button"], span'));
  for (const b of btns) {
    const t = (b.innerText || '').trim().toLowerCase();
    if (
      t.startsWith('view more comments') ||
      t.startsWith('xem thêm bình luận') ||
      t.startsWith('xem thêm phản hồi') ||
      t.startsWith('view previous') ||
      t.startsWith('xem trước')
    ) {
      try { b.click(); } catch (e) {}
    }
  }
  await sleep(600);
}

function collectCommentText() {
  const out = [];

  // Strategy 1: role="article" (works on News Feed posts, sometimes on Reel side panel)
  document.querySelectorAll('div[role="article"]').forEach((a) => {
    const label = a.getAttribute('aria-label') || '';
    if (/^(Post|Bài viết)\b/i.test(label) || /video by/i.test(label) || /reel by/i.test(label)) return;
    const author = extractAuthor(a);
    const text = extractCommentText(a);
    if (text && text.length >= 2) out.push(author ? `${author}: ${text}` : text);
  });

  // Strategy 2: aria-label starting with "Comment by X" — matches individual comment
  // items on Reel side panel (Facebook's 2024+ Reel UI)
  document.querySelectorAll('[aria-label]').forEach((el) => {
    const label = el.getAttribute('aria-label') || '';
    // "Comment by John Doe" / "Bình luận của John Doe"
    const m = label.match(/^(?:Comment by|Bình luận (?:của|by))\s+(.+)$/i);
    if (!m) return;
    const author = m[1].trim();
    const text = extractCommentText(el);
    if (text && text.length >= 2) out.push(`${author}: ${text}`);
  });

  // Strategy 3: <ul aria-label="Comments"> — legacy
  document.querySelectorAll('ul[aria-label*="Comment"], ul[aria-label*="ình luận"]').forEach((ul) => {
    ul.querySelectorAll('li').forEach((li) => {
      const text = extractCommentText(li);
      const author = extractAuthor(li);
      if (text && text.length >= 2) out.push(author ? `${author}: ${text}` : text);
    });
  });

  // Strategy 4: walk visible dir="auto" nodes inside likely comment container
  // Filter out video caption / UI chrome by requiring the node to be inside
  // something with 'comment' or 'bình luận' in an aria-label somewhere up.
  document.querySelectorAll('div[dir="auto"]').forEach((el) => {
    const text = (el.innerText || '').trim();
    if (!text || text.length < 3 || text.length > 400) return;
    if (/^(Like|Thích|Reply|Trả lời|Share|Chia sẻ|\d+[hmdwy]|\d+ (weeks?|months?|days?|hours?|mins?))$/i.test(text)) return;
    // Skip if this node's text is already collected via strategies above
    if (out.some(o => o.endsWith(text))) return;
    // Verify it's inside a comment-related section
    let anc = el.parentElement;
    let inCommentArea = false;
    for (let i = 0; i < 8 && anc; i++) {
      const l = (anc.getAttribute('aria-label') || '').toLowerCase();
      if (l.includes('comment') || l.includes('bình luận')) { inCommentArea = true; break; }
      anc = anc.parentElement;
    }
    if (inCommentArea) out.push(text);
  });

  return out;
}

function extractAuthor(node) {
  const link = node.querySelector('a[role="link"] span, a[role="link"] strong');
  return link && link.innerText ? link.innerText.trim() : '';
}

function extractCommentText(node) {
  const candidates = node.querySelectorAll('div[dir="auto"]');
  let longest = '';
  for (const c of candidates) {
    const t = (c.innerText || '').trim();
    if (!t) continue;
    if (/^(Like|Thích|Reply|Trả lời|Share|Chia sẻ|\d+[hmd]|\d+ w)$/i.test(t)) continue;
    if (t.length > longest.length) longest = t;
  }
  return longest;
}
