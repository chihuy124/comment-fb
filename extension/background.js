// Background service worker — orchestrates scraping FB Reel tabs.
// Web page (comment-fb.*) → page_bridge → chrome.runtime.sendMessage → here →
// open FB tab → content_script asks for mission → runs → reports back.

const DEFAULT_SETTINGS = {
  concurrent: 3,        // parallel lanes walking the URL queue
  perTabTimeoutMs: 45000, // max time to wait for one reel's comments
};

async function getSettings() {
  const stored = await chrome.storage.local.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

// tabId → mission descriptor. Content script queries GET_MISSION with its
// own sender.tab.id and receives the mode assigned by whoever opened it.
const missions = new Map();
// tabId → resolvers for the caller-facing promise
const pendingScrapes = new Map();
const pendingHarvests = new Map();
const pendingComments = new Map();

// ---- Keep-alive: pinging chrome APIs every 20s keeps the MV3 service worker
// awake during long-running discover/scrape operations. Only ticks while there
// is at least one pending mission. ----
let keepAliveTimer = null;
function ensureKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    if (missions.size === 0 && pendingScrapes.size === 0 && pendingHarvests.size === 0 && pendingComments.size === 0) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      return;
    }
    // Any chrome API call resets the SW idle timer
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
}

// Inject a "pin reel" script into a tab's MAIN world. Bypasses FB's CSP
// which blocks content-script-injected <script> tags. Freezes navigation
// and playback so the tab stays on the requested reel for the whole scrape.
async function pinReelInPageWorld(tabId, pinnedReelId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (pinned) => {
        if (window.__fbSeedingPinned) return;
        window.__fbSeedingPinned = pinned;
        const extractId = (href) => {
          try {
            const u = new URL(href, location.href);
            const m = u.pathname.match(/^\/reels?\/(\d+)/);
            if (m) return 'reel:' + m[1];
            if (u.pathname.indexOf('/watch') === 0) {
              const v = u.searchParams.get('v');
              if (v) return 'watch:' + v;
            }
          } catch (e) {}
          return null;
        };
        const _push = history.pushState.bind(history);
        const _replace = history.replaceState.bind(history);
        history.pushState = function (s, t, url) {
          if (url) { const id = extractId(url); if (id && id !== pinned) return; }
          return _push(s, t, url);
        };
        history.replaceState = function (s, t, url) {
          if (url) { const id = extractId(url); if (id && id !== pinned) return; }
          return _replace(s, t, url);
        };
        HTMLMediaElement.prototype.play = function () {
          try { this.pause(); } catch (e) {}
          return Promise.resolve();
        };
        console.log('[FB Seeding MAIN] pinned to', pinned);
      },
      args: [pinnedReelId],
    });
    console.log('[BG] pinned tab', tabId, 'to', pinnedReelId);
  } catch (e) {
    console.error('[BG] pin failed:', e);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[BG] recv', msg?.type, 'from', sender.tab?.id ? `tab=${sender.tab.id}` : (sender.url || 'unknown'));

  // Content script asking to pin its tab (freeze reel + video in MAIN world)
  if (msg?.type === 'REQUEST_PIN' && sender.tab?.id != null && msg.reelId) {
    pinReelInPageWorld(sender.tab.id, msg.reelId);
    sendResponse({ ok: true });
    return false;
  }

  // Content script asking what to do
  if (msg?.type === 'GET_MISSION' && sender.tab?.id != null) {
    const m = missions.get(sender.tab.id);
    // Content script vừa vào việc → bắt đầu đếm hạn từ đây, không tính thời
    // gian Facebook tải trang (tab nền có khi mất 20-30s).
    if (m?.mode === 'harvest') {
      const p = pendingHarvests.get(sender.tab.id);
      if (p?.rearm) p.rearm();
    }
    if (m?.mode === 'scrape') {
      const p = pendingScrapes.get(sender.tab.id);
      if (p?.rearm) p.rearm();
    }
    sendResponse(m || { mode: null });
    return false;
  }

  // Content script reports scrape done
  if (msg?.type === 'SCRAPE_RESULT' && sender.tab?.id != null) {
    const p = pendingScrapes.get(sender.tab.id);
    if (p) {
      clearTimeout(p.timer);
      pendingScrapes.delete(sender.tab.id);
      if (!p.keepTab) {
        missions.delete(sender.tab.id);
        chrome.tabs.remove(sender.tab.id).catch(() => {});
      }
      p.resolve({
        comments: msg.comments || [],
        foundUrls: msg.foundUrls || [],
        diag: msg.diag || null,
      });
    }
    return false;
  }

  // Content script reports the outcome of a comment attempt
  if (msg?.type === 'COMMENT_RESULT' && sender.tab?.id != null) {
    const p = pendingComments.get(sender.tab.id);
    if (p) {
      clearTimeout(p.timer);
      pendingComments.delete(sender.tab.id);
      p.resolve(msg);
    }
    return false;
  }

  // Web app asks to post one comment on one reel
  if (msg?.type === 'POST_COMMENT') {
    postCommentOnReel(msg.url, msg.text, msg.behaviour || {}).then(sendResponse);
    return true;
  }

  // Web app starts / stops a hunt
  if (msg?.type === 'HUNT_REELS') {
    huntReels(msg.opts || {}, sender.tab?.id).then(sendResponse);
    return true;
  }
  if (msg?.type === 'HUNT_ABORT') {
    huntAbort = true;
    sendResponse({ ok: true });
    return false;
  }

  // Web app kicks off feed discovery
  if (msg?.type === 'DISCOVER_REELS') {
    discoverFromFeed(msg.durationMs || 45000, msg.startUrl, msg.keywords).then(sendResponse);
    return true;
  }

  // Content script reports the reel URLs it harvested from a feed/search page
  if (msg?.type === 'HARVEST_RESULT' && sender.tab?.id != null) {
    const p = pendingHarvests.get(sender.tab.id);
    if (p) {
      clearTimeout(p.timer);
      pendingHarvests.delete(sender.tab.id);
      p.resolve({ urls: msg.urls || [], stuck: !!msg.stuck });
    }
    return false;
  }

  // Heartbeat from content script — keeps SW alive, logged for debug.
  // Cũng là bản sao lưu: nếu harvest hết hạn trước khi content script kịp gửi
  // HARVEST_RESULT, số URL kèm theo đây là thứ duy nhất cứu được.
  if (msg?.type === 'DISCOVER_PROGRESS') {
    if (sender.tab?.id) {
      const p = pendingHarvests.get(sender.tab.id);
      if (p && Array.isArray(msg.urls) && msg.urls.length >= (p.partial?.length || 0)) {
        p.partial = msg.urls;
      }
      console.log(
        `[BG] progress tab=${sender.tab.id} count=${msg.count} phase=${msg.phase || '-'}` +
        (p ? ` (giữ ${p.partial.length} url)` : '')
      );
    }
    return false;
  }

  if (msg?.type === 'CS_ERROR') {
    console.error('[BG] content script error on', msg.url, ':', msg.error);
    return false;
  }

  if (msg?.type === 'PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
});

// ---- SINGLE COMMENT FLOW ----
// One click in the web app = one comment. Opens the reel in a background tab,
// lets the content script fill and submit the composer, then reports back.
// On success the tab is closed; on failure it is brought to the front with the
// text already filled in so the user can finish (or abandon) it by hand.
async function postCommentOnReel(url, text, behaviour = {}) {
  const canonical = canonicalReelUrl(url) || url;
  const reelId = extractReelIdBg(canonical);
  console.log('[BG][comment] opening', canonical, 'behaviour', behaviour);

  let tab;
  try {
    tab = await chrome.tabs.create({ url: canonical, active: false });
  } catch (e) {
    return { ok: false, error: 'tab_create_failed' };
  }
  missions.set(tab.id, {
    mode: 'comment',
    text,
    reelId,
    dwellMs: behaviour.dwellMs || 0,
    likeChance: behaviour.likeChance || 0,
  });
  ensureKeepAlive();

  // Watchdog has to outlast the dwell period, otherwise a long "watch" would
  // look like a hang.
  const watchdogMs = 90000 + (behaviour.dwellMs || 0);
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingComments.delete(tab.id);
      resolve({ ok: false, error: 'timeout', hint: 'Hết thời gian chờ — tab được giữ lại để bạn kiểm tra.' });
    }, watchdogMs);
    pendingComments.set(tab.id, {
      resolve: (payload) => { clearTimeout(timer); resolve(payload); },
      timer,
    });
  });

  missions.delete(tab.id);
  if (result.ok) {
    chrome.tabs.remove(tab.id).catch(() => {});
    console.log('[BG][comment] posted on', canonical);
  } else {
    // Surface the tab so the user can see exactly what happened
    chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    console.warn('[BG][comment] failed on', canonical, '→', result.error);
  }
  return { ...result, url: canonical };
}

function extractReelIdBg(href) {
  try {
    const u = new URL(href, 'https://www.facebook.com');
    const m = u.pathname.match(/^\/reels?\/(\d+)/);
    if (m) return 'reel:' + m[1];
    if (u.pathname.startsWith('/watch')) {
      const v = u.searchParams.get('v');
      if (v) return 'watch:' + v;
    }
    const vm = u.pathname.match(/^\/[^/]+\/videos\/(\d+)/);
    if (vm) return 'video:' + vm[1];
  } catch (e) {}
  return null;
}

// ---- REEL HUNTER FLOW ----
// Walk Facebook Reels one at a time: load a reel, scrape its comments, count
// how many match the intent keywords, keep it if it clears the threshold.
// Repeat until we have `targetCount` qualifying reels (or run out of budget).
//
// Advancing is done by NAVIGATING to the next reel URL rather than faking
// swipe/keyboard events — FB ignores synthetic ArrowDown and the reel feed
// isn't window-scrollable, which is why event-based walking yielded 1 reel.
// Every page load renders exactly one reel, so the comments we read always
// belong to the reel we think they do.

let huntAbort = false;

function normalizeVi(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function countIntentMatches(comments, keywords) {
  const kws = (keywords || []).map(normalizeVi).filter(Boolean);
  const matched = [];
  for (const c of comments || []) {
    const nc = normalizeVi(c);
    if (kws.some((k) => nc.includes(k))) matched.push(String(c).trim());
  }
  return matched;
}

// Dịch `diag` của content script thành một dòng đọc được. Không có diag nghĩa là
// content script không gửi gì về — tức là nó chết hoặc hết hạn, khác hẳn với
// reel thật sự không có bình luận.
function logZeroCommentDiag(url, diag) {
  if (!diag) {
    console.warn(`[BG][hunt]    ↳ 0 comments: content script KHÔNG trả lời (hết hạn ${DEFAULT_SETTINGS.perTabTimeoutMs}ms hoặc tab chết)`);
    return;
  }
  const bits = [
    `lý do=${diag.why || '?'}`,
    `panel=${diag.panelOpened ? `mở (${diag.openedVia})` : 'KHÔNG mở'}`,
    `nút tìm thấy=${diag.candidates ?? '?'}`,
    `trên màn hình=${diag.onScreen ?? '?'}`,
    diag.identityUnverified ? 'KHÔNG-đo-được-vị-trí-nút' : null,
    `FB báo tổng=${diag.claimedTotal || 0}`,
    `node trong DOM=${diag.loadedNodes ?? diag.loadedAtStart ?? '?'}`,
    `số lần bấm "xem thêm"=${diag.moreClicks ?? 0}`,
    diag.elapsedMs ? `mất ${Math.round(diag.elapsedMs / 1000)}s/${Math.round((diag.budgetMs || 0) / 1000)}s` : null,
    diag.hitBudget ? 'HẾT-NGÂN-SÁCH-THỜI-GIAN' : null,
    diag.scopedToPanel === false ? 'không-tìm-được-panel-container' : null,
    diag.sortedByAll === false ? 'không-đổi-được-sang-Tất-cả-bình-luận' : null,
    diag.driftedTo ? `URL nhảy sang ${diag.driftedTo}` : null,
  ].filter(Boolean);
  console.warn(`[BG][hunt]    ↳ 0 comments trên ${url}: ${bits.join(' | ')}`);
}

async function huntReels(opts, appTabId) {
  const {
    targetCount = 10,
    minIntent = 2,
    intentKeywords = [],
    searchKeywords = [],
    maxChecks = 120,
    excludeUrls = [],
  } = opts || {};

  huntAbort = false;
  const visited = new Set((excludeUrls || []).map((u) => canonicalReelUrl(u) || u));
  const qualified = [];
  const frontier = [];
  let checked = 0;

  const pushFrontier = (urls) => {
    for (const u of urls || []) {
      const c = canonicalReelUrl(u) || u;
      if (c && !visited.has(c) && !frontier.includes(c)) frontier.push(c);
    }
  };

  const report = (extra) => {
    if (appTabId == null) return;
    chrome.tabs.sendMessage(appTabId, {
      type: 'HUNT_PROGRESS',
      checked,
      qualifiedCount: qualified.length,
      frontier: frontier.length,
      ...extra,
    }).catch(() => {});
  };

  // Mutable: the escalation ladder below may replace the tab entirely, which
  // changes its id, and every later call has to follow the new one.
  let tabId;
  try {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    tabId = tab.id;
    console.log('[BG][hunt] tab id=', tabId);
  } catch (e) {
    console.error('[BG][hunt] tab create failed:', e);
    return { ok: false, error: 'tab_create_failed', reels: [] };
  }
  ensureKeepAlive();
  const settings = await getSettings();

  // Replenishment sources, tried in order whenever the frontier runs dry.
  // The vertical reel feed comes first and is revisited most: it is the one
  // truly endless source, since each advance loads another reel.
  const replenishSources = [
    'https://www.facebook.com/reel/',
    'https://www.facebook.com/watch/',
    'https://www.facebook.com/reel/',
  ];
  for (const kw of searchKeywords) {
    const q = encodeURIComponent(kw);
    replenishSources.push(`https://www.facebook.com/search/videos/?q=${q}`);
    replenishSources.push(`https://www.facebook.com/search/posts/?q=${q}`);
    replenishSources.push('https://www.facebook.com/reel/');
  }
  // Sources are cycled. Each harvest is told what we have already visited and
  // how many new reels we want, so it scrolls DEEPER into the feed rather than
  // handing back the same first screenful — that was the bug behind premature
  // "Facebook không trả thêm Reels mới": zero new URLs meant "I re-scanned the
  // top of the feed", not "the feed is empty".
  //
  // A round only counts as dry when the page itself reported it could not
  // advance at all (no new links, no scroll movement, no URL change).
  let replenishRound = 0;
  let dryRounds = 0;
  const MAX_DRY_ROUNDS = 8;
  const WANT_PER_HARVEST = 15;
  const MAX_RELOADS_PER_SOURCE = 2;

  try {
    while (qualified.length < targetCount && checked < maxChecks && !huntAbort) {
      // The escalation ladder can fail to produce a replacement tab; without one
      // there is nothing left to drive.
      if (tabId == null) {
        console.warn('[BG][hunt] no working tab left — stopping');
        break;
      }

      // Out of reels to try → harvest a fresh batch from the next source
      if (frontier.length === 0) {
        if (dryRounds >= MAX_DRY_ROUNDS) {
          console.log(`[BG][hunt] ${MAX_DRY_ROUNDS} sources in a row could not advance — stopping`);
          break;
        }
        const src = replenishSources[replenishRound % replenishSources.length];
        replenishRound++;
        // NB: field must NOT be called `source` — page_bridge wraps progress in
        // an envelope keyed `source: TAG` and spreads the message over it, so a
        // `source` here would clobber the envelope and the page would drop it.
        report({ phase: 'replenish', sourceUrl: src });
        console.log(`[BG][hunt] replenishing from ${src} (round ${replenishRound})`);

        const harvestOpts = {
          durationMs: HARVEST_CAP_MS,
          exclude: Array.from(visited),
          want: WANT_PER_HARVEST,
        };
        const countNew = (urls) => {
          let n = 0;
          for (const u of urls || []) {
            const c = canonicalReelUrl(u) || u;
            if (c && !visited.has(c)) n++;
          }
          return n;
        };

        let harvest = await navigateAndHarvest(tabId, src, HARVEST_CAP_MS + 25000, harvestOpts);

        // Escalation ladder for a stalled source. The previous version called
        // chrome.tabs.reload, which reloads the tab's CURRENT url — and by then
        // the reel feed has drifted to /reel/<id>, so it just reloaded a reel we
        // had already checked. That is why reloading measured 9 → 9 new urls.
        //   1. re-navigate to the SOURCE url (via about:blank, so an unchanged
        //      url still produces a brand-new document)
        //   2. throw the tab away and start a fresh one
        // Only if both fail does the source count as dry.
        let recovery = 0;
        while (harvest.stuck && recovery < 2 && !huntAbort) {
          recovery++;
          const newBefore = countNew(harvest.urls);
          const how = recovery === 1 ? 'renavigate' : 'fresh-tab';
          report({ phase: 'reload', sourceUrl: src, attempt: recovery, how });
          console.log(`[BG][hunt] stuck → ${how} (${recovery}/2) on ${src}`);

          let retry;
          if (recovery === 1) {
            retry = await renavigateAndHarvest(tabId, src, HARVEST_CAP_MS + 25000, harvestOpts);
          } else {
            tabId = await recreateHuntTab(tabId);
            if (tabId == null) break; // cannot continue without a tab
            retry = await navigateAndHarvest(tabId, src, HARVEST_CAP_MS + 25000, harvestOpts);
          }

          const merged = new Set([...(harvest.urls || []), ...(retry.urls || [])]);
          harvest = { urls: Array.from(merged), stuck: retry.stuck };

          // Logged so it stays measurable which rung of the ladder actually helps
          console.log(
            `[BG][hunt] ${how} → new urls ${newBefore} → ${countNew(harvest.urls)}` +
            `${retry.stuck ? ' (still stuck)' : ' (unstuck)'}`
          );
        }

        const sizeBefore = frontier.length;
        pushFrontier(harvest.urls);
        const added = frontier.length - sizeBefore;

        // Một nguồn không đẩy được reel mới nào vào frontier cũng tính là cạn —
        // kể cả khi nó không tự nhận là stuck. Trước đây chỉ đếm `stuck`, nên
        // một nguồn liên tục hết hạn với 0 url (stuck=false) reset dryRounds về
        // 0 và vòng lặp quay mãi: `checked` không tăng nên maxChecks không bao
        // giờ chạm tới. Đúng cái thấy trong log: 3 vòng "+0 new urls dryRounds=0".
        dryRounds = (harvest.stuck || added === 0) ? dryRounds + 1 : 0;
        console.log(
          `[BG][hunt] +${added} new urls (saw ${harvest.urls.length}), frontier=${frontier.length}` +
          `${recovery ? `, ${recovery} recovery attempt(s)` : ''}` +
          `${harvest.stuck ? ' [stuck]' : ''} dryRounds=${dryRounds}`
        );
        if (frontier.length === 0) continue; // try the next source
      }

      const target = frontier.shift();
      visited.add(target);
      checked++;
      report({ phase: 'checking', current: target });

      const result = await navigateAndScrape(tabId, target, settings.perTabTimeoutMs, true);
      const comments = result.comments || [];
      // Reel pages sometimes expose neighbouring reels — keeps the crawl going
      pushFrontier(result.foundUrls);

      const matched = countIntentMatches(comments, intentKeywords);
      const pass = matched.length >= minIntent;
      console.log(
        `[BG][hunt] ${checked}. ${pass ? '✅' : '✗'} ${target} → ${comments.length} comments, ${matched.length} intent`
      );
      // Reel về 0 bình luận thì in luôn lý do. Log của content script nằm trong
      // console của tab nền, bị xoá mỗi lần điều hướng, nên đây là chỗ duy nhất
      // đọc được nguyên nhân sau khi hunt chạy xong.
      if (comments.length === 0) logZeroCommentDiag(target, result.diag);

      if (pass) {
        qualified.push({
          url: target,
          comments,
          intentCount: matched.length,
          intentComments: matched,
          commentCount: comments.length,
        });
      }

      report({
        phase: 'checked',
        current: target,
        lastCommentCount: comments.length,
        lastIntentCount: matched.length,
        lastPassed: pass,
      });
    }
  } finally {
    if (tabId != null) {
      missions.delete(tabId);
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  const stopReason = huntAbort ? 'stopped'
    : qualified.length >= targetCount ? 'target_reached'
    : checked >= maxChecks ? 'max_checks'
    : 'sources_exhausted';
  console.log(`[BG][hunt] done: ${qualified.length}/${targetCount} qualified after ${checked} checks (${stopReason})`);
  return { ok: true, reels: qualified, checked, stopReason };
}

function canonicalReelUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw, 'https://www.facebook.com');
    let m = u.pathname.match(/^\/reels?\/(\d{8,})/);
    if (m) return `https://www.facebook.com/reel/${m[1]}`;
    if (u.pathname.startsWith('/watch')) {
      const v = u.searchParams.get('v');
      if (v && /^\d{8,}$/.test(v)) return `https://www.facebook.com/watch/?v=${v}`;
    }
    m = u.pathname.match(/^\/([^/]+)\/videos\/(\d{8,})/);
    if (m) return `https://www.facebook.com/${m[1]}/videos/${m[2]}`;
  } catch (e) {}
  return null;
}

// ---- DISCOVER FLOW ----

// How long the in-tab feed-walking phase runs before we switch to
// background-driven URL navigation (which is far more reliable).
const HARVEST_MS_PER_SOURCE = 20000;
// Hunt harvests are goal-driven — they return as soon as enough new reels are
// found — so this is only an upper bound. Walking a vertical reel feed to
// collect ~15 fresh reels needs far more than the old flat 20s.
const HARVEST_CAP_MS = 100000;

// Pages worth harvesting reel URLs from. The Watch feed gives whatever FB's
// algorithm serves this account; search pages give topically targeted results
// (FB search works fine here because we're a real logged-in browser).
function buildHarvestTargets(keywords) {
  const targets = ['https://www.facebook.com/watch/'];
  for (const kw of keywords || []) {
    const q = encodeURIComponent(kw);
    targets.push(`https://www.facebook.com/search/videos/?q=${q}`);
  }
  return targets;
}

async function discoverFromFeed(totalBudgetMs, startUrl, keywords) {
  const overallDeadline = Date.now() + totalBudgetMs;
  const targets = startUrl ? [startUrl] : buildHarvestTargets(keywords);
  console.log('[BG] discover start, budget=', totalBudgetMs, 'sources=', targets.length);

  let tab;
  try {
    tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    console.log('[BG] harvest tab id=', tab.id);
  } catch (e) {
    console.error('[BG] tab create failed:', e);
    return { ok: false, error: 'tab_create_failed', reels: [] };
  }
  ensureKeepAlive();

  // --- Phase A: harvest URLs from each source page in turn. ---
  const queueSet = new Set();
  for (const target of targets) {
    // Always leave at least a minute for the scraping phase
    if (Date.now() > overallDeadline - 60000) {
      console.log('[BG] harvest budget spent, skipping remaining sources');
      break;
    }
    const harvest = await navigateAndHarvest(tab.id, target, HARVEST_MS_PER_SOURCE + 25000, {
      exclude: Array.from(queueSet),
    });
    harvest.urls.forEach((u) => queueSet.add(u));
    console.log(`[BG] harvested ${harvest.urls.length} from ${target} → total ${queueSet.size}`);
  }

  const collected = [];
  const queue = Array.from(queueSet);
  console.log('[BG] phase A done: queue', queue.length);

  if (queue.length === 0) {
    chrome.tabs.remove(tab.id).catch(() => {});
    return { ok: true, reels: [] };
  }

  // --- Phase B: navigate tabs through the queue URL-by-URL. Each page load
  // shows exactly one reel, so scraped comments can never belong to a
  // neighbouring reel. Lanes are created to match the real queue size. ---
  const settings = await getSettings();
  const wantLanes = Math.max(1, Math.min(4, settings.concurrent || 3));
  const lanes = Math.min(wantLanes, queue.length);
  const laneTabs = [tab.id];
  for (let i = 1; i < lanes; i++) {
    try {
      const t = await chrome.tabs.create({ url: 'about:blank', active: false });
      laneTabs.push(t.id);
    } catch (e) { /* fewer lanes is fine */ }
  }

  let cursor = 0;
  const worker = async (tabId) => {
    while (true) {
      // Leave headroom so we can still return results before the app times out
      if (Date.now() > overallDeadline - 12000) return;
      const idx = cursor++;
      if (idx >= queue.length) return;
      const target = queue[idx];
      const comments = await navigateAndScrape(tabId, target, settings.perTabTimeoutMs);
      collected.push({ url: target, comments });
      console.log(`[BG] queue ${idx + 1}/${queue.length} tab=${tabId} → ${comments.length} comments`);
    }
  };
  await Promise.all(laneTabs.map(worker));

  for (const id of laneTabs) {
    missions.delete(id);
    chrome.tabs.remove(id).catch(() => {});
  }
  console.log('[BG] discover+scrape complete, reels =', collected.length);
  return { ok: true, reels: collected };
}

// Navigate a tab to a feed/search page and wait for the content script to
// report every reel URL it could harvest there. Tab stays open for reuse.
// `opts.exclude` lets the content script keep scrolling past reels we have
// already visited instead of stopping at the first screenful; `opts.want` is
// how many genuinely-new reels it should try to come back with.
// `navigateFn` decides how we get onto the page — a fresh URL, or a reload of
// whatever is already there.
function runHarvest(tabId, timeoutMs, opts, navigateFn, label) {
  return new Promise(async (resolve) => {
    const empty = { urls: [], stuck: false };
    const durationMs = opts.durationMs || HARVEST_MS_PER_SOURCE;
    missions.set(tabId, {
      mode: 'harvest',
      durationMs,
      exclude: opts.exclude || [],
      want: opts.want || 0,
    });
    try {
      await navigateFn();
    } catch (e) {
      resolve(empty);
      return;
    }

    // `partial` giữ những URL content script đã báo qua DISCOVER_PROGRESS.
    // Trước đây timeout trả về rỗng, nên cả một vòng harvest tìm được 5-6 reel
    // vẫn bị ghi là "+0 new urls (saw 0)" — vứt sạch công đã làm.
    const entry = { partial: [], timer: null, resolve: null, armed: false };

    const fire = (payload, why) => {
      clearTimeout(entry.timer);
      pendingHarvests.delete(tabId);
      resolve(payload || empty);
      if (why) console.log('[BG] harvest', why, 'on', label);
    };

    const arm = (ms) => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        const salvaged = entry.partial || [];
        console.warn(
          '[BG] harvest timeout on', label,
          salvaged.length ? `— giữ lại ${salvaged.length} url đã tìm được` : '— không có url nào'
        );
        // stuck=false: trang vẫn đang chạy, chỉ là chậm hơn hạn. Đánh dấu stuck
        // ở đây sẽ kích hoạt nhầm thang leo renavigate/fresh-tab.
        fire({ urls: salvaged, stuck: false });
      }, ms);
    };

    // Đồng hồ chạy từ lúc NAVIGATE, nhưng tab nền tải Facebook có khi mất 20-30s
    // mới chạy được content script — hết cả hạn trước khi nó kịp làm gì.
    // `rearm` được gọi lại khi content script hỏi GET_MISSION, tức là từ lúc nó
    // thực sự bắt đầu đếm giờ của chính nó.
    entry.rearm = () => {
      if (entry.armed) return; // chỉ gia hạn một lần cho mỗi lần điều hướng
      entry.armed = true;
      console.log('[BG] content script vào việc trên', label, `→ gia hạn ${durationMs + 25000}ms`);
      arm(durationMs + 25000);
    };
    entry.resolve = (payload) => fire(payload);

    arm(timeoutMs);
    pendingHarvests.set(tabId, entry);
  });
}

function navigateAndHarvest(tabId, url, timeoutMs, opts = {}) {
  return runHarvest(tabId, timeoutMs, opts, () => chrome.tabs.update(tabId, { url }), url);
}

// Rung 1 of the stuck ladder: go back to the SOURCE url. Routing through
// about:blank first guarantees a brand-new document even when the tab is
// already sitting on that exact url, which a plain update would no-op on.
async function renavigateAndHarvest(tabId, url, timeoutMs, opts = {}) {
  try {
    await chrome.tabs.update(tabId, { url: 'about:blank' });
    await sleep(400);
  } catch (e) { /* fall through — the navigate below is what matters */ }
  return navigateAndHarvest(tabId, url, timeoutMs, opts);
}

// Rung 2: discard the tab and start clean. A fresh tab gets a fresh renderer
// and a fresh SPA state, which a same-tab navigation does not. Returns the new
// tab id, or null if a replacement could not be created.
async function recreateHuntTab(oldTabId) {
  missions.delete(oldTabId);
  pendingHarvests.delete(oldTabId);
  pendingScrapes.delete(oldTabId);
  pendingComments.delete(oldTabId);
  try { await chrome.tabs.remove(oldTabId); } catch (e) { /* already gone */ }

  try {
    // Created blank on purpose: navigateAndHarvest sets the mission before it
    // navigates, so the content script can never load before its mission exists.
    const t = await chrome.tabs.create({ url: 'about:blank', active: false });
    console.log('[BG][hunt] replaced tab', oldTabId, '→', t.id);
    return t.id;
  } catch (e) {
    console.error('[BG][hunt] could not create replacement tab:', e);
    return null;
  }
}

// Navigate an existing tab to a reel URL and wait for its content script to
// report the comments it scraped. Tab is kept open for reuse.
// `rich` callers get {comments, foundUrls}; legacy callers get a bare array.
function navigateAndScrape(tabId, url, timeoutMs, rich) {
  return new Promise(async (resolve) => {
    const empty = rich ? { comments: [], foundUrls: [] } : [];
    // Nói cho content script biết nó có bao nhiêu thời gian. Không có con số này
    // thì vòng nạp "Xem thêm bình luận" chạy quá hạn (đo thật trên một reel 539
    // bình luận: 45s vẫn chưa xong, đã nạp 187 node) → background bỏ cuộc, trả
    // rỗng, và cả một lượt cào công phu bị ghi thành "0 comments".
    // Trừ 12s cho phần mở panel + đổi sang "Tất cả bình luận" + gửi kết quả.
    const budgetMs = Math.max(15000, timeoutMs - 12000);
    missions.set(tabId, { mode: 'scrape', budgetMs });
    try {
      await chrome.tabs.update(tabId, { url });
    } catch (e) {
      resolve(empty);
      return;
    }
    const entry = { timer: null, armed: false, keepTab: true };
    const arm = (ms) => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        pendingScrapes.delete(tabId);
        console.warn('[BG] scrape timeout on', url);
        resolve(empty);
      }, ms);
    };
    // Y như harvest: đồng hồ chạy từ lúc navigate, nhưng tab nền tải Facebook mất
    // vài giây tới vài chục giây. Đo thật: cào xong một reel mất 34,8s tính từ lúc
    // content script bắt đầu — cộng thời gian tải trang là vượt hạn 45s. Nên tính
    // lại hạn từ lúc content script hỏi GET_MISSION.
    entry.rearm = () => {
      if (entry.armed) return;
      entry.armed = true;
      arm(timeoutMs);
    };
    entry.resolve = (payload) => {
      clearTimeout(entry.timer);
      const comments = payload?.comments || [];
      resolve(rich
        ? { comments, foundUrls: payload?.foundUrls || [], diag: payload?.diag || null }
        : comments);
    };
    arm(timeoutMs);
    pendingScrapes.set(tabId, entry);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
