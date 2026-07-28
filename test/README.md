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

## harvest-salvage.js / hunt-no-progress.js — thu thập URL

Chạy `runHarvest` và `huntReels` thật với **đồng hồ nén** (1 giây thật = vài ms
trong test), nên mô phỏng được hạn 125 giây mà không phải chờ 125 giây.

Ba bug bị bắt, đều lấy thẳng từ log thật khi hunt không ra một video nào:
- hết hạn thì trả rỗng → cả vòng harvest tìm được 5-6 reel bị ghi là
  `+0 new urls (saw 0)`. Giờ `DISCOVER_PROGRESS` mang theo danh sách URL và
  background giữ lại khi hết hạn
- hạn đếm từ lúc điều hướng, nhưng tab nền tải Facebook mất 20-30s mới chạy
  được content script → hết giờ trước khi nó kịp làm gì. Giờ `GET_MISSION`
  khởi động lại đồng hồ
- chỉ `harvest.stuck` mới cộng `dryRounds`, nên nguồn trả 0 url mà không tự
  nhận stuck sẽ reset về 0; `checked` không tăng nên `maxChecks` không bao giờ
  chạm tới → **quay vô hạn**. Chạy test trên code cũ: tới vòng 12345 vẫn chưa
  dừng

## scrape-comments.js — cào bình luận

Chạy `scrapeComments()` thật trên DOM jsdom dựng theo **hai UI bình luận thật**
của Facebook (theo ảnh chụp màn hình của user):

| UI | URL | Panel | Nút tải thêm |
|---|---|---|---|
| A | `/<page>/videos/<id>` | mở sẵn ở cột phải | `Xem thêm bình luận` + `2/801` |
| B | `/reel/<id>` | đóng — phải bấm nút comment (số `22`) dưới nút like | `Xem thêm bình luận` + `6/22` |

UI A còn kiểm tra chuyện tổng FB công bố (801) lớn hơn nhiều số nó chịu trả:
phải dừng đúng lúc chứ không quay vô hạn. UI B có **hai** nút comment trên
trang (reel hiện tại + reel preload kế bên) — bấm nhầm cái ngoài màn hình là
cào comment của reel khác.

Fixture **chỉ nghe `mousedown`**, đúng như React của FB — `el.click()` trần
không kích hoạt gì cả.

Ba kịch bản: UI A, UI B, và UI B khi panel không mở được.

Năm bug bị bắt — bốn cái đầu là lý do reel 38 bình luận báo về `0`:
- `findCommentScrollContainer()` neo vào `[aria-label^="Bình luận"]` nên trúng
  luôn cái NÚT mở panel → leo lên ra khung feed → cuộn feed 8 lần (ngoài đời =
  nhảy sang reel khác giữa chừng) và scope collect sai nhánh
- `clickMoreCommentsButtons()` dùng `b.click()` → log ghi "clicked 2 buttons"
  nhưng DOM không nạp thêm bình luận nào
- vòng lặp 8 vòng cố định, không lặp cho tới khi hết bình luận
- `switchToAllComments()` cũng `.click()` trần → không bao giờ chuyển sang
  "Tất cả bình luận", và im lặng khi thất bại
- khi panel của reel hiện tại không mở, `openCommentPanel()` bấm tiếp sang nút
  comment của reel preload → cào comment của REEL KHÁC rồi gán cho reel này
  (reel rác bị chấm là chất lượng). Giờ chỉ bấm nút đang hiển thị trên màn hình,
  không mở được thì báo rỗng để hunter bỏ qua
