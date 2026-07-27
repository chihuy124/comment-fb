/**
 * STORAGE MANAGER
 * Manages persistence in LocalStorage for posts, templates, promo link, history, and theme settings.
 */

const STORAGE_KEYS = {
    POSTS: 'fb_seeding_posts_v1',
    TEMPLATES: 'fb_seeding_templates_v1',
    SETTINGS: 'fb_seeding_settings_v1',
    PROMO_LINK: 'fb_seeding_promo_link_v1',
    PROMO_LINKS_EXTRA: 'fb_seeding_promo_links_extra_v1'
};

const DEFAULT_PROMO_LINK = '';

// Initial Empty Data (No Mock Data)
const INITIAL_SAMPLE_POSTS = [];

class StorageManager {
    /**
     * Gets user's promo link (Link bài viết Facebook cá nhân/page của bạn)
     * @returns {string}
     */
    static getPromoLink() {
        const link = localStorage.getItem(STORAGE_KEYS.PROMO_LINK) || DEFAULT_PROMO_LINK;
        if (link.includes('MoviePostExample')) {
            localStorage.removeItem(STORAGE_KEYS.PROMO_LINK);
            return '';
        }
        return link;
    }

    /**
     * Saves user's promo link
     * @param {string} url
     */
    static savePromoLink(url) {
        if (url && url.trim()) {
            localStorage.setItem(STORAGE_KEYS.PROMO_LINK, url.trim());
        } else {
            localStorage.removeItem(STORAGE_KEYS.PROMO_LINK);
        }
    }

    /**
     * All promo links the user configured (slot 1 is the legacy single link,
     * slots 2-3 are extras). Rotating between several destinations is what
     * stops every comment carrying the identical URL.
     * @returns {string[]} only non-empty, trimmed links
     */
    static getPromoLinks() {
        const extras = [];
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.PROMO_LINKS_EXTRA);
            if (raw) extras.push(...JSON.parse(raw));
        } catch (e) {}
        return [this.getPromoLink(), ...extras]
            .map(l => (l || '').trim())
            .filter(Boolean);
    }

    /**
     * @param {string[]} links full list; first element goes to the legacy key
     */
    static savePromoLinks(links) {
        const clean = (links || []).map(l => (l || '').trim());
        this.savePromoLink(clean[0] || '');
        const extras = clean.slice(1);
        if (extras.some(Boolean)) {
            localStorage.setItem(STORAGE_KEYS.PROMO_LINKS_EXTRA, JSON.stringify(extras));
        } else {
            localStorage.removeItem(STORAGE_KEYS.PROMO_LINKS_EXTRA);
        }
    }

    /** Picks one promo link at random, so consecutive comments differ. */
    static pickPromoLink() {
        const links = this.getPromoLinks();
        if (links.length === 0) return '';
        return links[Math.floor(Math.random() * links.length)];
    }

    /**
     * Gets all posts from LocalStorage, cleaning up any legacy mock data automatically
     * @returns {Array}
     */
    static getPosts() {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.POSTS);
            if (!data) {
                this.savePosts([]);
                return [];
            }
            let posts = JSON.parse(data);
            
            // Clean up any remaining legacy mock demo posts
            const filteredPosts = posts.filter(p => p.id && !p.id.startsWith('post_demo'));
            if (filteredPosts.length !== posts.length) {
                this.savePosts(filteredPosts);
                return filteredPosts;
            }
            return posts;
        } catch (e) {
            console.error('Error reading posts from LocalStorage:', e);
            return [];
        }
    }

    /**
     * Saves posts array to LocalStorage
     * @param {Array} posts
     */
    static savePosts(posts) {
        try {
            localStorage.setItem(STORAGE_KEYS.POSTS, JSON.stringify(posts));
        } catch (e) {
            console.error('Error saving posts to LocalStorage:', e);
        }
    }

    /**
     * Gets templates from LocalStorage, automatically filtering out legacy 3 templates
     * @returns {Array}
     */
    static getTemplates() {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.TEMPLATES);
            if (!data) {
                this.saveTemplates(window.DEFAULT_TEMPLATES || []);
                return window.DEFAULT_TEMPLATES || [];
            }
            let templates = JSON.parse(data);
            
            // Remove legacy 3 templates: KHEN_NGUOI, HOI_GIA, REVIEW
            const cleanTemplates = templates.filter(t => t.category === 'PHIM_PROMO' || t.id === 'tpl_phim_promo');
            if (cleanTemplates.length === 0) {
                this.saveTemplates(window.DEFAULT_TEMPLATES || []);
                return window.DEFAULT_TEMPLATES || [];
            }
            if (cleanTemplates.length !== templates.length) {
                this.saveTemplates(cleanTemplates);
            }
            return cleanTemplates;
        } catch (e) {
            return window.DEFAULT_TEMPLATES || [];
        }
    }

    /**
     * Saves templates to LocalStorage
     * @param {Array} templates
     */
    static saveTemplates(templates) {
        localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
    }

    /**
     * Adds bulk links to the post list
     * @param {string[]} urls
     * @param {string} category
     * @param {string} tag
     * @returns {number} Count of added posts
     */
    static addBulkPosts(urls, category = 'PHIM_PROMO', tag = '') {
        const posts = this.getPosts();
        const templates = this.getTemplates();
        const categoryTemplate = templates.find(t => t.category === category) || templates[0];
        let addedCount = 0;

        urls.forEach(url => {
            const cleanUrl = url.trim();
            if (!cleanUrl) return;

            // Pick per post, not per batch, so a bulk import doesn't hand the
            // same URL to every single comment.
            const promoLink = this.pickPromoLink();
            const initialComment = categoryTemplate
                ? window.SpintaxEngine.generateComment(categoryTemplate.content, { link_fb: promoLink }) 
                : `Đã Cập Nhật Đầy Đủ phim tại đây 👉🏻\n${promoLink}`;

            const newPost = {
                id: 'post_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                url: cleanUrl,
                tag: tag.trim() || 'Link bài viết mới',
                category: category,
                status: 'PENDING',
                currentComment: initialComment,
                createdAt: new Date().toISOString(),
                lastActionAt: null
            };

            posts.unshift(newPost);
            addedCount++;
        });

        this.savePosts(posts);
        return addedCount;
    }

    /**
     * Updates status of a post
     * @param {string} postId
     * @param {string} status - PENDING | COMPLETED | SKIPPED
     */
    static updatePostStatus(postId, status) {
        const posts = this.getPosts();
        const target = posts.find(p => p.id === postId);
        if (target) {
            target.status = status;
            target.lastActionAt = new Date().toISOString();
            this.savePosts(posts);
        }
    }

    /**
     * Regenerates a new random comment for a specific post
     * @param {string} postId
     * @returns {string} New comment string
     */
    static regenerateCommentForPost(postId) {
        const posts = this.getPosts();
        const templates = this.getTemplates();
        const promoLink = this.pickPromoLink();
        const target = posts.find(p => p.id === postId);
        if (!target) return '';

        const categoryTemplate = templates.find(t => t.category === target.category) || templates[0];
        const newComment = categoryTemplate 
            ? window.SpintaxEngine.generateComment(categoryTemplate.content, { link_fb: promoLink })
            : `Đã Cập Nhật Đầy Đủ phim tại đây 👉🏻\n${promoLink}`;

        target.currentComment = newComment;
        this.savePosts(posts);
        return newComment;
    }

    /**
     * Deletes multiple posts by ID
     * @param {string[]} postIds
     */
    static deletePosts(postIds) {
        let posts = this.getPosts();
        posts = posts.filter(p => !postIds.includes(p.id));
        this.savePosts(posts);
    }

    /**
     * Resets data back to completely clean state
     */
    static resetToDemoData() {
        this.savePosts([]);
        this.saveTemplates(window.DEFAULT_TEMPLATES || []);
        this.savePromoLink('');
        localStorage.clear();
    }
}

window.StorageManager = StorageManager;
