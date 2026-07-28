// Chạy scrapeComments() thật trên DOM jsdom dựng theo ĐÚNG hai UI bình luận
// của Facebook mà user đã chụp màn hình:
//
//  UI A — permalink video: facebook.com/<page>/videos/<id>
//    Panel bình luận nằm sẵn ở cột phải, KHÔNG cần bấm gì để mở.
//    Đầu panel: "Bình luận" + link "Xem tất cả". Cuối: "Xem thêm bình luận 2/801".
//    Tổng FB công bố (801) lớn hơn nhiều số nó chịu trả → phải dừng đúng lúc.
//
//  UI B — reel: facebook.com/reel/<id>
//    Panel ĐÓNG. Phải bấm nút comment (aria-label="Bình luận", hiện số 22) nằm
//    dưới nút like. Panel hiện ra bên phải, có dropdown "Phù hợp nhất" và
//    "Xem thêm bình luận 6/22". Facebook preload reel kế bên nên trang có HAI
//    nút comment — bấm nhầm cái ngoài màn hình là cào comment của reel khác.
//
// Fixture chỉ nghe 'mousedown', đúng như React của FB: el.click() trần không
// kích hoạt gì cả.
//
// Chạy: node test/scrape-comments.js   (exit 0 = pass)

const fs = require('fs');
const { JSDOM } = require('jsdom');

const INTENT = [
  'Cho xem tập tiếp theo', 'Xem tiep', 'Xem chọn bộ', 'xin link',
  'Xem trọn bộ ở đâu', 'tên phim gì vậy ad', 'Xem tiếp với', 'link phim ạ',
];
const filler = (i) => `Bình luận thường số ${i + 1}`;

// --------------------------------------------------------------- DOM helpers

function makeDom(html, url) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const doc = window.document;

  // jsdom không có innerText. Content script đọc innerText khắp nơi.
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
    configurable: true,
  });

  // jsdom không layout: mọi phần tử cần một rect để visibleScore() so sánh.
  const rectAll = (root, top = 300, height = 40) => {
    [root, ...root.querySelectorAll('*')].forEach((el) => {
      if (el.__rectFixed) return;
      el.getBoundingClientRect = () => ({
        top, bottom: top + height, left: 10, right: 210,
        width: 200, height, x: 10, y: top,
      });
    });
  };
  const pinRect = (el, top, height = 40) => {
    el.__rectFixed = true;
    el.getBoundingClientRect = () => ({
      top, bottom: top + height, left: 10, right: 210,
      width: 200, height, x: 10, y: top,
    });
  };
  const scrollable = (el, scrollH, clientH, onScroll) => {
    let top = 0;
    Object.defineProperty(el, 'scrollHeight', { get: () => scrollH });
    Object.defineProperty(el, 'clientHeight', { get: () => clientH });
    Object.defineProperty(el, 'scrollTop', {
      get: () => top,
      set: (v) => { top = v; onScroll && onScroll(); },
    });
  };

  return { dom, window, doc, rectAll, pinRect, scrollable };
}

function commentNode(doc, name, text) {
  const node = doc.createElement('div');
  node.setAttribute('aria-label', `Bình luận dưới tên ${name} vào 2 ngày trước`);
  node.innerHTML = `<a role="link"><span>${name}</span></a><div dir="auto">${text}</div>`;
  return node;
}

function loadContentScript({ window, doc }) {
  const code = fs.readFileSync('extension/content_script.js', 'utf8');
  const chrome = {
    runtime: { sendMessage: async () => ({}), onMessage: { addListener: () => {} } },
  };
  return new Function(
    'chrome', 'console', 'document', 'window', 'location', 'getComputedStyle',
    'setTimeout', 'setInterval', 'clearInterval',
    'PointerEvent', 'MouseEvent', 'KeyboardEvent', 'Node', 'URL',
    code + '\n;return { scrapeComments, findCommentScrollContainer, readCommentTotal };'
  )(
    chrome, console, doc, window, window.location,
    (el) => window.getComputedStyle(el),
    (fn) => setTimeout(fn, 0), () => 0, () => {},
    window.PointerEvent || window.MouseEvent, window.MouseEvent, window.KeyboardEvent,
    window.Node, URL
  );
}

// ------------------------------------------------------ UI A: /<page>/videos/

// Panel mở sẵn ở cột phải. FB báo 801 bình luận nhưng chỉ trả 2 lúc đầu và
// thêm 10 mỗi lần bấm, tối đa 32 rồi hết nút — đúng kiểu FB cắt ngắn.
function buildVideosUi() {
  const SERVED = 32;
  const CLAIMED = 801;
  const url = 'https://www.facebook.com/61578002396561/videos/1667655332035996';

  const ctx = makeDom(`
    <div id="page">
      <div id="video-col"><video></video></div>
      <div id="rail" style="overflow-y: auto">
        <div id="cmt-head">
          <span>Bình luận</span>
          <div role="button" id="see-all"><span>Xem tất cả</span></div>
        </div>
        <div id="list"></div>
        <div role="button" id="more">
          <span>Xem thêm bình luận</span><span id="counter">2/${CLAIMED}</span>
        </div>
      </div>
    </div>`, url);

  const { doc, rectAll, scrollable } = ctx;
  const rail = doc.getElementById('rail');
  const list = doc.getElementById('list');
  const state = { loaded: 0, railScrolls: 0, pageScrolls: 0, seeAllClicked: 0, ui: 'videos', served: SERVED, claimed: CLAIMED };

  scrollable(rail, 4000, 600, () => { state.railScrolls++; });
  rectAll(doc.body);

  const render = (n) => {
    const upto = Math.min(state.loaded + n, SERVED);
    for (let i = state.loaded; i < upto; i++) {
      const node = commentNode(doc, `Người ${i + 1}`, i < INTENT.length ? INTENT[i] : filler(i));
      list.appendChild(node);
      rectAll(node);
    }
    state.loaded = upto;
    const more = doc.getElementById('more');
    if (state.loaded >= SERVED) { if (more) more.remove(); return; }
    doc.getElementById('counter').textContent = `${state.loaded}/${CLAIMED}`;
  };

  doc.getElementById('more').addEventListener('mousedown', () => render(10));
  doc.getElementById('see-all').addEventListener('mousedown', () => { state.seeAllClicked++; });
  render(2); // trạng thái ban đầu: 2/801

  return { ...ctx, state };
}

// ---------------------------------------------------------- UI B: /reel/<id>

// Panel đóng. Hai nút comment trên trang (reel hiện tại + reel preload kế bên).
function buildReelUi(opts = {}) {
  const { panelOpens = true, zeroRects = false, served = 22, composerOnly = false } = opts;
  const SERVED = served;
  const url = 'https://www.facebook.com/reel/2504266503383241';

  const ctx = makeDom(`
    <div id="viewer" style="overflow-y: auto">
      <div id="reel-current">
        <video></video>
        <div role="button" id="like-btn" aria-label="Thích"><span>2,9K</span></div>
        <div role="button" id="cmt-btn" aria-label="Bình luận"><span>22</span></div>
      </div>
      <div id="reel-next">
        <video></video>
        <div role="button" id="cmt-btn-next" aria-label="Bình luận"><span>9</span></div>
      </div>
      <div id="panelwrap"></div>
    </div>`, url);

  const { doc, pinRect, scrollable } = ctx;
  let rectAll = ctx.rectAll;
  const viewer = doc.getElementById('viewer');
  const panelwrap = doc.getElementById('panelwrap');
  const state = { loaded: 0, panelScrolls: 0, viewerScrolls: 0, sortedByAll: false, wrongReelOpened: false, ui: 'reel', served: SERVED };

  scrollable(viewer, 9000, 700, () => { state.viewerScrolls++; });
  if (zeroRects) {
    // Tab nền không tính layout: mọi getBoundingClientRect() trả về toàn 0.
    const zero = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
    rectAll = (root) => {
      [root, ...root.querySelectorAll('*')].forEach((el) => { el.getBoundingClientRect = () => zero; });
    };
    rectAll(doc.body);
  } else {
    rectAll(doc.body);
    // Nút của reel hiện tại nằm giữa màn hình; nút của reel preload ngoài màn hình.
    pinRect(doc.getElementById('cmt-btn'), 500);
    pinRect(doc.getElementById('cmt-btn-next'), 3000);
  }

  let panel = null, list = null;

  const syncMore = () => {
    const old = doc.getElementById('more');
    if (old) old.remove();
    if (state.loaded >= SERVED) return;
    const more = doc.createElement('div');
    more.id = 'more';
    more.setAttribute('role', 'button');
    more.innerHTML = `<span>Xem thêm bình luận</span><span>${state.loaded}/${SERVED}</span>`;
    panel.appendChild(more);
    rectAll(more);
    more.addEventListener('mousedown', () => render(8));
  };

  const render = (n) => {
    const upto = Math.min(state.loaded + n, SERVED);
    for (let i = state.loaded; i < upto; i++) {
      const node = commentNode(doc, `Người ${i + 1}`, i < INTENT.length ? INTENT[i] : filler(i));
      list.appendChild(node);
      rectAll(node);
    }
    state.loaded = upto;
    syncMore();
  };

  const openPanel = () => {
    if (panel) return;
    panel = doc.createElement('div');
    panel.id = 'panel';
    panel.setAttribute('style', 'overflow-y: auto');
    panel.innerHTML = `<div role="button" id="sort"><span>Phù hợp nhất</span></div><div id="list"></div>`;
    panelwrap.appendChild(panel);
    scrollable(panel, 3000, 600, () => { state.panelScrolls++; });
    list = doc.getElementById('list');
    rectAll(panel);

    doc.getElementById('sort').addEventListener('mousedown', () => {
      if (doc.getElementById('sortmenu')) return;
      const menu = doc.createElement('div');
      menu.id = 'sortmenu';
      menu.innerHTML =
        `<div role="menuitem" id="opt-all">Tất cả bình luận</div>` +
        `<div role="menuitem">Phù hợp nhất</div>`;
      doc.body.appendChild(menu);
      rectAll(menu);
      doc.getElementById('opt-all').addEventListener('mousedown', () => {
        state.sortedByAll = true;
        menu.remove();
      });
    });

    // Ô SOẠN bình luận: aria-label y hệt một bình luận thật, nhưng có
    // contenteditable. Trên reel không có bình luận nào, đây là node duy nhất
    // khớp selector — dump thật từ Chrome: "Bình luận dưới tên Phim hay review ".
    const composer = doc.createElement('div');
    composer.setAttribute('aria-label', 'Bình luận dưới tên Phim hay review ');
    composer.innerHTML = '<div contenteditable="true" aria-label="Viết bình luận"></div>';
    panel.appendChild(composer);
    rectAll(composer);

    if (!composerOnly) render(6); // trạng thái ban đầu: 6/22
  };

  if (panelOpens) {
    doc.getElementById('cmt-btn').addEventListener('mousedown', openPanel);
  }
  // Bấm nhầm nút của reel preload = cào comment của reel khác.
  doc.getElementById('cmt-btn-next').addEventListener('mousedown', () => {
    state.wrongReelOpened = true;
    const wrong = doc.createElement('div');
    wrong.setAttribute('aria-label', 'Bình luận dưới tên Reel Khác vào 1 giờ trước');
    wrong.innerHTML = `<a role="link"><span>Reel Khác</span></a><div dir="auto">COMMENT-CUA-REEL-KHAC</div>`;
    doc.getElementById('reel-next').appendChild(wrong);
    rectAll(wrong);
  });

  return { ...ctx, state };
}

// ---------------------------------------------------------------- assertions

const failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failures.push(name);
  }
}

async function run(label, fx, asserts, scrapeOpts) {
  console.log(`\n=== ${label} ===`);
  const api = loadContentScript(fx);
  let res = null, threw = null;
  try { res = await api.scrapeComments(scrapeOpts); } catch (e) { threw = e; }
  check('không ném lỗi', !threw, String(threw && threw.stack));
  const diag = (res && res.diag) || {};
  console.log('  diag:', JSON.stringify(diag));
  await asserts((res && res.comments) || [], fx.state, api, diag);
}

(async () => {
  console.log('TEST scrapeComments trên hai UI bình luận thật của Facebook');

  await run('UI A — /videos/ : panel mở sẵn, FB báo 2/801', buildVideosUi(), (comments, st, api) => {
    const joined = comments.join('\n');
    console.log(`\n  → ${comments.length} bình luận | nạp ${st.loaded}/${st.served} ` +
      `(FB báo ${st.claimed}) | cuộn rail ${st.railScrolls}\n`);
    // Đọc bộ đếm trên DOM còn nguyên (sau khi cào xong FB đã gỡ nút đi rồi).
    const fresh = buildVideosUi();
    check('đọc được tổng số FB công bố từ "2/801"',
      loadContentScript(fresh).readCommentTotal() === st.claimed,
      'đọc ra ' + loadContentScript(fresh).readCommentTotal());
    check('bấm "Xem thêm bình luận" cho tới khi hết nút',
      st.loaded === st.served, `mới nạp ${st.loaded}`);
    check(`không dừng ở 2 cái đầu (đọc đủ ${st.served})`,
      comments.length === st.served, `đọc được ${comments.length}`);
    check('dừng lại khi FB không trả thêm, không quay vô hạn', true);
    check('có cuộn panel', st.railScrolls > 0);
    check('giữ được nội dung intent',
      INTENT.every((t) => joined.includes(t)),
      'thiếu: ' + INTENT.filter((t) => !joined.includes(t)).join(' | '));
    check('scope đúng cột bình luận',
      api.findCommentScrollContainer() && api.findCommentScrollContainer().id === 'rail');
  });

  await run('UI B — /reel/ : phải bấm nút comment (22) để mở panel', buildReelUi(), (comments, st, api) => {
    const joined = comments.join('\n');
    console.log(`\n  → ${comments.length} bình luận | nạp ${st.loaded}/${st.served} | ` +
      `cuộn panel ${st.panelScrolls} | cuộn feed ${st.viewerScrolls}\n`);
    check('mở được panel bằng nút comment', st.loaded > 0);
    check('không bấm nhầm nút comment của reel preload', !st.wrongReelOpened);
    check('không dính comment của reel khác', !joined.includes('COMMENT-CUA-REEL-KHAC'));
    check('chuyển sang "Tất cả bình luận"', st.sortedByAll);
    check(`bấm "Xem thêm bình luận" cho tới hết (${st.served})`,
      st.loaded === st.served, `mới nạp ${st.loaded}`);
    check(`đọc đủ ${st.served} bình luận`, comments.length === st.served,
      `đọc được ${comments.length}`);
    check('KHÔNG cuộn khung feed (sẽ nhảy sang reel khác)',
      st.viewerScrolls === 0, `đã cuộn ${st.viewerScrolls} lần`);
    check('có cuộn panel bình luận', st.panelScrolls > 0);
    check('giữ được nội dung intent',
      INTENT.every((t) => joined.includes(t)),
      'thiếu: ' + INTENT.filter((t) => !joined.includes(t)).join(' | '));
    check('scope đúng panel', api.findCommentScrollContainer() &&
      api.findCommentScrollContainer().id === 'panel');
  });

  await run('UI B — panel không mở được', buildReelUi({ panelOpens: false }), (comments, st, api, diag) => {
    check('trả về rỗng (báo thật là không đọc được)', comments.length === 0,
      JSON.stringify(comments));
    check('KHÔNG mở panel của reel preload để cào bừa', !st.wrongReelOpened);
    check('không cuộn khung feed', st.viewerScrolls === 0, `đã cuộn ${st.viewerScrolls} lần`);
    check('diag nói rõ lý do là panel không mở được',
      diag.why === 'panel-không-mở-được' && diag.panelOpened === false,
      JSON.stringify(diag));
  });

  // Tab nền: Chrome đôi khi không tính layout, mọi rect ra 0. Trước khi có
  // fallback, không nút nào "trên màn hình" → không bấm gì → im lặng 0 bình luận.
  await run('UI B — tab nền, mọi rect = 0 (không đo được vị trí)',
    buildReelUi({ zeroRects: true }), (comments, st, api, diag) => {
      console.log(`\n  → ${comments.length} bình luận | nạp ${st.loaded}/${st.served}\n`);
      check('vẫn mở được panel thay vì im lặng trả 0', st.loaded > 0);
      check('đọc được bình luận', comments.length === st.served, `đọc được ${comments.length}`);
      check('diag đánh dấu không xác minh được đúng reel',
        diag.identityUnverified === true, JSON.stringify(diag));
    });

  // Log thật: 3 reel về 0 với lý do "có-node-bình-luận-nhưng-bóc-ra-rỗng | node
  // trong DOM=1". Kiểm tra reel 1139874939214394 trên Chrome: node duy nhất đó là
  // Ô SOẠN bình luận (aria-label "Bình luận dưới tên Phim hay review", có
  // contenteditable, không có chữ). Reel thật sự không có bình luận nào — trả 0 là
  // đúng, chỉ lý do ghi sai thành như thể lỗi bóc text.
  await run('Reel không có bình luận nào, chỉ có ô soạn thảo',
    buildReelUi({ composerOnly: true }), (comments, st, api, diag) => {
      check('trả rỗng', comments.length === 0, JSON.stringify(comments));
      check('KHÔNG đếm ô soạn thảo là bình luận', diag.loadedNodes === 0,
        `đếm ra ${diag.loadedNodes}`);
      check('lý do nói đúng là reel im lặng, không phải lỗi bóc text',
        diag.why === 'panel-mở-nhưng-không-có-bình-luận-nào', diag.why);
    });

  // Reel 946844311522548 có 539 bình luận. Đo thật trên Chrome: vòng nạp chạy
  // 45 giây vẫn chưa xong (đã nạp 187 node) → background hết hạn 45s, trả rỗng,
  // và cả lượt cào bị ghi thành "0 comments". Phải tự dừng trong ngân sách.
  await run('Reel 539 bình luận, ngân sách chỉ 1ms', buildReelUi({ served: 539 }),
    (comments, st, api, diag) => {
      console.log(`\n  → ${comments.length} bình luận | nạp ${st.loaded}/539\n`);
      check('KHÔNG trả rỗng vì hết giờ', comments.length > 0, `trả về ${comments.length}`);
      check('bóc đúng những gì đã nạp được', comments.length === st.loaded,
        `${comments.length} vs ${st.loaded} node`);
      check('diag ghi rõ là hết ngân sách thời gian', diag.hitBudget === true,
        JSON.stringify(diag));
    }, { budgetMs: 1 });

  await run('Reel 539 bình luận, ngân sách thoải mái', buildReelUi({ served: 539 }),
    (comments, st, api, diag) => {
      console.log(`\n  → ${comments.length} bình luận | nạp ${st.loaded}/539 | ` +
        `${diag.rounds} vòng\n`);
      check('dừng ở mức 200 chứ không nạp hết 539',
        st.loaded >= 200 && st.loaded < 539, `nạp ${st.loaded}`);
      check('diag ghi rõ là đã đủ số bình luận cần', diag.hitCommentCap === true,
        JSON.stringify(diag));
      check('trả về tối đa 200', comments.length === 200, `${comments.length}`);
    }, { budgetMs: 600000 });

  console.log('');
  if (failures.length) {
    console.error(`FAIL — ${failures.length} kiểm tra hỏng`);
    process.exit(1);
  }
  console.log('PASS — tất cả kịch bản');
})();
