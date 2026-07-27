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

// ---- Keep-alive: pinging chrome APIs every 20s keeps the MV3 service worker
// awake during long-running discover/scrape operations. Only ticks while there
// is at least one pending mission. ----
let keepAliveTimer = null;
function ensureKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    if (missions.size === 0 && pendingScrapes.size === 0 && pendingHarvests.size === 0) {
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
      p.resolve(msg.comments || []);
    }
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
      p.resolve(msg.urls || []);
    }
    return false;
  }

  // Heartbeat from content script — keeps SW alive, logged for debug
  if (msg?.type === 'DISCOVER_PROGRESS') {
    if (sender.tab?.id) {
      console.log(`[BG] progress tab=${sender.tab.id} count=${msg.count} phase=${msg.phase || '-'}`);
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

// ---- DISCOVER FLOW ----

// How long the in-tab feed-walking phase runs before we switch to
// background-driven URL navigation (which is far more reliable).
const HARVEST_MS_PER_SOURCE = 20000;

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
    const urls = await navigateAndHarvest(tab.id, target, HARVEST_MS_PER_SOURCE + 25000);
    urls.forEach((u) => queueSet.add(u));
    console.log(`[BG] harvested ${urls.length} from ${target} → total ${queueSet.size}`);
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
function navigateAndHarvest(tabId, url, timeoutMs) {
  return new Promise(async (resolve) => {
    missions.set(tabId, { mode: 'harvest', durationMs: HARVEST_MS_PER_SOURCE });
    try {
      await chrome.tabs.update(tabId, { url });
    } catch (e) {
      resolve([]);
      return;
    }
    const timer = setTimeout(() => {
      pendingHarvests.delete(tabId);
      console.warn('[BG] harvest timeout on', url);
      resolve([]);
    }, timeoutMs);
    pendingHarvests.set(tabId, {
      resolve: (urls) => { clearTimeout(timer); resolve(urls || []); },
      timer,
    });
  });
}

// Navigate an existing tab to a reel URL and wait for its content script to
// report the comments it scraped. Tab is kept open for reuse.
function navigateAndScrape(tabId, url, timeoutMs) {
  return new Promise(async (resolve) => {
    missions.set(tabId, { mode: 'scrape' });
    try {
      await chrome.tabs.update(tabId, { url });
    } catch (e) {
      resolve([]);
      return;
    }
    const timer = setTimeout(() => {
      pendingScrapes.delete(tabId);
      resolve([]);
    }, timeoutMs);
    pendingScrapes.set(tabId, {
      resolve: (comments) => { clearTimeout(timer); resolve(comments || []); },
      timer,
      keepTab: true,
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
