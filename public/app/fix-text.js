// Sửa lỗi OCR hay gặp với tiếng Việt: hai âm tiết bị dính nhau ("lọcnhiễu" -> "lọc nhiễu").
// Mỗi âm tiết tiếng Việt chỉ có MỘT cụm nguyên âm, nên một từ có dấu tiếng Việt mà chứa
// hai cụm nguyên âm cách nhau bởi phụ âm chắc chắn là nhiều âm tiết bị dính.
// Dùng được cả trên trình duyệt (window.FixText) lẫn Node (require).
(function (root) {
  const FINALS = new Set(['', 'c', 'ch', 'm', 'n', 'ng', 'nh', 'p', 't']);
  const INITIALS = new Set([
    '', 'b', 'c', 'ch', 'd', 'đ', 'g', 'gh', 'h', 'k', 'kh', 'l', 'm', 'n', 'ng', 'ngh',
    'nh', 'p', 'ph', 'q', 'r', 's', 't', 'th', 'tr', 'v', 'x',
  ]);
  // Dấu chỉ tiếng Việt mới có: ngã, hỏi, nặng, ă, â/ê/ô, ơ/ư.
  // Không tính dấu sắc/huyền vì từ nước ngoài cũng có (Pokémon, café, résumé).
  const VN_ONLY_MARK = /[̛̣̃̉̆̂]/;

  const base = (ch) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const isVowel = (ch) => /[aeiouy]/.test(base(ch));

  function isVietnameseWord(word) {
    const lower = word.toLowerCase();
    if (/[fjwz]/.test(lower)) return false; // chữ cái không có trong tiếng Việt
    return lower.includes('đ') || VN_ONLY_MARK.test(lower.normalize('NFD'));
  }

  function splitWord(word) {
    if (!isVietnameseWord(word)) return word;
    const chars = [...word];
    const syllables = [];
    let start = 0;
    let i = 0;
    // bỏ qua phụ âm đầu và cụm nguyên âm đầu tiên
    while (i < chars.length && !isVowel(chars[i])) i++;
    while (i < chars.length && isVowel(chars[i])) i++;
    while (i < chars.length) {
      const runStart = i;
      while (i < chars.length && !isVowel(chars[i])) i++;
      if (i >= chars.length) break; // phụ âm cuối của âm tiết cuối
      const run = chars.slice(runStart, i).join('').toLowerCase();
      // chọn cách tách: phụ âm cuối ngắn nhất sao cho phần còn lại là phụ âm đầu hợp lệ
      let k = -1;
      for (let j = 0; j <= run.length; j++) {
        if (FINALS.has(run.slice(0, j)) && INITIALS.has(run.slice(j))) {
          k = j;
          break;
        }
      }
      if (k < 0) return word; // không tách được chắc chắn thì giữ nguyên
      syllables.push(chars.slice(start, runStart + k).join(''));
      start = runStart + k;
      while (i < chars.length && isVowel(chars[i])) i++;
    }
    syllables.push(chars.slice(start).join(''));
    return syllables.join(' ');
  }

  function fixMergedSyllables(text) {
    return String(text).normalize('NFC').replace(/\p{L}+/gu, splitWord);
  }

  const api = { fixMergedSyllables };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FixText = api;
})(typeof window !== 'undefined' ? window : globalThis);
