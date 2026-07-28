// Bug user gặp: chạy "Comment Tất Cả", vài bài CUỐI báo thành công nhưng trên
// Facebook không có bình luận nào, không có lỗi nào được báo. Nguyên nhân: bằng
// chứng thành công duy nhất là "ô soạn thảo trở nên trống" — mà Lexical xoá ô
// ngay khi nhấn Enter, TRƯỚC khi biết server có nhận hay không. Bị rate limit thì
// ô vẫn trống y như lúc thành công.
//
// Giờ bằng chứng là: bình luận XUẤT HIỆN trong danh sách, đúng tên người đăng,
// đúng nội dung, và VẪN CÒN sau vài giây (Facebook chèn lạc quan rồi rút lại).
//
// Chạy: node test/post-comment.js   (exit 0 = pass)

const fs = require('fs');
const { JSDOM } = require('jsdom');

const REEL_URL = 'https://www.facebook.com/reel/946844311522548';
const POSTER = 'Phim hay review';
const TEXT = 'Trọn bộ nè bạn ơi 👉 https://phimnet.live/xem-tap-tiep-theo';

// Kịch bản Facebook phản ứng thế nào sau khi nhấn Enter:
//   'accept'      : chèn bình luận và giữ nguyên
//   'silent-drop' : xoá ô, không chèn gì (rate limit âm thầm)
//   'optimistic'  : chèn rồi rút lại sau 1 nhịp
//   'blocked'     : xoá ô + hiện hộp thoại chặn
//   'other-author': chèn bình luận CÙNG nội dung nhưng của người khác
//   'stuck'       : không xoá ô, không nhận
function buildDom(behaviour) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="viewer">
        <video></video>
        <div role="button" id="cmt-btn" aria-label="Bình luận"><span>38</span></div>
        <div id="panelwrap"></div>
      </div>
    </body></html>`,
    { url: REEL_URL, pretendToBeVisual: true }
  );
  const { window } = dom;
  const doc = window.document;
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
    configurable: true,
  });
  const rectAll = (root, top = 300, h = 40) => {
    [root, ...root.querySelectorAll('*')].forEach((el) => {
      el.getBoundingClientRect = () => ({
        top, bottom: top + h, left: 10, right: 210, width: 200, height: h, x: 10, y: top,
      });
    });
  };
  rectAll(doc.body);

  const state = { behaviour, submits: 0, inserted: null };
  let panel = null, list = null, composerBox = null;

  const addComment = (author, text) => {
    const node = doc.createElement('div');
    node.setAttribute('aria-label', `Bình luận dưới tên ${author} vào 1 phút trước`);
    node.innerHTML = `<a role="link"><span>${author}</span></a><div dir="auto">${text}</div>`;
    list.appendChild(node);
    rectAll(node);
    return node;
  };

  const openPanel = () => {
    if (panel) return;
    panel = doc.createElement('div');
    panel.id = 'panel';
    panel.setAttribute('style', 'overflow-y: auto');
    panel.innerHTML = '<div id="list"></div>';
    panelwrapAppend();
    let top = 0;
    Object.defineProperty(panel, 'scrollHeight', { get: () => 3000 });
    Object.defineProperty(panel, 'clientHeight', { get: () => 600 });
    Object.defineProperty(panel, 'scrollTop', { get: () => top, set: (v) => { top = v; } });
    list = doc.getElementById('list');

    // Ô soạn thảo: aria-label y hệt một bình luận thật + contenteditable
    const composer = doc.createElement('div');
    composer.setAttribute('aria-label', `Bình luận dưới tên ${POSTER} `);
    composer.innerHTML = '<div contenteditable="true" aria-label="Viết bình luận"></div>';
    panel.appendChild(composer);
    composerBox = composer.querySelector('[contenteditable="true"]');
    composerBox.focus = () => {};
    rectAll(panel);

    addComment('Nguyễn An', 'phim hay quá');
    addComment('Trần Bình', 'cho xin link với, thử lại sau nhé'); // bẫy báo động giả
  };
  const panelwrapAppend = () => doc.getElementById('panelwrap').appendChild(panel);

  doc.getElementById('cmt-btn').addEventListener('mousedown', openPanel);

  const showBlockDialog = () => {
    const d = doc.createElement('div');
    d.setAttribute('role', 'dialog');
    d.innerHTML = '<span>Bạn đang thao tác quá nhanh</span>' +
      '<span>Vui lòng thử lại sau. Chúng tôi đã hạn chế tính năng này để giữ an toàn cho cộng đồng.</span>';
    doc.body.appendChild(d);
    rectAll(d);
  };

  // Enter = gửi, đúng như Facebook
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !composerBox) return;
    const text = composerBox.textContent;
    if (!text) return;
    state.submits++;
    if (behaviour === 'stuck') return; // giữ nguyên chữ trong ô

    composerBox.textContent = ''; // Lexical xoá ô ngay, chưa biết server nhận chưa
    if (behaviour === 'accept') { state.inserted = addComment(POSTER, text); return; }
    if (behaviour === 'other-author') { addComment('Người Khác', text); return; }
    if (behaviour === 'optimistic') {
      // Rút lại NGAY SAU khi bị đọc một lần — tất định, không phụ thuộc đồng hồ.
      // Mô phỏng đúng chuyện Facebook chèn lạc quan rồi bỏ khi server từ chối:
      // lần soi đầu thấy có, lần soi xác nhận thì đã mất.
      const n = addComment(POSTER, text);
      const body = n.querySelector('div[dir="auto"]');
      let reads = 0;
      Object.defineProperty(body, 'innerText', {
        get() {
          reads++;
          if (reads >= 2) { n.remove(); return ''; }
          return text;
        },
        configurable: true,
      });
      return;
    }
    if (behaviour === 'blocked') { showBlockDialog(); return; }
    // 'silent-drop': không làm gì cả
  });

  return { dom, window, doc, state };
}

function loadContentScript({ window, doc }) {
  const code = fs.readFileSync('extension/content_script.js', 'utf8');
  const chrome = {
    runtime: { sendMessage: async () => ({}), onMessage: { addListener: () => {} } },
  };
  // execCommand không có trong jsdom — thay bằng bản chèn vào node đang focus.
  doc.execCommand = (cmd, _ui, value) => {
    if (cmd !== 'insertText') return false;
    const el = doc.querySelector('[contenteditable="true"]');
    if (!el) return false;
    el.textContent = (el.textContent || '') + value;
    return true;
  };
  return new Function(
    'chrome', 'console', 'document', 'window', 'location', 'getComputedStyle',
    'setTimeout', 'setInterval', 'clearInterval',
    'PointerEvent', 'MouseEvent', 'KeyboardEvent', 'Node', 'URL',
    code + '\n;return { postComment, detectBlockDialog, findPosterName };'
  )(
    chrome, console, doc, window, window.location,
    (el) => window.getComputedStyle(el),
    // Nén 50 lần thay vì cho về 0: các bước vẫn giữ ĐÚNG THỨ TỰ so với đồng hồ
    // thật của fixture, nhưng test không phải chờ 3 giây mỗi lần sleep.
    (fn, ms) => setTimeout(fn, Math.ceil((ms || 0) / 50)), () => 0, () => {},
    window.PointerEvent || window.MouseEvent, window.MouseEvent, window.KeyboardEvent,
    window.Node, URL
  );
}

const failures = [];
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failures.push(name); }
};

// verifyMs/persistMs là hạn tính bằng đồng hồ THẬT (Date.now), nên để nhỏ cho
// test chạy nhanh. Mặc định khi chạy thật là 12s / 3s.
const OPTS = { verifyMs: 600, persistMs: 200 };

async function run(label, behaviour, asserts) {
  console.log(`\n=== ${label} ===`);
  const fx = buildDom(behaviour);
  const api = loadContentScript(fx);
  let res = null, threw = null;
  try { res = await api.postComment(TEXT, 'reel:946844311522548', OPTS); } catch (e) { threw = e; }
  check('không ném lỗi', !threw, String(threw && threw.stack));
  console.log(`  → ${JSON.stringify({ ok: res && res.ok, error: res && res.error, verified: res && res.verified })}`);
  await asserts(res || {}, fx.state, api);
}

(async () => {
  console.log('TEST postComment: chỉ báo thành công khi bình luận THẬT SỰ xuất hiện');

  await run('Facebook nhận bình luận', 'accept', (res, st) => {
    check('báo thành công', res.ok === true, JSON.stringify(res));
    check('có cờ verified', res.verified === true);
    check('xác minh đúng tên người đăng', res.author === POSTER, res.author);
    check('chỉ gửi một lần', st.submits === 1, `gửi ${st.submits} lần`);
  });

  await run('Rate limit âm thầm: ô trống nhưng không có bình luận', 'silent-drop', (res) => {
    check('KHÔNG báo thành công (đây chính là bug cũ)', res.ok === false, JSON.stringify(res));
    check('lý do là không thấy bình luận', res.error === 'not_visible', res.error);
    check('nói rõ tab được giữ lại', /giữ lại/.test(res.hint || ''), res.hint);
  });

  await run('Chèn lạc quan rồi Facebook rút lại', 'optimistic', (res) => {
    check('KHÔNG báo thành công', res.ok === false, JSON.stringify(res));
    check('lý do là bình luận bị rút lại', res.error === 'comment_vanished', res.error);
  });

  await run('Facebook hiện hộp thoại chặn', 'blocked', (res) => {
    check('KHÔNG báo thành công', res.ok === false, JSON.stringify(res));
    check('phân biệt được là BỊ CHẶN, không phải lỗi kỹ thuật', res.error === 'blocked', res.error);
    check('kèm nguyên văn Facebook nói gì',
      /thao tác quá nhanh/i.test(res.blockText || ''), res.blockText);
  });

  await run('Bình luận cùng nội dung nhưng của người khác', 'other-author', (res) => {
    check('KHÔNG nhận vơ bình luận của người khác', res.ok === false, JSON.stringify(res));
    check('lý do là không thấy bình luận của mình', res.error === 'not_visible', res.error);
    check('ghi lại cái gần giống để dễ soi',
      res.nearMiss && res.nearMiss.author === 'Người Khác', JSON.stringify(res.nearMiss));
  });

  await run('Ô soạn thảo không chịu trống', 'stuck', (res) => {
    check('KHÔNG báo thành công', res.ok === false, JSON.stringify(res));
    check('lý do là không gửi được', res.error === 'submit_failed', res.error);
  });

  // Bẫy báo động giả: chữ "thử lại sau" nằm trong bình luận của người khác chứ
  // không phải trong hộp thoại chặn — không được coi là bị chặn.
  console.log('\n=== Bẫy: "thử lại sau" nằm trong bình luận của người khác ===');
  {
    const fx = buildDom('accept');
    const api = loadContentScript(fx);
    fx.doc.getElementById('cmt-btn').dispatchEvent(
      new fx.window.MouseEvent('mousedown', { bubbles: true })
    );
    check('không nhận diện sai thành bị chặn', api.detectBlockDialog() === null,
      JSON.stringify(api.detectBlockDialog()));
    check('đọc đúng tên người đăng từ ô soạn thảo', api.findPosterName() === POSTER,
      api.findPosterName());
  }

  console.log('');
  if (failures.length) { console.error(`FAIL — ${failures.length} kiểm tra hỏng`); process.exit(1); }
  console.log('PASS — tất cả kịch bản');
})();
