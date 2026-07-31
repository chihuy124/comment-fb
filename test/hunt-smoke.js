const fs = require('fs');
const code = fs.readFileSync('extension/background.js', 'utf8');

let listener = null;
let nextTabId = 100;
const created = [], removed = [], navigations = [];
const logs = [];

const chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  alarms: { create: () => {}, clear: async () => {}, onAlarm: { addListener: () => {} } },
  runtime: {
    onMessage: { addListener: (fn) => { listener = fn; } },
    getPlatformInfo: () => {},
    getManifest: () => ({ version: 'test' }),
    sendMessage: async () => ({}),
  },
  scripting: { executeScript: async () => {} },
  tabs: {
    create: async () => { const t = { id: nextTabId++ }; created.push(t.id); return t; },
    remove: async (id) => { removed.push(id); },
    sendMessage: async () => {},
    update: async (id, props) => {
      if (!props || !props.url || props.url === 'about:blank') return;
      navigations.push({ id, url: props.url });
      const isReelPermalink = /\/reels?\/\d+|\/watch\/\?v=\d+/.test(props.url);
      // Reply the way a content script would, on the next tick
      setTimeout(() => {
        if (!listener) return;
        if (isReelPermalink) {
          const hasIntent = props.url.endsWith('2') || props.url.endsWith('4');
          listener({
            type: 'SCRAPE_RESULT',
            comments: hasIntent ? ['A: xem tiếp', 'B: cho xin link'] : ['C: hay quá'],
            foundUrls: [],
          }, { tab: { id } }, () => {});
        } else {
          listener({
            type: 'HARVEST_RESULT',
            urls: Array.from({ length: 6 }, (_, i) => `https://www.facebook.com/reel/9000000000000${i}`),
            stuck: false,
          }, { tab: { id } }, () => {});
        }
      }, 5);
    },
  },
};

const origLog = console.log, origWarn = console.warn, origErr = console.error;
const cap = (fn) => (...a) => { logs.push(a.join(' ')); fn(...a); };
console.log = cap(origLog); console.warn = cap(origWarn); console.error = cap(origErr);

const api = new Function('chrome', 'console', code + '\n;return { huntReels };')(chrome, console);

(async () => {
  const res = await api.huntReels({
    targetCount: 2, minIntent: 1, maxChecks: 10,
    intentKeywords: ['xem tiếp', 'xin link'],
    searchKeywords: ['review phim'], excludeUrls: [],
  }, null);

  console.log = origLog; console.warn = origWarn; console.error = origErr;
  const bailed = logs.some(l => l.includes('no working tab left'));
  console.log('\n================ KẾT QUẢ ================');
  console.log('tab tạo ra          :', created.join(', '));
  console.log('điều hướng          :', navigations.length, 'lần');
  console.log('bail "no working tab":', bailed ? '❌ CÓ (bug)' : '✅ KHÔNG');
  console.log('stopReason          :', res.stopReason);
  console.log('qualified           :', res.reels.length + '/2');
  console.log('checked             :', res.checked);
  const ok = !bailed && res.reels.length === 2 && res.stopReason === 'target_reached';
  console.log('\n' + (ok ? '✅ PASS' : '❌ FAIL'));
  process.exit(ok ? 0 : 1);
})();
