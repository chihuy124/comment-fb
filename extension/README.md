# FB Reel Comment Scraper — Chrome Extension

Cào comment thật từ Facebook Reels bằng session FB đang login của bạn.
Kết hợp với web app [comment-fb.vercel.app](https://comment-fb.vercel.app/).

## Cài đặt (Load Unpacked)

1. Mở Chrome/Edge/Brave → gõ vào thanh địa chỉ: `chrome://extensions`
2. Bật **Developer mode** (góc trên phải)
3. Bấm **Load unpacked** → chọn folder `extension/` này
4. Icon 🧩 xuất hiện ở toolbar → done

## Cách dùng

1. Đảm bảo bạn **đã đăng nhập Facebook** trên chính trình duyệt đó
2. Mở [comment-fb.vercel.app](https://comment-fb.vercel.app/) → tab **Scanner**
3. Quét Reel như thường lệ (nút "Tự Động Quét & Phân Tích Comment Reels")
4. Sau khi có kết quả, bấm nút mới **"🧩 Cào Comment Thật (qua Extension)"**
5. Extension mở tab ẩn cho mỗi Reel → scroll → đọc comment → gửi về web app
6. Web app cập nhật `intentComments` và `intentCount` với dữ liệu **thật**

## Cấu hình (icon extension → popup)

- **Số tab song song**: 1-8 (mặc định 3). Cao hơn → nhanh hơn nhưng dễ bị FB flag
- **Timeout mỗi tab**: giây chờ tối đa cho 1 Reel (mặc định 45s)
- **Delay giữa batch**: giây nghỉ giữa các đợt song song (mặc định 2s)

## Nguyên tắc an toàn

- Không cào quá 100-200 Reel/giờ để tránh FB tạm khóa tài khoản
- Không share cookie hoặc thông tin đăng nhập
- Extension chỉ đọc DOM của các trang Reel bạn chỉ định, không đọc gì khác trên facebook.com

## Kiến trúc

```
[Web app] ⇄ [page_bridge.js on comment-fb.*]  ⇄  [background.js SW]  ⇄  [content_script.js on facebook.com/reel/...]
     window.postMessage        chrome.runtime.sendMessage       chrome.tabs.create + onMessage
```

## Nếu FB đổi DOM và ngừng cào được

Chỉ cần sửa các selector trong `content_script.js`:
- `div[role="article"]` — comment container
- `div[dir="auto"]` — comment text
- `a[role="link"]` — author link

Không phải build lại extension, chỉ reload ở `chrome://extensions`.
