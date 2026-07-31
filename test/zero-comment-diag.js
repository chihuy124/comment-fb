// Log của content script nằm trong console của TAB NỀN, mà tab đó bị điều hướng
// liên tục nên log bị xoá trước khi user kịp đọc. Vì vậy khi một reel về
// "0 comments", lý do phải được gửi kèm SCRAPE_RESULT và in ở background log —
// nếu không thì không phân biệt được ba trường hợp hoàn toàn khác nhau:
//   - reel thật sự không có bình luận
//   - panel bình luận không mở được
//   - content script không trả lời gì (hết hạn / tab chết)
//
// Chạy: node test/zero-comment-diag.js   (exit 0 = pass)

const fs = require('fs');

const SPEED = 200;
const code = fs.readFileSync('extension/background.js', 'utf8');

let listener = null;
let nextTabId = 100;
const logs = [];

// Mỗi reel trả về một tình huống khác nhau
const SCENARIOS = {
  '1': { comments: ['A: xem tiếp', 'B: cho xin link'], diag: { why: null, collected: 2 } },
  '2': { comments: [], diag: { why: 'panel-không-mở-được', panelOpened: false, candidates: 2, onScreen: 0 } },
  '3': { comments: [], diag: { why: 'có-node-bình-luận-nhưng-bóc-ra-rỗng', panelOpened: true, openedVia: 'Bình luận', loadedNodes: 14, moreClicks: 3, claimedTotal: 38 } },
  '4': { comments: [], diag: null }, // content script không trả lời → không có diag
  '5': { comments: ['C: xem trọn bộ'], diag: { why: null, collected: 1 } },
};

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
      const url = props.url;
      const isReel = /\/reel\/\d+$/.test(url);
      setTimeout(() => {
        if (!listener) return;
        if (!isReel) {
          listener({
            type: 'HARVEST_RESULT',
            urls: Object.keys(SCENARIOS).map((k) => `https://www.facebook.com/reel/${k}`),
            stuck: false,
          }, { tab: { id } }, () => {});
          return;
        }
        const key = url.split('/').pop();
        const sc = SCENARIOS[key];
        if (!sc) return;
        // diag=null mô phỏng content script im lặng: không gửi SCRAPE_RESULT.
        if (sc.diag === null && sc.comments.length === 0) return;
        listener({
          type: 'SCRAPE_RESULT', url, comments: sc.comments, foundUrls: [], diag: sc.diag,
        }, { tab: { id } }, () => {});
      }, 1);
    },
  },
};

const cap = (orig) => (...a) => { logs.push(a.map(String).join(' ')); };
console.log = cap(console.log); console.warn = cap(console.warn); console.error = cap(console.error);

const api = new Function(
  'chrome', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  code + '\n;return { huntReels };'
)(
  chrome, console,
  (fn, ms) => setTimeout(fn, Math.max(0, Math.round((ms || 0) / SPEED))),
  (t) => clearTimeout(t),
  () => 0, () => {}
);

(async () => {
  const res = await api.huntReels({
    targetCount: 99, minIntent: 1, maxChecks: 5,
    intentKeywords: ['xem tiếp', 'xin link', 'xem trọn bộ'],
    searchKeywords: [], excludeUrls: [],
  }, null);

  const realLog = process.stdout.write.bind(process.stdout);
  const out = (s) => realLog(s + '\n');
  const failures = [];
  const check = (name, cond, detail) => {
    if (cond) out(`  ✅ ${name}`);
    else { out(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failures.push(name); }
  };

  out('TEST lý do "0 comments" phải hiện ở background log\n');
  const diagLines = logs.filter((l) => l.includes('↳ 0 comments'));
  diagLines.forEach((l) => out('  ' + l.replace(/\s+/g, ' ').slice(0, 150)));
  out('');

  check('mỗi reel 0 bình luận đều có một dòng lý do', diagLines.length === 3,
    `có ${diagLines.length} dòng`);
  check('phân biệt được "panel không mở được"',
    diagLines.some((l) => l.includes('panel-không-mở-được') && l.includes('panel=KHÔNG mở')));
  check('phân biệt được "bóc ra rỗng" và nói rõ có 14 node trong DOM',
    diagLines.some((l) => l.includes('bóc-ra-rỗng') && l.includes('node trong DOM=14')));
  check('phân biệt được "content script không trả lời"',
    diagLines.some((l) => l.includes('KHÔNG trả lời')));
  check('reel có bình luận thì không in dòng lý do',
    !diagLines.some((l) => l.includes('/reel/1') || l.includes('/reel/5')));
  check('hunt vẫn giữ đúng reel đạt chuẩn', res.reels.length === 2,
    `${res.reels.length} reel`);

  out('');
  if (failures.length) { out(`FAIL — ${failures.length} kiểm tra hỏng`); process.exit(1); }
  out('PASS');
})();
