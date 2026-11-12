export function draftManager(storage, onError = () => {}) {
  const key = (id) => `nickyoung:draft:${id || 'new'}`;
  return {
    read(id) {
      try { return JSON.parse(storage.getItem(key(id)) || '{}'); }
      catch { onError(); return {}; }
    },
    write(id, value) {
      try { storage.setItem(key(id), JSON.stringify(value)); }
      catch { onError(); }
    },
    clear(id) {
      try { storage.removeItem(key(id)); }
      catch { onError(); }
    },
  };
}
