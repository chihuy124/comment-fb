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

    if (mission.mode === 'harvest') {
      const urls = await harvestMode(mission.durationMs || 20000);
      chrome.runtime.sendMessage({ type: 'HARVEST_RESULT', urls });
      return;
    }
    if (mission.mode === 'scrape') {
      await sleep(2000);
      const comments = await scrapeComments();
      // Reel pages sometimes reference neighbouring reels — hand them back so
      // the hunter can keep walking without another harvest round.
      const foundUrls = Array.from(sweepReelUrls());
      chrome.runtime.sendMessage({ type: 'SCRAPE_RESULT', url: location.href, comments, foundUrls });
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

async function harvestMode(durationMs) {
  // Scroll whatever feed/search page we were navigated to and collect every
  // reel/video permalink present. No scraping here — background navigates each
  // harvested URL individually afterwards, which is what guarantees the
  // comments it reads belong to that reel.
  console.log('[FB Seeding CS] harvest start on', location.href, 'for', durationMs, 'ms');
  const found = new Set();
  const endTime = Date.now() + durationMs;
  let idleRounds = 0;

  await sleep(3000);
  sweepReelUrls().forEach((u) => found.add(u));
  console.log('[FB Seeding CS] initial sweep:', found.size);

  while (Date.now() < endTime) {
    const before = found.size;
    scrollFeed();
    await sleep(1500);
    sweepReelUrls().forEach((u) => found.add(u));

    if (found.size === before) {
      idleRounds++;
      if (idleRounds >= 8) {
        console.log('[FB Seeding CS] 8 idle rounds — stopping harvest');
        break;
      }
    } else {
      idleRounds = 0;
      console.log('[FB Seeding CS]   harvest at', found.size);
      chrome.runtime.sendMessage({ type: 'DISCOVER_PROGRESS', count: found.size });
    }
  }

  const urls = Array.from(found);
  console.log('[FB Seeding CS] harvest done:', urls.length, 'URLs from', location.href);
  return urls;
}

function findFeedScroller() {
  // Facebook's Watch feed and search results scroll an INNER container, not
  // the window — window.scrollBy() there is a no-op, which is why lazy-loading
  // never fired and harvesting stalled at the first screenful.
  let best = null;
  let bestHeight = 0;
  for (const el of document.querySelectorAll('div')) {
    const cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowY)) continue;
    if (el.clientHeight < 300) continue;
    if (el.scrollHeight <= el.clientHeight + 50) continue;
    if (el.scrollHeight > bestHeight) {
      bestHeight = el.scrollHeight;
      best = el;
    }
  }
  return best;
}

function scrollFeed() {
  // Drive every plausible scroller: the window, the tallest inner scroll
  // container, and document.scrollingElement.
  const step = Math.max(600, window.innerHeight * 0.85);
  try { window.scrollBy(0, step); } catch (_) {}

  const scroller = findFeedScroller();
  if (scroller) {
    try { scroller.scrollTop = scroller.scrollTop + step; } catch (_) {}
  }
  const se = document.scrollingElement;
  if (se) {
    try { se.scrollTop = se.scrollTop + step; } catch (_) {}
  }

  // Vertical reel viewer responds to ArrowDown / the next-reel control
  nudgeNextReel();
}

function nudgeNextReel() {
  const labels = ['next reel', 'reel tiếp theo', 'next video', 'video tiếp theo', 'reel kế tiếp'];
  for (const el of document.querySelectorAll('[aria-label]')) {
    const l = (el.getAttribute('aria-label') || '').toLowerCase();
    if (labels.includes(l)) {
      try { el.click(); return; } catch (_) {}
    }
  }
  const opts = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true };
  try {
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', opts));
    window.dispatchEvent(new KeyboardEvent('keydown', opts));
  } catch (_) {}
}

function sweepReelUrls() {
  // Anchors first (cheap + precise), then a regex pass over the serialized DOM
  // to catch permalinks that only exist inside React props / lazy markup.
  const found = new Set();
  const cur = canonicalize(location.href);
  if (cur) found.add(cur);

  document.querySelectorAll('a[href]').forEach((a) => {
    const c = canonicalize(a.getAttribute('href'));
    if (c) found.add(c);
  });

  const html = document.body ? document.body.innerHTML.slice(0, 3000000) : '';
  (html.match(/\/reels?\/(\d{8,})/g) || []).forEach((m) => {
    found.add('https://www.facebook.com/reel/' + m.replace(/^\/reels?\//, ''));
  });
  (html.match(/\/watch\/?\?v=(\d{8,})/g) || []).forEach((m) => {
    found.add('https://www.facebook.com/watch/?v=' + m.match(/(\d{8,})/)[1]);
  });
  // Escaped forms that show up in inline JSON payloads
  (html.match(/watch%2F%3Fv%3D(\d{8,})/g) || []).forEach((m) => {
    found.add('https://www.facebook.com/watch/?v=' + m.match(/(\d{8,})/)[1]);
  });

  return found;
}


// ---------- SCRAPE MODE (comments on a single Reel) ----------

async function scrapeComments() {
  const startReelId = extractReelId(location.href);
  console.log('[FB Seeding CS] scrape start on', location.href, 'reelId=', startReelId);

  // CRITICAL: ask background to inject a MAIN-world script that patches
  // history + overrides HTMLMediaElement.play. Content-script injected
  // <script> tags are blocked by FB's CSP, so this must go through
  // chrome.scripting.executeScript from the extension.
  if (startReelId) {
    try {
      await chrome.runtime.sendMessage({ type: 'REQUEST_PIN', reelId: startReelId });
    } catch (e) { console.warn('[FB Seeding CS] pin request failed', e); }
  }

  // Belt-and-braces: also pause videos from the isolated world.
  const stopAutoAdvance = startAutoPauseLoop(startReelId);

  // Give FB Reel viewer time to hydrate before we touch anything
  await sleep(3000);
  await dismissLoginNags();

  // Desktop Reel UI: comments live in a side panel that opens on click.
  const opened = await openCommentPanel();
  console.log('[FB Seeding CS] panel opened =', opened);
  await switchToAllComments();

  // Only scroll the comment panel itself. NEVER scroll the window in scrape
  // mode — that advances the vertical Reel feed and mixes comments from
  // adjacent reels into the DOM.
  const panel = findCommentScrollContainer();
  if (!panel) {
    console.warn('[FB Seeding CS] no comment container found — reel likely has 0 comments');
    // Fall through — collectCommentText will run once and yield whatever is on page.
  }
  for (let i = 0; i < 8; i++) {
    if (panel) {
      panel.scrollTop = panel.scrollHeight;
    }
    await sleep(1200);
    await clickMoreCommentsButtons();
    // Bail early if FB navigated us to a different reel mid-scrape
    if (extractReelId(location.href) !== startReelId) {
      console.warn('[FB Seeding CS] URL drifted during scrape, aborting');
      return [];
    }
  }

  // Final invariant check: URL must still be the same reel
  if (extractReelId(location.href) !== startReelId) {
    console.warn('[FB Seeding CS] URL drifted before extract, discarding');
    stopAutoAdvance();
    return [];
  }

  const collected = collectCommentText();
  stopAutoAdvance();
  console.log('[FB Seeding CS] collected', collected.length, 'comment candidates on reel', startReelId);

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

function startAutoPauseLoop(startReelId) {
  // Belt-and-braces: pause every <video> from the isolated world. Backup for
  // the MAIN-world play() override — even if injection is slow, this catches
  // videos that are already playing.
  const pauseAll = () => {
    document.querySelectorAll('video').forEach((v) => {
      try {
        if (!v.paused) v.pause();
        v.muted = true;
      } catch (e) {}
    });
  };
  pauseAll();
  const pauseInterval = setInterval(pauseAll, 400);
  return function stop() { clearInterval(pauseInterval); };
}

function extractReelId(href) {
  try {
    const u = new URL(href, 'https://www.facebook.com');
    const m = u.pathname.match(/^\/reels?\/(\d+)/);
    if (m) return `reel:${m[1]}`;
    if (u.pathname.startsWith('/watch')) {
      const v = u.searchParams.get('v');
      if (v) return `watch:${v}`;
    }
    const vm = u.pathname.match(/^\/[^/]+\/videos\/(\d+)/);
    if (vm) return `video:${vm[1]}`;
  } catch (e) {}
  return null;
}

function humanClick(el) {
  // React (used by FB) sometimes ignores el.click() and requires the full
  // pointer/mouse event sequence with real coordinates. Dispatch all four.
  try {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + Math.max(1, rect.width) / 2;
    const cy = rect.top + Math.max(1, rect.height) / 2;
    const opts = {
      bubbles: true, cancelable: true, view: window,
      clientX: cx, clientY: cy,
      button: 0, buttons: 1,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  } catch (e) {
    try { el.click(); } catch (_) {}
  }
}

async function openCommentPanel() {
  const isPanelOpen = () =>
    !!document.querySelector(
      '[aria-label^="Bình luận dưới tên"], [aria-label^="Comment by"], [aria-label^="Bình luận của"]'
    );

  if (isPanelOpen()) {
    console.log('[FB Seeding CS] panel already open');
    return true;
  }

  const patterns = [
    /^\d+[\s.,]*(bình luận|comment)/i,
    /^(bình luận|comment)$/i,
    /^(bình luận|comment)\s*\d+/i,
    /(view|xem)\s*(all\s*)?(comments?|bình luận)/i,
    /^(leave|viết)\s*(a\s*)?(comment|bình luận)/i,
  ];
  const matches = (t) => t && patterns.some((p) => p.test(t));

  const candidates = Array.from(document.querySelectorAll(
    '[aria-label], div[role="button"], a[role="link"], div[role="link"]'
  ));

  const targets = [];
  for (const el of candidates) {
    const label = (el.getAttribute && el.getAttribute('aria-label') || '').trim();
    const text = (el.innerText || '').trim().slice(0, 60);
    if (matches(label) || matches(text)) targets.push({ el, label: label || text });
  }
  console.log('[FB Seeding CS] found', targets.length, 'candidate comment buttons');

  for (const { el, label } of targets) {
    // React handlers might sit on the element itself, its parent, or even
    // higher — dispatch full mouse sequence on the element and its ancestors.
    let node = el;
    for (let up = 0; up < 4 && node; up++) {
      humanClick(node);
      node = node.parentElement;
    }
    console.log('[FB Seeding CS] clicked candidate:', label);

    // Poll for panel to open — up to 6s (hidden tabs load slower under
    // Chrome's background throttling).
    for (let wait = 0; wait < 12; wait++) {
      await sleep(500);
      if (isPanelOpen()) {
        console.log('[FB Seeding CS] panel opened after', (wait + 1) * 500, 'ms via', label);
        return true;
      }
    }
  }

  return isPanelOpen();
}

function findCommentScrollContainer() {
  // Anchor the search on an actual comment node, then walk up until we hit a
  // scrollable ancestor. This binds the container to the CURRENT reel's
  // comment panel and never accidentally picks the reel-feed viewport.
  const anchor = document.querySelector(
    '[aria-label^="Bình luận"], [aria-label^="Comment by"], [aria-label^="Comment "]'
  );
  if (!anchor) return null;
  let el = anchor.parentElement;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 10) {
      console.log('[FB Seeding CS] scroll container: h=', el.scrollHeight, 'client=', el.clientHeight);
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

async function dismissLoginNags() {
  document.querySelectorAll('div[aria-label="Close"], div[aria-label="Đóng"]').forEach((b) => {
    try { b.click(); } catch (e) {}
  });
  await sleep(300);
}

async function switchToAllComments() {
  // Sort dropdown label is usually "Phù hợp nhất" (default) or "Most relevant".
  // Click it, then pick "Tất cả bình luận" from the menu that appears.
  // Match with startsWith because FB sometimes appends aria hints to the label.
  const triggerCandidates = Array.from(document.querySelectorAll(
    'div[role="button"], span, [aria-label]'
  )).filter((el) => {
    const t = (el.innerText || '').trim().toLowerCase();
    const l = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
    return (
      t === 'most relevant' || t === 'phù hợp nhất' ||
      l.startsWith('most relevant') || l.startsWith('phù hợp nhất') ||
      l.includes('sort comments') || l.includes('sắp xếp bình luận')
    );
  });

  for (const el of triggerCandidates.slice(0, 2)) {
    try {
      el.click();
      await sleep(900);
      const menuOpts = Array.from(document.querySelectorAll(
        'div[role="menuitem"], div[role="menuitemcheckbox"], div[role="menuitemradio"], span'
      ));
      const all = menuOpts.find((m) => {
        const t = (m.innerText || '').trim().toLowerCase();
        return t.startsWith('tất cả bình luận') || t.startsWith('all comments');
      });
      if (all) {
        console.log('[FB Seeding CS] switching to All Comments');
        all.click();
        await sleep(1500);
        return;
      }
    } catch (e) {}
  }
}

async function clickMoreCommentsButtons() {
  // Click every "Xem thêm bình luận" / "View more comments" button visible.
  // Note: FB shows this as a link inside the comment panel. Sometimes the
  // clickable target is a span; sometimes a parent div[role="button"].
  const nodes = Array.from(document.querySelectorAll(
    'div[role="button"], span, a[role="button"], div[role="link"]'
  ));
  let clicked = 0;
  for (const b of nodes) {
    const t = (b.innerText || '').trim().toLowerCase();
    if (!t) continue;
    if (
      t.startsWith('view more comments') ||
      t.startsWith('xem thêm bình luận') ||
      t.startsWith('xem thêm phản hồi') ||
      t.startsWith('view more replies') ||
      t.startsWith('view previous') ||
      t.startsWith('xem trước')
    ) {
      try { b.click(); clicked++; } catch (e) {}
    }
  }
  if (clicked > 0) console.log('[FB Seeding CS] clicked', clicked, 'more-comments buttons');
  await sleep(700);
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

  // Strategy 2: aria-label pattern for individual comment nodes (FB 2024+ Reel panel).
  // English: "Comment by John Doe"
  // Vietnamese: "Bình luận dưới tên Anh Nhi vào 13 giờ trước"
  //             "Bình luận của Anh Nhi"
  const COMMENT_LABEL_RE = /^(?:Comment by\s+(.+?)|Bình luận (?:của|by|dưới tên)\s+(.+?))(?:\s+(?:vào|on|·|,)\s+.*)?$/i;
  document.querySelectorAll('[aria-label]').forEach((el) => {
    const label = el.getAttribute('aria-label') || '';
    const m = label.match(COMMENT_LABEL_RE);
    if (!m) return;
    const author = (m[1] || m[2] || '').trim();
    if (!author) return;
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
