// Scores a free-text answer to an accident. Keyword matching for now; a local
// embedding model with cosine similarity can replace gradeAnswer later, as long
// as it returns the same shape: {passed, matched: [group], missing: [group]}.

// Full-width to half-width, lower case, katakana to hiragana, no spaces or punctuation.
export function normalize(text) {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s、。，．,.!?！？「」『』（）()・]/g, "");
}

export function gradeAnswer(answer, accident) {
  const english = accident.language === "en";
  const normalizeEnglish = (value) => value.normalize("NFKC").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
  const key = english ? normalizeEnglish : normalize;
  const text = key(answer);
  const matched = [], missing = [];
  for (const group of accident.groups) {
    const found = group.keywords.some((word) => {
      const keyword = key(word);
      return english ? ` ${text} `.includes(` ${keyword} `) : text.includes(keyword);
    });
    (found ? matched : missing).push(group);
  }
  return {passed: text.length > 0 && matched.length >= accident.min, matched, missing};
}
