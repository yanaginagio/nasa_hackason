const photos = ["PIA06748.jpg", "PIA06749.jpg", "PIA06750.jpg"];
const rounds = [
  { command: "けずれ！！！", label: "1 / 2 · SOL 177", hits: 20 },
  { command: "もっとけずれ！！！", label: "2 / 2 · SOL 178", hits: 24 },
];
const get = id => document.getElementById(id);
const grind = get("grind");
const base = get("base");
const next = get("next");
const progress = get("progress");
const results = get("results");
const finalPhoto = new Image();
finalPhoto.src = photos[2];

let stage = 0;
let hits = 0;

function render() {
  const round = rounds[stage];
  const clear = !round;
  grind.dataset.clear = String(clear);
  grind.disabled = clear;
  base.src = photos[stage];
  next.hidden = clear;
  get("command").textContent = clear ? "CLEAR" : round.command;
  get("stage-label").textContent = clear ? "SOL 178 · 研磨完了" : round.label;
  get("instruction").textContent = clear ? "↓ 下に観測結果" : "画面を連打して岩を削る";
  get("progress-wrap").hidden = clear;
  results.hidden = !clear;
  if (clear) return;

  next.src = photos[stage + 1];
  next.style.setProperty("--reveal", "0%");
  progress.max = round.hits;
  progress.value = 0;
  get("count").textContent = "0 / " + round.hits;
}

grind.addEventListener("click", () => {
  const round = rounds[stage];
  if (!round) return;

  hits += 1;
  if (hits < round.hits) {
    progress.value = hits;
    get("count").textContent = hits + " / " + round.hits;
    next.style.setProperty("--reveal", (hits / round.hits * 71) + "%");
    return;
  }

  stage += 1;
  hits = 0;
  render();
  get("status").textContent = rounds[stage]
    ? "1回目の研磨が完了。続けて同じ岩を削ります。"
    : "クリア。観測結果が表示されました。";
  if (!rounds[stage]) get("result-title").focus({ preventScroll: true });
});

function restart() {
  stage = 0;
  hits = 0;
  get("status").textContent = "";
  render();
  grind.focus();
}

get("restart").addEventListener("click", restart);
get("retry").addEventListener("click", restart);
render();
