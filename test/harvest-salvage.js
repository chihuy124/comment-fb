// Hai lỗi thấy trong log thật của user: harvest chạy trên /reel/ và /watch/,
// content script báo tiến độ đều (count 0→5) rồi background hết hạn và ghi
// "+0 new urls (saw 0)" — vứt sạch mọi URL đã tìm được, ba nguồn liên tiếp.
//
//   1. hết hạn = trả rỗng, không giữ lại gì
//   2. đồng hồ chạy từ lúc điều hướng, nhưng tab nền tải Facebook có khi mất
//      20-30s mới chạy được content script → hết hạn trước khi nó kịp làm việc
//
// Test chạy runHarvest() thật với đồng hồ nén (1 giây thật = 2ms trong test) và
// một content script giả lập theo đúng nhịp trong log.
//
// Chạy: node test/harvest-salvage.js   (exit 0 = pass)

const fs = require('fs');

const SPEED = 500; // hệ số nén thời gian
const at = (ms, fn) => setTimeout(fn, Math.max(0, Math.round(ms / SPEED)));

function makeBackground() {
  const code = fs.readFileSync('extension/background.js', 'utf8');
  let listener = null;
  const navigations = [];

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
      create: async () => ({ id: 999 }),
      remove: async () => {},
      sendMessage: async () => {},
      update: async (id, props) => { navigations.push({ id, url: props && props.url }); },
    },
  };

  const api = new Function(
    'chrome', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    code + '\n;return { runHarvest, missions, pendingHarvests };'
  )(
    chrome, console,
    (fn, ms) => setTimeout(fn, Math.max(0, Math.round((ms || 0) / SPEED))),
    (t) => clearTimeout(t),
    () => 0, () => {}
  );

  return { api, navigations, send: (msg, tabId) => listener(msg, { tab: { id: tabId } }, () => {}) };
}

const urlsAfter = (n) =>
  Array.from({ length: n }, (_, i) => `https://www.facebook.com/reel/900000000000${i}`);

const failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failures.push(name);
  }
}

const TAB = 1649352453;
const DURATION = 100000;   // HARVEST_CAP_MS
const TIMEOUT = 125000;    // HARVEST_CAP_MS + 25000

// Kịch bản 1: Facebook tải chậm 30s, content script chạy đủ giờ của nó rồi mới
// gửi HARVEST_RESULT ở giây thứ 140 — sau hạn ban đầu (125s).
async function slowLoadStillCounts() {
  console.log('\n=== Facebook tải chậm 30s, HARVEST_RESULT về ở giây 140 ===');
  const { api, send } = makeBackground();
  const t0 = Date.now();

  at(30000, () => send({ type: 'GET_MISSION', url: 'https://www.facebook.com/reel/' }, TAB));
  at(60000, () => send({ type: 'DISCOVER_PROGRESS', count: 3, urls: urlsAfter(3) }, TAB));
  at(140000, () => send({ type: 'HARVEST_RESULT', urls: urlsAfter(9), stuck: false }, TAB));

  const res = await api.runHarvest(TAB, TIMEOUT, { durationMs: DURATION }, async () => {}, '/reel/');
  const elapsed = (Date.now() - t0) * SPEED;

  console.log(`\n  → ${res.urls.length} url, stuck=${res.stuck}, xong ở giây ~${Math.round(elapsed / 1000)}\n`);
  check('nhận trọn kết quả thật, không cắt ngang ở giây 125',
    res.urls.length === 9, `chỉ có ${res.urls.length} url`);
  check('hạn được gia hạn từ lúc content script vào việc',
    elapsed > TIMEOUT, `xong ở ${Math.round(elapsed / 1000)}s`);
}

// Kịch bản 2: đúng như log — báo tiến độ đều rồi im, không bao giờ có
// HARVEST_RESULT. Phải giữ lại những URL đã báo.
async function timeoutKeepsPartial() {
  console.log('\n=== Không bao giờ gửi HARVEST_RESULT (đúng như log) ===');
  const { api, send } = makeBackground();

  at(5000, () => send({ type: 'GET_MISSION', url: 'https://www.facebook.com/watch/' }, TAB));
  at(20000, () => send({ type: 'DISCOVER_PROGRESS', count: 2, urls: urlsAfter(2) }, TAB));
  at(50000, () => send({ type: 'DISCOVER_PROGRESS', count: 4, urls: urlsAfter(4) }, TAB));
  at(90000, () => send({ type: 'DISCOVER_PROGRESS', count: 6, urls: urlsAfter(6) }, TAB));

  const res = await api.runHarvest(TAB, TIMEOUT, { durationMs: DURATION }, async () => {}, '/watch/');

  console.log(`\n  → ${res.urls.length} url, stuck=${res.stuck}\n`);
  check('giữ lại URL đã tìm được thay vì trả rỗng',
    res.urls.length === 6, `trả về ${res.urls.length} url`);
  check('không đánh dấu stuck (trang vẫn chạy, chỉ chậm hơn hạn)', res.stuck === false);
  check('dọn sạch pendingHarvests', !api.pendingHarvests.has(TAB));
}

// Kịch bản 3: tab chết hẳn, không có GET_MISSION nào.
async function deadTabTimesOut() {
  console.log('\n=== Tab chết, không có GET_MISSION ===');
  const { api } = makeBackground();
  const t0 = Date.now();
  const res = await api.runHarvest(TAB, TIMEOUT, { durationMs: DURATION }, async () => {}, '/reel/');
  const elapsed = (Date.now() - t0) * SPEED;

  console.log(`\n  → ${res.urls.length} url, xong ở giây ~${Math.round(elapsed / 1000)}\n`);
  check('trả rỗng', res.urls.length === 0);
  check('không chờ quá hạn ban đầu', elapsed < TIMEOUT * 1.6,
    `chờ tới ${Math.round(elapsed / 1000)}s`);
}

(async () => {
  console.log('TEST harvest: giữ URL khi hết hạn + đếm giờ từ lúc CS vào việc');
  await slowLoadStillCounts();
  await timeoutKeepsPartial();
  await deadTabTimesOut();

  console.log('');
  if (failures.length) {
    console.error(`FAIL — ${failures.length} kiểm tra hỏng`);
    process.exit(1);
  }
  console.log('PASS — tất cả kịch bản');
})();
