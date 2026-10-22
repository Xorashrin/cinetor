const store = new Map();

export const AsyncStorage = {
  async getItem(key) {
    return store.get(key) ?? null;
  },
  async setItem(key, value) {
    store.set(key, String(value));
  },
  async removeItem(key) {
    store.delete(key);
  },
  async clear() {
    store.clear();
  },
};

export default AsyncStorage;
