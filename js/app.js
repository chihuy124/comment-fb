/**
 * MAIN APPLICATION CONTROLLER (FB SEEDING ASSISTANT)
 * Controls Tab Navigation, Dashboard Rendering, Promo Link Management, Smart Reel Intent Scanner, 1-Click Action Flow, Modals & Toast Alerts.
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const elements = {
        navItems: document.querySelectorAll('.nav-item'),
        tabContents: document.querySelectorAll('.tab-content'),
        pageTitle: document.getElementById('page-title'),
        pageSubtitle: document.getElementById('page-subtitle'),

        // Promo Link Input
        inputPromoLink: document.getElementById('input-promo-link'),
        inputPromoLink2: document.getElementById('input-promo-link-2'),
        inputPromoLink3: document.getElementById('input-promo-link-3'),
        btnSavePromoLink: document.getElementById('btn-save-promo-link'),
        
        // Stats
        statTotal: document.getElementById('stat-total'),
        statPending: document.getElementById('stat-pending'),
        statCompleted: document.getElementById('stat-completed'),
        statRate: document.getElementById('stat-rate'),
        totalPostsCount: document.getElementById('total-posts-count'),
        
        // Dashboard
        cardsContainer: document.getElementById('cards-container'),
        bulkDelayMin: document.getElementById('bulk-delay-min'),
        bulkDelayMax: document.getElementById('bulk-delay-max'),
        bulkDwellMin: document.getElementById('bulk-dwell-min'),
        bulkDwellMax: document.getElementById('bulk-dwell-max'),
        bulkLikeChance: document.getElementById('bulk-like-chance'),
        bulkBreakEvery: document.getElementById('bulk-break-every'),
        bulkBreakMin: document.getElementById('bulk-break-min'),
        bulkBreakMax: document.getElementById('bulk-break-max'),
        btnCommentAll: document.getElementById('btn-comment-all'),
        btnStopCommentAll: document.getElementById('btn-stop-comment-all'),
        bulkStatus: document.getElementById('bulk-status'),
        searchDashboard: document.getElementById('search-dashboard'),
        filterCategory: document.getElementById('filter-category'),
        filterStatus: document.getElementById('filter-status'),

        // Posts Table
        postsTableBody: document.getElementById('posts-table-body'),
        checkAllPosts: document.getElementById('check-all-posts'),
        btnSelectAll: document.getElementById('btn-select-all'),
        btnDeleteSelected: document.getElementById('btn-delete-selected'),
        postsPageSize: document.getElementById('posts-page-size'),
        postsPagination: document.getElementById('posts-pagination'),
        postsPageInfo: document.getElementById('posts-page-info'),
        postsPageIndicator: document.getElementById('posts-page-indicator'),
        btnPostsFirst: document.getElementById('btn-posts-first'),
        btnPostsPrev: document.getElementById('btn-posts-prev'),
        btnPostsNext: document.getElementById('btn-posts-next'),
        btnPostsLast: document.getElementById('btn-posts-last'),

        // Modals
        btnOpenAddModal: document.getElementById('btn-open-add-modal'),
        modalAddPosts: document.getElementById('modal-add-posts'),
        btnCloseAddModal: document.getElementById('btn-close-add-modal'),
        btnCancelAddModal: document.getElementById('btn-cancel-add-modal'),
        btnSavePosts: document.getElementById('btn-save-posts'),
        bulkLinksInput: document.getElementById('bulk-links-input'),
        postCategorySelect: document.getElementById('post-category-select'),
        postTagInput: document.getElementById('post-tag-input'),

        // Spintax Tester
        spintaxInput: document.getElementById('spintax-input'),
        btnGenerateVariants: document.getElementById('btn-generate-variants'),
        chkAutoEmoji: document.getElementById('chk-auto-emoji'),
        spintaxOutputList: document.getElementById('spintax-output-list'),
        templateList: document.getElementById('template-list'),
        btnAddTemplate: document.getElementById('btn-add-template'),
        btnQuickSpintaxTest: document.getElementById('btn-quick-spintax-test'),

        // Tab 5: Scanner Elements
        scanKeywordInput: document.getElementById('scan-keyword-input'),
        minIntentCount: document.getElementById('min-intent-count'),
        scannedResultsContainer: document.getElementById('scanned-results-container'),
        btnImportScannedAll: document.getElementById('btn-import-scanned-all'),
        btnDiscoverFeed: document.getElementById('btn-discover-feed'),

        // Reel Hunter tab
        huntTargetCount: document.getElementById('hunt-target-count'),
        huntMinIntent: document.getElementById('hunt-min-intent'),
        huntMaxChecks: document.getElementById('hunt-max-checks'),
        huntSkipExisting: document.getElementById('hunt-skip-existing'),
        btnStartHunt: document.getElementById('btn-start-hunt'),
        btnStopHunt: document.getElementById('btn-stop-hunt'),
        huntProgress: document.getElementById('hunt-progress'),
        huntResultsContainer: document.getElementById('hunt-results-container'),
        btnImportHunted: document.getElementById('btn-import-hunted'),
        huntExtNote: document.getElementById('hunt-ext-note'),
        extStatusBanner: document.getElementById('ext-status-banner'),
        intentKeywordsContainer: document.getElementById('intent-keywords-container'),
        inputNewIntentKeyword: document.getElementById('input-new-intent-keyword'),
        btnAddIntentKeyword: document.getElementById('btn-add-intent-keyword'),
        chkHideCommented: document.getElementById('chk-hide-commented'),

        // Settings & Export
        btnExportData: document.getElementById('btn-export-data'),
        inputImportFile: document.getElementById('input-import-file'),
        btnResetDemo: document.getElementById('btn-reset-demo'),
        themeSwitch: document.getElementById('theme-switch'),
        toastContainer: document.getElementById('toast-container')
    };

    // State
    let currentTab = 'dashboard-tab';
    let scannedItems = [];
    let intentKeywords = getStoredIntentKeywords();
    let extensionReady = false;
    let extensionVersion = null;
    let huntedItems = [];
    let huntRunning = false;
    let bulkRunning = false;
    let bulkAbort = false;
    let postsPage = 1;

    function getStoredIntentKeywords() {
        const stored = localStorage.getItem('fb_intent_keywords');
        if (stored) {
            try { return JSON.parse(stored); } catch(e) {}
        }
        // Short, loose tokens on purpose: Vietnamese viewers phrase these many
        // ways ("cho xin tên phim", "phim này tên gì", "hóng tập"), so matching
        // on long exact phrases like "tên phim là gì" misses most of them.
        return [
            'xin link', 'cho xin', 'link full', 'link phim',
            'tên phim', 'tên gì', 'phim gì',
            'tập 2', 'tập tiếp', 'tập sau', 'hóng tập', 'phần 2',
            'xem tiếp', 'x tiếp', 'tiếp đi', 'xem tiep',
            'trọn bộ', 'full bộ', 'xem ở đâu', 'ở đâu',
        ];
    }

    function saveIntentKeywords(keywords) {
        intentKeywords = keywords;
        localStorage.setItem('fb_intent_keywords', JSON.stringify(keywords));
        renderIntentKeywords();
    }

    function renderIntentKeywords() {
        if (!elements.intentKeywordsContainer) return;
        elements.intentKeywordsContainer.innerHTML = '';
        intentKeywords.forEach((kw, index) => {
            const span = document.createElement('span');
            span.className = 'post-tag-badge';
            span.style.display = 'inline-flex';
            span.style.alignItems = 'center';
            span.style.gap = '0.3rem';
            span.style.padding = '0.35rem 0.65rem';

            span.innerHTML = `
                <span>${escapeHtml(kw)}</span>
                <span class="btn-remove-tag" data-index="${index}" style="cursor:pointer; font-weight:bold; margin-left:0.2rem; opacity:0.7;">&times;</span>
            `;
            elements.intentKeywordsContainer.appendChild(span);
        });

        document.querySelectorAll('.btn-remove-tag').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                const removed = intentKeywords.splice(idx, 1);
                saveIntentKeywords(intentKeywords);
                showToast(`Đã xóa từ khóa intent "${removed[0]}"`, 'info');
            });
        });
    }

    // Page titles mapping
    const TAB_TITLES = {
        'dashboard-tab': { title: 'Bảng điều khiển Seeding 1-Click', subtitle: 'Bấm "Tự Động Comment" để extension mở bài và đăng giúp bạn. Mỗi lần bấm là một comment — nhịp độ do bạn quyết định.' },
        'posts-tab': { title: 'Quản lý danh sách bài viết mục tiêu', subtitle: 'Thêm, sửa, xóa các bài viết Facebook của người khác / Group cần seeding.' },
        'spintax-tab': { title: 'Bộ mẫu & Trình tạo Spintax Phim', subtitle: 'Thiết lập cú pháp {A|B|C} và {link_fb} để tạo hàng ngàn câu comment biến thể không trùng lặp.' },
        'scanner-tab': { title: 'Quét Reels Phim & Phân Tích Comment Nhu Cầu Cao 🔥', subtitle: 'Tự động lọc các video Reels đang có nhiều người comment hỏi xin link / hỏi tập 2.' },
        'hunter-tab': { title: 'Săn Reels Chất Lượng 🎯', subtitle: 'Đi từng Reel một trên Facebook, cào comment thật và chỉ dừng khi gom đủ số Reels đạt chuẩn bạn đặt.' },
        'settings-tab': { title: 'Cài đặt & Quản lý dữ liệu', subtitle: 'Sao lưu dữ liệu LocalStorage và xem hướng dẫn thao tác an toàn.' }
    };

    // --- INITIALIZATION ---
    function init() {
        bindEvents();
        initPromoLink();
        renderIntentKeywords();
        renderAll();
        initTheme();
    }

    // --- PROMO LINK INITIALIZATION & EVENT ---
    function initPromoLink() {
        const links = StorageManager.getPromoLinks();
        elements.inputPromoLink.value = links[0] || '';
        if (elements.inputPromoLink2) elements.inputPromoLink2.value = links[1] || '';
        if (elements.inputPromoLink3) elements.inputPromoLink3.value = links[2] || '';

        elements.btnSavePromoLink.addEventListener('click', () => {
            const entered = [
                elements.inputPromoLink.value,
                elements.inputPromoLink2 ? elements.inputPromoLink2.value : '',
                elements.inputPromoLink3 ? elements.inputPromoLink3.value : '',
            ].map(v => (v || '').trim());

            if (!entered[0].startsWith('http')) {
                showToast('Link 1 là bắt buộc và phải bắt đầu bằng http:// hoặc https://', 'warning');
                return;
            }
            const badExtra = entered.slice(1).find(v => v && !v.startsWith('http'));
            if (badExtra) {
                showToast('Link phụ phải bắt đầu bằng http:// hoặc https:// (hoặc để trống).', 'warning');
                return;
            }

            StorageManager.savePromoLinks(entered);
            const count = entered.filter(Boolean).length;
            showToast(
                count > 1
                    ? `Đã lưu ${count} link. Mỗi comment sẽ dùng một link ngẫu nhiên trong số này.`
                    : 'Đã lưu link. Thêm link 2 và 3 để mỗi comment không dùng chung một URL.',
                'success'
            );
            
            // Regenerate comments for pending posts
            const posts = StorageManager.getPosts();
            posts.forEach(p => {
                if (p.status === 'PENDING') {
                    StorageManager.regenerateCommentForPost(p.id);
                }
            });

            renderAll();
        });
    }

    // --- RENDER ALL UI COMPONENTS ---
    function renderAll() {
        updateStats();
        renderDashboardCards();
        renderPostsTable();
        renderTemplates();
    }

    // --- STATS UPDATE ---
    function updateStats() {
        const posts = StorageManager.getPosts();
        const total = posts.length;
        const pending = posts.filter(p => p.status === 'PENDING').length;
        const completed = posts.filter(p => p.status === 'COMPLETED').length;
        const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

        elements.statTotal.textContent = total;
        elements.statPending.textContent = pending;
        elements.statCompleted.textContent = completed;
        elements.statRate.textContent = `${rate}%`;
        elements.totalPostsCount.textContent = total;
    }

    // --- DASHBOARD CARDS RENDER ---
    function renderDashboardCards() {
        const posts = StorageManager.getPosts();
        const searchQuery = elements.searchDashboard.value.toLowerCase().trim();
        const catFilter = elements.filterCategory.value;
        const statusFilter = elements.filterStatus.value;

        let filtered = posts.filter(post => {
            const matchesSearch = post.url.toLowerCase().includes(searchQuery) || post.tag.toLowerCase().includes(searchQuery) || post.currentComment.toLowerCase().includes(searchQuery);
            const matchesCategory = catFilter === 'ALL' || post.category === catFilter;
            const matchesStatus = statusFilter === 'ALL' || post.status === statusFilter;
            return matchesSearch && matchesCategory && matchesStatus;
        });

        elements.cardsContainer.innerHTML = '';

        if (filtered.length === 0) {
            elements.cardsContainer.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    <h3>Chưa có bài viết nào trong danh sách</h3>
                    <p>Hãy nhấn nút "Thêm Link Bài Viết" để dán các link Reels/Bài viết Facebook người khác cần seeding.</p>
                </div>
            `;
            return;
        }

        filtered.forEach(post => {
            const card = document.createElement('div');
            card.className = `post-action-card card-${post.status.toLowerCase()}`;

            const statusBadges = {
                'PENDING': '<span class="post-status-badge status-pending">Chờ comment</span>',
                'COMPLETED': '<span class="post-status-badge status-completed">Đã xong ✓</span>',
                'SKIPPED': '<span class="post-status-badge status-skipped">Đã bỏ qua</span>'
            };

            card.innerHTML = `
                <div class="card-top">
                    <div>
                        <span class="post-tag-badge">${escapeHtml(post.tag || 'Nhãn mặc định')}</span>
                    </div>
                    ${statusBadges[post.status] || ''}
                </div>

                <a href="${escapeHtml(post.url)}" target="_blank" class="post-link-preview" title="Mở link bài viết người khác: ${escapeHtml(post.url)}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    <span>${truncateUrl(post.url)}</span>
                </a>

                <div class="comment-box-preview">
                    <label>Nội dung comment sẵn sàng (Đã chèn link của bạn & biến đổi Spintax):</label>
                    <div class="comment-text-content" style="white-space: pre-line; word-break: break-all;">${escapeHtml(post.currentComment)}</div>
                    <button class="btn-regen-comment" data-id="${post.id}" title="Đổi câu comment biến thể khác">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                    </button>
                </div>

                <div class="card-actions-row" style="flex-wrap:wrap; gap:0.4rem;">
                    <button class="btn btn-copy-launch btn-action-auto-comment" data-id="${post.id}"
                            title="${extensionReady ? 'Mở bài và tự động đăng comment này' : 'Cần cài Chrome Extension trước'}"
                            ${extensionReady ? '' : 'disabled style="opacity:0.55;"'}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"></path></svg>
                        <span>Tự Động Comment</span>
                    </button>

                    <button class="btn btn-secondary btn-sm btn-action-copy-launch" data-id="${post.id}"
                            title="Cách thủ công: copy nội dung rồi mở bài để tự dán">Copy & Mở</button>

                    ${post.status === 'COMPLETED'
                        ? `<button class="btn btn-secondary btn-sm btn-mark-pending" data-id="${post.id}" title="Đánh dấu chờ làm lại">Chờ lại</button>`
                        : `<button class="btn btn-secondary btn-sm btn-mark-complete" data-id="${post.id}" title="Đánh dấu đã đăng">Đã xong</button>`
                    }
                </div>
            `;

            elements.cardsContainer.appendChild(card);
        });

        bindCardActionEvents();
    }

    // Bind card action buttons
    function bindCardActionEvents() {
        document.querySelectorAll('.btn-action-auto-comment').forEach(btn => {
            btn.addEventListener('click', (e) => {
                autoCommentOnPost(e.currentTarget.getAttribute('data-id'), e.currentTarget);
            });
        });

        document.querySelectorAll('.btn-action-copy-launch').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const postId = e.currentTarget.getAttribute('data-id');
                const posts = StorageManager.getPosts();
                const target = posts.find(p => p.id === postId);

                if (target) {
                    navigator.clipboard.writeText(target.currentComment).then(() => {
                        window.open(target.url, '_blank');
                        StorageManager.updatePostStatus(postId, 'COMPLETED');
                        showToast('Đã copy comment kèm link của bạn & Mở bài viết! Nhấn Ctrl+V để dán & đăng.', 'success');
                        renderAll();
                        renderScannedResults();
                    }).catch(err => {
                        window.open(target.url, '_blank');
                        showToast('Đã mở bài viết Facebook. Vui lòng copy nội dung comment thủ công.', 'info');
                    });
                }
            });
        });

        document.querySelectorAll('.btn-regen-comment').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const postId = e.currentTarget.getAttribute('data-id');
                StorageManager.regenerateCommentForPost(postId);
                showToast('Đã sinh câu comment biến thể mới kèm link của bạn!', 'info');
                renderAll();
            });
        });

        document.querySelectorAll('.btn-mark-complete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const postId = e.currentTarget.getAttribute('data-id');
                StorageManager.updatePostStatus(postId, 'COMPLETED');
                showToast('Đã đánh dấu hoàn thành bài viết!', 'success');
                renderAll();
                renderScannedResults();
            });
        });

        document.querySelectorAll('.btn-mark-pending').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const postId = e.currentTarget.getAttribute('data-id');
                StorageManager.updatePostStatus(postId, 'PENDING');
                showToast('Đã chuyển bài viết về trạng thái chờ!', 'info');
                renderAll();
                renderScannedResults();
            });
        });
    }

    // --- POSTS TABLE RENDER (TAB 2) ---
    // lastActionAt has been written both as Date.now() and as an ISO string over
    // time, so normalise before comparing. Missing values sort to the bottom.
    function actionTime(post) {
        if (!post || !post.lastActionAt) return 0;
        const t = new Date(post.lastActionAt).getTime();
        return Number.isFinite(t) ? t : 0;
    }

    function getSortedPosts() {
        return StorageManager.getPosts().slice().sort((a, b) => actionTime(b) - actionTime(a));
    }

    function renderPostsTable() {
        const posts = getSortedPosts();
        const pageSize = Math.max(1, parseInt(elements.postsPageSize?.value) || 20);
        const totalPages = Math.max(1, Math.ceil(posts.length / pageSize));

        // Deleting rows or shrinking the page size can leave us past the end
        if (postsPage > totalPages) postsPage = totalPages;
        if (postsPage < 1) postsPage = 1;

        const start = (postsPage - 1) * pageSize;
        const pageItems = posts.slice(start, start + pageSize);

        elements.postsTableBody.innerHTML = '';
        renderPostsPagination(posts.length, totalPages, start, pageItems.length);

        if (posts.length === 0) {
            elements.postsTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center" style="padding:2rem; color:var(--text-muted);">
                        Chưa có bài viết nào trong danh sách. Hãy nhấn "Thêm Link Bài Viết" để tạo.
                    </td>
                </tr>
            `;
            return;
        }

        pageItems.forEach(post => {
            const tr = document.createElement('tr');
            
            const categoryNames = {
                'PHIM_PROMO': 'Điều hướng Link Phim ({link_fb})'
            };

            const formattedDate = post.lastActionAt ? new Date(post.lastActionAt).toLocaleString('vi-VN') : 'Chưa tác vụ';

            tr.innerHTML = `
                <td><input type="checkbox" class="post-checkbox" data-id="${post.id}"></td>
                <td>
                    <a href="${escapeHtml(post.url)}" target="_blank" class="post-link-preview">
                        ${truncateUrl(post.url, 45)}
                    </a>
                </td>
                <td><span class="post-tag-badge">${escapeHtml(post.tag)}</span></td>
                <td>${categoryNames[post.category] || post.category}</td>
                <td><span class="post-status-badge status-${post.status.toLowerCase()}">${post.status}</span></td>
                <td style="font-size:0.8rem; color:var(--text-muted);">${formattedDate}</td>
                <td>
                    <button class="btn btn-outline-danger btn-sm btn-delete-single" data-id="${post.id}">Xóa</button>
                </td>
            `;

            elements.postsTableBody.appendChild(tr);
        });

        // Header checkbox only ever reflects the rows currently on screen
        if (elements.checkAllPosts) elements.checkAllPosts.checked = false;
        updateDeleteSelectedButtonState();
        bindTableEvents();
    }

    function renderPostsPagination(total, totalPages, start, shown) {
        if (elements.postsPageInfo) {
            elements.postsPageInfo.textContent = total === 0
                ? 'Không có bài viết nào'
                : `Hiện ${start + 1}–${start + shown} trên tổng ${total} bài · mới nhất lên đầu`;
        }
        if (elements.postsPageIndicator) {
            elements.postsPageIndicator.textContent = `Trang ${postsPage}/${totalPages}`;
        }
        const atFirst = postsPage <= 1;
        const atLast = postsPage >= totalPages;
        if (elements.btnPostsFirst) elements.btnPostsFirst.disabled = atFirst;
        if (elements.btnPostsPrev) elements.btnPostsPrev.disabled = atFirst;
        if (elements.btnPostsNext) elements.btnPostsNext.disabled = atLast;
        if (elements.btnPostsLast) elements.btnPostsLast.disabled = atLast;
        if (elements.postsPagination) {
            elements.postsPagination.style.display = total === 0 ? 'none' : 'flex';
        }
    }

    function gotoPostsPage(page) {
        postsPage = page;
        renderPostsTable();
    }

    function bindTableEvents() {
        const checkboxes = document.querySelectorAll('.post-checkbox');
        checkboxes.forEach(cb => cb.addEventListener('change', updateDeleteSelectedButtonState));

        document.querySelectorAll('.btn-delete-single').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const postId = e.currentTarget.getAttribute('data-id');
                if (confirm('Bạn có chắc muốn xóa bài viết này khỏi danh sách?')) {
                    StorageManager.deletePosts([postId]);
                    showToast('Đã xóa bài viết khỏi danh sách.', 'info');
                    renderAll();
                    renderScannedResults();
                }
            });
        });
    }

    function updateDeleteSelectedButtonState() {
        const checked = document.querySelectorAll('.post-checkbox:checked');
        elements.btnDeleteSelected.disabled = checked.length === 0;
        elements.btnDeleteSelected.textContent = checked.length > 0 ? `Xóa ${checked.length} bài đã chọn` : 'Xóa bài đã chọn';
    }

    // --- TEMPLATES RENDER (TAB 3) ---
    function renderTemplates() {
        const templates = StorageManager.getTemplates();
        elements.templateList.innerHTML = '';

        templates.forEach(tpl => {
            const item = document.createElement('div');
            item.className = 'variant-item';
            item.style.flexDirection = 'column';
            item.style.alignItems = 'flex-start';
            item.style.gap = '0.4rem';
            item.style.marginBottom = '0.75rem';

            item.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                    <strong style="color:var(--accent-blue);">${escapeHtml(tpl.name)}</strong>
                    <span class="badge badge-pro">${tpl.category}</span>
                </div>
                <div class="code-font" style="font-size:0.82rem; color:var(--text-secondary); background:var(--bg-surface); padding:0.5rem 0.75rem; border-radius:6px; width:100%; word-break:break-all; white-space:pre-line;">
                    ${escapeHtml(tpl.content)}
                </div>
            `;

            elements.templateList.appendChild(item);
        });
    }

    // --- EXTENSION BRIDGE ---
    const EXT_TAG = 'FB_SEEDING_EXT';

    let lastKnownExtReady = null;

    function updateExtensionBanner() {
        // Dashboard cards render their auto-comment button enabled or disabled
        // based on extensionReady, and the extension announces itself after the
        // first render — so re-render the cards whenever readiness flips.
        if (lastKnownExtReady !== extensionReady) {
            lastKnownExtReady = extensionReady;
            renderDashboardCards();
        }

        if (!elements.extStatusBanner) return;
        if (extensionReady) {
            elements.extStatusBanner.innerHTML = `<span style="color:#22c55e;">✅ Extension đã kết nối (v${extensionVersion || '?'}). Có thể Discover Reels + cào Comment thật từ session FB của bạn.</span>`;
            if (elements.btnDiscoverFeed) {
                elements.btnDiscoverFeed.disabled = false;
                elements.btnDiscoverFeed.title = 'Mở tab ẩn feed FB, cào comment thật của từng Reel';
            }
            if (elements.btnStartHunt && !huntRunning) elements.btnStartHunt.disabled = false;
            if (elements.btnCommentAll && !bulkRunning) {
                elements.btnCommentAll.disabled = false;
                elements.btnCommentAll.title = 'Đăng comment tuần tự cho tất cả bài đang chờ';
            }
            if (elements.huntExtNote) {
                elements.huntExtNote.innerHTML = `<span style="color:#22c55e;">✅ Extension đã kết nối (v${extensionVersion || '?'}).</span>`;
            }
        } else {
            elements.extStatusBanner.innerHTML = `Extension chưa phát hiện. Xem <a href="extension/README.md" target="_blank" style="color:var(--accent-blue);">hướng dẫn cài</a> để cào Reels + comment thật từ session FB.`;
            if (elements.btnDiscoverFeed) {
                elements.btnDiscoverFeed.disabled = true;
                elements.btnDiscoverFeed.title = 'Cần cài Chrome Extension trước';
            }
            if (elements.btnStartHunt) elements.btnStartHunt.disabled = true;
            if (elements.btnCommentAll) {
                elements.btnCommentAll.disabled = true;
                elements.btnCommentAll.title = 'Cần cài Chrome Extension trước';
            }
            if (elements.huntExtNote) {
                elements.huntExtNote.textContent = 'Cần cài Chrome Extension và đăng nhập Facebook trên trình duyệt này.';
            }
        }
    }

    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        const msg = e.data;
        if (!msg || msg.source !== EXT_TAG) return;
        if (msg.type === 'EXT_READY' || msg.type === 'PONG') {
            extensionReady = true;
            extensionVersion = msg.version;
            updateExtensionBanner();
        }
    });

    // Client-side intent matcher — mirrors server's parse_intent_comments.
    function normalizeText(str) {
        return (str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .trim();
    }
    function matchIntent(comments, keywords) {
        const kws = (keywords && keywords.length ? keywords : intentKeywords).map(normalizeText);
        const matched = [];
        (comments || []).forEach(c => {
            const nc = normalizeText(c);
            if (kws.some(k => k && nc.includes(k))) matched.push(c.trim());
        });
        return matched;
    }

    function scrapeIdFromRequest() {
        return `req_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    }

    // --- AUTO COMMENT (one click = one comment) ---
    // Nothing is posted without a deliberate click on this button: the click is
    // the authorisation for that one comment. Rate is whatever the user's own
    // clicking pace is, which is what keeps it from looking like a bot run.
    const COMMENT_ERROR_TEXT = {
        no_comment_panel: 'Không mở được ô bình luận — Reel có thể đã tắt bình luận.',
        no_composer: 'Không tìm thấy ô soạn bình luận trên trang.',
        insert_failed: 'Không gõ được nội dung vào ô bình luận.',
        insert_partial: 'Nội dung vào ô không đầy đủ nên đã hủy, tránh đăng thiếu.',
        url_drifted: 'Facebook nhảy sang Reel khác nên đã hủy, tránh comment nhầm bài.',
        submit_failed: 'Đã điền nội dung nhưng Facebook không nhận. Tab đang mở để bạn bấm gửi thủ công.',
        timeout: 'Quá thời gian chờ. Tab đang mở để bạn kiểm tra.',
        tab_create_failed: 'Không mở được tab Facebook.',
        empty_text: 'Comment đang trống — hãy tạo nội dung trước.',
        blocked: 'Facebook CHẶN vì nghi spam (giới hạn tần suất). Nghỉ một lúc rồi hãy chạy lại.',
        not_visible: 'Đã gửi nhưng bình luận KHÔNG xuất hiện — Facebook có thể đã bỏ âm thầm. Tab đang mở để bạn kiểm tra.',
        comment_vanished: 'Bình luận hiện ra rồi bị Facebook rút lại — coi như chưa đăng.',
    };

    // Sends one comment request to the extension and resolves with its result.
    // Shared by the per-card button and the sequential "Comment Tất Cả" run.
    function requestCommentPost(post, behaviour = {}) {
        const requestId = scrapeIdFromRequest();
        const done = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Quá thời gian chờ extension.')), 150000);
            const listener = (e) => {
                if (e.source !== window) return;
                const msg = e.data;
                if (!msg || msg.source !== EXT_TAG || msg.requestId !== requestId) return;
                if (msg.type === 'COMMENT_DONE') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', listener);
                    resolve(msg.response);
                } else if (msg.type === 'COMMENT_ERROR') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', listener);
                    reject(new Error(msg.error));
                }
            };
            window.addEventListener('message', listener);
        });

        window.postMessage({
            source: EXT_TAG, type: 'POST_COMMENT', requestId,
            url: post.url, text: post.currentComment, behaviour,
        }, '*');

        return done;
    }

    async function autoCommentOnPost(postId, btnEl) {
        if (!extensionReady) {
            showToast('Cần cài Chrome Extension để tự động comment. Xem tab Cài đặt.', 'warning');
            return;
        }
        if (bulkRunning) {
            showToast('Đang chạy "Comment Tất Cả" — hãy dừng trước khi đăng lẻ.', 'warning');
            return;
        }
        const post = StorageManager.getPosts().find(p => p.id === postId);
        if (!post) return;
        if (!post.currentComment || !post.currentComment.trim()) {
            showToast('Bài này chưa có nội dung comment. Bấm nút đổi biến thể để sinh nội dung.', 'warning');
            return;
        }

        const originalHtml = btnEl ? btnEl.innerHTML : null;
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = '<span>Đang đăng...</span>';
        }
        showToast('Đang mở bài và đăng comment...', 'info');

        const done = requestCommentPost(post);

        try {
            const res = await done;
            if (res?.ok) {
                StorageManager.updatePostStatus(postId, 'COMPLETED');
                showToast('Đã đăng comment thành công!', 'success');
                renderAll();
            } else {
                const why = COMMENT_ERROR_TEXT[res?.error] || res?.hint || res?.error || 'Không rõ nguyên nhân';
                showToast(`Chưa đăng được: ${why}`, 'warning');
                // Status stays PENDING so the post is not silently lost
                if (btnEl) {
                    btnEl.disabled = false;
                    btnEl.innerHTML = originalHtml;
                }
            }
        } catch (err) {
            console.error(err);
            showToast(`Lỗi khi đăng comment: ${err.message}`, 'warning');
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML = originalHtml;
            }
        }
    }

    // --- BULK SEQUENTIAL AUTO COMMENT ---
    // Strictly one comment at a time with a random gap in between. Never two
    // tabs at once: simultaneous timestamps across different posts are the
    // clearest bot signal there is.

    function setBulkRunning(running) {
        bulkRunning = running;
        if (elements.btnCommentAll) {
            elements.btnCommentAll.disabled = running || !extensionReady;
            elements.btnCommentAll.innerHTML = running
                ? '<span>Đang chạy...</span>'
                : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"></path></svg><span>Comment Tất Cả</span>';
        }
        if (elements.btnStopCommentAll) elements.btnStopCommentAll.disabled = !running;
        [
            elements.bulkDelayMin, elements.bulkDelayMax,
            elements.bulkDwellMin, elements.bulkDwellMax,
            elements.bulkLikeChance, elements.bulkBreakEvery,
            elements.bulkBreakMin, elements.bulkBreakMax,
        ].forEach(el => { if (el) el.disabled = running; });
    }

    function setBulkStatus(html) {
        if (elements.bulkStatus) elements.bulkStatus.innerHTML = html;
    }

    // Human gaps are heavy-tailed: mostly short, with the occasional long pause.
    // A flat uniform draw between two bounds is itself a recognisable signature,
    // so skew toward the low end and sometimes stretch well past the maximum.
    function nextGapMs(minS, maxS) {
        const skewed = minS + (maxS - minS) * Math.pow(Math.random(), 1.8);
        const stretched = Math.random() < 0.15 ? skewed * (2 + Math.random() * 2) : skewed;
        return stretched * 1000;
    }

    function readBulkSettings() {
        let minS = Math.max(5, parseInt(elements.bulkDelayMin?.value) || 30);
        let maxS = Math.max(5, parseInt(elements.bulkDelayMax?.value) || 90);
        if (minS > maxS) { const t = minS; minS = maxS; maxS = t; }

        let dwellMinS = Math.max(0, parseInt(elements.bulkDwellMin?.value) || 0);
        let dwellMaxS = Math.max(0, parseInt(elements.bulkDwellMax?.value) || 0);
        if (dwellMinS > dwellMaxS) { const t = dwellMinS; dwellMinS = dwellMaxS; dwellMaxS = t; }

        let breakMinM = Math.max(1, parseInt(elements.bulkBreakMin?.value) || 8);
        let breakMaxM = Math.max(1, parseInt(elements.bulkBreakMax?.value) || 20);
        if (breakMinM > breakMaxM) { const t = breakMinM; breakMinM = breakMaxM; breakMaxM = t; }

        return {
            minS, maxS, dwellMinS, dwellMaxS, breakMinM, breakMaxM,
            likeChance: Math.min(100, Math.max(0, parseInt(elements.bulkLikeChance?.value) || 0)) / 100,
            breakEvery: Math.max(0, parseInt(elements.bulkBreakEvery?.value) || 0),
        };
    }

    function formatMMSS(ms) {
        const total = Math.max(0, Math.ceil(ms / 1000));
        const m = String(Math.floor(total / 60)).padStart(2, '0');
        const s = String(total % 60).padStart(2, '0');
        return `${m}:${s}`;
    }

    // Abortable countdown that repaints the remaining time every second.
    function waitWithCountdown(ms, label) {
        return new Promise((resolve) => {
            const endAt = Date.now() + ms;
            const tick = () => {
                if (bulkAbort) {
                    clearInterval(timer);
                    resolve('aborted');
                    return;
                }
                const left = endAt - Date.now();
                if (left <= 0) {
                    clearInterval(timer);
                    resolve('done');
                    return;
                }
                setBulkStatus(`${label} · <strong style="color:var(--accent-blue); font-size:1.05rem;">${formatMMSS(left)}</strong> nữa`);
            };
            const timer = setInterval(tick, 250);
            tick();
        });
    }

    async function commentAllSequentially() {
        if (!extensionReady) {
            showToast('Cần cài Chrome Extension trước. Xem tab Cài đặt.', 'warning');
            return;
        }
        if (bulkRunning) return;

        const cfg = readBulkSettings();
        const queue = StorageManager.getPosts()
            .filter(p => p.status === 'PENDING' && p.currentComment && p.currentComment.trim());

        if (queue.length === 0) {
            showToast('Không có bài nào đang chờ comment.', 'info');
            return;
        }

        bulkAbort = false;
        setBulkRunning(true);
        let posted = 0, failed = 0, consecutiveFailures = 0, likedCount = 0;
        let sinceBreak = 0;
        // Randomise the burst length too, so breaks don't land on a fixed cadence
        let burstTarget = cfg.breakEvery > 0
            ? Math.max(1, cfg.breakEvery + Math.floor(Math.random() * 3) - 1)
            : 0;

        showToast(`Bắt đầu đăng tuần tự ${queue.length} bài, cách nhau ${cfg.minS}-${cfg.maxS}s.`, 'info');

        for (let i = 0; i < queue.length; i++) {
            if (bulkAbort) break;
            const post = queue[i];
            const pos = `Bài ${i + 1}/${queue.length}`;

            const dwellMs = cfg.dwellMaxS > 0
                ? (cfg.dwellMinS + Math.random() * (cfg.dwellMaxS - cfg.dwellMinS)) * 1000
                : 0;

            setBulkStatus(
                `${pos} · <span style="color:var(--accent-blue);">${dwellMs > 0 ? `đang xem reel ~${Math.round(dwellMs / 1000)}s rồi comment...` : 'đang mở bài và đăng comment...'}</span>` +
                ` · ✅ ${posted} · ✗ ${failed}${likedCount ? ` · 👍 ${likedCount}` : ''}`
            );

            let res;
            try {
                res = await requestCommentPost(post, { dwellMs, likeChance: cfg.likeChance });
            } catch (err) {
                res = { ok: false, error: 'exception', hint: err.message };
            }
            if (res?.liked) likedCount++;

            if (res?.ok) {
                StorageManager.updatePostStatus(post.id, 'COMPLETED');
                posted++;
                consecutiveFailures = 0;
            } else {
                failed++;
                consecutiveFailures++;
                const why = COMMENT_ERROR_TEXT[res?.error] || res?.hint || res?.error || 'không rõ';
                showToast(`${pos} chưa đăng được: ${why}`, 'warning');
            }
            renderAll();

            // Facebook nói thẳng là đang chặn thì dừng NGAY, không cố thêm 2 bài
            // nữa cho đủ 3 lần thất bại — mỗi lần cố thêm chỉ làm bị chặn nặng hơn.
            if (res?.error === 'blocked') {
                const detail = res.blockText ? ` Facebook nói: "${escapeHtml(res.blockText)}".` : '';
                setBulkStatus(
                    `<span style="color:var(--accent-red);">🛑 ĐÃ DỪNG — Facebook chặn vì nghi spam.${detail}` +
                    ` Đã đăng ${posted}, lỗi ${failed}. Nghỉ 30-60 phút rồi hãy chạy lại,` +
                    ` và giãn delay giữa các comment ra.</span>`
                );
                showToast('Facebook chặn vì nghi spam — đã dừng toàn bộ. Nghỉ 30-60 phút rồi chạy lại.', 'warning');
                setBulkRunning(false);
                return;
            }

            // Stop early rather than hammering a wall — repeated failures usually
            // mean Facebook is blocking, and pushing on makes that worse.
            if (consecutiveFailures >= 3) {
                setBulkStatus(`<span style="color:var(--accent-red);">Đã dừng: 3 bài liên tiếp thất bại — có thể Facebook đang chặn. Đã đăng ${posted}, lỗi ${failed}.</span>`);
                showToast('Dừng tự động vì 3 bài liên tiếp thất bại. Kiểm tra lại tài khoản trước khi chạy tiếp.', 'warning');
                setBulkRunning(false);
                return;
            }

            if (bulkAbort) break;
            sinceBreak++;

            // Gap before the next one (nothing to wait for after the last)
            if (i < queue.length - 1) {
                const tally = `✅ ${posted} · ✗ ${failed}${likedCount ? ` · 👍 ${likedCount}` : ''}`;
                let waitMs, label;

                if (burstTarget > 0 && sinceBreak >= burstTarget) {
                    // Long break between bursts — the shape of a real session
                    waitMs = (cfg.breakMinM + Math.random() * (cfg.breakMaxM - cfg.breakMinM)) * 60000;
                    label = `${tally} · <span style="color:var(--accent-blue);">nghỉ dài sau ${sinceBreak} bài</span> · tiếp tục sau`;
                    sinceBreak = 0;
                    burstTarget = Math.max(1, cfg.breakEvery + Math.floor(Math.random() * 3) - 1);
                } else {
                    waitMs = nextGapMs(cfg.minS, cfg.maxS);
                    label = `${pos} xong · ${tally} · chờ bài ${i + 2}/${queue.length} sau`;
                }

                const outcome = await waitWithCountdown(waitMs, label);
                if (outcome === 'aborted') break;
            }
        }

        const stopped = bulkAbort;
        setBulkStatus(
            `<strong>${stopped ? 'Đã dừng' : 'Hoàn tất'}:</strong> đăng thành công ${posted}, thất bại ${failed} / ${queue.length} bài` +
            `${likedCount ? `, đã like ${likedCount} reel` : ''}.`
        );
        showToast(`${stopped ? 'Đã dừng' : 'Xong'}: đăng ${posted}, lỗi ${failed}.`, stopped ? 'info' : 'success');
        setBulkRunning(false);
        renderAll();
    }

    function stopCommentAll() {
        if (!bulkRunning) return;
        bulkAbort = true;
        setBulkStatus('Đang dừng... chờ bài hiện tại kết thúc.');
        showToast('Đã yêu cầu dừng. Các bài đã đăng vẫn được giữ.', 'info');
    }

    // --- REEL HUNTER ---
    // Walks FB Reels one at a time via the extension, keeping only reels whose
    // comments clear the intent threshold, until the target count is reached.

    function renderHuntProgress(text) {
        if (elements.huntProgress) elements.huntProgress.innerHTML = text;
    }

    function setHuntRunning(running) {
        huntRunning = running;
        if (elements.btnStartHunt) {
            elements.btnStartHunt.disabled = running || !extensionReady;
            elements.btnStartHunt.innerHTML = running
                ? '<span>🎯 Đang săn...</span>'
                : '<span>🎯 Bắt Đầu Săn Reels</span>';
        }
        if (elements.btnStopHunt) elements.btnStopHunt.disabled = !running;
    }

    function renderHuntResults() {
        if (!elements.huntResultsContainer) return;
        elements.huntResultsContainer.innerHTML = '';

        const existingUrls = new Set(StorageManager.getPosts().map(p => p.url));
        const fresh = huntedItems.filter(i => !existingUrls.has(i.url));
        if (elements.btnImportHunted) elements.btnImportHunted.disabled = fresh.length === 0;

        if (huntedItems.length === 0) {
            elements.huntResultsContainer.innerHTML = `
                <div class="empty-state" style="padding:2rem 1rem;">
                    <p>Chưa có Reels đạt chuẩn. Nhấn "🎯 Bắt Đầu Săn Reels" để bắt đầu.</p>
                </div>`;
            return;
        }

        huntedItems.forEach((item, index) => {
            const isAlreadyAdded = existingUrls.has(item.url);
            const box = document.createElement('div');
            box.className = 'variant-item';
            box.style.cssText = 'flex-direction:column; align-items:flex-start; gap:0.5rem; padding:1rem; margin-bottom:0.75rem;';
            box.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center; gap:0.4rem;">
                    <a href="${escapeHtml(item.url)}" target="_blank" class="post-link-preview">${truncateUrl(item.url, 42)}</a>
                    <div style="display:flex; gap:0.4rem; align-items:center;">
                        ${isAlreadyAdded ? '<span class="post-status-badge status-completed" style="font-size:0.72rem;">✓ Đã có</span>' : ''}
                        <span class="post-tag-badge" style="background:rgba(239,68,68,0.15); color:var(--accent-red); font-weight:700;">🔥 ${item.intentCount} comment hỏi</span>
                    </div>
                </div>
                <div style="font-size:0.82rem; color:var(--text-secondary); background:var(--bg-surface); padding:0.6rem 0.85rem; border-radius:6px; width:100%;">
                    <strong>Comment hỏi link / hỏi tập (thật):</strong>
                    <ul style="margin:0.4rem 0 0 1.2rem; padding:0;">
                        ${item.intentComments.slice(0, 12).map(c => `<li><code>${escapeHtml(c)}</code></li>`).join('')}
                    </ul>
                    <div style="margin-top:0.4rem; color:var(--text-muted); font-size:0.75rem;">Đã đọc ${item.commentCount || 0} comment · khớp ${item.intentCount}</div>
                </div>
                ${isAlreadyAdded
                    ? `<button class="btn btn-secondary btn-sm" disabled style="opacity:0.6;">✓ Đã trong Bảng Seeding</button>`
                    : `<button class="btn btn-secondary btn-sm btn-import-single-hunt" data-index="${index}">+ Đẩy bài này vào Bảng Seeding</button>`}
            `;
            elements.huntResultsContainer.appendChild(box);
        });

        elements.huntResultsContainer.querySelectorAll('.btn-import-single-hunt').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = huntedItems[parseInt(e.currentTarget.getAttribute('data-index'))];
                if (!item) return;
                StorageManager.addBulkPosts([item.url], 'PHIM_PROMO', `Săn Reels (🔥 ${item.intentCount} hỏi)`);
                showToast('Đã đẩy Reel này vào Bảng Seeding!', 'success');
                renderAll();
                renderHuntResults();
            });
        });
    }

    async function startHunt() {
        if (!extensionReady) {
            showToast('Chưa cài extension. Xem tab Cài đặt để làm theo.', 'warning');
            return;
        }
        if (huntRunning) return;

        const targetCount = Math.max(1, parseInt(elements.huntTargetCount?.value) || 10);
        const minIntent = Math.max(1, parseInt(elements.huntMinIntent?.value) || 2);
        const maxChecks = Math.max(5, parseInt(elements.huntMaxChecks?.value) || 120);
        const skipExisting = elements.huntSkipExisting ? elements.huntSkipExisting.checked : true;
        const searchKeywords = (elements.scanKeywordInput?.value || '')
            .split(',').map(k => k.trim()).filter(Boolean);
        const excludeUrls = skipExisting ? StorageManager.getPosts().map(p => p.url) : [];

        huntedItems = [];
        renderHuntResults();
        setHuntRunning(true);
        renderHuntProgress(`Đang khởi động... Mục tiêu ${targetCount} Reels đạt chuẩn (≥${minIntent} comment hỏi), kiểm tối đa ${maxChecks} Reels.`);

        const requestId = scrapeIdFromRequest();
        // There is no time limit any more — maxChecks bounds the run. This is
        // only a watchdog for a silently dead extension, so it has to sit well
        // past the worst case (every reel timing out at ~45s, plus replenishes).
        const watchdogMs = maxChecks * 60000 + 10 * 60000;
        const done = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('hunt_timeout')), watchdogMs);
            const listener = (e) => {
                if (e.source !== window) return;
                const msg = e.data;
                if (!msg || msg.source !== EXT_TAG) return;

                if (msg.type === 'HUNT_PROGRESS') {
                    const parts = [
                        `<strong>Đã kiểm ${msg.checked || 0} Reels</strong>`,
                        `<span style="color:#22c55e;">${msg.qualifiedCount || 0}/${targetCount} đạt chuẩn</span>`,
                    ];
                    if (msg.phase === 'replenish') {
                        parts.push(`<span style="color:var(--text-muted);">đang lấy thêm Reels từ ${escapeHtml(String(msg.sourceUrl || '').replace('https://www.facebook.com', ''))}</span>`);
                    } else if (msg.phase === 'reload') {
                        const how = msg.how === 'fresh-tab' ? 'mở tab mới' : 'điều hướng lại';
                        parts.push(`<span style="color:var(--accent-red);">trang bị treo — ${how} (${msg.attempt || 1}/2): ${escapeHtml(String(msg.sourceUrl || '').replace('https://www.facebook.com', ''))}</span>`);
                    } else if (msg.phase === 'checked') {
                        parts.push(`<span style="color:var(--text-muted);">Reel vừa xong: ${msg.lastCommentCount || 0} comment, ${msg.lastIntentCount || 0} khớp ${msg.lastPassed ? '✅' : '✗'}</span>`);
                    } else if (msg.phase === 'checking') {
                        parts.push(`<span style="color:var(--text-muted);">đang đọc comment...</span>`);
                    }
                    renderHuntProgress(parts.join(' · '));
                    return;
                }

                if (msg.requestId !== requestId) return;
                if (msg.type === 'HUNT_DONE') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', listener);
                    resolve(msg.response);
                } else if (msg.type === 'HUNT_ERROR') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', listener);
                    reject(new Error(msg.error));
                }
            };
            window.addEventListener('message', listener);
        });

        window.postMessage({
            source: EXT_TAG, type: 'HUNT_REELS', requestId,
            opts: { targetCount, minIntent, intentKeywords, searchKeywords, maxChecks, excludeUrls },
        }, '*');

        try {
            const response = await done;
            huntedItems = (response?.reels || []).filter(r => r && r.url);
            const reasons = {
                target_reached: 'đã gom đủ mục tiêu',
                max_checks: `đã kiểm hết giới hạn ${maxChecks} Reels`,
                stopped: 'bạn đã bấm dừng',
                sources_exhausted: 'các trang nguồn không cuộn thêm được (Facebook có thể đang giới hạn, thử lại sau ít phút)',
            };
            const why = reasons[response?.stopReason] || response?.stopReason || '';
            renderHuntProgress(`<strong>Xong:</strong> ${huntedItems.length}/${targetCount} Reels đạt chuẩn sau khi kiểm ${response?.checked || 0} Reels — ${why}.`);
            showToast(`Săn xong: ${huntedItems.length} Reels đạt chuẩn (kiểm ${response?.checked || 0} bài).`, 'success');
            renderHuntResults();
        } catch (err) {
            console.error(err);
            renderHuntProgress(`<span style="color:var(--accent-red);">Lỗi: ${escapeHtml(err.message)}</span>`);
            showToast(`Săn Reels lỗi: ${err.message}`, 'warning');
        } finally {
            setHuntRunning(false);
        }
    }

    function stopHunt() {
        if (!huntRunning) return;
        window.postMessage({ source: EXT_TAG, type: 'HUNT_ABORT' }, '*');
        renderHuntProgress('Đang dừng... chờ Reel hiện tại xong.');
        showToast('Đã yêu cầu dừng. Kết quả đã gom vẫn được giữ.', 'info');
    }

    // Ask extension to open FB feed in a hidden tab, scroll, and return
    // every Reel URL discovered. Merges into scannedItems (dedup vs Bảng
    // Seeding and against URLs already scanned).
    async function discoverReelsViaExtension() {
        if (!extensionReady) {
            showToast('Chưa cài extension. Xem extension/README.md.', 'warning');
            return;
        }
        // Total budget for the extension: ~22s walking the feed to harvest a
        // URL queue, then background navigates tabs through that queue.
        const durationMs = 210000; // 3.5 min → typically 20-35 reels
        const keywords = (elements.scanKeywordInput?.value || '')
            .split(',').map(k => k.trim()).filter(Boolean);
        const requestId = scrapeIdFromRequest();
        elements.btnDiscoverFeed.disabled = true;
        elements.btnDiscoverFeed.innerHTML = `<span>🚀 Đang cào feed FB (~${durationMs/1000}s)...</span>`;
        showToast(`Extension mở tab ẩn: thu thập Reels từ feed Watch${keywords.length ? ` + tìm kiếm "${keywords.join('", "')}"` : ''}, rồi cào comment thật từng Reel. Chạy ~${durationMs/1000}s. Đảm bảo đã login FB.`, 'info');

        const done = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('discover_timeout')), durationMs + 90000);
            const listener = (e) => {
                if (e.source !== window) return;
                const msg = e.data;
                if (!msg || msg.source !== EXT_TAG || msg.requestId !== requestId) return;
                if (msg.type === 'DISCOVER_RESULT') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', listener);
                    resolve(msg.response);
                } else if (msg.type === 'DISCOVER_ERROR') {
                    clearTimeout(timeout);
                    window.removeEventListener('message', listener);
                    reject(new Error(msg.error));
                }
            };
            window.addEventListener('message', listener);
        });

        window.postMessage({ source: EXT_TAG, type: 'DISCOVER_REELS', requestId, durationMs, keywords }, '*');

        try {
            const response = await done;
            // New payload: reels = [{url, comments}]. Legacy: reels = [url strings].
            const raw = response?.reels || response?.urls || [];
            const reelObjs = raw.map(x => (typeof x === 'string') ? { url: x, comments: [] } : x)
                                .filter(r => r && typeof r.url === 'string' && r.url.startsWith('http'));

            const existingPosts = StorageManager.getPosts();
            const existingSet = new Set([
                ...existingPosts.map(p => p.url),
                ...scannedItems.map(i => i.url),
            ]);
            let added = 0;
            let totalIntent = 0;
            reelObjs.forEach(({ url, comments }) => {
                if (existingSet.has(url)) return;
                const matched = matchIntent(comments || [], intentKeywords);
                totalIntent += matched.length;
                scannedItems.push({
                    url,
                    tag: 'Feed FB + Comment thật',
                    intentCount: matched.length,
                    intentComments: matched.length ? matched : (comments || []).slice(0, 5),
                    commentCount: (comments || []).length,
                    source: 'fb_feed_scraped',
                });
                existingSet.add(url);
                added++;
            });
            showToast(`Xong: ${reelObjs.length} Reel + comment thật. Thêm mới ${added} bài, ${totalIntent} comment intent phát hiện.`, 'success');
            renderScannedResults();
        } catch (err) {
            console.error(err);
            showToast(`Discover lỗi: ${err.message}. Đảm bảo bạn đang login Facebook trên trình duyệt này.`, 'warning');
        } finally {
            elements.btnDiscoverFeed.disabled = false;
            elements.btnDiscoverFeed.innerHTML = '<span>🚀 Discover + Cào Comment</span>';
        }
    }

    function getMinIntent() {
        return Math.max(0, parseInt(elements.minIntentCount?.value) || 0);
    }

    function renderScannedResults() {
        // Refresh Discover button state — depends on extension + scannedItems
        if (typeof updateExtensionBanner === 'function') updateExtensionBanner();

        elements.scannedResultsContainer.innerHTML = '';

        const existingPosts = StorageManager.getPosts();
        const existingUrls = new Set(existingPosts.map(p => p.url));
        const shouldHideCommented = elements.chkHideCommented ? elements.chkHideCommented.checked : true;
        const minIntent = getMinIntent();

        // Filtering happens entirely client-side now (no backend involved).
        let displayItems = scannedItems.filter(item => (item.intentCount || 0) >= minIntent);
        const belowThreshold = scannedItems.length - displayItems.length;
        const beforeHide = displayItems.length;

        if (shouldHideCommented) {
            displayItems = displayItems.filter(item => !existingUrls.has(item.url));
        }
        const hiddenAsDuplicate = beforeHide - displayItems.length;

        // Always explain the funnel — otherwise "scraped 12, shows 1" looks broken.
        if (scannedItems.length > 0) {
            const summary = document.createElement('div');
            summary.style.cssText = 'padding:0.6rem 0.85rem; margin-bottom:0.85rem; background:var(--bg-surface); border-radius:8px; font-size:0.82rem; color:var(--text-secondary); line-height:1.6;';
            summary.innerHTML = `
                <strong>Đã quét ${scannedItems.length} Reels</strong> ·
                <span style="color:#22c55e;">${displayItems.length} hiện ra</span> ·
                <span style="color:var(--text-muted);">${belowThreshold} dưới ngưỡng ${minIntent} người hỏi</span>
                ${hiddenAsDuplicate > 0 ? ` · <span style="color:var(--text-muted);">${hiddenAsDuplicate} đã có trong Bảng Seeding</span>` : ''}
                ${belowThreshold > 0 ? `<br><span style="color:var(--text-muted);">Đặt "Số người comment hỏi tối thiểu" về 0 để xem hết và kiểm tra comment đã đọc được.</span>` : ''}
            `;
            elements.scannedResultsContainer.appendChild(summary);
        }

        if (displayItems.length === 0) {
            let msg;
            if (scannedItems.length === 0) {
                msg = 'Nhấn "🚀 Discover + Cào Comment" để extension đi qua feed Reels của bạn và cào comment thật.';
            } else if (belowThreshold === scannedItems.length) {
                msg = `Đã quét ${scannedItems.length} Reels nhưng không bài nào đạt mốc ${minIntent} người comment hỏi. Thử giảm số tối thiểu xuống.`;
            } else {
                msg = 'Tất cả các bài Reels đạt tiêu chí đều đã có trong Bảng Seeding của bạn (Đã ẩn trùng).';
            }
            // Append (not innerHTML=) so the summary above stays visible
            elements.scannedResultsContainer.insertAdjacentHTML('beforeend',
                `<div class="empty-state" style="padding:2rem 1rem;"><p>${msg}</p></div>`);
            elements.btnImportScannedAll.disabled = true;
            return;
        }

        elements.btnImportScannedAll.disabled = false;

        displayItems.forEach((item, index) => {
            const isAlreadyAdded = existingUrls.has(item.url);
            const box = document.createElement('div');
            box.className = 'variant-item';
            box.style.flexDirection = 'column';
            box.style.alignItems = 'flex-start';
            box.style.gap = '0.5rem';
            box.style.padding = '1rem';
            box.style.marginBottom = '0.75rem';

            box.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                    <a href="${escapeHtml(item.url)}" target="_blank" class="post-link-preview">
                        ${truncateUrl(item.url, 45)}
                    </a>
                    <div style="display:flex; gap:0.4rem; align-items:center;">
                        ${isAlreadyAdded ? '<span class="post-status-badge status-completed" style="font-size:0.75rem;">✓ Đã có trong Bảng Seeding</span>' : ''}
                        ${item.source === 'fb_feed_scraped' ? '<span class="post-tag-badge" style="background:rgba(34,197,94,0.2); color:#22c55e; font-size:0.7rem;">🚀 Feed + Comment thật</span>' : ''}
                        <span class="post-tag-badge" style="background:rgba(239, 68, 68, 0.15); color:var(--accent-red); font-weight:700;">🔥 ${item.intentCount} người comment hỏi</span>
                    </div>
                </div>
                <div style="font-size:0.82rem; color:var(--text-secondary); background:var(--bg-surface); padding:0.6rem 0.85rem; border-radius:6px; width:100%;">
                    <strong>${item.intentCount > 0
                        ? 'Các comment bình luận THẬT của người xem:'
                        : `Không comment nào khớp từ khóa. ${item.commentCount || 0} comment đã đọc, xem thử vài cái:`}</strong>
                    <ul style="margin:0.4rem 0 0 1.2rem; padding:0;">
                        ${item.intentComments.map(c => `<li><code>${escapeHtml(c)}</code></li>`).join('')}
                    </ul>
                    ${typeof item.commentCount === 'number'
                        ? `<div style="margin-top:0.4rem; color:var(--text-muted); font-size:0.75rem;">Đã đọc ${item.commentCount} comment · khớp ${item.intentCount}</div>`
                        : ''}
                </div>
                ${isAlreadyAdded 
                    ? `<button class="btn btn-secondary btn-sm" disabled style="opacity:0.6;">✓ Đã trong Bảng Seeding</button>`
                    : `<button class="btn btn-secondary btn-sm btn-import-single-scan" data-index="${index}">+ Đẩy bài này vào Bảng Seeding</button>`
                }
            `;

            elements.scannedResultsContainer.appendChild(box);
        });

        document.querySelectorAll('.btn-import-single-scan').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                const item = displayItems[idx];
                if (item) {
                    StorageManager.addBulkPosts([item.url], 'PHIM_PROMO', `${item.tag} (🔥 ${item.intentCount} hỏi)`);
                    showToast('Đã đẩy bài Reels này vào Bảng Seeding!', 'success');
                    renderAll();
                    renderScannedResults();
                }
            });
        });
    }

    // --- EVENT BINDINGS ---
    function bindEvents() {
        // Tab switching
        elements.navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const targetTab = e.currentTarget.getAttribute('data-tab');
                switchTab(targetTab);
            });
        });

        // Toggle Hide Commented Checkbox
        if (elements.chkHideCommented) {
            elements.chkHideCommented.addEventListener('change', () => {
                renderScannedResults();
            });
        }

        // Intent Keywords Add/Remove
        if (elements.btnAddIntentKeyword) {
            const addKeyword = () => {
                const val = elements.inputNewIntentKeyword.value.trim().toLowerCase();
                if (val && !intentKeywords.includes(val)) {
                    intentKeywords.push(val);
                    saveIntentKeywords(intentKeywords);
                    elements.inputNewIntentKeyword.value = '';
                    showToast(`Đã thêm từ khóa nhu cầu mới: "${val}"`, 'success');
                }
            };

            elements.btnAddIntentKeyword.addEventListener('click', addKeyword);
            elements.inputNewIntentKeyword.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addKeyword();
                }
            });
        }

        // Modals
        elements.btnOpenAddModal.addEventListener('click', () => {
            elements.modalAddPosts.classList.add('show');
        });

        const closeModal = () => elements.modalAddPosts.classList.remove('show');
        elements.btnCloseAddModal.addEventListener('click', closeModal);
        elements.btnCancelAddModal.addEventListener('click', closeModal);

        // Bulk Add Posts
        elements.btnSavePosts.addEventListener('click', () => {
            const text = elements.bulkLinksInput.value;
            const urls = text.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
            const category = elements.postCategorySelect.value;
            const tag = elements.postTagInput.value;

            if (urls.length === 0) {
                showToast('Vui lòng nhập ít nhất 1 link bài viết Facebook người khác hợp lệ (bắt đầu bằng http)!', 'warning');
                return;
            }

            const count = StorageManager.addBulkPosts(urls, category, tag);
            elements.bulkLinksInput.value = '';
            elements.postTagInput.value = '';
            closeModal();

            showToast(`Đã thêm thành công ${count} bài viết mục tiêu vào danh sách!`, 'success');
            renderAll();
            renderScannedResults();
        });

        // Bulk sequential auto-comment
        if (elements.btnCommentAll) elements.btnCommentAll.addEventListener('click', commentAllSequentially);
        if (elements.btnStopCommentAll) elements.btnStopCommentAll.addEventListener('click', stopCommentAll);

        // Search & Filters
        elements.searchDashboard.addEventListener('input', renderDashboardCards);
        elements.filterCategory.addEventListener('change', renderDashboardCards);
        elements.filterStatus.addEventListener('change', renderDashboardCards);

        // Tab 5 Scanner Events
        if (elements.btnDiscoverFeed) {
            elements.btnDiscoverFeed.addEventListener('click', discoverReelsViaExtension);
        }
        // Min-intent threshold now filters the list live, client-side
        if (elements.minIntentCount) {
            elements.minIntentCount.addEventListener('input', renderScannedResults);
        }

        // Reel Hunter tab
        if (elements.btnStartHunt) elements.btnStartHunt.addEventListener('click', startHunt);
        if (elements.btnStopHunt) elements.btnStopHunt.addEventListener('click', stopHunt);
        if (elements.btnImportHunted) {
            elements.btnImportHunted.addEventListener('click', () => {
                const existingUrls = new Set(StorageManager.getPosts().map(p => p.url));
                const fresh = huntedItems.filter(i => !existingUrls.has(i.url));
                if (fresh.length === 0) return;
                StorageManager.addBulkPosts(fresh.map(i => i.url), 'PHIM_PROMO', 'Săn Reels 🎯');
                showToast(`Đã đẩy ${fresh.length} Reels đạt chuẩn vào Bảng Seeding!`, 'success');
                renderAll();
                renderHuntResults();
                switchTab('dashboard-tab');
            });
        }
        // Extension might inject before or after our listener — ping proactively
        setTimeout(() => {
            window.postMessage({ source: EXT_TAG, type: 'PING', requestId: 'init' }, '*');
        }, 500);
        updateExtensionBanner();
        elements.btnImportScannedAll.addEventListener('click', () => {
            const existingPosts = StorageManager.getPosts();
            const existingUrls = new Set(existingPosts.map(p => p.url));
            const minIntent = getMinIntent();
            // Only import what's actually shown (respects the min-intent filter)
            const unhandledItems = scannedItems.filter(item =>
                (item.intentCount || 0) >= minIntent && !existingUrls.has(item.url)
            );

            if (unhandledItems.length === 0) return;
            const urls = unhandledItems.map(i => i.url);
            StorageManager.addBulkPosts(urls, 'PHIM_PROMO', 'Reels Tiềm Năng 🔥');
            showToast(`Đã đẩy tất cả ${urls.length} bài Reels tiềm năng mới vào Bảng Seeding!`, 'success');
            renderAll();
            renderScannedResults();
            switchTab('dashboard-tab');
        });

        // Posts table pagination
        if (elements.postsPageSize) {
            elements.postsPageSize.addEventListener('change', () => gotoPostsPage(1));
        }
        if (elements.btnPostsFirst) elements.btnPostsFirst.addEventListener('click', () => gotoPostsPage(1));
        if (elements.btnPostsPrev) elements.btnPostsPrev.addEventListener('click', () => gotoPostsPage(postsPage - 1));
        if (elements.btnPostsNext) elements.btnPostsNext.addEventListener('click', () => gotoPostsPage(postsPage + 1));
        if (elements.btnPostsLast) {
            elements.btnPostsLast.addEventListener('click', () => {
                const pageSize = Math.max(1, parseInt(elements.postsPageSize?.value) || 20);
                gotoPostsPage(Math.max(1, Math.ceil(StorageManager.getPosts().length / pageSize)));
            });
        }

        // Check All Posts in Table
        elements.checkAllPosts.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.post-checkbox').forEach(cb => cb.checked = isChecked);
            updateDeleteSelectedButtonState();
        });

        elements.btnSelectAll.addEventListener('click', () => {
            const checkboxes = document.querySelectorAll('.post-checkbox');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => cb.checked = !allChecked);
            elements.checkAllPosts.checked = !allChecked;
            updateDeleteSelectedButtonState();
        });

        elements.btnDeleteSelected.addEventListener('click', () => {
            const checkedCbs = document.querySelectorAll('.post-checkbox:checked');
            const idsToDelete = Array.from(checkedCbs).map(cb => cb.getAttribute('data-id'));
            
            if (idsToDelete.length > 0 && confirm(`Bạn có chắc chắn muốn xóa ${idsToDelete.length} bài viết đã chọn?`)) {
                StorageManager.deletePosts(idsToDelete);
                showToast(`Đã xóa ${idsToDelete.length} bài viết khỏi danh sách.`, 'info');
                elements.checkAllPosts.checked = false;
                renderAll();
                renderScannedResults();
            }
        });

        // Spintax Tester (Tab 3)
        elements.btnGenerateVariants.addEventListener('click', generateSpintaxPreview);
        elements.btnQuickSpintaxTest.addEventListener('click', () => {
            switchTab('spintax-tab');
            generateSpintaxPreview();
        });

        // Export Data
        elements.btnExportData.addEventListener('click', () => {
            const data = {
                posts: StorageManager.getPosts(),
                templates: StorageManager.getTemplates(),
                promoLink: StorageManager.getPromoLink(),
                promoLinks: StorageManager.getPromoLinks(),
                exportedAt: new Date().toISOString()
            };
            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `fb_seeding_backup_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Đã xuất file sao lưu dữ liệu JSON thành công!', 'success');
        });

        // Import Data
        elements.inputImportFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const parsed = JSON.parse(event.target.result);
                    if (parsed.posts && Array.isArray(parsed.posts)) {
                        StorageManager.savePosts(parsed.posts);
                        if (parsed.templates) StorageManager.saveTemplates(parsed.templates);
                        // Newer backups carry all slots; older ones only one link
                        const importedLinks = Array.isArray(parsed.promoLinks) && parsed.promoLinks.length
                            ? parsed.promoLinks
                            : (parsed.promoLink ? [parsed.promoLink] : []);
                        if (importedLinks.length) {
                            StorageManager.savePromoLinks(importedLinks);
                            const saved = StorageManager.getPromoLinks();
                            elements.inputPromoLink.value = saved[0] || '';
                            if (elements.inputPromoLink2) elements.inputPromoLink2.value = saved[1] || '';
                            if (elements.inputPromoLink3) elements.inputPromoLink3.value = saved[2] || '';
                        }
                        showToast('Đã nhập thành công dữ liệu từ file sao lưu!', 'success');
                        renderAll();
                        renderScannedResults();
                    } else {
                        showToast('Định dạng file sao lưu không hợp lệ!', 'warning');
                    }
                } catch (err) {
                    showToast('Lỗi khi đọc file JSON!', 'warning');
                }
            };
            reader.readAsText(file);
        });

        // Reset Demo
        elements.btnResetDemo.addEventListener('click', () => {
            if (confirm('Bạn có chắc chắn muốn xóa sạch toàn bộ dữ liệu hiện tại?')) {
                StorageManager.resetToDemoData();
                elements.inputPromoLink.value = '';
                showToast('Đã xóa sạch toàn bộ dữ liệu!', 'info');
                renderAll();
                renderScannedResults();
            }
        });
    }

    // --- TAB SWITCHER ---
    function switchTab(tabId) {
        currentTab = tabId;

        elements.navItems.forEach(item => {
            if (item.getAttribute('data-tab') === tabId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        elements.tabContents.forEach(content => {
            if (content.id === tabId) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });

        if (TAB_TITLES[tabId]) {
            elements.pageTitle.textContent = TAB_TITLES[tabId].title;
            elements.pageSubtitle.textContent = TAB_TITLES[tabId].subtitle;
        }
    }

    // --- SPINTAX PREVIEW GENERATOR ---
    function generateSpintaxPreview() {
        const inputStr = elements.spintaxInput.value;
        const addEmoji = elements.chkAutoEmoji.checked;
        // Preview each variant with a freshly picked link so the rotation is visible
        const variants = window.SpintaxEngine
            .generateVariants(inputStr, { link_fb: StorageManager.pickPromoLink() }, 5, addEmoji)
            .map(v => v.replace(/https?:\/\/\S+/, () => StorageManager.pickPromoLink() || ''));

        elements.spintaxOutputList.innerHTML = '';

        if (variants.length === 0) {
            elements.spintaxOutputList.innerHTML = '<div class="empty-state-sm">Cú pháp không tạo được biến thể nào.</div>';
            return;
        }

        variants.forEach((v, index) => {
            const item = document.createElement('div');
            item.className = 'variant-item';
            item.style.flexDirection = 'column';
            item.style.alignItems = 'flex-start';
            item.style.gap = '0.5rem';

            item.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                    <strong>Biến thể #${index + 1}:</strong>
                    <button class="btn-copy-variant" data-text="${escapeHtml(v)}">Copy nội dung</button>
                </div>
                <div class="code-font" style="font-size:0.85rem; color:var(--text-primary); white-space:pre-line; word-break:break-all;">${escapeHtml(v)}</div>
            `;
            elements.spintaxOutputList.appendChild(item);
        });

        document.querySelectorAll('.btn-copy-variant').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const text = e.currentTarget.getAttribute('data-text');
                navigator.clipboard.writeText(text);
                showToast('Đã copy câu biến thể thử nghiệm!', 'success');
            });
        });
    }

    // --- THEME SWITCHER ---
    function initTheme() {
        const isDark = localStorage.getItem('fb_theme') !== 'light';
        elements.themeSwitch.checked = isDark;
        applyTheme(isDark);

        elements.themeSwitch.addEventListener('change', (e) => {
            const dark = e.target.checked;
            applyTheme(dark);
            localStorage.setItem('fb_theme', dark ? 'dark' : 'light');
        });
    }

    function applyTheme(isDark) {
        if (isDark) {
            document.body.classList.remove('light-theme');
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
            document.body.classList.add('light-theme');
        }
    }

    // --- TOAST NOTIFICATIONS ---
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icons = {
            success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
            info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
            warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 1 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
        };

        toast.innerHTML = `${icons[type] || icons.info} <span>${escapeHtml(message)}</span>`;
        elements.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // --- HELPER FUNCTIONS ---
    function truncateUrl(url, maxLength = 35) {
        if (!url) return '';
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength) + '...';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, function(m) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            }[m];
        });
    }

    // Start App
    init();
});
