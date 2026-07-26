// Runs on every facebook.com page. If the URL looks like a Reel/Watch/Video
// permalink AND the page was opened by our background scraper (has our marker
// in sessionStorage or matches the pattern), we scroll to load comments and
// send them back.

(async function () {
  const url = location.href;
  const isTarget =
    /facebook\.com\/reels?\/\d+/i.test(url) ||
    /facebook\.com\/watch\/?\?v=\d+/i.test(url) ||
    /facebook\.com\/[^/]+\/videos\/\d+/i.test(url);

  if (!isTarget) return;

  // Wait a beat for React to hydrate
  await sleep(2000);

  const comments = await scrapeComments();
  chrome.runtime.sendMessage({ type: 'SCRAPE_RESULT', url, comments });
})();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scrapeComments() {
  // Nudge the page: dismiss dialogs, scroll, expand replies
  await dismissLoginNags();

  // Attempt to click "Most relevant" -> "All comments" if present
  await switchToAllComments();

  // Scroll to load more comments
  for (let i = 0; i < 6; i++) {
    window.scrollBy(0, 900);
    await sleep(1200);
    await clickMoreCommentsButtons();
  }

  const collected = collectCommentText();

  // Dedupe while preserving order
  const seen = new Set();
  const uniq = [];
  for (const c of collected) {
    if (!seen.has(c)) {
      seen.add(c);
      uniq.push(c);
    }
  }
  return uniq.slice(0, 200);
}

async function dismissLoginNags() {
  const closeButtons = document.querySelectorAll(
    'div[aria-label="Close"], div[aria-label="Đóng"]'
  );
  closeButtons.forEach((b) => {
    try { b.click(); } catch (e) {}
  });
  await sleep(300);
}

async function switchToAllComments() {
  // Facebook shows "Most relevant" or "Phù hợp nhất" dropdown near comments.
  // Clicking it and choosing "All comments" reveals more.
  const filterCandidates = Array.from(
    document.querySelectorAll('div[role="button"], span')
  ).filter((el) => {
    const t = (el.innerText || '').toLowerCase();
    return (
      t === 'most relevant' ||
      t === 'phù hợp nhất' ||
      t === 'all comments' ||
      t === 'tất cả bình luận'
    );
  });
  for (const el of filterCandidates.slice(0, 1)) {
    try {
      el.click();
      await sleep(700);
      const menuOpts = Array.from(document.querySelectorAll('div[role="menuitem"], span'));
      const all = menuOpts.find((m) => {
        const t = (m.innerText || '').toLowerCase();
        return t === 'all comments' || t === 'tất cả bình luận';
      });
      if (all) {
        all.click();
        await sleep(1200);
      }
    } catch (e) {}
  }
}

async function clickMoreCommentsButtons() {
  const btns = Array.from(document.querySelectorAll('div[role="button"], span'));
  for (const b of btns) {
    const t = (b.innerText || '').trim().toLowerCase();
    if (
      t.startsWith('view more comments') ||
      t.startsWith('xem thêm bình luận') ||
      t.startsWith('xem thêm phản hồi') ||
      t.startsWith('view previous') ||
      t.startsWith('xem trước')
    ) {
      try { b.click(); } catch (e) {}
    }
  }
  await sleep(600);
}

function collectCommentText() {
  const out = [];

  // FB comment DOM has evolved. We try multiple strategies and merge.
  // Strategy 1: articles/comment nodes with role="article" (comments only, not the video post)
  const articles = document.querySelectorAll('div[role="article"]');
  articles.forEach((a) => {
    const label = a.getAttribute('aria-label') || '';
    // Skip the main post article — its aria-label usually says "Post by ..."
    if (
      /^(Post|Bài viết)\b/i.test(label) ||
      /video by/i.test(label) ||
      /reel by/i.test(label)
    ) {
      return;
    }
    const author = extractAuthor(a);
    const text = extractCommentText(a);
    if (text && text.length >= 2) {
      out.push(author ? `${author}: ${text}` : text);
    }
  });

  // Strategy 2: fallback — <ul aria-label="Comments"> lists
  const commentLists = document.querySelectorAll('ul[aria-label*="Comment"], ul[aria-label*="ình luận"]');
  commentLists.forEach((ul) => {
    ul.querySelectorAll('li').forEach((li) => {
      const text = extractCommentText(li);
      const author = extractAuthor(li);
      if (text && text.length >= 2) {
        out.push(author ? `${author}: ${text}` : text);
      }
    });
  });

  return out;
}

function extractAuthor(node) {
  const link = node.querySelector('a[role="link"] span, a[role="link"] strong');
  if (link && link.innerText) return link.innerText.trim();
  return '';
}

function extractCommentText(node) {
  // Comment body usually lives in <div dir="auto"> with actual text
  const candidates = node.querySelectorAll('div[dir="auto"]');
  let longest = '';
  for (const c of candidates) {
    const t = (c.innerText || '').trim();
    // ignore timestamps, "Like", "Reply", counts
    if (!t) continue;
    if (/^(Like|Thích|Reply|Trả lời|Share|Chia sẻ|\d+[hmd]|\d+ w)$/i.test(t)) continue;
    if (t.length > longest.length) longest = t;
  }
  return longest;
}
