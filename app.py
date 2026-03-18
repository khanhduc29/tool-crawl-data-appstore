"""
App Store Crawler Tool
- Tìm kiếm app theo keyword qua iTunes Search API
- Cào reviews qua Apple RSS Feed (không cần đăng nhập)
- Phân loại reviews theo số sao (1-5)
- Xuất kết quả ra CSV
"""

import csv
import io
import requests
from flask import Flask, render_template, request, jsonify, Response

app = Flask(__name__)


def fetch_reviews_rss(app_id, country="us", max_pages=10):
    """
    Cào reviews qua Apple RSS Feed.
    URL format: https://itunes.apple.com/{country}/rss/customerreviews/page={page}/id={app_id}/sortBy=mostRecent/json
    Mỗi page trả về tối đa 50 reviews, tối đa 10 pages (500 reviews).
    """
    all_reviews = []

    for page in range(1, max_pages + 1):
        url = (
            f"https://itunes.apple.com/{country}/rss/customerreviews"
            f"/page={page}/id={app_id}/sortBy=mostRecent/json"
        )
        try:
            resp = requests.get(url, timeout=15)
            if resp.status_code != 200:
                break

            data = resp.json()
            entries = data.get("feed", {}).get("entry", [])

            if not entries:
                break

            for e in entries:
                # Entry đầu tiên đôi khi là metadata của app, bỏ qua
                if "im:rating" not in e:
                    continue

                rating = int(e.get("im:rating", {}).get("label", "0"))
                review = {
                    "title": e.get("title", {}).get("label", ""),
                    "content": e.get("content", {}).get("label", ""),
                    "rating": rating,
                    "userName": e.get("author", {}).get("name", {}).get("label", "Unknown"),
                    "date": e.get("updated", {}).get("label", ""),
                    "isEdited": False,
                    "voteCount": e.get("im:voteCount", {}).get("label", "0"),
                    "voteSum": e.get("im:voteSum", {}).get("label", "0"),
                    "appVersion": e.get("im:version", {}).get("label", ""),
                }
                all_reviews.append(review)

        except Exception:
            break

    return all_reviews


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/search", methods=["POST"])
def search_apps():
    """Tìm kiếm app trên App Store theo keyword."""
    data = request.get_json()
    keyword = data.get("keyword", "").strip()
    country = data.get("country", "vn")
    limit = data.get("limit", 50)

    if not keyword:
        return jsonify({"error": "Vui lòng nhập keyword"}), 400

    try:
        url = "https://itunes.apple.com/search"
        params = {
            "term": keyword,
            "entity": "software",
            "country": country,
            "limit": min(limit, 50),
        }
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        results = resp.json().get("results", [])

        apps = []
        for r in results:
            apps.append({
                "trackId": r.get("trackId"),
                "trackName": r.get("trackName", ""),
                "bundleId": r.get("bundleId", ""),
                "artworkUrl100": r.get("artworkUrl100", ""),
                "artworkUrl60": r.get("artworkUrl60", ""),
                "artistName": r.get("artistName", ""),
                "averageUserRating": round(r.get("averageUserRating", 0), 1),
                "userRatingCount": r.get("userRatingCount", 0),
                "primaryGenreName": r.get("primaryGenreName", ""),
                "price": r.get("price", 0),
                "formattedPrice": r.get("formattedPrice", "Free"),
                "description": (r.get("description", "")[:200] + "...")
                if len(r.get("description", "")) > 200
                else r.get("description", ""),
            })

        return jsonify({"apps": apps, "count": len(apps)})

    except requests.RequestException as e:
        return jsonify({"error": f"Lỗi khi tìm kiếm: {str(e)}"}), 500


@app.route("/api/reviews", methods=["POST"])
def get_reviews():
    """Cào reviews của một app qua Apple RSS Feed."""
    data = request.get_json()
    app_name = data.get("app_name", "")
    app_id = data.get("app_id")
    country = data.get("country", "vn")
    max_pages = data.get("max_pages", 10)

    if not app_id:
        return jsonify({"error": "Thiếu app_id"}), 400

    try:
        all_reviews = fetch_reviews_rss(app_id, country=country, max_pages=max_pages)

        # Phân loại reviews theo số sao
        reviews_by_rating = {1: [], 2: [], 3: [], 4: [], 5: []}
        rating_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}

        for review in all_reviews:
            rating = review.get("rating", 0)
            if rating in reviews_by_rating:
                reviews_by_rating[rating].append(review)
                rating_counts[rating] += 1

        total = sum(rating_counts.values())

        # Nếu VN trả 0, tự động thử US
        fallback_country = None
        if total == 0 and country != "us":
            fallback_reviews = fetch_reviews_rss(app_id, country="us", max_pages=max_pages)
            for review in fallback_reviews:
                rating = review.get("rating", 0)
                if rating in reviews_by_rating:
                    reviews_by_rating[rating].append(review)
                    rating_counts[rating] += 1
            total = sum(rating_counts.values())
            if total > 0:
                fallback_country = "us"

        return jsonify({
            "app_name": app_name,
            "app_id": app_id,
            "total_reviews": total,
            "rating_counts": rating_counts,
            "reviews_by_rating": reviews_by_rating,
            "fallback_country": fallback_country,
        })

    except Exception as e:
        return jsonify({"error": f"Lỗi khi cào reviews: {str(e)}"}), 500


@app.route("/api/export", methods=["POST"])
def export_csv():
    """Xuất reviews ra file CSV."""
    data = request.get_json()
    app_name = data.get("app_name", "app")
    reviews_by_rating = data.get("reviews_by_rating", {})

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Rating", "Title", "Content", "User", "Date", "App Version", "Vote Count"])

    for rating in ["5", "4", "3", "2", "1"]:
        reviews = reviews_by_rating.get(str(rating), [])
        for r in reviews:
            writer.writerow([
                r.get("rating", ""),
                r.get("title", ""),
                r.get("content", ""),
                r.get("userName", ""),
                r.get("date", ""),
                r.get("appVersion", ""),
                r.get("voteCount", ""),
            ])

    csv_content = output.getvalue()
    output.close()

    safe_name = "".join(c if c.isalnum() or c in (" ", "-", "_") else "_" for c in app_name)

    return Response(
        csv_content,
        mimetype="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=reviews_{safe_name}.csv",
            "Content-Type": "text/csv; charset=utf-8",
        },
    )


if __name__ == "__main__":
    print("=" * 60)
    print("  App Store Crawler Tool")
    print("  Mở trình duyệt tại: http://localhost:5000")
    print("=" * 60)
    app.run(debug=True, host="0.0.0.0", port=5000)
