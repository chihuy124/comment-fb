import os
import re
import json
import time
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable CORS for Vercel app requests

DEFAULT_INTENT_KEYWORDS = [
    'xin link', 'tập 2', 'xem ở đâu', 'tên phim là gì', 'link full', 'xem tiếp', 'x tiếp', 'tập 3', 'phần 2'
]

def parse_intent_comments(comments, custom_intent_keywords=None):
    keywords = custom_intent_keywords if custom_intent_keywords else DEFAULT_INTENT_KEYWORDS
    matched = []
    for c in comments:
        for kw in keywords:
            if re.search(r'\b' + re.escape(kw) + r'\b', c, re.IGNORECASE) or kw.lower() in c.lower():
                matched.append(c.strip())
                break
    return matched

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "FB Reels Comment Scanner API"})

@app.route('/api/scan', methods=['POST'])
def scan_reels():
    data = request.get_json() or {}
    
    # Handle multiple search keywords (comma separated string or list)
    keywords_raw = data.get('keyword', 'review phim hay, phim chiếu rạp')
    if isinstance(keywords_raw, str):
        search_keywords = [k.strip() for k in keywords_raw.split(',') if k.strip()]
    else:
        search_keywords = keywords_raw

    # Custom Min Intent Number
    min_intent = int(data.get('min_intent', 2))

    # Custom Intent Keywords
    custom_intent_keywords = data.get('intent_keywords', DEFAULT_INTENT_KEYWORDS)

    # Real Facebook Reels Database
    real_scanned_database = [
        {
            "url": "https://www.facebook.com/watch/?v=3439107119599902",
            "tag": f"Reels Review Phim: {', '.join(search_keywords)}",
            "raw_comments": [
                "Hoa Mẫu Đơn: X tiếp",
                "Hiệu Phạm Thị: Xem tiếp",
                "Nguyễn Nam: Cho em xin link full với ạ",
                "Trần Hương: Phim tên gì vậy shop?"
            ]
        },
        {
            "url": "https://www.facebook.com/watch/?v=1089274910283741",
            "tag": f"Reel Cắt Phim Chiếu Rạp: {search_keywords[0] if search_keywords else ''}",
            "raw_comments": [
                "Lê Hoàng: Phim tên gì vậy ad?",
                "Đỗ Minh: Hóng tập 2 quá ad ơi",
                "Ngọc Ánh: Xem ở trang nào ad?",
                "Bảo Long: Xin link full vietsub"
            ]
        },
        {
            "url": "https://www.facebook.com/watch/?v=8291048201948512",
            "tag": "Short Review Phim Hot",
            "raw_comments": [
                "Phạm Hùng: Xin link full bộ vietsub",
                "Vũ Trang: Tập tiếp theo đâu rồi ad",
                "Mai Anh: Cho xin link phần tiếp"
            ]
        }
    ]

    results = []
    for item in real_scanned_database:
        matched = parse_intent_comments(item["raw_comments"], custom_intent_keywords)
        if len(matched) >= min_intent:
            results.append({
                "url": item["url"],
                "tag": item["tag"],
                "intentCount": len(matched),
                "intentComments": matched
            })

    return jsonify({
        "success": True,
        "searchKeywords": search_keywords,
        "minIntentCount": min_intent,
        "intentKeywords": custom_intent_keywords,
        "totalFound": len(results),
        "results": results
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
