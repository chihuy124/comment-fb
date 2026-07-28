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

## zero-comment-diag.js — lý do "0 comments"

Log của content script nằm trong console của **tab nền**, mà tab đó bị điều
hướng liên tục nên log bị xoá trước khi đọc được. Nên lý do phải gửi kèm
`SCRAPE_RESULT` và in ở background log. Test kiểm tra ba trường hợp khác hẳn
nhau đều được phân biệt rõ:

- `panel-không-mở-được`
- `có-node-bình-luận-nhưng-bóc-ra-rỗng` (kèm số node thật có trong DOM)
- content script không trả lời (hết hạn / tab chết) — không có `diag` nào

## post-comment.js — xác minh comment đã đăng thật

Bug user gặp: chạy "Comment Tất Cả", vài bài **cuối** báo thành công nhưng trên
Facebook không có bình luận nào, và không có lỗi nào được báo.

Nguyên nhân: bằng chứng thành công duy nhất là *"ô soạn thảo trở nên trống"* —
mà Lexical xoá ô ngay khi nhấn Enter, **trước** khi biết server có nhận hay
không. Bị rate limit thì ô vẫn trống y như lúc thành công. Hỏng dồn về cuối một
loạt chính là dáng điệu của rate limit.

Giờ bằng chứng là: bình luận **xuất hiện** trong danh sách, **đúng tên người
đăng** (đọc từ `aria-label` của ô soạn thảo), **đúng nội dung**, và **vẫn còn**
sau vài giây — Facebook chèn lạc quan rồi rút lại nếu server từ chối.

Bảy kịch bản, mỗi cái ra một mã lỗi khác nhau:

| Facebook làm gì | Kết quả |
|---|---|
| nhận bình luận | `ok: true, verified: true` |
| xoá ô, không chèn gì (rate limit âm thầm) | `not_visible` |
| chèn rồi rút lại | `comment_vanished` |
| hiện hộp thoại chặn | `blocked` + nguyên văn Facebook nói gì |
| có bình luận cùng nội dung của người khác | `not_visible` + `nearMiss` |
| không xoá ô | `submit_failed` |

Kèm hai bẫy báo động giả: chữ "thử lại sau" nằm trong **bình luận của người
khác** không được tính là bị chặn (nên chỉ quét trong `role="dialog"` /
`aria-live`), và bình luận trùng nội dung của người khác không được nhận vơ.

`blocked` làm app **dừng ngay** thay vì cố thêm 2 bài cho đủ 3 lần thất bại.

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

Sáu kịch bản: UI A, UI B, UI B khi panel không mở được, tab nền không đo được
vị trí nút, và hai kịch bản reel 539 bình luận (ngân sách 1ms / ngân sách thoải
mái) — đo thật trên Chrome: vòng nạp chạy 45 giây vẫn chưa xong, đã nạp 187
node, trong khi hạn của background đúng bằng 45 giây.

Năm bug bị bắt — bốn cái đầu là lý do reel 38 bình luận báo về `0`:
- `findCommentScrollContainer()` neo vào `[aria-label^="Bình luận"]` nên trúng
  luôn cái NÚT mở panel → leo lên ra khung feed → cuộn feed 8 lần (ngoài đời =
  nhảy sang reel khác giữa chừng) và scope collect sai nhánh
- `clickMoreCommentsButtons()` dùng `b.click()` → log ghi "clicked 2 buttons"
  nhưng DOM không nạp thêm bình luận nào
- vòng lặp 8 vòng cố định, không lặp cho tới khi hết bình luận
- `switchToAllComments()` cũng `.click()` trần → không bao giờ chuyển sang
  "Tất cả bình luận", và im lặng khi thất bại
- vòng "bấm cho tới hết" (`MAX_ROUNDS=40`, ~2,5s/vòng ≈ 100 giây) dài hơn hạn
  cào 45 giây của background → background bỏ cuộc, trả rỗng, cả lượt cào công
  phu bị ghi thành `0 comments`. Đây là hồi tố của chính bản sửa "đọc hết bình
  luận": bản 8 vòng cũ chỉ mất ~16 giây nên vừa khít. Giờ background gửi
  `budgetMs` và content script tự dừng, bóc chỗ đã nạp; thêm trần
  `MAX_COMMENTS=200` vì kết quả vốn đã bị cắt còn 200
- khi panel của reel hiện tại không mở, `openCommentPanel()` bấm tiếp sang nút
  comment của reel preload → cào comment của REEL KHÁC rồi gán cho reel này
  (reel rác bị chấm là chất lượng). Giờ chỉ bấm nút đang hiển thị trên màn hình,
  không mở được thì báo rỗng để hunter bỏ qua
