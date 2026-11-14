const storageKey = "jezero-language";
let savedLanguage;
try { savedLanguage = localStorage.getItem(storageKey); } catch { /* storage unavailable */ }

export let locale = savedLanguage === "en" ? "en" : "ja";
export const tr = (ja, en) => locale === "en" ? en : ja;

const fields = [
  ["data-en", "textContent"],
  ["data-en-alt", "alt"],
  ["data-en-label", "aria-label"],
  ["data-en-title", "title"],
  ["data-en-placeholder", "placeholder"],
  ["data-en-content", "content"],
];
const translations = fields.flatMap(([marker, target]) =>
  Array.from(document.querySelectorAll(`[${marker}]`), (element) => ({
    element, target,
    ja: target === "textContent" ? element.textContent : element.getAttribute(target),
    en: element.getAttribute(marker),
  }))
);

function renderLocale() {
  document.documentElement.lang = document.documentElement.dataset.locale = locale;
  for (const {element, target, ja, en} of translations) {
    if (target === "textContent") element.textContent = tr(ja, en);
    else element.setAttribute(target, tr(ja, en));
  }
}

document.getElementById(`vg-lang-${locale}`).checked = true;
renderLocale();

document.getElementById("vg-language").addEventListener("change", (event) => {
  locale = event.target.value;
  renderLocale();
  try { localStorage.setItem(storageKey, locale); } catch { /* storage unavailable */ }
  document.dispatchEvent(new Event("localechange"));
});
