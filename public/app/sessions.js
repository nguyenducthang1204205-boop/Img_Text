// Lịch sử làm việc lưu ngay trên trình duyệt (localStorage), riêng cho từng tài khoản.
// Chỉ lưu chữ đã trích xuất và tuỳ chọn, KHÔNG lưu ảnh và không gửi lên server.
(function (root) {
  const MAX_ENTRIES = 30;
  let key = 'dt-history:';

  function setUser(username) {
    key = 'dt-history:' + username;
  }

  function list() {
    try {
      const data = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function write(entries) {
    // Hết dung lượng thì bỏ bớt các phiên cũ nhất rồi thử lại
    for (let n = entries.length; n >= 0; n = Math.min(n - 1, Math.floor(n / 2))) {
      try {
        localStorage.setItem(key, JSON.stringify(entries.slice(0, n)));
        return true;
      } catch {
        if (n === 0) return false;
      }
    }
    return false;
  }

  // entry: { id, updatedAt, items: [{ name, text }], opts, total, snippet }
  function save(entry) {
    const entries = list().filter((e) => e.id !== entry.id);
    entries.unshift(entry);
    return write(entries.slice(0, MAX_ENTRIES));
  }

  function get(id) {
    return list().find((e) => e.id === id) || null;
  }

  function remove(id) {
    write(list().filter((e) => e.id !== id));
  }

  function clear() {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  root.Sessions = { setUser, list, save, get, remove, clear };
})(window);
