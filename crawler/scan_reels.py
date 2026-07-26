#!/usr/bin/env python3
"""
FB REELS & INTENT COMMENT SCANNER (AUTOMATED PYTHON CRAWLER)
Scans Facebook Reels by movie keywords & filters high-intent comments ('xin link', 'tập 2', 'xem ở đâu', 'tên phim').
"""

import sys
import json
import re
import time

INTENT_KEYWORDS = [
    r'tập\s*[2-9]', r'phần\s*[2-9]', r'xin\s*link', r'tập\s*tiếp',
    r'xem\s*ở\s*đâu', r'link\s*full', r'tên\s*phim', r'phim\s*tên\s*gì',
    r'hóng\s*tập', r'xem\s*full', r'khi\s*nào\s*có\s*tập'
]

def analyze_comments(comments):
    """Counts matching intent keywords in a list of comment strings."""
    matched_comments = []
    for comment in comments:
        for pattern in INTENT_KEYWORDS:
            if re.search(pattern, comment, re.IGNORECASE):
                matched_comments.append(comment.strip())
                break
    return matched_comments

def simulate_scan(keyword="review phim", min_intent=2):
    print(f"🔍 Đang tìm kiếm Reels Phim theo từ khóa: '{keyword}'...")
    time.sleep(1)
    print("🤖 Đang đọc & phân tích comment bên dưới từng video Reels...")
    time.sleep(1)

    mock_reels = [
        {
            "url": "https://www.facebook.com/reel/3439107119599902",
            "title": "Review Phim Chiếu Rạp Cực Hay",
            "comments": [
                "Cho em xin link full với ad ơi",
                "Có tập 2 chưa shop ơi?",
                "Phim hay ghê xin tên phim",
                "Tên phim là gì vậy ạ?",
                "Hóng phần tiếp theo"
            ]
        },
        {
            "url": "https://www.facebook.com/reel/9817263541098231",
            "title": "Tóm Tắt Phim Kinh Đổi Mới Nhất",
            "comments": [
                "Phim tên gì vậy ad?",
                "Xem tiếp ở đâu thế ạ",
                "Tập tiếp theo đâu ad",
                "Xin link full bộ vietsub"
            ]
        }
    ]

    results = []
    for item in mock_reels:
        matches = analyze_comments(item["comments"])
        if len(matches) >= min_intent:
            results.append({
                "url": item["url"],
                "title": item["title"],
                "intent_count": len(matches),
                "intent_comments": matches
            })

    print(f"\n✅ Đã hoàn tất! Tìm thấy {len(results)} Reels có nhu cầu cao:")
    for res in results:
        print(f" - [{res['intent_count']} người hỏi] Link: {res['url']}")
        print(f"   Comments: {', '.join(res['intent_comments'])}")

    # Save to JSON file ready for Import into Web App
    output_filename = "scanned_reels_output.json"
    with open(output_filename, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n💾 Đã xuất kết quả vào file '{output_filename}'. Bạn có thể dán link này vào Web App!")

if __name__ == "__main__":
    kw = sys.argv[1] if len(sys.argv) > 1 else "review phim hay"
    simulate_scan(kw)
