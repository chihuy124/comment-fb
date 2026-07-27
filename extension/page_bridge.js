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

  // Background pushes live hunt progress here via chrome.tabs.sendMessage;
  // relay it into the page so the UI can update while the hunt runs.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'HUNT_PROGRESS') {
      // Spread first, then set the envelope keys, so a payload field can never
      // clobber `source`/`type` and get the message dropped by the page.
      window.postMessage({ ...msg, source: TAG, type: 'HUNT_PROGRESS' }, '*');
    }
  });

  window.addEventListener('message', async (e) => {
    if (e.source !== window) return;
    const msg = e.data;
    if (!msg || msg.source !== TAG) return;

    if (msg.type === 'PING') {
      window.postMessage({ source: TAG, type: 'PONG', requestId: msg.requestId, version: chrome.runtime.getManifest().version }, '*');
      return;
    }

    if (msg.type === 'HUNT_REELS') {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'HUNT_REELS',
          opts: msg.opts || {},
        });
        window.postMessage(
          { source: TAG, type: 'HUNT_DONE', requestId: msg.requestId, response },
          '*'
        );
      } catch (err) {
        window.postMessage(
          { source: TAG, type: 'HUNT_ERROR', requestId: msg.requestId, error: String(err) },
          '*'
        );
      }
      return;
    }

    if (msg.type === 'HUNT_ABORT') {
      try { await chrome.runtime.sendMessage({ type: 'HUNT_ABORT' }); } catch (_) {}
      return;
    }

    if (msg.type === 'DISCOVER_REELS') {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'DISCOVER_REELS',
          durationMs: msg.durationMs || 45000,
          startUrl: msg.startUrl,
          keywords: msg.keywords || [],
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
