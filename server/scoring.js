const STOP_WORDS = new Set(["a", "an", "the", "of", "to"]);

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

// Returns true if `submitted` is considered a match for `accepted` (allowing
// minor typos proportional to answer length), checked against every
// acceptable answer variant for a question.
function isMatch(submitted, acceptedAnswers) {
  const normSubmitted = normalize(submitted);
  if (!normSubmitted) return false;
  const candidates = Array.isArray(acceptedAnswers) ? acceptedAnswers : [acceptedAnswers];
  for (const raw of candidates) {
    const normAccepted = normalize(raw);
    if (!normAccepted) continue;
    if (normSubmitted === normAccepted) return true;
    const distance = levenshtein(normSubmitted, normAccepted);
    const threshold = Math.max(1, Math.floor(normAccepted.length * 0.2));
    if (distance <= threshold) return true;
  }
  return false;
}

module.exports = { normalize, levenshtein, isMatch };
