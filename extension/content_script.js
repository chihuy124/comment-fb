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
      const res = await harvestMode(
        mission.durationMs || 20000,
        mission.exclude || [],
        mission.want || 0
      );
      chrome.runtime.sendMessage({
        type: 'HARVEST_RESULT', urls: res.urls, stuck: res.stuck,
        // Facebook không chạy feed khi trang không hiển thị — background cần biết
        // để nói thẳng lý do thay vì để user đoán tại sao chỉ ra 2 URL.
        visibility: document.visibilityState,
      });
      return;
    }
    if (mission.mode === 'comment') {
      const res = await postComment(mission.text, mission.reelId, {
        dwellMs: mission.dwellMs,
        likeChance: mission.likeChance,
      });
      chrome.runtime.sendMessage({ type: 'COMMENT_RESULT', url: location.href, ...res });
      return;
    }
    if (mission.mode === 'scrape') {
      await sleep(2000);
      const { comments, diag } = await scrapeComments({ budgetMs: mission.budgetMs });
      // Reel pages sometimes reference neighbouring reels — hand them back so
      // the hunter can keep walking without another harvest round.
      const foundUrls = Array.from(sweepReelUrls());
      chrome.runtime.sendMessage({
        type: 'SCRAPE_RESULT', url: location.href, comments, foundUrls, diag,
      });
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

async function harvestMode(durationMs, excludeList, want) {
  // Goal-driven: keep scrolling this feed until `want` reels the caller has
  // NOT already seen have been found. Previously this scrolled for a fixed
  // 20s and returned everything on screen, so revisiting a feed produced the
  // same first screenful and the caller — which filters against what it has
  // already visited — concluded Facebook had run out of reels. The feed is
  // effectively infinite; we just were not scrolling deep enough.
  const exclude = new Set(excludeList || []);
  const target = want > 0 ? want : Infinity;

  console.log(
    `[FB Seeding CS] harvest start on ${location.href} | want ${target} new | ${exclude.size} excluded | cap ${durationMs}ms`
  );

  const found = new Set();
  const endTime = Date.now() + durationMs;
  const newCount = () => {
    let n = 0;
    for (const u of found) if (!exclude.has(u)) n++;
    return n;
  };

  await sleep(3000);
  sweepReelUrls().forEach((u) => found.add(u));
  console.log('[FB Seeding CS] initial sweep:', found.size, 'total /', newCount(), 'new');

  // "Stuck" means the page genuinely will not advance: no new permalinks AND
  // no movement in scroll position, URL or document height. Absence of NEW
  // urls alone is not enough — deep in a feed we may re-see known reels for a
  // while before hitting fresh ones.
  let noProgressRounds = 0;
  const STUCK_ROUNDS = 10;
  let lastSignature = '';

  while (Date.now() < endTime && newCount() < target) {
    const beforeTotal = found.size;
    await scrollFeed();
    // advanceOneReel already waits for the reel to change, so grid feeds need
    // the settle time more than the reel viewer does
    await sleep(isVerticalReelViewer() ? 600 : 1500);
    sweepReelUrls().forEach((u) => found.add(u));

    const scroller = findFeedScroller();
    const signature = [
      location.href,
      Math.round(window.scrollY),
      scroller ? Math.round(scroller.scrollTop) : -1,
      document.body ? document.body.scrollHeight : -1,
    ].join('|');

    const gainedUrls = found.size > beforeTotal;
    const moved = signature !== lastSignature;
    lastSignature = signature;

    if (!gainedUrls && !moved) {
      noProgressRounds++;
      if (noProgressRounds >= STUCK_ROUNDS) {
        console.log('[FB Seeding CS] page will not advance — harvest stuck');
        return { urls: Array.from(found), stuck: true };
      }
    } else {
      noProgressRounds = 0;
    }

    // Gửi MỖI VÒNG, kèm cả danh sách URL — không chỉ khi có url mới. Đây là bản
    // sao lưu duy nhất nếu background hết hạn trước khi harvest kịp kết thúc;
    // trước đây trường hợp đó vứt sạch mọi thứ đã tìm được.
    try {
      chrome.runtime.sendMessage({
        type: 'DISCOVER_PROGRESS',
        count: newCount(),
        urls: Array.from(found),
        visibility: document.visibilityState,
      });
    } catch (e) { /* service worker đang ngủ — vòng sau gửi lại */ }
  }

  const urls = Array.from(found);
  const satisfied = newCount() >= target;
  console.log(
    `[FB Seeding CS] harvest done: ${urls.length} total, ${newCount()} new${satisfied ? ' (target met)' : ' (time cap)'}`
  );
  // Hitting the time cap without finding anything new is also a dead end
  return { urls, stuck: !satisfied && newCount() === 0 };
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

// The vertical reel viewer is one-reel-per-URL with scroll snapping; grid feeds
// (/watch/, search results) are continuous lists. They need different handling.
function isVerticalReelViewer() {
  return /^\/reels?\/\d+/.test(location.pathname);
}

async function scrollFeed() {
  if (isVerticalReelViewer()) {
    // Exactly one reel per step. Firing several advance mechanisms at once made
    // the feed jump two reels and silently skip the one in between.
    await advanceOneReel();
    return;
  }

  // Grid feed: extra scrolling is harmless here, it just goes further down.
  const step = Math.max(600, window.innerHeight * 0.85);
  const scroller = findFeedScroller();
  if (scroller) {
    try { scroller.scrollTop = scroller.scrollTop + step; } catch (_) {}
  } else {
    try { window.scrollBy(0, step); } catch (_) {}
    const se = document.scrollingElement;
    if (se) {
      try { se.scrollTop = se.scrollTop + step; } catch (_) {}
    }
  }
}

// Advances by a single reel. Tries one mechanism at a time and waits to see the
// URL actually change before moving on to the next, so whichever one Facebook
// currently honours is used alone rather than all of them together.
async function advanceOneReel() {
  const before = location.href;
  const mechanisms = [
    ['next-button', clickNextReelControl],
    ['arrow-down', pressArrowDown],
    ['scroll', scrollOneViewport],
  ];

  for (const [name, fire] of mechanisms) {
    let fired = false;
    try { fired = fire(); } catch (_) {}
    if (fired === false) continue;

    for (let i = 0; i < 6; i++) {
      await sleep(250);
      if (location.href !== before) {
        if (name !== lastWorkingAdvance) {
          lastWorkingAdvance = name;
          console.log('[FB Seeding CS] advancing reels via', name);
        }
        return true;
      }
    }
  }
  return false;
}

let lastWorkingAdvance = null;

// Confirmed from a live page dump: the real controls are labelled "Thẻ tiếp
// theo" and "Mục tiếp theo". The names I had been guessing at ("Reel tiếp
// theo" etc.) never existed, so this mechanism silently never fired and every
// advance fell through to ArrowDown.
const NEXT_REEL_LABELS = [
  'thẻ tiếp theo', 'mục tiếp theo', 'next card', 'next item',
  'next reel', 'reel tiếp theo', 'next video', 'video tiếp theo', 'reel kế tiếp',
];

function clickNextReelControl() {
  for (const el of document.querySelectorAll('[aria-label]')) {
    const l = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (NEXT_REEL_LABELS.includes(l)) {
      humanClick(el);
      return true;
    }
  }
  return false; // control not present, let the caller try the next mechanism
}

function pressArrowDown() {
  const opts = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true };
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', opts));
  window.dispatchEvent(new KeyboardEvent('keydown', opts));
  return true;
}

function scrollOneViewport() {
  const scroller = findFeedScroller();
  if (scroller) {
    scroller.scrollTop = scroller.scrollTop + scroller.clientHeight;
  } else {
    window.scrollBy(0, window.innerHeight);
  }
  return true;
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


// ---------- COMMENT MODE (post one comment on this reel) ----------

async function postComment(text, expectedReelId, opts = {}) {
  if (!text || !String(text).trim()) return { ok: false, error: 'empty_text' };

  const dwellMs = Math.max(0, opts.dwellMs || 0);
  const likeChance = Math.min(1, Math.max(0, opts.likeChance || 0));

  console.log('[FB Seeding CS] comment mode on', location.href, '| dwell', dwellMs, 'ms | likeChance', likeChance);
  await sleep(3000);
  await dismissLoginNags();

  // Behave like a viewer before commenting: let the clip actually play, scroll
  // through the existing comments, and sometimes like the reel. Posting within
  // a few seconds of load with zero interaction is a distinctly non-human trace.
  // NB: videos are deliberately NOT paused here (unlike scrape mode) so watch
  // time is real.
  let liked = false;
  if (dwellMs > 0) {
    const dwellEnd = Date.now() + dwellMs;

    // Open the panel early so there is something to read while "watching"
    await openCommentPanel();
    const readPanel = findCommentScrollContainer();

    if (likeChance > 0 && Math.random() < likeChance) {
      // Like partway through rather than instantly on arrival
      await sleep(Math.min(dwellMs * 0.4, 8000));
      liked = await likeCurrentReel();
    }

    while (Date.now() < dwellEnd) {
      if (readPanel) {
        try { readPanel.scrollTop += 200 + Math.random() * 250; } catch (e) {}
      }
      await sleep(1800 + Math.random() * 2200);
    }
    console.log('[FB Seeding CS] dwell finished, liked =', liked);
  }

  const opened = await openCommentPanel();
  if (!opened) {
    return { ok: false, error: 'no_comment_panel', hint: 'Không mở được ô bình luận — có thể Reel đã tắt bình luận.' };
  }

  const box = findCommentComposer();
  if (!box) {
    return { ok: false, error: 'no_composer', hint: 'Không tìm thấy ô soạn bình luận.' };
  }

  // Facebook's composer submits on Enter, so a literal newline in the text
  // would post a half-finished comment. Collapse them to spaces.
  const oneLine = String(text).replace(/\s*\n+\s*/g, ' ').trim();

  humanClick(box);
  box.focus();
  await sleep(500);

  // FB uses Lexical; assigning textContent does nothing. insertText goes
  // through the editor's own input handling.
  document.execCommand('insertText', false, oneLine);
  await sleep(900);

  const typed = (box.innerText || '').trim();
  if (!typed) {
    return { ok: false, error: 'insert_failed', hint: 'Không gõ được vào ô bình luận.' };
  }
  // Guard against a partially-inserted comment
  if (typed.length < Math.min(20, oneLine.length * 0.5)) {
    return { ok: false, error: 'insert_partial', typed, hint: 'Nội dung vào ô không đầy đủ, đã hủy để không đăng thiếu.' };
  }

  // CRITICAL: make sure FB has not swapped the reel under us before we post.
  if (expectedReelId && extractReelId(location.href) !== expectedReelId) {
    return { ok: false, error: 'url_drifted', hint: 'Facebook đã nhảy sang Reel khác — đã hủy để không comment nhầm bài.' };
  }

  console.log('[FB Seeding CS] submitting comment...');
  pressEnter(box);
  await sleep(2500);

  // Verify: FB clears the composer once a comment is accepted.
  let emptied = !(box.innerText || '').trim();
  if (!emptied) {
    await sleep(2500);
    emptied = !(box.innerText || '').trim();
  }

  if (emptied) {
    console.log('[FB Seeding CS] comment posted');
    return { ok: true, posted: oneLine, liked };
  }

  // Composer still holds our text → try the explicit send control once.
  const btn = findSendButton();
  if (btn) {
    humanClick(btn);
    await sleep(2500);
    if (!(box.innerText || '').trim()) {
      console.log('[FB Seeding CS] comment posted via send button');
      return { ok: true, posted: oneLine, liked };
    }
  }

  return {
    ok: false,
    error: 'submit_failed',
    typed,
    hint: 'Đã điền nội dung nhưng Facebook không nhận. Tab được giữ lại để bạn bấm gửi thủ công.',
  };
}

async function likeCurrentReel() {
  // Only ever likes — never unlikes. If the reel is already liked we leave it
  // alone, so re-running over the same reel can't toggle a like off.
  const candidates = Array.from(document.querySelectorAll('[aria-label][role="button"], div[role="button"][aria-label]'));
  for (const el of candidates) {
    const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    const isLike = label === 'thích' || label === 'like';
    if (!isLike) continue;
    // aria-pressed / "Bỏ thích" mean it is already liked
    if (el.getAttribute('aria-pressed') === 'true') return false;
    try {
      humanClick(el);
      await sleep(700);
      console.log('[FB Seeding CS] liked the reel');
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

// Lower is better: on-screen elements sort ahead of off-screen ones, and among
// those the closest to the viewport centre wins.
function visibleScore(el, centre) {
  try {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return 1e9;
    const onScreen = r.bottom > 0 && r.top < window.innerHeight;
    const dist = Math.abs((r.top + r.bottom) / 2 - centre);
    return (onScreen ? 0 : 1e6) + dist;
  } catch (e) {
    return 1e9;
  }
}

function findCommentComposer() {
  const nodes = document.querySelectorAll('div[contenteditable="true"]');
  for (const el of nodes) {
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    if (
      label.includes('bình luận') || label.includes('comment') ||
      label.includes('viết') || label.includes('write')
    ) return el;
  }
  // Fall back to the first editable box that looks like an input
  for (const el of nodes) {
    if (el.getAttribute('role') === 'textbox') return el;
  }
  return nodes[0] || null;
}

function findSendButton() {
  const wanted = ['bình luận', 'comment', 'gửi', 'send', 'post', 'đăng'];
  for (const el of document.querySelectorAll('[aria-label][role="button"], div[role="button"][aria-label]')) {
    const l = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (wanted.includes(l)) return el;
  }
  return null;
}

function pressEnter(el) {
  const base = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  try {
    el.dispatchEvent(new KeyboardEvent('keydown', base));
    el.dispatchEvent(new KeyboardEvent('keypress', base));
    el.dispatchEvent(new KeyboardEvent('keyup', base));
  } catch (e) {}
}

// ---------- SCRAPE MODE (comments on a single Reel) ----------

// Trả về { comments, diag }. `diag` được gửi kèm SCRAPE_RESULT và in ra ở
// background log, vì log của content script nằm trong console của tab nền —
// tab đó bị điều hướng liên tục nên log bị xoá trước khi kịp đọc. Không có
// diag thì "0 comments" không phân biệt được: reel thật sự không có bình luận,
// panel không mở được, hay nút bấm không phản hồi.
// Nhiều nhất bấy nhiêu bình luận. Kết quả vốn đã bị cắt còn 200 ở cuối hàm, nên
// nạp quá con số này là đốt thời gian vào thứ sẽ bị bỏ đi — mà thời gian hết là
// mất TRẮNG cả lượt cào.
const MAX_COMMENTS = 200;

async function scrapeComments(opts = {}) {
  const startedAt = Date.now();
  const budgetMs = opts.budgetMs || 33000;
  const deadline = startedAt + budgetMs;
  const startReelId = extractReelId(location.href);
  const diag = { reel: startReelId, why: null, budgetMs };
  const done = (comments, why) => {
    if (why) diag.why = why;
    return { comments, diag };
  };
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
  const opened = await openCommentPanel(diag);
  console.log('[FB Seeding CS] panel opened =', opened);
  diag.panelOpened = opened;

  // Fail loudly. Previously we carried on, and collectCommentText's fallback
  // strategies scraped ~15 strings of page furniture that matched no keywords —
  // reported as "15 comments, 0 intent", indistinguishable from a reel that
  // genuinely has no one asking for a link.
  if (!opened) {
    console.warn('[FB Seeding CS] comment panel never opened — reporting no comments read');
    stopAutoAdvance();
    return done([], 'panel-không-mở-được');
  }

  diag.sortedByAll = await switchToAllComments();

  // Only scroll the comment panel itself. NEVER scroll the window in scrape
  // mode — that advances the vertical Reel feed and mixes comments from
  // adjacent reels into the DOM.
  let panel = findCommentScrollContainer();

  // Bấm "Xem thêm bình luận" CHO TỚI KHI HẾT, không phải 8 vòng cố định.
  // Dừng khi: đạt tổng số FB công bố ("16/38"), hoặc 3 vòng liên tiếp không
  // nạp thêm được node nào, hoặc chạm trần vòng lặp.
  //
  // Lưu ý: tổng FB công bố có thể lớn hơn nhiều so với những gì nó chịu trả
  // (bài /videos/ ghi "2/801"). Không nạp hết là chuyện bình thường — dừng theo
  // 'idle' và ghi log rõ, chứ không quay vòng vô ích.
  const MAX_ROUNDS = 40;
  const total = readCommentTotal(panel);
  let loaded = countCommentNodes(panel);
  let idle = 0;
  let rounds = 0;
  let moreClicks = 0;
  diag.scopedToPanel = !!panel;
  diag.claimedTotal = total;
  diag.loadedAtStart = loaded;
  if (total) console.log('[FB Seeding CS] FB báo tổng', total, 'bình luận');

  for (; rounds < MAX_ROUNDS && idle < 3; rounds++) {
    if (total && loaded >= total) break;
    // Hai cái phanh mới. Trước đây chỉ có MAX_ROUNDS=40, mỗi vòng ~2,5s → tới
    // 100 giây, quá xa hạn 45s của background.
    if (Date.now() >= deadline) {
      diag.hitBudget = true;
      console.warn('[FB Seeding CS] hết ngân sách thời gian sau', rounds, 'vòng — bóc luôn chỗ đã nạp');
      break;
    }
    if (loaded >= MAX_COMMENTS) {
      diag.hitCommentCap = true;
      console.log('[FB Seeding CS] đã đủ', loaded, 'bình luận — không nạp thêm');
      break;
    }
    // Tìm lại container mỗi vòng: đổi sang "Tất cả bình luận" hoặc mở rộng
    // danh sách làm React thay cả nhánh DOM, giữ tham chiếu cũ là cuộn vào
    // một node đã bị gỡ khỏi trang.
    panel = findCommentScrollContainer() || panel;
    if (panel) panel.scrollTop = panel.scrollHeight;
    await sleep(900);
    const clicked = await clickMoreCommentsButtons(panel);
    moreClicks += clicked;
    await sleep(clicked ? 1200 : 600);

    // Bail early if FB navigated us to a different reel mid-scrape
    if (extractReelId(location.href) !== startReelId) {
      console.warn('[FB Seeding CS] URL drifted during scrape, aborting');
      stopAutoAdvance();
      diag.driftedTo = extractReelId(location.href);
      return done([], 'url-nhảy-sang-reel-khác');
    }

    const now = countCommentNodes(panel);
    if (now > loaded) {
      idle = 0;
      loaded = now;
    } else {
      idle++;
    }
  }
  console.log(
    '[FB Seeding CS] nạp xong sau', rounds, 'vòng —', loaded,
    total ? `/${total}` : '', 'node bình luận trong DOM'
  );
  if (total && loaded < total) {
    console.warn('[FB Seeding CS] CHƯA nạp hết:', loaded, '/', total);
  }

  diag.rounds = rounds;
  diag.moreClicks = moreClicks;
  diag.loadedNodes = loaded;
  diag.elapsedMs = Date.now() - startedAt;

  // Final invariant check: URL must still be the same reel
  if (extractReelId(location.href) !== startReelId) {
    console.warn('[FB Seeding CS] URL drifted before extract, discarding');
    stopAutoAdvance();
    diag.driftedTo = extractReelId(location.href);
    return done([], 'url-nhảy-sang-reel-khác');
  }

  // Scope to the panel so a neighbouring preloaded reel's comments can't leak in
  const collected = collectCommentText(panel || undefined);
  stopAutoAdvance();
  console.log(
    '[FB Seeding CS] collected', collected.length, 'comment candidates on reel', startReelId,
    panel ? '(scoped to panel)' : '(document-wide — no panel container found)'
  );

  const seen = new Set();
  const uniq = [];
  for (const c of collected) {
    if (!seen.has(c)) {
      seen.add(c);
      uniq.push(c);
    }
  }
  diag.collected = uniq.length;
  diag.elapsedMs = Date.now() - startedAt;
  // Panel mở được, có node bình luận trong DOM, nhưng bóc ra không được chữ nào
  // → lỗi bóc text, không phải reel im lặng. Phân biệt hai cái này là điểm chính.
  const why = uniq.length === 0
    ? (loaded > 0 ? 'có-node-bình-luận-nhưng-bóc-ra-rỗng' : 'panel-mở-nhưng-không-có-bình-luận-nào')
    : null;
  return done(uniq.slice(0, 200), why);
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

// Chỉ khớp node BÌNH LUẬN THẬT. Không dùng '[aria-label^="Bình luận"]' vì nó
// khớp luôn cái NÚT mở panel (aria-label="Bình luận") nằm ngoài panel.
const COMMENT_NODE_SEL =
  '[aria-label^="Bình luận dưới tên"], [aria-label^="Bình luận của"], [aria-label^="Comment by"]';

function countCommentNodes(scope) {
  return (scope || document).querySelectorAll(COMMENT_NODE_SEL).length;
}

async function openCommentPanel(diag = {}) {
  const isPanelOpen = () => !!document.querySelector(COMMENT_NODE_SEL);

  if (isPanelOpen()) {
    console.log('[FB Seeding CS] panel already open');
    diag.openedVia = 'đã-mở-sẵn';
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

  // Facebook preloads the neighbouring reels, so the page really does contain
  // several "Bình luận" buttons (one per reel, e.g. 57 and 9). Clicking the
  // first one in DOM order is a coin flip that can open the wrong reel's
  // panel — prefer the button actually on screen, nearest the viewport centre.
  const centre = window.innerHeight / 2;
  targets.sort((a, b) => visibleScore(a.el, centre) - visibleScore(b.el, centre));

  // Chỉ bấm nút ĐANG HIỂN THỊ trên màn hình. Nút ngoài màn hình là của reel
  // preload — bấm vào đó sẽ mở panel của REEL KHÁC, và ta gán nhầm comment của
  // nó cho reel hiện tại (reel rác bị chấm là chất lượng, và ngược lại).
  // Thà báo "không mở được panel" để hunter bỏ qua reel này còn hơn.
  let queue = targets.filter(({ el }) => visibleScore(el, centre) < 1e6);
  diag.candidates = targets.length;
  diag.onScreen = queue.length;

  // Tab nền đôi khi không tính layout, mọi getBoundingClientRect() ra 0 → không
  // nút nào "trên màn hình" và ta sẽ không bấm gì cả, im lặng trả 0 bình luận.
  // Thà thử nút gần đầu DOM nhất, nhưng ghi rõ là không xác minh được reel nào.
  if (queue.length === 0 && targets.length > 0) {
    queue = targets.slice(0, 1);
    diag.identityUnverified = true;
    console.warn(
      '[FB Seeding CS] không đo được vị trí nút nào (tab nền không layout?) —',
      'thử nút đầu tiên, KHÔNG chắc đúng reel'
    );
  }

  const dropped = targets.length - queue.length;
  console.log(
    '[FB Seeding CS] found', targets.length, 'candidate comment buttons;',
    dropped ? `bỏ ${dropped} nút ngoài màn hình (reel preload);` : '',
    'trying', queue.map((t) => t.label).slice(0, 4).join(' / ') || '(không có nút nào)'
  );

  for (const { el, label } of queue) {
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
        diag.openedVia = label;
        diag.openedAfterMs = (wait + 1) * 500;
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
  //
  // Hai cái bẫy đã làm scrape trả về 0 bình luận:
  //   1. anchor cũ khớp cả nút "Bình luận" (ngoài panel) → leo lên trúng khung
  //      feed của reel. Cuộn nó = nhảy sang reel khác giữa chừng.
  //   2. khung feed cũng scrollable, nên vòng lặp dừng ngay ở nó.
  // Chốt chặn: container nào chứa <video> thì đó là khung feed, không phải panel.
  const anchor = document.querySelector(COMMENT_NODE_SEL);
  if (!anchor) return null;
  let el = anchor.parentElement;
  let lastSafe = null;
  while (el && el !== document.body) {
    if (el.querySelector('video')) break; // đã leo ra tới khung reel → dừng
    lastSafe = el;
    const cs = getComputedStyle(el);
    if (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 10) {
      console.log('[FB Seeding CS] scroll container: h=', el.scrollHeight, 'client=', el.clientHeight);
      return el;
    }
    el = el.parentElement;
  }
  // Chưa đủ comment để panel scroll được: vẫn trả về nhánh DOM của panel để
  // collectCommentText() không quét cả trang (dính comment của reel kế bên).
  if (lastSafe) console.log('[FB Seeding CS] panel không scroll được, dùng nhánh panel làm scope');
  return lastSafe;
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

  for (const el of triggerCandidates.slice(0, 3)) {
    try {
      // humanClick, không phải el.click(): React của FB bỏ qua click trần.
      humanClick(el);
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
        humanClick(all);
        await sleep(1500);
        return true;
      }
      console.warn('[FB Seeding CS] mở dropdown nhưng không thấy "Tất cả bình luận"');
    } catch (e) {}
  }
  console.warn('[FB Seeding CS] không chuyển được sang "Tất cả bình luận" — đọc theo thứ tự mặc định');
  return false;
}

const MORE_PREFIXES = [
  'xem thêm bình luận', 'view more comments',
  'xem thêm phản hồi', 'view more replies',
  'xem trước', 'view previous',
  'xem tất cả bình luận', 'view all comments',
];

// Trả về số nút đã bấm, để vòng lặp scrape biết khi nào hết cái để bấm.
async function clickMoreCommentsButtons(scope) {
  const root = scope || document;
  const nodes = Array.from(root.querySelectorAll(
    'div[role="button"], span, a[role="button"], div[role="link"]'
  ));
  const hits = nodes.filter((b) => {
    const t = (b.innerText || '').trim().toLowerCase();
    return !!t && MORE_PREFIXES.some((p) => t.startsWith(p));
  });

  // Một nút thật thường lồng nhau (div[role=button] > span cùng text). Bỏ node
  // cha khi con của nó cũng khớp, để không bấm hai lần vào cùng một nút.
  const innermost = hits.filter((h) => !hits.some((o) => o !== h && h.contains(o)));

  let clicked = 0;
  for (const b of innermost) {
    // humanClick chứ không phải b.click(): React của FB bỏ qua click trần —
    // đây chính là lý do trước đây log ghi "clicked 2 buttons" mà DOM không
    // nạp thêm bình luận nào.
    try { humanClick(b); clicked++; } catch (e) {}
  }
  if (clicked > 0) console.log('[FB Seeding CS] bấm', clicked, 'nút "Xem thêm bình luận"');
  await sleep(700);
  return clicked;
}

// Đọc bộ đếm FB in trên nút, ví dụ "Xem thêm bình luận 16/38" → 38.
function readCommentTotal(scope) {
  const root = scope || document;
  let total = 0;
  root.querySelectorAll('div[role="button"], span, div[role="link"]').forEach((el) => {
    const t = (el.innerText || '').trim().toLowerCase();
    if (!MORE_PREFIXES.some((p) => t.startsWith(p))) return;
    const m = t.match(/(\d+)\s*\/\s*(\d+)/);
    if (m) total = Math.max(total, parseInt(m[2], 10));
  });
  return total;
}

// `root` scopes collection to the open comment panel. That matters because
// Facebook keeps the neighbouring reels mounted, so a document-wide sweep can
// mix in comments belonging to a different reel.
function collectCommentText(root) {
  const scope = root || document;
  const out = [];

  // Strategy 1: role="article" (works on News Feed posts, sometimes on Reel side panel)
  scope.querySelectorAll('div[role="article"]').forEach((a) => {
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
  scope.querySelectorAll('[aria-label]').forEach((el) => {
    const label = el.getAttribute('aria-label') || '';
    const m = label.match(COMMENT_LABEL_RE);
    if (!m) return;
    const author = (m[1] || m[2] || '').trim();
    if (!author) return;
    const text = extractCommentText(el);
    if (text && text.length >= 2) out.push(`${author}: ${text}`);
  });

  // Strategy 3: <ul aria-label="Comments"> — legacy
  scope.querySelectorAll('ul[aria-label*="Comment"], ul[aria-label*="ình luận"]').forEach((ul) => {
    ul.querySelectorAll('li').forEach((li) => {
      const text = extractCommentText(li);
      const author = extractAuthor(li);
      if (text && text.length >= 2) out.push(author ? `${author}: ${text}` : text);
    });
  });

  // Strategy 4: walk visible dir="auto" nodes inside likely comment container
  // Filter out video caption / UI chrome by requiring the node to be inside
  // something with 'comment' or 'bình luận' in an aria-label somewhere up.
  scope.querySelectorAll('div[dir="auto"]').forEach((el) => {
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
