# Test

```bash
npm install     # chỉ cần jsdom, dùng cho test scrape
npm test        # chạy cả 3 file
```

Exit code 0 = pass.

## hunt-smoke.js / hunt-stuck.js — vòng lặp hunt

Chạy `huntReels` thật trong Node với `chrome.*` API giả lập. Content script được
mô phỏng bằng cách trả `HARVEST_RESULT` / `SCRAPE_RESULT` ngay sau mỗi
`chrome.tabs.update`, nên toàn bộ vòng lặp và giao thức message được chạy thật.

```bash
node test/hunt-smoke.js    # đường bình thường: harvest → scrape → đủ target
node test/hunt-stuck.js    # nhánh stuck: renavigate → fresh-tab → tab được thay
```

Hai bug đã bị bắt bởi bộ này, cả hai đều là lỗi runtime mà kiểm tra cú pháp
không thấy:
- `tabId = tabId` (do sed thay `tab.id` quá tay) → hunt thoát ngay lập tức
- `reloads is not defined` (đổi tên biến sót một chỗ) → crash ở lượt harvest đầu

## scrape-comments.js — cào bình luận

Chạy `scrapeComments()` thật trên DOM jsdom dựng đúng theo cấu trúc Reel thật
(đã xác minh từ dump của user): nút `aria-label="Bình luận"` nằm ngoài panel
trong khung feed cuộn được, node bình luận `aria-label="Bình luận dưới tên X
vào N giờ trước"`, nút `Xem thêm bình luận 8/38` nạp thêm từng đợt 8 cái.

Fixture **chỉ nghe `mousedown`**, đúng như React của FB — `el.click()` trần
không kích hoạt gì cả.

Ba kịch bản: nút có bộ đếm `8/38`, nút không có bộ đếm, và panel không mở được.

Bốn bug bị bắt ở lần chạy đầu — đều là lý do reel 38 bình luận báo về `0`:
- `findCommentScrollContainer()` neo vào `[aria-label^="Bình luận"]` nên trúng
  luôn cái NÚT mở panel → leo lên ra khung feed → cuộn feed 8 lần (ngoài đời =
  nhảy sang reel khác giữa chừng) và scope collect sai nhánh
- `clickMoreCommentsButtons()` dùng `b.click()` → log ghi "clicked 2 buttons"
  nhưng DOM không nạp thêm bình luận nào
- vòng lặp 8 vòng cố định, không lặp cho tới khi hết bình luận
- `switchToAllComments()` cũng `.click()` trần → không bao giờ chuyển sang
  "Tất cả bình luận", và im lặng khi thất bại
