/**
 * SPINTAX ENGINE & COMMENT VARIATION GENERATOR
 * Handles parsing {option1|option2|option3} syntax, {link_fb} variables & producing unique non-duplicate comments.
 */

const EMOJI_POOL = ['👍', '❤️', '🔥', '✨', '💯', '😍', '🙏', '😊', '👌', '📌', '🎉', '🌟', '🎬', '🍿', '👇🏻', '👉🏻'];

class SpintaxEngine {
    /**
     * Parses a spintax string and generates a random unique output string
     * @param {string} text - Input text containing spintax like {hello|hi|hey}
     * @param {Object} variables - Key-value pair of variables like { link_fb: 'https://fb.com/my-post' }
     * @returns {string} - Evaluated random string
     */
    static parse(text, variables = {}) {
        if (!text) return '';
        
        // 1. Replace custom variables like {link_fb} first if present
        if (variables.link_fb) {
            text = text.replace(/\{link_fb\}/g, variables.link_fb);
        } else {
            // Default placeholder if promo link not set yet
            text = text.replace(/\{link_fb\}/g, '');
        }

        const spintaxRegex = /\{([^{}]+)\}/g;

        // 2. Recursively replace nested or single spintax blocks
        while (spintaxRegex.test(text)) {
            text = text.replace(spintaxRegex, (match, choicesStr) => {
                const choices = choicesStr.split('|');
                const randomIndex = Math.floor(Math.random() * choices.length);
                return choices[randomIndex].trim();
            });
        }

        // Clean up double spaces
        text = text.replace(/\s+/g, ' ').trim();
        return text;
    }

    /**
     * Generates a comment from a template with variable replacement & optional random emoji
     * @param {string} templateText - Spintax template
     * @param {Object} variables - Variables mapping
     * @param {boolean} addEmoji - Whether to append random emoji
     * @returns {string}
     */
    static generateComment(templateText, variables = {}, addEmoji = false) {
        let result = this.parse(templateText, variables);
        
        if (addEmoji) {
            const randomEmoji = EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
            result += ` ${randomEmoji}`;
        }

        return result;
    }

    /**
     * Generates multiple distinct variations from a single spintax input
     * @param {string} templateText
     * @param {Object} variables
     * @param {number} count
     * @param {boolean} addEmoji
     * @returns {string[]}
     */
    static generateVariants(templateText, variables = {}, count = 5, addEmoji = false) {
        const variants = new Set();
        let attempts = 0;
        const maxAttempts = count * 30;

        while (variants.size < count && attempts < maxAttempts) {
            attempts++;
            const variant = this.generateComment(templateText, variables, addEmoji);
            if (variant) {
                variants.add(variant);
            }
        }

        return Array.from(variants);
    }
}

// Default Spintax Templates (Only Phim / Promo Link)
const DEFAULT_TEMPLATES = [
    {
        id: 'tpl_phim_promo',
        name: 'Điều hướng Link Phim / Bài viết của bạn',
        category: 'PHIM_PROMO',
        content: '{Đã Cập Nhật Đầy Đủ phim tại đây|Link xem trọn bộ bản nét HD tại đây mọi người ơi|Xem full bộ vietsub cực nét ở đây nha|Đã cập nhật tập mới nhất ở link này} - {còn có nhiều phim hay khác nữa cho bạn nào muốn xem|tổng hợp nhiều phim siêu hot cho mọi người|kho phim vietsub chất lượng cao cập nhật liên tục|nhiều phim chiếu rạp đỉnh lắm nè} {👉🏻|👇🏻|🔥|🎬|🍿}\n{link_fb}'
    }
];

window.SpintaxEngine = SpintaxEngine;
window.DEFAULT_TEMPLATES = DEFAULT_TEMPLATES;
