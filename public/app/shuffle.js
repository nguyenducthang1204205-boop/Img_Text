// Trộn đề: đảo thứ tự câu hỏi và (tuỳ chọn) đảo thứ tự đáp án A/B/C/D trong mỗi câu.
// Chạy được cả trên trình duyệt (window.Shuffle) lẫn Node (module.exports) để thử nhanh.
(function (root) {
  const OPTION_RE = /^([A-H])\.\s+(.*)$/;

  // Số ngẫu nhiên an toàn trong [0, n)
  function randInt(n, rand) {
    if (rand) return Math.floor(rand() * n);
    const buf = new Uint32Array(1);
    (root.crypto || globalThis.crypto).getRandomValues(buf);
    return buf[0] % n;
  }

  function shuffled(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1, rand);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // "Câu {n}:" → /^Câu \d+:\s*/ để bỏ số câu cũ ở đầu câu hỏi
  function prefixRegex(format) {
    const esc = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{n\\}', '\\d+');
    return new RegExp('^' + esc + '\\s*');
  }

  // Tách một câu hỏi đã đánh số thành phần đề và các đáp án.
  // Chỉ coi là câu trắc nghiệm khi các dòng cuối là A., B., C.… liên tiếp từ A
  // (câu Đúng/Sai, câu kéo thả… giữ nguyên, không đảo đáp án).
  function parseQuestion(text, format) {
    const lines = text.split('\n');
    lines[0] = lines[0].replace(prefixRegex(format), '');
    let k = lines.length;
    while (k > 0 && OPTION_RE.test(lines[k - 1])) k--;
    const tail = lines.slice(k);
    const ok =
      k >= 1 && tail.length >= 2 && tail.every((l, i) => l.charCodeAt(0) === 65 + i);
    return {
      stem: ok ? lines.slice(0, k) : lines,
      options: ok ? tail.map((l) => OPTION_RE.exec(l)[2]) : null,
    };
  }

  // questions: các câu đã đánh số theo `format`.
  // opts: { versions, startCode, shuffleOptions, format, rand }
  // Trả về [{ code, questions: [text], map: [{ no, orig, options: 'A→C, B→A…' | '' }] }]
  function makeVersions(questions, opts = {}) {
    const { versions = 4, startCode = 101, shuffleOptions = true, format = 'Câu {n}:', rand } = opts;
    const parsed = questions.map((q) => parseQuestion(q, format));
    const out = [];
    for (let v = 0; v < versions; v++) {
      const order = shuffled(parsed.map((_, i) => i), rand);
      const qs = [];
      const map = [];
      order.forEach((orig, i) => {
        const p = parsed[orig];
        const label = format.replace('{n}', i + 1);
        const stem = p.stem.slice();
        stem[0] = (label + ' ' + stem[0]).trim();
        let optionMap = '';
        let lines = stem;
        if (p.options && shuffleOptions) {
          const perm = shuffled(p.options.map((_, j) => j), rand);
          lines = stem.concat(perm.map((j, pos) => `${String.fromCharCode(65 + pos)}. ${p.options[j]}`));
          // Đáp án gốc X nay nằm ở vị trí Y
          optionMap = p.options
            .map((_, j) => `${String.fromCharCode(65 + j)}→${String.fromCharCode(65 + perm.indexOf(j))}`)
            .join(', ');
        } else if (p.options) {
          lines = stem.concat(p.options.map((o, j) => `${String.fromCharCode(65 + j)}. ${o}`));
        }
        qs.push(lines.join('\n'));
        map.push({ no: i + 1, orig: orig + 1, options: optionMap });
      });
      out.push({ code: startCode + v, questions: qs, map });
    }
    return out;
  }

  const api = { parseQuestion, makeVersions, prefixRegex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Shuffle = api;
})(typeof window !== 'undefined' ? window : globalThis);
