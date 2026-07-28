# Smoke tests cho hunt loop

Chạy `huntReels` thật trong Node với `chrome.*` API giả lập. Content script được
mô phỏng bằng cách trả `HARVEST_RESULT` / `SCRAPE_RESULT` ngay sau mỗi
`chrome.tabs.update`, nên toàn bộ vòng lặp và giao thức message được chạy thật.

```bash
node test/hunt-smoke.js    # đường bình thường: harvest → scrape → đủ target
node test/hunt-stuck.js    # nhánh stuck: renavigate → fresh-tab → tab được thay
```

Exit code 0 = pass.

Hai bug đã bị bắt bởi bộ này, cả hai đều là lỗi runtime mà kiểm tra cú pháp
không thấy:
- `tabId = tabId` (do sed thay `tab.id` quá tay) → hunt thoát ngay lập tức
- `reloads is not defined` (đổi tên biến sót một chỗ) → crash ở lượt harvest đầu
