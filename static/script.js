/**
 * App Store Crawler - Frontend Logic
 */

// State
let currentApps = [];
let currentReviews = null;
let currentSelectedApp = null;

// ========== Search Apps ==========
async function searchApps() {
    const keyword = document.getElementById('searchInput').value.trim();
    const country = document.getElementById('countrySelect').value;

    if (!keyword) {
        showToast('Vui lòng nhập keyword tìm kiếm', 'error');
        return;
    }

    const btn = document.getElementById('searchBtn');
    setLoading(btn, true);

    try {
        const resp = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword, country }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || 'Lỗi tìm kiếm');
        }

        currentApps = data.apps;
        renderAppList(data.apps);
        showToast(`Tìm thấy ${data.count} ứng dụng`, 'success');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        setLoading(btn, false);
    }
}

// ========== Render App List ==========
function renderAppList(apps) {
    const panel = document.getElementById('appListPanel');
    const grid = document.getElementById('appGrid');
    const count = document.getElementById('resultCount');

    panel.style.display = 'block';
    count.textContent = `${apps.length} app`;

    grid.innerHTML = apps.map((app, idx) => `
        <div class="app-card" onclick="loadReviews(${idx})" style="animation-delay: ${idx * 0.03}s">
            <img class="app-icon" src="${app.artworkUrl100 || app.artworkUrl60}" alt="${app.trackName}" loading="lazy">
            <div class="app-info">
                <div class="app-name">${escapeHtml(app.trackName)}</div>
                <div class="app-developer">${escapeHtml(app.artistName)}</div>
                <div class="app-meta">
                    <span class="app-rating">⭐ ${app.averageUserRating || 'N/A'}</span>
                    <span>${formatNumber(app.userRatingCount)} đánh giá</span>
                    <span class="app-genre">${escapeHtml(app.primaryGenreName)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// ========== Load Reviews ==========
async function loadReviews(index) {
    const app = currentApps[index];
    if (!app) return;

    currentSelectedApp = app;

    const panel = document.getElementById('reviewsPanel');
    const loading = document.getElementById('reviewsLoading');
    const empty = document.getElementById('reviewsEmpty');
    const summary = document.getElementById('ratingSummary');
    const tabs = document.getElementById('ratingTabs');
    const exportBtn = document.getElementById('exportBtn');
    const appInfo = document.getElementById('reviewAppInfo');

    // Show panel & loading
    panel.style.display = 'block';
    loading.style.display = 'flex';
    empty.style.display = 'none';
    summary.style.display = 'none';
    tabs.style.display = 'none';
    exportBtn.style.display = 'none';

    // Scroll to panel
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Set app info in header
    appInfo.innerHTML = `
        <img src="${app.artworkUrl60 || app.artworkUrl100}" alt="${app.trackName}">
        <div class="info-text">
            <h3>${escapeHtml(app.trackName)}</h3>
            <p>${escapeHtml(app.artistName)}</p>
        </div>
    `;

    // Clear reviews
    clearReviews();

    const country = document.getElementById('countrySelect').value;

    try {
        const resp = await fetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_name: app.trackName,
                app_id: app.trackId,
                country: country,
                how_many: 200,
            }),
        });
        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || 'Lỗi cào reviews');
        }

        currentReviews = data;
        loading.style.display = 'none';

        if (data.total_reviews === 0) {
            empty.style.display = 'flex';
            return;
        }

        // Show rating summary
        summary.style.display = 'flex';
        tabs.style.display = 'flex';
        exportBtn.style.display = 'flex';

        renderRatingSummary(data);
        switchTab('all');

        let msg = `Cào được ${data.total_reviews} đánh giá`;
        if (data.fallback_country) {
            msg += ` (fallback sang store ${data.fallback_country.toUpperCase()})`;
        }
        showToast(msg, 'success');
    } catch (err) {
        loading.style.display = 'none';
        showToast(err.message, 'error');
        empty.style.display = 'flex';
        const emptyP = empty.querySelector('p');
        if (emptyP) emptyP.textContent = 'Lỗi khi cào đánh giá: ' + err.message;
    }
}

// ========== Render Rating Summary ==========
function renderRatingSummary(data) {
    const totalEl = document.getElementById('totalReviews');
    const barsEl = document.getElementById('ratingBars');

    totalEl.textContent = data.total_reviews;

    const max = Math.max(...Object.values(data.rating_counts), 1);

    barsEl.innerHTML = [5, 4, 3, 2, 1].map(rating => {
        const count = data.rating_counts[rating] || 0;
        const pct = (count / max) * 100;
        return `
            <div class="rating-bar-row">
                <span class="rating-bar-label">${'★'.repeat(rating)}</span>
                <div class="rating-bar-track">
                    <div class="rating-bar-fill" data-rating="${rating}" style="width: 0%"></div>
                </div>
                <span class="rating-bar-count">${count}</span>
            </div>
        `;
    }).join('');

    // Animate bars
    requestAnimationFrame(() => {
        setTimeout(() => {
            barsEl.querySelectorAll('.rating-bar-fill').forEach(bar => {
                const rating = bar.dataset.rating;
                const count = data.rating_counts[rating] || 0;
                const pct = (count / max) * 100;
                bar.style.width = pct + '%';
            });
        }, 50);
    });
}

// ========== Switch Tab ==========
function switchTab(rating) {
    if (!currentReviews) return;

    // Update active tab
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.rating === String(rating));
    });

    const list = document.getElementById('reviewsList');
    // Keep loading/empty states
    const loading = document.getElementById('reviewsLoading');
    const empty = document.getElementById('reviewsEmpty');

    // Get reviews to show
    let reviews = [];
    if (rating === 'all') {
        for (let r = 5; r >= 1; r--) {
            reviews = reviews.concat(currentReviews.reviews_by_rating[r] || []);
        }
    } else {
        reviews = currentReviews.reviews_by_rating[rating] || [];
    }

    // Render reviews
    const reviewCards = reviews.map((review, idx) => `
        <div class="review-card" style="animation-delay: ${Math.min(idx * 0.03, 0.5)}s">
            <div class="review-header">
                <span class="review-user">${escapeHtml(review.userName)}</span>
                <span class="review-date">${formatDate(review.date)}</span>
            </div>
            <div class="review-stars">${'⭐'.repeat(review.rating)}</div>
            ${review.title ? `<div class="review-title">${escapeHtml(review.title)}</div>` : ''}
            <div class="review-content">${escapeHtml(review.content)}</div>
            ${review.isEdited ? '<span class="review-edited">✏️ Đã chỉnh sửa</span>' : ''}
            ${review.appVersion ? `<span class="review-edited">📱 v${escapeHtml(review.appVersion)}</span>` : ''}
        </div>
    `).join('');

    // Remove old review cards but keep loading/empty
    list.querySelectorAll('.review-card').forEach(el => el.remove());

    if (reviews.length === 0) {
        // show inline empty
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'review-card';
        emptyDiv.style.textAlign = 'center';
        emptyDiv.style.color = 'var(--text-muted)';
        emptyDiv.innerHTML = 'Không có đánh giá nào ở mức sao này';
        list.appendChild(emptyDiv);
    } else {
        list.insertAdjacentHTML('beforeend', reviewCards);
    }
}

// ========== Export CSV ==========
async function exportCSV() {
    if (!currentReviews || !currentSelectedApp) {
        showToast('Không có dữ liệu để xuất', 'error');
        return;
    }

    try {
        const resp = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_name: currentSelectedApp.trackName,
                reviews_by_rating: currentReviews.reviews_by_rating,
            }),
        });

        if (!resp.ok) throw new Error('Lỗi khi xuất file');

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reviews_${currentSelectedApp.trackName.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('Đã xuất file CSV thành công!', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ========== Close Reviews ==========
function closeReviews() {
    const panel = document.getElementById('reviewsPanel');
    panel.style.display = 'none';
    currentReviews = null;
    currentSelectedApp = null;
}

// ========== Helpers ==========
function clearReviews() {
    const list = document.getElementById('reviewsList');
    list.querySelectorAll('.review-card').forEach(el => el.remove());
}

function setLoading(btn, loading) {
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loader');
    if (loading) {
        text.style.display = 'none';
        loader.style.display = 'block';
        btn.disabled = true;
    } else {
        text.style.display = 'inline';
        loader.style.display = 'none';
        btn.disabled = false;
    }
}

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
    } catch {
        return dateStr;
    }
}

// ========== Keyboard Shortcut ==========
document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        searchApps();
    }
});
