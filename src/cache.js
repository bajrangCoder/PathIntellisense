const MAX_CACHE_SIZE = 20;

class LRUCache {
    constructor() {
        this.cache = new Map();
        this.accessOrder = [];
    }

    async getAsync(key) {
        if (this.cache.has(key)) {
            // Update access order
            this.accessOrder = this.accessOrder.filter(item => item !== key);
            this.accessOrder.unshift(key);
            return this.cache.get(key);
        }
        return null;
    }

    async setAsync(key, value) {
        if (this.cache.size >= MAX_CACHE_SIZE) {
            // Remove the least recently used item
            const lruKey = this.accessOrder.pop();
            this.cache.delete(lruKey);
        }
        this.cache.set(key, value);
        this.accessOrder.unshift(key);
    }
}

export default LRUCache;
