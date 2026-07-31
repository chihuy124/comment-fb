// Đo thật trên Chrome của user: trong TAB ẨN, Facebook không chạy feed Reels
// (bấm "Thẻ tiếp theo" → URL không đổi, cả 3 cơ chế đều thất bại) và trang
// /search/videos/ không lazy-load thêm (scrollTop đứng ở 451, bodyH đứng ở 1427
// qua 6 lần cuộn). Cùng cú bấm đó ở tab đang hiện: 1 reel mỗi 0,4 giây.
// Vì vậy hunt phải chạy trong CỬA SỔ RIÊNG mở với focused:false — tab trong đó
// là tab active của cửa sổ nên Facebook coi là visible, mà không giành bàn phím.
//
// Chạy: node test/hunt-window.js   (exit 0 = pass)

const fs = require('fs');

const SPEED = 200;
const code = fs.readFileSync('extension/background.js', 'utf8');

function makeBackground(opts = {}) {
  const { visibility = 'visible', urlsPerHarvest = 6, windowsFail = false } = opts;
  let listener = null;
  const calls = { windowsCreate: [], tabsCreate: [], windowsRemove: [], logs: [] };
  let nextTabId = 300, nextWinId = 7;

  const chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    alarms: { create: () => {}, clear: async () => {}, onAlarm: { addListener: () => {} } },
    runtime: {
      onMessage: { addListener: (fn) => { listener = fn; } },
      getPlatformInfo: () => {}, getManifest: () => ({ version: 'test' }),
      sendMessage: async () => ({}),
    },
    scripting: { executeScript: async () => {} },
    windows: {
      create: async (props) => {
        calls.windowsCreate.push(props);
        if (windowsFail) throw new Error('no windows api');
        const id = nextWinId++;
        return { id, tabs: [{ id: nextTabId++ }] };
      },
      remove: async (id) => { calls.windowsRemove.push(id); },
    },
    tabs: {
      create: async (props) => { calls.tabsCreate.push(props || {}); return { id: nextTabId++ }; },
      remove: async () => {},
      sendMessage: async () => {},
      update: async (id, props) => {
        if (!props || !props.url || props.url === 'about:blank') return;
        const isReel = /\/reels?\/\d+/.test(props.url);
        setTimeout(() => {
          if (!listener) return;
          if (isReel) {
            listener({ type: 'SCRAPE_RESULT', url: props.url, comments: [], foundUrls: [], diag: { why: 'x' } },
              { tab: { id } }, () => {});
          } else {
            listener({
              type: 'HARVEST_RESULT',
              urls: Array.from({ length: urlsPerHarvest }, (_, i) => `https://www.facebook.com/reel/70000000000${i}`),
              stuck: false, visibility,
            }, { tab: { id } }, () => {});
          }
        }, 1);
      },
    },
  };

  const origWarn = console.warn, origLog = console.log;
  console.warn = (...a) => { calls.logs.push(a.map(String).join(' ')); };
  console.log = (...a) => { calls.logs.push(a.map(String).join(' ')); };

  const api = new Function(
    'chrome', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    code + '\n;return { huntReels };'
  )(
    chrome, console,
    (fn, ms) => setTimeout(fn, Math.max(0, Math.round((ms || 0) / SPEED))),
    (t) => clearTimeout(t), () => 0, () => {}
  );

  return { api, calls, restore: () => { console.warn = origWarn; console.log = origLog; } };
}

const failures = [];
const out = (s) => process.stdout.write(s + '\n');
const check = (name, cond, detail) => {
  if (cond) out(`  ✅ ${name}`);
  else { out(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failures.push(name); }
};

const OPTS = {
  targetCount: 1, minIntent: 99, maxChecks: 3,
  intentKeywords: ['xem tiếp'], searchKeywords: [], excludeUrls: [],
};

(async () => {
  out('TEST hunt chạy trong cửa sổ riêng, không giành focus\n');

  out('=== Cửa sổ riêng, focused:false ===');
  {
    const { api, calls, restore } = makeBackground();
    await api.huntReels(OPTS, null);
    restore();
    const w = calls.windowsCreate[0] || {};
    out(`\n  → windows.create(${JSON.stringify(w)})\n`);
    check('mở cửa sổ riêng chứ không dùng tab nền', calls.windowsCreate.length === 1);
    check('focused:false — không giành bàn phím', w.focused === false, JSON.stringify(w));
    check('không tạo tab nền nữa', calls.tabsCreate.length === 0,
      JSON.stringify(calls.tabsCreate));
    check('đóng cửa sổ khi hunt xong', calls.windowsRemove.length === 1,
      JSON.stringify(calls.windowsRemove));
  }

  out('\n=== Cửa sổ bị che kín: visibility=hidden, harvest ra ít url ===');
  {
    const { api, calls, restore } = makeBackground({ visibility: 'hidden', urlsPerHarvest: 1 });
    await api.huntReels(OPTS, null);
    restore();
    const warned = calls.logs.filter((l) => l.includes('BỊ CHE'));
    warned.slice(0, 1).forEach((l) => out('  ' + l.replace(/\s+/g, ' ').slice(0, 130)));
    check('nói thẳng là cửa sổ bị che, không để user đoán', warned.length > 0);
    check('có kèm hướng dẫn kéo cửa sổ ra',
      warned.some((l) => l.includes('Kéo cửa sổ hunt ra chỗ hở')));
  }

  out('\n=== Cửa sổ hiện bình thường, harvest ra đủ url ===');
  {
    const { api, calls, restore } = makeBackground({ visibility: 'visible', urlsPerHarvest: 6 });
    await api.huntReels(OPTS, null);
    restore();
    check('không cảnh báo sai khi cửa sổ đang hiện',
      calls.logs.filter((l) => l.includes('BỊ CHE')).length === 0);
  }

  out('\n=== chrome.windows lỗi → vẫn chạy được bằng tab nền ===');
  {
    const { api, calls, restore } = makeBackground({ windowsFail: true });
    const res = await api.huntReels(OPTS, null);
    restore();
    check('không sập, vẫn trả kết quả', res && res.ok === true, JSON.stringify(res));
    check('quay về tạo tab nền', calls.tabsCreate.length >= 1,
      JSON.stringify(calls.tabsCreate));
  }

  out('');
  if (failures.length) { out(`FAIL — ${failures.length} kiểm tra hỏng`); process.exit(1); }
  out('PASS — tất cả kịch bản');
})();
