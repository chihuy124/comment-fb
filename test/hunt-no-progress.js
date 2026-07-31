// Trong log thật của user, ba nguồn liên tiếp trả về "+0 new urls (saw 0)" và
// mỗi lần đều ghi "dryRounds=0" — vòng lặp không tiến lên mà cũng không dừng.
// Lý do: chỉ `harvest.stuck` mới cộng dryRounds. Một nguồn hết hạn với 0 url
// (stuck=false) reset dryRounds về 0, và vì `checked` không tăng nên maxChecks
// không bao giờ chạm tới → hunt quay vô hạn, mỗi vòng đốt 125 giây.
//
// Chạy: node test/hunt-no-progress.js   (exit 0 = pass)

const fs = require('fs');

const SPEED = 200; // nén thời gian: 1 giây thật = 5ms trong test
const code = fs.readFileSync('extension/background.js', 'utf8');

let listener = null;
let nextTabId = 100;
const harvests = [];

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
    create: async () => ({ id: nextTabId++ }),
    remove: async () => {},
    sendMessage: async () => {},
    update: async (id, props) => {
      if (!props || !props.url || props.url === 'about:blank') return;
      harvests.push(props.url);
      // Content script trả lời: không tìm được url nào, nhưng KHÔNG tự nhận là
      // stuck (trang vẫn cuộn được, chỉ là không ra reel mới nào).
      setTimeout(() => {
        listener &&
          listener({ type: 'HARVEST_RESULT', urls: [], stuck: false }, { tab: { id } }, () => {});
      }, 1);
    },
  },
};

const api = new Function(
  'chrome', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  code + '\n;return { huntReels };'
)(
  chrome, console,
  (fn, ms) => setTimeout(fn, Math.max(0, Math.round((ms || 0) / SPEED))),
  (t) => clearTimeout(t),
  () => 0, () => {}
);

const failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failures.push(name);
  }
}

(async () => {
  console.log('TEST hunt: nguồn không ra url nào thì phải dừng, không quay vô hạn\n');

  const watchdog = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('huntReels không bao giờ trả về — vòng lặp vô hạn')), 20000)
  );

  let res;
  try {
    res = await Promise.race([
      api.huntReels({
        targetCount: 5, minIntent: 1, maxChecks: 50,
        intentKeywords: ['xem tiếp'], searchKeywords: ['review phim'], excludeUrls: [],
      }, null),
      watchdog,
    ]);
  } catch (e) {
    check('huntReels trả về thay vì quay vô hạn', false, e.message);
    console.error('\nFAIL');
    process.exit(1);
  }

  console.log(`\n  → dừng vì "${res.stopReason}" sau ${harvests.length} lần harvest, ` +
    `${res.reels.length} reel đạt\n`);

  check('huntReels trả về thay vì quay vô hạn', true);
  check('dừng vì hết nguồn', res.stopReason === 'sources_exhausted', res.stopReason);
  check('dừng sau đúng MAX_DRY_ROUNDS(8) lần harvest, không mò mãi',
    harvests.length === 8, `đã harvest ${harvests.length} lần`);

  console.log('');
  if (failures.length) {
    console.error(`FAIL — ${failures.length} kiểm tra hỏng`);
    process.exit(1);
  }
  console.log('PASS');
})();
