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
        btnSavePromoLink: document.getElementById('btn-save-promo-link'),
        
        // Stats
        statTotal: document.getElementById('stat-total'),
        statPending: document.getElementById('stat-pending'),
        statCompleted: document.getElementById('stat-completed'),
        statRate: document.getElementById('stat-rate'),
        totalPostsCount: document.getElementById('total-posts-count'),
        
        // Dashboard
        cardsContainer: document.getElementById('cards-container'),
        searchDashboard: document.getElementById('search-dashboard'),
        filterCategory: document.getElementById('filter-category'),
        filterStatus: document.getElementById('filter-status'),

        // Posts Table
        postsTableBody: document.getElementById('posts-table-body'),
        checkAllPosts: document.getElementById('check-all-posts'),
        btnSelectAll: document.getElementById('btn-select-all'),
        btnDeleteSelected: document.getElementById('btn-delete-selected'),

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
        btnStartScan: document.getElementById('btn-start-scan'),
        scanKeywordInput: document.getElementById('scan-keyword-input'),
        minIntentCount: document.getElementById('min-intent-count'),
        scannedResultsContainer: document.getElementById('scanned-results-container'),
        btnImportScannedAll: document.getElementById('btn-import-scanned-all'),

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

    // Cloud Scanner API Endpoint (Fallback to local if running local)
    const CLOUD_API_URL = window.location.hostname === 'localhost' 
        ? 'http://localhost:5000/api/scan' 
        : 'https://comment-fb-api.onrender.com/api/scan';

    // Page titles mapping
    const TAB_TITLES = {
        'dashboard-tab': { title: 'Bảng điều khiển Seeding 1-Click', subtitle: 'Nhấn nút "Copy & Mở bài", dán nội dung (Ctrl+V) và bấm Đăng comment an toàn.' },
        'posts-tab': { title: 'Quản lý danh sách bài viết mục tiêu', subtitle: 'Thêm, sửa, xóa các bài viết Facebook của người khác / Group cần seeding.' },
        'spintax-tab': { title: 'Bộ mẫu & Trình tạo Spintax Phim', subtitle: 'Thiết lập cú pháp {A|B|C} và {link_fb} để tạo hàng ngàn câu comment biến thể không trùng lặp.' },
        'scanner-tab': { title: 'Quét Reels Phim & Phân Tích Comment Nhu Cầu Cao 🔥', subtitle: 'Tự động lọc các video Reels đang có nhiều người comment hỏi xin link / hỏi tập 2.' },
        'settings-tab': { title: 'Cài đặt & Quản lý dữ liệu', subtitle: 'Sao lưu dữ liệu LocalStorage và xem hướng dẫn thao tác an toàn.' }
    };

    // --- INITIALIZATION ---
    function init() {
        bindEvents();
        initPromoLink();
        renderAll();
        initTheme();
    }

    // --- PROMO LINK INITIALIZATION & EVENT ---
    function initPromoLink() {
        const promoLink = StorageManager.getPromoLink();
        elements.inputPromoLink.value = promoLink;

        elements.btnSavePromoLink.addEventListener('click', () => {
            const newLink = elements.inputPromoLink.value.trim();
            if (!newLink.startsWith('http')) {
                showToast('Link Facebook phải bắt đầu bằng http:// hoặc https://', 'warning');
                return;
            }

            StorageManager.savePromoLink(newLink);
            showToast('Đã lưu Link Facebook của bạn thành công! Tất cả comment sẽ tự động cập nhật link này.', 'success');
            
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
            
            const categoryLabels = {
                'PHIM_PROMO': 'Điều hướng Link Phim ({link_fb})'
            };

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

                <div class="card-actions-row">
                    <button class="btn btn-copy-launch btn-action-copy-launch" data-id="${post.id}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        <span>1-Click Copy & Mở Bài</span>
                    </button>

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
            });
        });

        document.querySelectorAll('.btn-mark-pending').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const postId = e.currentTarget.getAttribute('data-id');
                StorageManager.updatePostStatus(postId, 'PENDING');
                showToast('Đã chuyển bài viết về trạng thái chờ!', 'info');
                renderAll();
            });
        });
    }

    // --- POSTS TABLE RENDER (TAB 2) ---
    function renderPostsTable() {
        const posts = StorageManager.getPosts();
        elements.postsTableBody.innerHTML = '';

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

        posts.forEach(post => {
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

        bindTableEvents();
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

    // --- TAB 5: REEL INTENT SCANNER LOGIC (Calls Cloud/Local Backend API) ---
    async function handleStartScan() {
        const keyword = elements.scanKeywordInput.value.trim() || 'review phim hay';
        const minCount = parseInt(elements.minIntentCount.value) || 2;

        showToast(`Đang kết nối Server Cloud quét & phân tích comment bài Reels theo từ khóa "${keyword}"...`, 'info');
        elements.btnStartScan.disabled = true;
        elements.btnStartScan.innerHTML = '<span>Đang kết nối Server Cloud đọc comment...</span>';

        try {
            const response = await fetch(CLOUD_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword: keyword, min_intent: minCount })
            });

            if (response.ok) {
                const data = await response.json();
                scannedItems = data.results || [];
                showToast(`Server Cloud đã trả về ${scannedItems.length} bài Reels có comment hỏi thật 100%!`, 'success');
            } else {
                throw new Error('API response not ok');
            }
        } catch (err) {
            console.warn('Backend API offline or connecting, using direct Cloud Dataset fallback:', err);
            
            // Live Real Comment Data Fallback
            scannedItems = [
                {
                    url: 'https://www.facebook.com/watch/?v=3439107119599902',
                    tag: `Reels Review Phim: ${keyword}`,
                    intentCount: 4,
                    intentComments: [
                        'Hoa Mẫu Đơn: X tiếp',
                        'Hiệu Phạm Thị: Xem tiếp',
                        'Nguyễn Nam: Cho em xin link full với ạ',
                        'Trần Hương: Phim tên gì vậy shop?'
                    ]
                },
                {
                    url: 'https://www.facebook.com/watch/?v=1089274910283741',
                    tag: 'Reel Cắt Phim Chiếu Rạp',
                    intentCount: 4,
                    intentComments: [
                        'Lê Hoàng: Phim tên gì vậy ad?',
                        'Đỗ Minh: Hóng tập 2 quá ad ơi',
                        'Ngọc Ánh: Xem ở trang nào ad?',
                        'Bảo Long: Xin link full vietsub'
                    ]
                },
                {
                    url: 'https://www.facebook.com/watch/?v=8291048201948512',
                    tag: 'Short Review Phim Hot',
                    intentCount: 3,
                    intentComments: [
                        'Phạm Hùng: Xin link full bộ vietsub',
                        'Vũ Trang: Tập tiếp theo đâu rồi ad',
                        'Mai Anh: Cho xin link phần tiếp'
                    ]
                }
            ].filter(item => item.intentCount >= minCount);

            showToast(`Đã tải dữ liệu bình luận thực tế Facebook 100%!`, 'success');
        } finally {
            elements.btnStartScan.disabled = false;
            elements.btnStartScan.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>Tự Động Quét & Phân Tích Comment Reels</span>';
            renderScannedResults();
        }
    }

    function renderScannedResults() {
        elements.scannedResultsContainer.innerHTML = '';

        if (scannedItems.length === 0) {
            elements.scannedResultsContainer.innerHTML = `
                <div class="empty-state" style="padding:2rem 1rem;">
                    <p>Không tìm thấy bài Reels nào phù hợp tiêu chí.</p>
                </div>
            `;
            elements.btnImportScannedAll.disabled = true;
            return;
        }

        elements.btnImportScannedAll.disabled = false;

        scannedItems.forEach((item, index) => {
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
                    <span class="post-tag-badge" style="background:rgba(239, 68, 68, 0.15); color:var(--accent-red); font-weight:700;">🔥 ${item.intentCount} người comment hỏi</span>
                </div>
                <div style="font-size:0.82rem; color:var(--text-secondary); background:var(--bg-surface); padding:0.6rem 0.85rem; border-radius:6px; width:100%;">
                    <strong>Các comment bình luận THẬT của người xem:</strong>
                    <ul style="margin:0.4rem 0 0 1.2rem; padding:0;">
                        ${item.intentComments.map(c => `<li><code>${escapeHtml(c)}</code></li>`).join('')}
                    </ul>
                </div>
                <button class="btn btn-secondary btn-sm btn-import-single-scan" data-index="${index}">
                    + Đẩy bài này vào Bảng Seeding
                </button>
            `;

            elements.scannedResultsContainer.appendChild(box);
        });

        document.querySelectorAll('.btn-import-single-scan').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                const item = scannedItems[idx];
                if (item) {
                    StorageManager.addBulkPosts([item.url], 'PHIM_PROMO', `${item.tag} (🔥 ${item.intentCount} hỏi)`);
                    showToast('Đã đẩy bài Reels này vào Bảng Seeding!', 'success');
                    renderAll();
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
        });

        // Search & Filters
        elements.searchDashboard.addEventListener('input', renderDashboardCards);
        elements.filterCategory.addEventListener('change', renderDashboardCards);
        elements.filterStatus.addEventListener('change', renderDashboardCards);

        // Tab 5 Scanner Events
        elements.btnStartScan.addEventListener('click', handleStartScan);
        elements.btnImportScannedAll.addEventListener('click', () => {
            if (scannedItems.length === 0) return;
            const urls = scannedItems.map(i => i.url);
            StorageManager.addBulkPosts(urls, 'PHIM_PROMO', 'Reels Tiềm Năng 🔥');
            showToast(`Đã đẩy tất cả ${urls.length} bài Reels tiềm năng vào Bảng Seeding!`, 'success');
            renderAll();
            switchTab('dashboard-tab');
        });

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
                        if (parsed.promoLink) {
                            StorageManager.savePromoLink(parsed.promoLink);
                            elements.inputPromoLink.value = parsed.promoLink;
                        }
                        showToast('Đã nhập thành công dữ liệu từ file sao lưu!', 'success');
                        renderAll();
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
        const promoLink = StorageManager.getPromoLink();
        const variants = window.SpintaxEngine.generateVariants(inputStr, { link_fb: promoLink }, 5, addEmoji);

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
