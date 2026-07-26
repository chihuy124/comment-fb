// Injected into comment-fb.vercel.app (and localhost) — proxies messages
// between the web page and the extension background service worker.
// Also announces extension presence so the web app can enable the button.

(function () {
  const TAG = 'FB_SEEDING_EXT';

  // Tell the page we exist as soon as possible (window.postMessage → app.js listens)
  const announce = () => {
    window.postMessage({ source: TAG, type: 'EXT_READY', version: chrome.runtime.getManifest().version }, '*');
  };
  announce();
  document.addEventListener('DOMContentLoaded', announce);

  window.addEventListener('message', async (e) => {
    if (e.source !== window) return;
    const msg = e.data;
    if (!msg || msg.source !== TAG) return;

    if (msg.type === 'PING') {
      window.postMessage({ source: TAG, type: 'PONG', requestId: msg.requestId, version: chrome.runtime.getManifest().version }, '*');
      return;
    }

    if (msg.type === 'SCRAPE_URLS') {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'SCRAPE_URLS',
          urls: msg.urls || [],
        });
        window.postMessage(
          { source: TAG, type: 'SCRAPE_RESULT', requestId: msg.requestId, response },
          '*'
        );
      } catch (err) {
        window.postMessage(
          { source: TAG, type: 'SCRAPE_ERROR', requestId: msg.requestId, error: String(err) },
          '*'
        );
      }
    }

    if (msg.type === 'DISCOVER_REELS') {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'DISCOVER_REELS',
          durationMs: msg.durationMs || 45000,
          startUrl: msg.startUrl,
        });
        window.postMessage(
          { source: TAG, type: 'DISCOVER_RESULT', requestId: msg.requestId, response },
          '*'
        );
      } catch (err) {
        window.postMessage(
          { source: TAG, type: 'DISCOVER_ERROR', requestId: msg.requestId, error: String(err) },
          '*'
        );
      }
    }
  });
})();
