// Cuộc săn phải sống sót qua cái chết của service worker.
//
// Lỗi thật user gặp: chạy được một lúc thì khung kết quả hiện dòng đỏ
//   "A listener indicated an asynchronous response by returning true,
//    but the message channel closed before a response was received"
// và MẤT TRẮNG mọi Reel đã gom.
//
// Nguyên nhân: HUNT_REELS giữ một sendResponse mở suốt cả cuộc săn (với
// maxChecks=120 là 30-60 phút), còn mảng `qualified` chỉ sống trong RAM của
// service worker. MV3 giết worker sau 30 giây rảnh — chết một lần là kênh đóng
// và không còn ai giữ kết quả.
//
// Test này dựng đúng cảnh đó: cho cuộc săn chạy, giết worker giữa chừng, rồi
// dựng worker mới đọc CHUNG chrome.storage.local.

const fs = require('fs');
const code = fs.readFileSync('extension/background.js', 'utf8');

// chrome.storage.local dùng chung cho mọi đời service worker — đúng như thật.
const store = {};

let checks = 0;
const failures = [];
function check(name, cond, detail) {
  checks++;
  console.log(`  ${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures.push(name);
}

// Dựng một "đời" service worker: cùng code, cùng storage, RAM riêng.
function bootWorker(name, { isDead = () => false } = {}) {
  let listener = null;
  let nextTabId = 100 * (name === 'A' ? 1 : 2);

  const chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          for (const k of [].concat(keys)) {
            if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
          }
          return out;
        },
        set: async (obj) => {
          // Worker đã chết thì mọi cái ghi rơi vào hư vô — đúng như khi Chrome
          // giết nó giữa chừng.
          if (isDead()) return;
          Object.assign(store, JSON.parse(JSON.stringify(obj)));
        },
      },
    },
    alarms: {
      create: () => {},
      clear: async () => {},
      onAlarm: { addListener: () => {} },
    },
    runtime: {
      onMessage: { addListener: (fn) => { listener = fn; } },
      getPlatformInfo: () => {},
      getManifest: () => ({ version: 'test' }),
      sendMessage: async () => ({}),
    },
    scripting: { executeScript: async () => {} },
    windows: {
      create: async () => ({ id: 7, tabs: [{ id: nextTabId++ }] }),
      remove: async () => {},
    },
    tabs: {
      create: async () => ({ id: nextTabId++ }),
      remove: async () => {},
      sendMessage: async () => {},
      update: async (id, props) => {
        if (!props || !props.url || props.url === 'about:blank') return;
        // Worker chết thì tab cũng không ai lái nữa.
        if (isDead()) throw new Error('worker đã chết');
        const isReel = /\/reels?\/\d+|\/watch\/\?v=\d+/.test(props.url);
        setTimeout(() => {
          if (!listener || isDead()) return;
          if (isReel) {
            // Reel có số cuối 2 hoặc 4 thì có comment hỏi link.
            const hasIntent = /[24]$/.test(props.url);
            listener({
              type: 'SCRAPE_RESULT',
              comments: hasIntent ? ['A: cho xin link', 'B: xem tiếp ở đâu'] : ['C: hay quá'],
              foundUrls: [],
            }, { tab: { id } }, () => {});
          } else {
            listener({
              type: 'HARVEST_RESULT',
              urls: Array.from({ length: 6 }, (_, i) =>
                `https://www.facebook.com/reel/${90000000000000 + harvestRound * 10 + i}`),
              stuck: false,
            }, { tab: { id } }, () => {});
            harvestRound++;
          }
        }, 4);
      },
    },
  };

  let harvestRound = 0;
  const api = new Function('chrome', 'console', code + '\n;return { huntReels };')(chrome, console);
  // Trả về một hộp bị SỬA TẠI CHỖ, không phải bản chụp: HUNT_STATUS trả lời bất
  // đồng bộ (return true rồi mới gọi sendResponse), nên người gọi phải đọc lại
  // sau khi await.
  return { api, send: (msg, tabId) => {
    const box = { resp: undefined, responded: false, keptOpen: false };
    box.keptOpen = listener(
      msg, { tab: { id: tabId ?? 1 } },
      (r) => { box.resp = r; box.responded = true; }
    ) === true;
    return box;
  } };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(2);
  }
  throw new Error(`quá hạn chờ: ${label}`);
}

const quiet = () => {};

(async () => {
  const origLog = console.log, origWarn = console.warn, origErr = console.error;

  // ---------------------------------------------------------------
  console.log('=== 1. HUNT_REELS trả lời NGAY, không giữ kênh mở cả buổi ===');

  let deadA = false;
  console.log = quiet; console.warn = quiet; console.error = quiet;
  const A = bootWorker('A', { isDead: () => deadA });
  const first = A.send({
    type: 'HUNT_REELS',
    opts: {
      targetCount: 6, minIntent: 1, maxChecks: 60,
      intentKeywords: ['xin link', 'xem tiếp'],
      searchKeywords: ['review phim'], excludeUrls: [],
    },
  });
  console.log = origLog; console.warn = origWarn; console.error = origErr;

  check('trả lời đồng bộ, không chờ hết cuộc săn', first.responded === true);
  check('không giữ kênh mở (return false)', first.keptOpen === false,
    `return = ${first.keptOpen}`);
  check('nội dung trả lời là "đã khởi động"',
    first.resp && first.resp.ok === true && first.resp.started === true,
    JSON.stringify(first.resp));

  console.log = quiet; console.warn = quiet; console.error = quiet;
  const second = A.send({ type: 'HUNT_REELS', opts: { targetCount: 3 } });
  console.log = origLog; console.warn = origWarn; console.error = origErr;
  check('cuộc săn thứ hai bị từ chối, không chạy chồng',
    second.resp && second.resp.error === 'already_running',
    JSON.stringify(second.resp));

  // ---------------------------------------------------------------
  console.log('\n=== 2. Reel đạt chuẩn nằm trong storage NGAY, không đợi hết buổi ===');

  console.log = quiet; console.warn = quiet; console.error = quiet;
  const midFlight = await waitFor(() => {
    const s = store.huntState;
    return (s && s.running && (s.qualified || []).length >= 2)
      ? JSON.parse(JSON.stringify(s)) : null;
  }, 5000, 'storage có ≥2 reel khi cuộc săn còn đang chạy').catch((e) => {
    console.log = origLog; throw e;
  });
  console.log = origLog; console.warn = origWarn; console.error = origErr;

  check('cuộc săn vẫn đang chạy tại thời điểm chụp', midFlight.running === true);
  check('mà storage đã giữ sẵn reel đạt chuẩn',
    midFlight.qualified.length >= 2, `${midFlight.qualified.length} reel`);
  check('chưa gom đủ mục tiêu (đúng là chụp giữa chừng)',
    midFlight.qualified.length < midFlight.targetCount,
    `${midFlight.qualified.length}/${midFlight.targetCount}`);
  check('mỗi reel có đủ url + số comment hỏi',
    midFlight.qualified.every(r => r && r.url && typeof r.intentCount === 'number'));

  // ---------------------------------------------------------------
  console.log('\n=== 3. Chrome giết service worker giữa chừng ===');

  deadA = true; // từ đây worker A không ghi được gì nữa, tab cũng không lái được
  const frozen = JSON.parse(JSON.stringify(store.huntState));
  await sleep(60); // để A giãy giụa một lúc, chứng minh nó không đụng được vào store

  check('storage không bị worker chết ghi đè',
    JSON.stringify(store.huntState) === JSON.stringify(frozen));
  check('storage vẫn ghi running:true (chưa ai chốt sổ)', store.huntState.running === true);

  console.log('\n=== 4. Worker mới đọc lại và chốt sổ ===');

  console.log = quiet; console.warn = quiet; console.error = quiet;
  const B = bootWorker('B');
  const status = B.send({ type: 'HUNT_STATUS' });
  await sleep(30);
  console.log = origLog; console.warn = origWarn; console.error = origErr;

  const st = status.resp && status.resp.state;
  check('HUNT_STATUS có trả lời', !!st, JSON.stringify(status.resp && status.resp.ok));
  check('worker mới biết mình không có vòng săn nào',
    status.resp && status.resp.loopAlive === false);
  check('cuộc săn được chốt là đã dừng', st && st.running === false);
  check('lý do nói đúng bản chất: worker bị khởi động lại',
    st && st.stopReason === 'worker_restarted', st && st.stopReason);
  check('GIỮ NGUYÊN số reel đã gom',
    st && (st.qualified || []).length === frozen.qualified.length,
    `${st && (st.qualified || []).length} reel (trước khi chết: ${frozen.qualified.length})`);
  check('giữ nguyên cả nội dung, không phải cái vỏ rỗng',
    st && JSON.stringify(st.qualified) === JSON.stringify(frozen.qualified));
  check('đã ghi lại vào storage, hỏi lần nữa không đổi',
    store.huntState.running === false && store.huntState.stopReason === 'worker_restarted');

  // ---------------------------------------------------------------
  console.log('\n=== 5. Cuộc săn mới chạy được sau khi worker chết ===');

  console.log = quiet; console.warn = quiet; console.error = quiet;
  const again = B.send({ type: 'HUNT_REELS', opts: { targetCount: 1, minIntent: 1, maxChecks: 20, intentKeywords: ['xin link'], searchKeywords: [], excludeUrls: [] } });
  console.log = origLog; console.warn = origWarn; console.error = origErr;
  check('không bị kẹt ở "already_running" của đời trước',
    again.resp && again.resp.ok === true, JSON.stringify(again.resp));

  console.log = quiet; console.warn = quiet; console.error = quiet;
  await waitFor(() => (store.huntState && store.huntState.running === false
    && store.huntState.stopReason !== 'worker_restarted') ? store.huntState : null,
    5000, 'cuộc săn mới kết thúc').catch(() => {});
  console.log = origLog; console.warn = origWarn; console.error = origErr;
  check('cuộc săn mới chốt sổ bình thường',
    store.huntState.running === false && store.huntState.stopReason === 'target_reached',
    store.huntState.stopReason);

  console.log(`\n${failures.length ? '❌ FAIL' : 'PASS'} — ${checks - failures.length}/${checks} kiểm tra`);
  if (failures.length) failures.forEach(f => console.log('   hỏng:', f));
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error('\n❌ FAIL —', e.message);
  process.exit(1);
});
