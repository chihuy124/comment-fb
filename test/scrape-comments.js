// Chạy scrapeComments() thật trên một DOM giả lập đúng theo cấu trúc Reel thật
// của Facebook (đã xác minh từ dump của user):
//   - nút mở panel:      aria-label="Bình luận", nằm NGOÀI panel, trong khung feed
//   - node bình luận:    aria-label="Bình luận dưới tên X vào N giờ trước"
//   - nút tải thêm:      text "Xem thêm bình luận 8/38"
//   - React của FB bỏ qua el.click() trần → fixture chỉ nghe 'mousedown'
//   - khung feed cuộn được và bọc cả panel (đây là cái bẫy: nếu scrape cuộn
//     nhầm nó thì reel bị nhảy sang cái kế tiếp)
//
// Chạy: node test/scrape-comments.js   (exit 0 = pass)

const fs = require('fs');
const { JSDOM } = require('jsdom');

const TOTAL = 38;
const PAGE = 8; // FB trả về từng đợt 8 comment mỗi lần bấm "Xem thêm bình luận"
const REEL_URL = 'https://www.facebook.com/reel/1048646424518667';

const INTENT_TEXTS = [
  'Xem tiếp ở đâu ạ', 'cho xin link', 'Xem trọn bộ chỗ nào', 'xin tập tiếp theo',
  'phim gì vậy ad', 'tên phim là gì', 'Xem tiếp tập sau', 'link phim với ạ',
];

function buildDom(opts = {}) {
  const { counter = true, panelOpens = true } = opts;
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="feed" style="overflow-y: auto">
        <video></video>
        <div id="reel">
          <div role="button" id="cmt-btn" aria-label="Bình luận"><span>38</span></div>
          <div id="panelwrap">
            <div id="panel" style="overflow-y: auto">
              <div role="button" id="sort"><span>Phù hợp nhất</span></div>
              <div id="list"></div>
            </div>
          </div>
        </div>
      </div>
    </body></html>`,
    { url: REEL_URL, pretendToBeVisual: true }
  );

  const { window } = dom;
  const doc = window.document;

  // jsdom không có innerText. Content script đọc innerText khắp nơi, nên map
  // tạm sang textContent — đủ sát cho DOM phẳng của fixture này.
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
    configurable: true,
  });
  const feed = doc.getElementById('feed');
  const panel = doc.getElementById('panel');
  const list = doc.getElementById('list');
  const btn = doc.getElementById('cmt-btn');
  const sort = doc.getElementById('sort');

  const state = { loaded: 0, sortedByAll: false, feedScrolls: 0, panelScrolls: 0 };

  // jsdom không layout: tự khai báo kích thước để logic cuộn có cái mà đọc.
  const sizes = (el, scrollH, clientH, onScroll) => {
    let top = 0;
    Object.defineProperty(el, 'scrollHeight', { get: () => scrollH });
    Object.defineProperty(el, 'clientHeight', { get: () => clientH });
    Object.defineProperty(el, 'scrollTop', {
      get: () => top,
      set: (v) => { top = v; onScroll && onScroll(); },
    });
  };
  sizes(feed, 9000, 700, () => { state.feedScrolls++; });
  sizes(panel, 4000, 600, () => { state.panelScrolls++; });

  // Mọi phần tử đều có rect thật để visibleScore() so sánh được.
  const rect = (el, top, height) => {
    el.getBoundingClientRect = () => ({
      top, bottom: top + height, left: 10, right: 210,
      width: 200, height, x: 10, y: top,
    });
  };
  [...doc.querySelectorAll('*')].forEach((el) => rect(el, 100, 40));

  function renderMore() {
    const upto = Math.min(state.loaded + PAGE, TOTAL);
    for (let i = state.loaded; i < upto; i++) {
      const name = `Người ${i + 1}`;
      const text = i < INTENT_TEXTS.length ? INTENT_TEXTS[i] : `Bình luận thường số ${i + 1}`;
      const node = doc.createElement('div');
      node.setAttribute('aria-label', `Bình luận dưới tên ${name} vào 3 giờ trước`);
      node.innerHTML =
        `<a role="link"><span>${name}</span></a><div dir="auto">${text}</div>`;
      list.appendChild(node);
      rect(node, 100, 40);
      [...node.querySelectorAll('*')].forEach((el) => rect(el, 100, 40));
    }
    state.loaded = upto;
    syncMoreButton();
  }

  function syncMoreButton() {
    const old = doc.getElementById('more');
    if (old) old.remove();
    if (state.loaded >= TOTAL) return;
    const more = doc.createElement('div');
    more.id = 'more';
    more.setAttribute('role', 'button');
    more.innerHTML = counter
      ? `<span>Xem thêm bình luận ${state.loaded}/${TOTAL}</span>`
      : `<span>Xem thêm bình luận</span>`;
    panel.appendChild(more);
    rect(more, 100, 40);
    rect(more.firstChild, 100, 40);
    // React: chỉ phản ứng với chuỗi sự kiện chuột thật, KHÔNG với el.click().
    more.addEventListener('mousedown', renderMore);
  }

  // Bấm nút "Bình luận" mới nạp panel (trước đó panel rỗng — đúng như tab sạch).
  // panelOpens=false mô phỏng reel mà nút bấm mãi không mở được panel.
  if (panelOpens) {
    btn.addEventListener('mousedown', () => { if (state.loaded === 0) renderMore(); });
  }

  // Dropdown sắp xếp
  sort.addEventListener('mousedown', () => {
    if (doc.getElementById('sortmenu')) return;
    const menu = doc.createElement('div');
    menu.id = 'sortmenu';
    menu.innerHTML =
      `<div role="menuitem" id="opt-all">Tất cả bình luận</div>` +
      `<div role="menuitem">Phù hợp nhất</div>`;
    doc.body.appendChild(menu);
    [...menu.querySelectorAll('*')].forEach((el) => rect(el, 100, 40));
    doc.getElementById('opt-all').addEventListener('mousedown', () => {
      state.sortedByAll = true;
      menu.remove();
    });
  });

  return { dom, window, doc, state };
}

function loadContentScript({ window, doc }) {
  const code = fs.readFileSync('extension/content_script.js', 'utf8');
  const chrome = {
    runtime: {
      sendMessage: async () => ({}),
      onMessage: { addListener: () => {} },
    },
  };
  // Timer tức thì: giữ thứ tự nhưng không tốn thời gian thật.
  const fastTimeout = (fn) => setTimeout(fn, 0);
  const noopInterval = () => 0;

  return new Function(
    'chrome', 'console', 'document', 'window', 'location', 'getComputedStyle',
    'setTimeout', 'setInterval', 'clearInterval',
    'PointerEvent', 'MouseEvent', 'KeyboardEvent', 'Node', 'URL',
    code + '\n;return { scrapeComments, findCommentScrollContainer, collectCommentText };'
  )(
    chrome, console, doc, window, window.location,
    (el) => window.getComputedStyle(el),
    fastTimeout, noopInterval, () => {},
    window.PointerEvent || window.MouseEvent, window.MouseEvent, window.KeyboardEvent,
    window.Node, URL
  );
}

// ---------------------------------------------------------------- assertions

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failures.push(name);
  }
}

async function runFullScrape(label, opts) {
  console.log(`\n=== ${label} ===`);
  const fx = buildDom(opts);
  const api = loadContentScript(fx);

  const comments = await api.scrapeComments();
  const joined = comments.join('\n');

  console.log(`\n  → trả về ${comments.length} bình luận, ` +
    `đã nạp ${fx.state.loaded}/${TOTAL}, ` +
    `cuộn panel ${fx.state.panelScrolls} lần, cuộn feed ${fx.state.feedScrolls} lần\n`);

  check('mở được panel bình luận', fx.state.loaded > 0);
  check('chuyển sang "Tất cả bình luận"', fx.state.sortedByAll);
  check(
    `bấm "Xem thêm bình luận" cho tới hết (${TOTAL} cái)`,
    fx.state.loaded === TOTAL,
    `mới nạp ${fx.state.loaded}`
  );
  check(
    `đọc đủ ${TOTAL} bình luận`,
    comments.length === TOTAL,
    `đọc được ${comments.length}`
  );
  check(
    'không cuộn nhầm khung feed (sẽ nhảy sang reel khác)',
    fx.state.feedScrolls === 0,
    `đã cuộn feed ${fx.state.feedScrolls} lần`
  );
  check(
    'có cuộn panel bình luận',
    fx.state.panelScrolls > 0
  );
  check(
    'giữ được nội dung intent',
    INTENT_TEXTS.every((t) => joined.includes(t)),
    'thiếu: ' + INTENT_TEXTS.filter((t) => !joined.includes(t)).join(' | ')
  );

  // findCommentScrollContainer phải trả về panel, không phải khung feed
  const container = api.findCommentScrollContainer();
  check(
    'findCommentScrollContainer() trả về panel chứ không phải feed',
    container && container.id === 'panel',
    'trả về: ' + (container ? '#' + container.id : 'null')
  );
}

async function runPanelNeverOpens() {
  console.log('\n=== Kịch bản 3: panel không mở được ===');
  const fx = buildDom({ panelOpens: false });
  const api = loadContentScript(fx);

  let threw = null;
  let comments = null;
  try {
    comments = await api.scrapeComments();
  } catch (e) {
    threw = e;
  }

  check('không ném lỗi', !threw, String(threw));
  check('trả về mảng rỗng (báo thật là không đọc được)',
    Array.isArray(comments) && comments.length === 0,
    JSON.stringify(comments));
  check('không cuộn nhầm khung feed', fx.state.feedScrolls === 0,
    `đã cuộn feed ${fx.state.feedScrolls} lần`);
}

(async () => {
  console.log('TEST scrapeComments trên DOM Reel giả lập');

  await runFullScrape('Kịch bản 1: nút có bộ đếm "8/38"', { counter: true });
  await runFullScrape('Kịch bản 2: nút không có bộ đếm', { counter: false });
  await runPanelNeverOpens();

  console.log('');
  if (failures.length) {
    console.error(`FAIL — ${failures.length} kiểm tra hỏng`);
    process.exit(1);
  }
  console.log('PASS — tất cả kịch bản');
})();
