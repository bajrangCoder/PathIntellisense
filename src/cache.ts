const MAX_CACHE_SIZE = 20;

class LRUCache<T> {
	private cache = new Map<string, T>();
	private accessOrder: string[] = [];

	async getAsync(key: string): Promise<T | null> {
		if (!this.cache.has(key)) return null;

		this.accessOrder = this.accessOrder.filter((item) => item !== key);
		this.accessOrder.unshift(key);
		return this.cache.get(key) ?? null;
	}

	async setAsync(key: string, value: T): Promise<void> {
		if (this.cache.size >= MAX_CACHE_SIZE) {
			const lruKey = this.accessOrder.pop();
			if (lruKey) this.cache.delete(lruKey);
		}

		this.cache.set(key, value);
		this.accessOrder.unshift(key);
	}

	resetCache(): void {
		this.cache.clear();
		this.accessOrder = [];
	}
}

export default LRUCache;
