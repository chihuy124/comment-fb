// Background service worker — orchestrates scraping FB Reel tabs.
// Web page (comment-fb.*) → page_bridge → chrome.runtime.sendMessage → here →
// open FB tab → content_script asks for mission → runs → reports back.

const DEFAULT_SETTINGS = {
  concurrent: 3,
  perTabTimeoutMs: 45000,
  delayBetweenBatchesMs: 1500,
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
const pendingDiscovers = new Map();

// ---- Keep-alive: pinging chrome APIs every 20s keeps the MV3 service worker
// awake during long-running discover/scrape operations. Only ticks while there
// is at least one pending mission. ----
let keepAliveTimer = null;
function ensureKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    if (missions.size === 0 && pendingScrapes.size === 0 && pendingDiscovers.size === 0) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      return;
    }
    // Any chrome API call resets the SW idle timer
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[BG] recv', msg?.type, 'from', sender.tab?.id ? `tab=${sender.tab.id}` : (sender.url || 'unknown'));

  // Content script asking what to do
  if (msg?.type === 'GET_MISSION' && sender.tab?.id != null) {
    const m = missions.get(sender.tab.id);
    sendResponse(m || { mode: null });
    return false;
  }

  // Web app kicks off scraping
  if (msg?.type === 'SCRAPE_URLS') {
    scrapeMany(msg.urls || []).then(sendResponse);
    return true;
  }

  // Content script reports scrape done
  if (msg?.type === 'SCRAPE_RESULT' && sender.tab?.id != null) {
    const p = pendingScrapes.get(sender.tab.id);
    if (p) {
      clearTimeout(p.timer);
      pendingScrapes.delete(sender.tab.id);
      missions.delete(sender.tab.id);
      p.resolve(msg.comments || []);
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
    return false;
  }

  // Web app kicks off feed discovery
  if (msg?.type === 'DISCOVER_REELS') {
    discoverFromFeed(msg.durationMs || 45000, msg.startUrl).then(sendResponse);
    return true;
  }

  // Content script reports discover done
  if (msg?.type === 'DISCOVER_RESULT' && sender.tab?.id != null) {
    const p = pendingDiscovers.get(sender.tab.id);
    if (p) {
      clearTimeout(p.timer);
      pendingDiscovers.delete(sender.tab.id);
      missions.delete(sender.tab.id);
      p.resolve(msg.urls || []);
      chrome.tabs.remove(sender.tab.id).catch(() => {});
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

// ---- SCRAPE FLOW ----

async function scrapeMany(urls) {
  const settings = await getSettings();
  const results = {};
  for (let i = 0; i < urls.length; i += settings.concurrent) {
    const batch = urls.slice(i, i + settings.concurrent);
    const batchResults = await Promise.all(
      batch.map((url) => scrapeOneUrl(url, settings.perTabTimeoutMs))
    );
    batch.forEach((url, idx) => { results[url] = batchResults[idx]; });
    if (i + settings.concurrent < urls.length) {
      await sleep(settings.delayBetweenBatchesMs);
    }
  }
  return { ok: true, results };
}

async function scrapeOneUrl(url, timeoutMs) {
  return new Promise(async (resolve) => {
    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
    } catch (e) {
      resolve({ error: 'tab_create_failed', comments: [] });
      return;
    }
    // Register mission BEFORE content script can query
    missions.set(tab.id, { mode: 'scrape' });
    ensureKeepAlive();

    const timer = setTimeout(() => {
      pendingScrapes.delete(tab.id);
      missions.delete(tab.id);
      chrome.tabs.remove(tab.id).catch(() => {});
      resolve({ error: 'timeout', comments: [] });
    }, timeoutMs);

    pendingScrapes.set(tab.id, {
      resolve: (comments) => resolve({ comments }),
      timer,
    });
  });
}

// ---- DISCOVER FLOW ----

async function discoverFromFeed(durationMs, startUrl) {
  const url = startUrl || 'https://www.facebook.com/watch/';
  console.log('[BG] discoverFromFeed start, url=', url, 'duration=', durationMs);
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    console.log('[BG] tab created id=', tab.id);
  } catch (e) {
    console.error('[BG] tab create failed:', e);
    return { ok: false, error: 'tab_create_failed', urls: [] };
  }
  missions.set(tab.id, { mode: 'discover', durationMs });
  ensureKeepAlive();

  return new Promise((resolve) => {
    // durationMs + generous buffer for tab load + content script GET_MISSION round-trip
    const timer = setTimeout(() => {
      pendingDiscovers.delete(tab.id);
      missions.delete(tab.id);
      chrome.tabs.remove(tab.id).catch(() => {});
      console.warn('[BG] discover timeout tab=', tab.id);
      resolve({ ok: false, error: 'timeout', urls: [] });
    }, durationMs + 25000);

    pendingDiscovers.set(tab.id, {
      resolve: (urls) => resolve({ ok: true, urls }),
      timer,
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
