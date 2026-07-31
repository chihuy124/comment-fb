// Đo thật trên Facebook: cào xong một reel 539 bình luận mất 34,8 giây tính từ
// lúc content script bắt đầu (10 vòng "Xem thêm bình luận", 107 node, dừng đúng
// lúc hết ngân sách 33s). Cộng thêm thời gian tab nền tải xong Facebook là vượt
// hạn 45s của background — và vượt hạn thì mất trắng cả lượt cào.
//
// Nên hạn phải tính từ lúc content script hỏi GET_MISSION, y như harvest.
//
// Chạy: node test/scrape-deadline.js   (exit 0 = pass)

const fs = require('fs');

const SPEED = 500; // 1 giây thật = 2ms trong test
const at = (ms, fn) => setTimeout(fn, Math.max(0, Math.round(ms / SPEED)));
const code = fs.readFileSync('extension/background.js', 'utf8');

function makeBackground() {
  let listener = null;
  const chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    alarms: { create: () => {}, clear: async () => {}, onAlarm: { addListener: () => {} } },
    runtime: {
      onMessage: { addListener: (fn) => { listener = fn; } },
      getPlatformInfo: () => {}, getManifest: () => ({ version: 'test' }),
      sendMessage: async () => ({}),
    },
    scripting: { executeScript: async () => {} },
    tabs: {
      create: async () => ({ id: 999 }), remove: async () => {}, sendMessage: async () => {},
      update: async () => {},
    },
  };
  const api = new Function(
    'chrome', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    code + '\n;return { navigateAndScrape, missions };'
  )(
    chrome, console,
    (fn, ms) => setTimeout(fn, Math.max(0, Math.round((ms || 0) / SPEED))),
    (t) => clearTimeout(t), () => 0, () => {}
  );
  return { api, send: (msg, tabId) => listener(msg, { tab: { id: tabId } }, () => {}) };
}

const failures = [];
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failures.push(name); }
};

const TAB = 555;
const TIMEOUT = 45000; // perTabTimeoutMs

(async () => {
  console.log('TEST hạn cào phải tính từ lúc content script vào việc\n');

  console.log('=== Tab nền tải Facebook 20s, cào mất 35s (đúng số đo thật) ===');
  {
    const { api, send } = makeBackground();
    const t0 = Date.now();
    at(20000, () => send({ type: 'GET_MISSION', url: 'https://www.facebook.com/reel/1' }, TAB));
    at(20000 + 35000, () => send({
      type: 'SCRAPE_RESULT', url: 'https://www.facebook.com/reel/1',
      comments: Array.from({ length: 105 }, (_, i) => `Người ${i}: xem tiếp`),
      foundUrls: [], diag: { why: null, collected: 105, elapsedMs: 34796, hitBudget: true },
    }, TAB));

    const res = await api.navigateAndScrape(TAB, 'https://www.facebook.com/reel/1', TIMEOUT, true);
    const elapsed = (Date.now() - t0) * SPEED;
    console.log(`\n  → ${res.comments.length} bình luận, xong ở giây ~${Math.round(elapsed / 1000)}\n`);
    check('nhận đủ 105 bình luận thay vì mất trắng', res.comments.length === 105,
      `chỉ có ${res.comments.length}`);
    check('diag đi kèm về tới nơi', res.diag && res.diag.hitBudget === true,
      JSON.stringify(res.diag));
    check('hạn được tính lại từ lúc CS vào việc', elapsed > TIMEOUT,
      `xong ở ${Math.round(elapsed / 1000)}s`);
  }

  console.log('\n=== budgetMs gửi cho content script phải nhỏ hơn hạn ===');
  {
    const { api, send } = makeBackground();
    at(1000, () => send({ type: 'SCRAPE_RESULT', url: 'x', comments: [], foundUrls: [] }, TAB));
    const p = api.navigateAndScrape(TAB, 'https://www.facebook.com/reel/2', TIMEOUT, true);
    const m = api.missions.get(TAB);
    console.log(`\n  → mission = ${JSON.stringify(m)}\n`);
    check('có budgetMs', typeof m.budgetMs === 'number', JSON.stringify(m));
    check('budgetMs chừa đủ chỗ cho mở panel + gửi kết quả',
      m.budgetMs === 33000, `là ${m.budgetMs}`);
    await p;
  }

  console.log('\n=== Tab chết hẳn, không có GET_MISSION ===');
  {
    const { api } = makeBackground();
    const t0 = Date.now();
    const res = await api.navigateAndScrape(TAB, 'https://www.facebook.com/reel/3', TIMEOUT, true);
    const elapsed = (Date.now() - t0) * SPEED;
    console.log(`\n  → ${res.comments.length} bình luận, xong ở giây ~${Math.round(elapsed / 1000)}\n`);
    check('trả rỗng', res.comments.length === 0);
    check('không chờ quá hạn ban đầu', elapsed < TIMEOUT * 1.6,
      `chờ tới ${Math.round(elapsed / 1000)}s`);
  }

  console.log('');
  if (failures.length) { console.error(`FAIL — ${failures.length} kiểm tra hỏng`); process.exit(1); }
  console.log('PASS — tất cả kịch bản');
})();
