// Prologue: launch, the cruise to Mars, and landing, before the rover game.
// - Footage is NASA's: the launch coverage (pad camera, the camera on the Atlas
//   booster, the Centaur camera at spacecraft separation) and the onboard
//   descent cameras with mission control's call-outs.
// - Distances, speeds and light time come from JPL Horizons, the asteroids from
//   NASA NeoWs; the debris count and the solar flare are NASA records.
// - The one game in the prologue is the hardest real step before landing:
//   steering clear of hazards on NASA's own Jezero hazard map (PIA23970).
// - Everything drawn on the canvas (craft, stars, planets, effects) is
//   computer graphics written by AI, and the screen says so (#vg-badge).
import {sound} from "./audio.js";
import {results} from "./results.js";

const $ = (id) => document.getElementById(id);
const root = $("voyage");
const video = $("vg-video");
const canvas = $("vg-canvas");
const ctx = canvas.getContext("2d");
const params = new URLSearchParams(location.search);
const CLIP = (name) => `assets/voyage/${name}`;

// ----- facts used on screen -----
const LAUNCH = {utc: "2020-07-30 11:50 UTC", jst: "日本時間 20:50", place: "ケープカナベラル 第41発射台", rocket: "アトラスV 541"};
const ROCKET_CAM_LIFTOFF = 1032; // liftoff, in seconds of NASA's launch coverage, on the booster camera
const ASCENT_SEGMENTS = [[0, 1040], [16, 1116], [46, 1170]]; // [clip time, source time] of each cut
const ASCENT_EARTH = 46; // the clip shows Earth's horizon from here on
const ASCENT_END = 62;
const LANDING_SEGMENTS = [[0, 12], [40, 106]]; // landing.mp4: source 12-52 s and 106-200 s
const TRN_CLIP = [60, 106]; // landing.mp4 from backshell separation (source 126 s) to the sky crane (172 s)
const MOON_KM = 384_400;
const DEBRIS = {total: 21_293, debris: 15_214, craft: 6_079}; // NASA ODQN Vol. 24 No. 4 (Nov 2020)
const FLARE = {cls: "M4.4", peak: "2020-11-29 13:11 UTC", day: 122};
const SOURCES = {
  launch: ["NASA 打ち上げ中継映像", "https://images.nasa.gov/details/KSC-20200730-VP-MMS01-0001-Mars_2020_Live_Launch_Coverage_ISO_Broll_String-3254502"],
  horizons: ["JPL Horizons（探査機 -168）", "https://ssd.jpl.nasa.gov/horizons/"],
  landing: ["NASA/JPL-Caltech 着陸の実映像", "https://svs.gsfc.nasa.gov/31250"],
  edl: ["NASA/JPL 着陸の解説", "https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/"],
  hazard: ["NASA 危険度マップ PIA23970", "https://science.nasa.gov/photojournal/avoiding-hazards-at-jezero-crater/"],
  usgs: ["USGS：着陸用の地図", "https://www.usgs.gov/news/national-news-release/mars-2020-mission-be-guided-usgs-astrogeology-maps"],
  chen: ["Astronomy 誌（Allen Chen の発言）", "https://www.astronomy.com/science/mars-madness-how-perseverance-will-stick-the-landing-during-its-7-minutes-of-terror/"],
};

// Mission control's call-outs (NASA's caption track), in source seconds of the landing video.
const CALLOUTS = [
  {t: 24.5, speed: 450, alt: 12000}, {t: 44.6, speed: 145, alt: 9500}, {t: 71, alt: 7400},
  {t: 77, speed: 100, alt: 6600}, {t: 100, speed: 90, alt: 4200}, {t: 128, speed: 83, alt: 2600},
  {t: 141, speed: 75, alt: 1000}, {t: 154, speed: 30, alt: 300}, {t: 176, alt: 20}, {t: 189, speed: 0, alt: 0},
];
const STALE_SECONDS = 15; // a speed reading older than this is shown as unknown
const PHASES = [
  {t: -1, label: "大気圏突入"}, {t: 14.4, label: "パラシュート展開"}, {t: 33.3, label: "熱シールド分離"},
  {t: 109, label: "地形相対航法"}, {t: 126.1, label: "バックシェル分離・回避"}, {t: 172.5, label: "スカイクレーン"}, {t: 189, label: "着地"},
];
// Japanese subtitles of the call-outs, in source seconds.
const SUBTITLES = [
  [12, 14.3, "パラシュートを開く準備。レーダーが地面を見やすいよう、機体を回転させます"],
  [14.4, 17.7, "パラシュートの展開を確認"],
  [17.8, 24.4, "パラシュートが開き、大きく減速しています"],
  [24.5, 31.5, "現在の速さ 秒速450 m、高度 約12 km"],
  [33.3, 34.8, "熱シールド分離"],
  [34.8, 44.5, "音速より遅くなり、熱シールドを切り離しました。レーダーとカメラが初めて地表を見ます"],
  [44.6, 52, "速さ 秒速145 m、高度 約9.5 km"],
  [106, 108.9, "（約1分を省略）レーダーが地面をとらえ、パラシュートで降下を続けています"],
  [109, 115, "着陸用の画像認識が、自分の位置を割り出しました（地形相対航法）"],
  [116, 120.6, "着陸用エンジンの点火時刻が決まりました"],
  [126.1, 133.6, "バックシェル分離。速さ 秒速83 m、高度 約2.6 km"],
  [172.5, 178, "スカイクレーン開始。地表から約20 m"],
  [184.5, 188.9, "探査車からの信号を受信中…"],
  [189, 192, "着地を確認！"],
  [192, 198, "パーサヴィアランスは火星に無事着陸。過去の生命の痕跡を探す準備が整いました"],
];

// Hazard map (PIA23970): blue safe, yellow caution, red hazard; the green dot is where Perseverance landed.
const MAP = {src: CLIP("jezero-hazard-pia23970.jpg"), x0: 34, x1: 1246, y0: 0, y1: 720, land: {x: 629, y: 345}};
const TRN = {
  seconds: 32,              // play time, from backshell separation (2.6 km) to the sky crane (20 m)
  path: [{x: 400, y: 120}, {x: 520, y: 250}, MAP.land], // camera drift over the map (game setting)
  zoom: [1.0, 4.4],         // the map grows as the craft descends
  hazardPerSec: 26, cautionPerSec: 6, badLanding: 35,
  nearPx: 26,               // within this many map pixels of the real landing spot counts as "near"
};

// ----- state -----
let data;
let missionPhoto = "";
let gameTime = 0;          // seconds, advances only when not paused
let paused = false;
let speedMul = 1;          // ×1 / ×2 / ×4 for the films and cinematic scenes
let sceneToken = 0;        // skipping a scene bumps this; waits for the old value end
const waiters = new Set();
let hull = 100;
let stage = "title";
let stageProgress = 0;
let bg = {stars: true, speed: 0.12, earth: 0, mars: 0, sun: 0, entry: 0}; // slow stars behind the title
let ship = null;           // {kind, x, y, r}
let trn = null;            // the landing game while it runs
let particles = [];
let stars = [];
const keys = new Set();
let pointer = null;
let landingMode = false;
let w = 0, h = 0, scale = 1;
const hazardMap = {img: new Image(), pixels: null, width: 0};

// ----- helpers -----
const sleep = (ms) => { const end = gameTime + ms / 1000; return until(() => gameTime >= end); };
function until(cond) {
  const token = sceneToken;
  return new Promise((resolve) => waiters.add({cond, resolve, token}));
}
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
function fmtKm(km) {
  if (km >= 1e8) return `${(km / 1e8).toFixed(2)}億 km`;
  if (km >= 1e4) return `${Math.round(km / 1e4).toLocaleString("ja-JP")}万 km`;
  return `${Math.round(km).toLocaleString("ja-JP")} km`;
}
function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m ? `${m}分${String(s).padStart(2, "0")}秒` : `${s}秒`;
}
const tPlus = (sec) => `T+${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const skipped = (token) => token !== sceneToken;

function dayData(value) {
  const days = data.days;
  const i = clamp(Math.floor(value), 0, days.length - 1), j = Math.min(days.length - 1, i + 1), f = clamp(value - i, 0, 1);
  const a = days[i], b = days[j];
  const mix = (key) => lerp(a[key], b[key], f);
  const pair = (key) => [lerp(a[key][0], b[key][0], f), lerp(a[key][1], b[key][1], f)];
  return {earthKm: mix("earthKm"), marsKm: mix("marsKm"), sunSpeed: mix("sunSpeed"), lightSec: mix("lightSec"),
    pathKm: mix("pathKm"), craft: pair("craft"), earth: pair("earth"), mars: pair("mars")};
}
function dateLabel(value) {
  const date = new Date(Date.UTC(2020, 6, 30) + Math.floor(value) * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// ----- screen parts -----
const STAGES = ["liftoff", "ascent", "separation", "cruise", "entry", "landing", "trn", "touchdown"];
function setStage(name, chapter) {
  stage = name;
  stageProgress = 0;
  root.dataset.scene = name;
  if (chapter) $("vg-chapter").textContent = chapter;
  renderProgress();
  renderSpeed();
}
function renderProgress() {
  const index = STAGES.indexOf(stage);
  $("vg-progress").value = index < 0 ? (stage === "arrival" ? 1 : 0) : (index + clamp(stageProgress, 0, 1)) / STAGES.length;
}
function buildMarks() {
  const mark = document.createElement("span");
  mark.className = "tm event";
  mark.style.left = `${(STAGES.indexOf("trn") + 0.5) / STAGES.length * 100}%`;
  $("vg-marks").replaceChildren(mark);
}

// Tell the viewer what they are looking at: NASA footage, or graphics made by AI.
const BADGES = {
  nasa: ["real", "実写：NASA の映像"],
  cg: ["ai", "AI生成のCG（実写ではありません）"],
  map: ["mix", "地図：NASA（PIA23970）／機体と演出：AI生成のCG"],
};
function badge(kind) {
  const el = $("vg-badge");
  const [cls, text] = BADGES[kind];
  el.dataset.kind = cls;
  el.textContent = text;
}

function card({kind = "info", label = "MISSION CONTROL", title = "", message = "", facts = [], note = "", sources = [], actions = []} = {}) {
  const el = $("vg-card");
  el.hidden = false;
  el.dataset.kind = kind;
  $("vg-kind").textContent = label;
  $("vg-title").textContent = title;
  $("vg-message").textContent = message;
  $("vg-facts").hidden = !facts.length;
  $("vg-facts").replaceChildren(...facts.map(([term, value]) => {
    const box = document.createElement("div");
    box.className = "fact";
    const dt = document.createElement("dt"); dt.textContent = term;
    const dd = document.createElement("dd"); dd.textContent = value;
    box.append(dt, dd);
    return box;
  }));
  $("vg-note").hidden = !note;
  $("vg-note").textContent = note;
  $("vg-src").replaceChildren(...sources.map(([text, href]) => {
    const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = text;
    return a;
  }));
  $("vg-actions").hidden = !actions.length;
  $("vg-actions").replaceChildren(...actions.map(([text, onClick, primary]) => {
    const button = document.createElement("button");
    button.textContent = text;
    if (primary) button.className = "primary";
    button.addEventListener("click", onClick);
    return button;
  }));
  $("vg-actions").querySelector("button")?.focus();
}
const hideCard = () => { $("vg-card").hidden = true; $("vg-actions").hidden = true; $("vg-actions").replaceChildren(); };

let captionTimer;
function caption(text, small = "", ms = 3000) {
  const el = $("vg-caption");
  clearTimeout(captionTimer);
  el.hidden = false;
  el.replaceChildren(document.createTextNode(text));
  if (small) { const s = document.createElement("small"); s.textContent = small; el.append(s); }
  el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
  if (ms) captionTimer = setTimeout(() => { el.hidden = true; }, ms / speedMul);
}
const hideCaption = () => { clearTimeout(captionTimer); $("vg-caption").hidden = true; };

let telemetryKey = "";
function telemetry(rows, source) {
  const key = JSON.stringify([rows, source]);
  if (key === telemetryKey) return; // values change slowly; skip identical redraws
  telemetryKey = key;
  $("vg-telemetry").replaceChildren(...rows.map(([label, value, extra, bar]) => {
    const row = document.createElement("div");
    row.className = "vg-row";
    const span = document.createElement("span"); span.textContent = label;
    const b = document.createElement("b"); b.textContent = value;
    row.append(span, b);
    if (extra) { const small = document.createElement("small"); small.textContent = extra; row.append(small); }
    if (bar !== undefined) {
      const track = document.createElement("div"); track.className = "vg-bar";
      const fill = document.createElement("i"); fill.style.width = `${clamp(bar, 0, 1) * 100}%`;
      track.append(fill); row.append(track);
    }
    return row;
  }));
  if (source) $("vg-hud-src").textContent = source;
}
function clockPill(clock, label) {
  if ($("vg-clock").textContent !== clock) $("vg-clock").textContent = clock;
  if ($("vg-day").textContent !== label) $("vg-day").textContent = label;
}

function renderHull() {
  const value = Math.max(0, Math.ceil(hull));
  $("vg-hull-value").textContent = `${value}%`;
  $("vg-hull-bar").style.width = `${value}%`;
  $("vg-hull").dataset.level = value <= 25 ? "low" : value <= 50 ? "mid" : "ok";
  $("vg-hull").setAttribute("aria-valuenow", value);
}
function floatHull(change) {
  const el = $("vg-hull-float");
  el.textContent = `${change > 0 ? "+" : "−"}${Math.abs(Math.round(change))}%`;
  el.className = "power-float mono";
  void el.offsetWidth;
  el.className = `power-float mono ${change > 0 ? "up" : "down"}`;
}

// ----- playback speed -----
const SPEEDS = [1, 2, 4];
function renderSpeed() {
  const button = $("vg-speed");
  button.hidden = stage === "title" || stage === "arrival" || (trn && trn.state === "play");
  button.textContent = `×${speedMul}`;
  button.setAttribute("aria-label", `再生の速さ ${speedMul}倍（押すと切り替え）`);
}
let videoBaseRate = 1;
function applyRate() {
  if (trn) return; // the landing game sets its own rate
  video.playbackRate = clamp(videoBaseRate * speedMul, 0.25, 16);
}

// ----- orbit minimap -----
const ORBIT_SCALE = 26; // SVG units per AU: Mars at aphelion (1.67 AU) sits inside the ring
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const toSvg = ([x, y]) => [x * ORBIT_SCALE, -y * ORBIT_SCALE];
function orbitPath(a, e, perihelionDeg) {
  const points = [];
  for (let k = 0; k <= 72; k += 1) {
    const theta = k / 72 * Math.PI * 2;
    const r = a * (1 - e * e) / (1 + e * Math.cos(theta - perihelionDeg * Math.PI / 180));
    points.push(toSvg([r * Math.cos(theta), r * Math.sin(theta)]).map((v) => v.toFixed(2)).join(","));
  }
  return points.join(" ");
}
function drawOrbit() {
  const svg = $("vg-orbit");
  const path = data.days.map((d) => toSvg(d.craft).map((v) => v.toFixed(2)).join(",")).join(" ");
  svg.replaceChildren(
    svgEl("circle", {r: 46.5, class: "mm-rim"}),
    svgEl("circle", {r: 44, class: "o-bg"}),
    svgEl("polygon", {points: orbitPath(1.000, 0.0167, 102.9), class: "o-orbit"}),   // Earth: a, e, longitude of perihelion
    svgEl("polygon", {points: orbitPath(1.5237, 0.0934, 336.0), class: "o-orbit"}),  // Mars
    svgEl("polyline", {points: path, class: "o-path"}),
    svgEl("polyline", {points: "", class: "o-done", id: "o-done"}),
    svgEl("circle", {r: 2.6, class: "o-sun"}),
    svgEl("circle", {r: 2.2, class: "o-earth", id: "o-earth"}),
    svgEl("circle", {r: 1.9, class: "o-mars", id: "o-mars"}),
    svgEl("circle", {r: 1.6, class: "o-craft", id: "o-craft"}),
  );
}
function renderOrbit(value) {
  const d = dayData(value);
  const set = (id, p) => { const [x, y] = toSvg(p); $(id).setAttribute("cx", x); $(id).setAttribute("cy", y); };
  set("o-earth", d.earth); set("o-mars", d.mars); set("o-craft", d.craft);
  const done = data.days.slice(0, Math.floor(value) + 1).map((x) => toSvg(x.craft).map((v) => v.toFixed(2)).join(","));
  done.push(toSvg(d.craft).join(","));
  $("o-done").setAttribute("points", done.join(" "));
}
function renderCruise(value) {
  const d = dayData(value);
  const total = data.days.at(-1).pathKm;
  renderOrbit(value);
  telemetry([
    ["地球からの距離", fmtKm(d.earthKm), d.earthKm > MOON_KM ? `月までの${(d.earthKm / MOON_KM).toFixed(0)}倍` : ""],
    ["火星までの距離", fmtKm(d.marsKm)],
    ["太陽に対する速さ", `秒速 ${d.sunSpeed.toFixed(1)} km`, `時速 ${(d.sunSpeed * 3.6).toFixed(1)}万 km`],
    ["電波が地球に届くまで", fmtDuration(d.lightSec)],
    ["進んだ道のり", fmtKm(d.pathKm), `${Math.round(d.pathKm / total * 100)}%`, d.pathKm / total],
  ], "JPL Horizons");
  clockPill(dateLabel(value), `打ち上げから ${Math.floor(value)}日目`);
  $("vg-orbit-label").textContent = `${Math.floor(value)}日目 / ${data.days.length - 1}日`;
}

// ----- canvas -----
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  w = canvas.clientWidth || innerWidth; h = canvas.clientHeight || innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = Math.max(0.6, Math.min(w, h) / 820); // keep the craft big enough to see on phones
  if (ship) { ship.y = h * 0.66; ship.r = (ship.kind === "capsule" ? 30 : 22) * scale; }
}
function makeStars() {
  stars = Array.from({length: 220}, () => ({x: Math.random(), y: Math.random(), z: rand(0.2, 1)}));
}
function setShip(kind) {
  ship = kind ? {kind, x: w / 2, y: h * 0.66, r: (kind === "capsule" ? 30 : 22) * scale} : null;
}

function drawBackground(dt) {
  if (bg.stars) {
    ctx.fillStyle = "#020304";
    ctx.fillRect(0, 0, w, h);
    for (const star of stars) {
      star.y += bg.speed * star.z * dt * 0.25;
      if (star.y > 1) { star.y -= 1; star.x = Math.random(); }
      ctx.globalAlpha = 0.35 + star.z * 0.65;
      ctx.fillStyle = "#e9f1ff";
      const size = star.z * 1.8;
      ctx.fillRect(star.x * w, star.y * h, size, size * (1 + bg.speed * 2));
    }
    ctx.globalAlpha = 1;
  }
  if (bg.sun > 0) {
    const g = ctx.createRadialGradient(w * 0.82, -h * 0.05, 10, w * 0.82, -h * 0.05, Math.max(w, h) * 0.7);
    g.addColorStop(0, `rgba(255,230,150,${0.9 * bg.sun})`);
    g.addColorStop(0.25, `rgba(255,150,60,${0.35 * bg.sun})`);
    g.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  if (bg.earth > 0) planet(w * 0.5, h + bg.earth * 0.55, bg.earth, ["#9fd4ff", "#2f6db5", "#0b2346"], true);
  if (bg.mars > 0) planet(w * 0.5, -bg.mars * 0.35, bg.mars, ["#f2b07c", "#c1603a", "#4c2116"], false);
  if (bg.entry > 0) {
    const g = ctx.createRadialGradient(w / 2, h * 0.7, 10, w / 2, h * 0.7, Math.max(w, h) * 0.6);
    g.addColorStop(0, `rgba(255,200,120,${0.55 * bg.entry})`);
    g.addColorStop(0.4, `rgba(255,90,40,${0.3 * bg.entry})`);
    g.addColorStop(1, "rgba(80,10,0,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
}
function planet(x, y, r, [light, mid, dark], clouds) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, light); g.addColorStop(0.55, mid); g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = clouds ? "rgba(160,210,255,.5)" : "rgba(255,190,150,.35)";
  ctx.lineWidth = Math.max(2, r * 0.03);
  ctx.beginPath(); ctx.arc(x, y, r * 1.01, 0, Math.PI * 2); ctx.stroke();
}

function drawShip() {
  if (!ship) return;
  const {x, y, kind} = ship;
  const s = scale;
  ctx.save();
  ctx.translate(x, y);
  if (kind === "cruise") {
    // Cruise stage seen from the Sun side: a ring of solar cells around the aeroshell.
    const r = 24 * s;
    ctx.rotate(gameTime * 0.35);
    ctx.fillStyle = "#1c2f5c"; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#8da2c8"; ctx.lineWidth = 1;
    for (let i = 0; i < 10; i += 1) {
      const a = i / 10 * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#e9ebe6"; ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#b9bdb5"; ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2); ctx.fill();
  } else if (kind === "capsule") {
    // Aeroshell entering the atmosphere, heat shield first (down the screen).
    const r = 30 * s;
    const glow = ctx.createRadialGradient(0, r * 0.6, 4, 0, r * 0.6, r * 2.6);
    glow.addColorStop(0, "rgba(255,240,200,.95)"); glow.addColorStop(0.3, "rgba(255,140,60,.6)"); glow.addColorStop(1, "rgba(255,60,20,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, r * 0.6, r * 2.6 + Math.random() * 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e7e3da"; ctx.beginPath(); ctx.moveTo(-r * 0.55, -r * 0.7); ctx.lineTo(r * 0.55, -r * 0.7); ctx.lineTo(r, r * 0.3); ctx.lineTo(-r, r * 0.3); ctx.fill();
    ctx.fillStyle = "#5a3a26"; ctx.beginPath(); ctx.ellipse(0, r * 0.32, r, r * 0.28, 0, 0, Math.PI); ctx.fill();
  }
  ctx.restore();
}

function burst(x, y, color, n = 16) {
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * Math.PI * 2, v = rand(60, 260) * scale;
    particles.push({x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.3, 0.8), color});
  }
}

// ----- the landing game: steer clear of hazards on NASA's map -----
function loadHazardMap() {
  return new Promise((resolve) => {
    hazardMap.img.onload = () => {
      const off = document.createElement("canvas");
      off.width = hazardMap.img.naturalWidth; off.height = hazardMap.img.naturalHeight;
      const octx = off.getContext("2d");
      octx.drawImage(hazardMap.img, 0, 0);
      try { hazardMap.pixels = octx.getImageData(0, 0, off.width, off.height).data; } catch { hazardMap.pixels = null; }
      hazardMap.width = off.width;
      resolve();
    };
    hazardMap.img.onerror = () => resolve();
    hazardMap.img.src = MAP.src;
  });
}
// "hazard" (red), "caution" (yellow) or "safe" (blue) under a map point.
function terrainAt(x, y) {
  if (x < MAP.x0 || x >= MAP.x1 || y < MAP.y0 || y >= MAP.y1) return "hazard"; // off the map: outside the landing area
  if (!hazardMap.pixels) return "safe";
  const i = (Math.floor(y) * hazardMap.width + Math.floor(x)) * 4;
  const r = hazardMap.pixels[i], g = hazardMap.pixels[i + 1], b = hazardMap.pixels[i + 2];
  if (r > 170 && g < 110) return "hazard";
  if (r > 150 && g >= 110 && b < 150) return "caution";
  return "safe";
}
function bezier(t) {
  const [a, b, c] = TRN.path;
  const u = 1 - t;
  return {x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y};
}
function trnView() {
  const f = clamp(trn.t / TRN.seconds, 0, 1);
  const fit = Math.max(w / (MAP.x1 - MAP.x0), h / (MAP.y1 - MAP.y0));
  const px = fit * lerp(TRN.zoom[0], TRN.zoom[1], ease(f));
  // Keep the view inside the map, so no black edges show.
  const raw = bezier(ease(f)), halfW = w / px / 2, halfH = h / px / 2;
  const cam = {x: clamp(raw.x, MAP.x0 + halfW, Math.max(MAP.x0 + halfW, MAP.x1 - halfW)),
    y: clamp(raw.y, MAP.y0 + halfH, Math.max(MAP.y0 + halfH, MAP.y1 - halfH))};
  return {f, cam, px};
}
// Ground point under the craft, in map pixels.
function trnGround(view) {
  return {x: view.cam.x + trn.ox / view.px, y: view.cam.y + trn.oy / view.px};
}
const trnSource = (f) => 126 + f * (176 - 126); // landing-video seconds the game stands for
function interpCallout(src, key) {
  const list = CALLOUTS.filter((c) => c[key] !== undefined);
  const after = list.findIndex((c) => c.t >= src);
  if (after <= 0) return list[Math.max(0, after)][key];
  const a = list[after - 1], b = list[after];
  return lerp(a[key], b[key], (src - a.t) / (b.t - a.t));
}

const BRIEF_SECONDS = 5;
function renderTrnHud(f) {
  const src = trnSource(f);
  const alt = interpCallout(src, "alt"), spd = interpCallout(src, "speed");
  telemetry([
    ["高度", alt >= 1000 ? `約${(alt / 1000).toFixed(1)} km` : `約${Math.round(alt)} m`, "管制の読み上げ値を補間"],
    ["速さ", `秒速 ${Math.round(spd)} m`, `時速 ${Math.round(spd * 3.6)} km`],
    ["足もと", trn.under === "hazard" ? "危険（赤）" : trn.under === "caution" ? "注意（黄）" : "安全（青）"],
  ], "NASA 管制の読み上げ");
}
function updateTrn(dt) {
  if (!trn) return;
  trn.t0 += dt;
  if (trn.state === "brief") {
    $("vg-timer").textContent = `開始まで ${Math.max(1, Math.ceil(BRIEF_SECONDS - trn.t0))}（いまのうちに位置を決められます）`;
    steerTrn(dt, trnView(), false);
    renderTrnHud(0);
    if (trn.t0 >= BRIEF_SECONDS) {
      trn.state = "play"; root.dataset.playing = "dodge"; renderSpeed(); sound.play("count");
      video.playbackRate = (TRN_CLIP[1] - TRN_CLIP[0]) / TRN.seconds;
      video.play().catch(() => {});
    }
    return;
  }
  if (trn.state !== "play") return;
  trn.t += dt;
  const view = trnView();
  stageProgress = view.f; renderProgress();
  $("vg-timer").textContent = `残り ${Math.max(0, Math.ceil(TRN.seconds - trn.t))} 秒`;

  // Wind: gusts that grow as the craft gets lower (NASA: wind pushed Perseverance southeast on the parachute).
  trn.gustIn -= dt;
  if (trn.gustIn <= 0) {
    const strength = lerp(40, 190, view.f) * scale;
    const angle = Math.PI / 4 + rand(-1.4, 1.4); // mostly toward the southeast (down-right)
    trn.wind = {x: Math.cos(angle) * strength, y: Math.sin(angle) * strength};
    trn.gustIn = lerp(2.6, 1.3, view.f);
  }
  trn.wind.x *= 1 - dt * 0.6; trn.wind.y *= 1 - dt * 0.6;

  steerTrn(dt, view, true);
  const g = trnGround(view);

  // Damage from what is under the craft (centre plus four points of its footprint).
  const r = 12 * scale / view.px;
  const samples = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].map(([sx, sy]) => terrainAt(g.x + sx, g.y + sy));
  const hazards = samples.filter((s) => s === "hazard").length, cautions = samples.filter((s) => s === "caution").length;
  trn.under = samples[0] === "hazard" || hazards >= 3 ? "hazard" : samples[0] === "caution" || cautions + hazards >= 3 ? "caution" : "safe";
  const rate = trn.under === "hazard" ? TRN.hazardPerSec * lerp(0.8, 1.4, view.f) : trn.under === "caution" ? TRN.cautionPerSec : 0;
  if (rate) {
    hull = Math.max(0, hull - rate * dt);
    trn.damage += rate * dt;
    trn.hazardTime += trn.under === "hazard" ? dt : 0;
    renderHull();
    trn.hitCooldown -= dt;
    if (trn.under === "hazard" && trn.hitCooldown <= 0) {
      trn.hitCooldown = 0.45;
      sound.play("hit");
      root.classList.remove("hit"); void root.offsetWidth; root.classList.add("hit");
      burst(w / 2 + trn.ox, h * 0.5 + trn.oy, "#ff9a6b", 8);
    }
    if (hull <= 0) { trn.state = "failed"; root.dataset.playing = ""; renderSpeed(); return; }
  }

  // Stage call-outs as the altitude drops.
  renderTrnHud(view.f);
  for (const note of trn.notes) {
    if (!note.done && view.f >= note.f) { note.done = true; caption(note.text, note.small, 2600); }
  }
  if (trn.t >= TRN.seconds) {
    const land = trnGround(view);
    trn.final = terrainAt(land.x, land.y);
    trn.distance = Math.hypot(land.x - MAP.land.x, land.y - MAP.land.y);
    if (trn.final === "hazard") { hull = Math.max(0, hull - TRN.badLanding); floatHull(-TRN.badLanding); renderHull(); }
    trn.state = hull <= 0 ? "failed" : "clear";
    root.dataset.playing = "";
    renderSpeed();
  }
}

// Steering: keys or follow the pointer; the wind pushes only while the game runs.
function steerTrn(dt, view, windy) {
  const speed = lerp(380, 300, view.f) * scale;
  let dx = 0, dy = 0;
  if (keys.has("ArrowLeft") || keys.has("a")) dx -= 1;
  if (keys.has("ArrowRight") || keys.has("d")) dx += 1;
  if (keys.has("ArrowUp") || keys.has("w")) dy -= 1;
  if (keys.has("ArrowDown") || keys.has("s")) dy += 1;
  if (dx || dy) {
    const n = Math.hypot(dx, dy);
    trn.ox += dx / n * speed * dt; trn.oy += dy / n * speed * dt;
    pointer = null;
  } else if (pointer) {
    const tx = pointer.x - w / 2, ty = pointer.y - h * 0.5;
    trn.ox += clamp(tx - trn.ox, -speed * dt, speed * dt);
    trn.oy += clamp(ty - trn.oy, -speed * dt, speed * dt);
  }
  if (windy) { trn.ox += trn.wind.x * dt; trn.oy += trn.wind.y * dt; }
  trn.ox = clamp(trn.ox, -w * 0.42, w * 0.42);
  trn.oy = clamp(trn.oy, -h * 0.36, h * 0.3);
  if (!windy) {
    const g = trnGround(view);
    trn.under = terrainAt(g.x, g.y);
  }
}

// Start on the nearest safe (blue) spot to the middle of the screen.
function safeStart() {
  const view = trnView();
  for (let radius = 0; radius < Math.min(w, h) * 0.3; radius += 6) {
    for (let k = 0; k < 24; k += 1) {
      const a = k / 24 * Math.PI * 2, ox = Math.cos(a) * radius, oy = Math.sin(a) * radius;
      if (terrainAt(view.cam.x + ox / view.px, view.cam.y + oy / view.px) === "safe") return {ox, oy};
    }
  }
  return {ox: 0, oy: 0};
}

function drawTrn() {
  if (!trn) return;
  const view = trnView();
  const {cam, px} = view;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  if (hazardMap.img.complete && hazardMap.img.naturalWidth) {
    const sw = w / px, sh = h / px;
    ctx.drawImage(hazardMap.img, cam.x - sw / 2, cam.y - sh / 2, sw, sh, 0, 0, w, h);
  }
  // A darker rim, like a camera view.
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

  // The real landing spot appears for the last stretch.
  if (view.f > 0.7) {
    const lx = w / 2 + (MAP.land.x - cam.x) * px, ly = h / 2 + (MAP.land.y - cam.y) * px;
    const pulse = 1 + Math.sin(gameTime * 5) * 0.08;
    ctx.strokeStyle = "rgba(120,255,140,.95)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(lx, ly, TRN.nearPx * px * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `700 ${Math.round(14 * Math.max(0.9, scale))}px "Yu Gothic UI", sans-serif`;
    ctx.fillStyle = "rgba(0,0,0,.6)";
    const label = "実際の着陸地点";
    const tw = ctx.measureText(label).width;
    ctx.fillRect(lx - tw / 2 - 6, ly - TRN.nearPx * px - 30, tw + 12, 22);
    ctx.fillStyle = "#b8ffc4"; ctx.fillText(label, lx - tw / 2, ly - TRN.nearPx * px - 14);
  }

  // Craft: the descent stage seen from above, with its footprint ring.
  const x = w / 2 + trn.ox, y = h * 0.5 + trn.oy, s = scale;
  const danger = trn.under === "hazard", warn = trn.under === "caution";
  ctx.strokeStyle = danger ? "rgba(255,80,60,.95)" : warn ? "rgba(255,220,90,.95)" : "rgba(184,249,142,.95)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.arc(x, y, 30 * s * (danger ? 1 + Math.sin(gameTime * 20) * 0.08 : 1), 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(6 * s, 8 * s, 18 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#cfd3cc"; ctx.fillRect(-14 * s, -10 * s, 28 * s, 20 * s);
  ctx.fillStyle = "#8f6a2a"; ctx.fillRect(-10 * s, -6 * s, 20 * s, 12 * s);
  for (const [ex, ey] of [[-16, -12], [16, -12], [-16, 12], [16, 12]]) {
    const flame = 0.6 + Math.random() * 0.4;
    ctx.fillStyle = `rgba(255,200,120,${flame})`;
    ctx.beginPath(); ctx.arc(ex * s, ey * s, 4.5 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // Wind arrow.
  const wl = Math.hypot(trn.wind.x, trn.wind.y);
  if (wl > 20 * scale && trn.state === "play") {
    const ax = w / 2, ay = h * 0.18, k = Math.min(1, wl / (190 * scale)) * 60 * scale;
    const ux = trn.wind.x / wl, uy = trn.wind.y / wl;
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ax - ux * k, ay - uy * k); ctx.lineTo(ax + ux * k, ay + uy * k); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax + ux * k, ay + uy * k); ctx.lineTo(ax + ux * k - (ux * 12 - uy * 8), ay + uy * k - (uy * 12 + ux * 8));
    ctx.lineTo(ax + ux * k - (ux * 12 + uy * 8), ay + uy * k - (uy * 12 - ux * 8)); ctx.closePath(); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.font = `600 ${Math.round(13 * Math.max(0.9, scale))}px "Yu Gothic UI", sans-serif`;
    ctx.fillText("風", ax - 6, ay - k - 8);
  }
}

function updateWorld(dt) {
  if (ship) ship.x += (w / 2 - ship.x) * Math.min(1, dt * 2);
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
  particles = particles.filter((p) => p.life > 0);
}

function draw(dt) {
  ctx.clearRect(0, 0, w, h);
  if (trn) drawTrn();
  else { drawBackground(dt); drawShip(); }
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life * 1.6, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 3 * scale, 3 * scale);
  }
  ctx.globalAlpha = 1;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) {
    const playing = trn && trn.state !== "brief";
    gameTime += dt * (playing ? 1 : speedMul); // fast-forward the cinematic parts only
    updateTrn(dt);
    updateWorld(dt);
    if (landingMode) updateLanding();
  }
  for (const waiter of [...waiters]) {
    if (waiter.token !== sceneToken || waiter.cond()) { waiters.delete(waiter); waiter.resolve(); }
  }
  draw(paused ? 0 : dt * speedMul);
  if (document.body.dataset.scene === "voyage") requestAnimationFrame(frame);
}

// ----- video -----
function playVideo(name, {rate = 1, fit = "cover", volume = 1, pip = false} = {}) {
  root.dataset.fit = fit;
  root.dataset.video = "on";
  root.dataset.pip = pip ? "on" : "off";
  video.src = CLIP(name);
  videoBaseRate = rate;
  video.defaultPlaybackRate = rate;
  applyRate();
  video.volume = volume;
  video.muted = !sound.enabled;
  video.loop = false;
  return startVideo();
}
// Play from where the video is; done when it ends, fails, or never starts (for example without codecs).
function startVideo() {
  const started = gameTime;
  video.play()?.catch(() => { video.muted = true; video.play().catch(() => {}); });
  return () => video.ended || Boolean(video.error) || (gameTime - started > 6 * speedMul && video.currentTime < 0.05);
}
function stopVideo() {
  video.pause();
  root.dataset.video = "off";
  root.dataset.pip = "off";
}

// ----- scenes -----
async function sceneLiftoff() {
  const token = sceneToken;
  setStage("liftoff", "打ち上げ");
  badge("nasa");
  setShip(null); bg = {stars: false, speed: 0, earth: 0, mars: 0, sun: 0, entry: 0};
  hideCard();
  telemetry([["ロケット", LAUNCH.rocket], ["発射場所", LAUNCH.place], ["打ち上げ", LAUNCH.utc, LAUNCH.jst]], "NASA");
  root.dataset.fit = "cover";
  video.src = CLIP("liftoff.mp4");
  video.muted = !sound.enabled;
  video.volume = 1;
  video.load();
  root.dataset.video = "on";
  const count = $("vg-count");
  for (let n = 5; n >= 1; n -= 1) {
    count.hidden = false; count.className = "vg-count mono"; count.textContent = n;
    clockPill(LAUNCH.utc, `T−${n}`);
    sound.play("count");
    await sleep(900);
    if (skipped(token)) { count.hidden = true; return; }
  }
  count.className = "vg-count mono go"; count.textContent = "LIFTOFF";
  clockPill(LAUNCH.utc, "T+00:00");
  sound.play("go");
  const done = playVideo("liftoff.mp4", {volume: 1});
  await sleep(1300);
  count.hidden = true;
  if (skipped(token)) return;
  caption("リフトオフ", `2020年7月30日 ${LAUNCH.utc}（${LAUNCH.jst}）・NASA の発射台カメラ`, 5000);
  await until(() => {
    stageProgress = video.currentTime / 20; renderProgress();
    clockPill(LAUNCH.utc, tPlus(video.currentTime));
    return done();
  });
}

async function sceneAscent() {
  setStage("ascent", "上昇");
  badge("nasa");
  const done = playVideo("ascent.mp4", {rate: 2, volume: 0.6});
  const captions = [[0.2, "ロケットの機体カメラ", "アトラスV の第1段に付けたカメラ（NASA の打ち上げ中継映像・2倍速）"],
    [15.5, "固体ロケットブースターを切り離す", ""],
    [ASCENT_EARTH, "地球を回る軌道へ", `この高さを回る登録物体は ${DEBRIS.total.toLocaleString("ja-JP")} 個（うち破片とロケットの機体 ${DEBRIS.debris.toLocaleString("ja-JP")} 個。NASA・2020年11月）`]];
  let shown = 0;
  await until(() => {
    const t = video.currentTime;
    while (shown < captions.length && t >= captions[shown][0]) { const [, a, b] = captions[shown++]; caption(a, b, 4200); }
    const seg = [...ASCENT_SEGMENTS].reverse().find(([clipT]) => t >= clipT) ?? ASCENT_SEGMENTS[0];
    const sinceLiftoff = seg[1] + (t - seg[0]) - ROCKET_CAM_LIFTOFF;
    clockPill(LAUNCH.utc, tPlus(sinceLiftoff));
    telemetry([["打ち上げからの時間", tPlus(sinceLiftoff), "映像の時刻から"], ["ロケット", LAUNCH.rocket], ["発射場所", LAUNCH.place]], "NASA 映像");
    stageProgress = t / ASCENT_END; renderProgress();
    return t >= ASCENT_END || done();
  });
}

async function sceneSeparation() {
  const token = sceneToken;
  setStage("separation", "探査機の分離");
  badge("nasa");
  hideCard(); setShip(null);
  const done = playVideo("separation.mp4", {rate: 1.5, volume: 0.5});
  caption("探査機がロケットから離れる", "上段ロケット Centaur のカメラ。円盤形のクルーズステージが遠ざかっていきます（NASA・1.5倍速）", 6000);
  let second = false;
  await until(() => {
    if (!second && video.currentTime > 12) { second = true; caption("火星まで 203日の旅", `NASA の発表で約4億7,200万 km。Horizons の軌道から計算すると ${fmtKm(data.days.at(-1).pathKm)}`, 6000); }
    stageProgress = video.currentTime / 32; renderProgress();
    return done();
  });
  if (skipped(token)) return;
  stopVideo();
}

// Real events along the way, shown as notes during the cruise.
function cruiseNotes() {
  const days = data.days, total = days.at(-1).pathKm;
  const half = days.find((d) => d.pathKm >= total / 2);
  const near = days.find((d) => d.marsKm < 5e6);
  const nearest = data.asteroids.nearest[0];
  return [
    {day: 2, text: "打ち上げの週、地球のそばを小惑星が通過",
      small: `7月30日〜8月5日に ${data.asteroids.count} 個。いちばん近い ${nearest.name}（直径 約${nearest.diameterM} m）も月までの距離の ${nearest.missLunar} 倍（NASA NeoWs）`},
    {day: half.day, text: "旅の半分", small: `${dateLabel(half.day)}・${fmtKm(half.pathKm)} を進んだ（JPL Horizons）`},
    {day: FLARE.day, text: `太陽フレア ${FLARE.cls}`, small: `${FLARE.peak}。3年あまりで最大のフレア。噴き出した物質は地球の方向には向かいませんでした`},
    {day: near.day, text: "火星が近づく", small: `${dateLabel(near.day)}・火星まで ${fmtKm(near.marsKm)}`},
  ];
}

async function sceneCruise() {
  const token = sceneToken;
  setStage("cruise", "火星への航行");
  badge("cg");
  root.dataset.video = "off"; video.pause();
  hideCard();
  setShip("cruise");
  sound.drone(true);
  const from = 0, to = data.days.length - 1, seconds = 20;
  const notes = cruiseNotes();
  const startAt = gameTime;
  await until(() => {
    const f = clamp((gameTime - startAt) / seconds, 0, 1);
    const value = lerp(from, to, f);
    const d = dayData(value);
    bg.stars = true; bg.speed = 0.6 + Math.sin(f * Math.PI) * 1.6; bg.entry = 0;
    bg.sun = Math.abs(value - FLARE.day) < 6 ? 1 - Math.abs(value - FLARE.day) / 6 : 0;
    bg.earth = d.earthKm < 3e6 ? clamp(260 * scale * 400000 / Math.max(d.earthKm, 400000), 12, 260 * scale) : 0;
    bg.mars = d.marsKm < 8e6 ? clamp(220 * scale * 1e6 / Math.max(d.marsKm, 1e6), 10, 240 * scale) : 0;
    renderCruise(value);
    while (notes.length && value >= notes[0].day) { const n = notes.shift(); caption(n.text, n.small, 3600); }
    stageProgress = f; renderProgress();
    return f >= 1;
  });
  if (skipped(token)) renderCruise(to);
}

// Landing video: call-outs, phases and subtitles follow the source time.
function landingSource(t) {
  const seg = [...LANDING_SEGMENTS].reverse().find(([clipT]) => t >= clipT) ?? LANDING_SEGMENTS[0];
  return seg[1] + (t - seg[0]);
}
let lastSub = "";
function renderPhases(src) {
  const phaseIndex = PHASES.reduce((index, p, i) => (src >= p.t ? i : index), 0);
  [...$("vg-phases").children].forEach((li, i) => { li.className = i < phaseIndex ? "done" : i === phaseIndex ? "now" : ""; });
}
function updateLanding() {
  const src = landingSource(video.currentTime);
  let speed = null, alt = null, speedAt = -Infinity;
  for (const c of CALLOUTS) { if (c.t <= src) { if (c.speed !== undefined) { speed = c.speed; speedAt = c.t; } if (c.alt !== undefined) alt = c.alt; } }
  if (src - speedAt > STALE_SECONDS && speed !== 0) speed = null; // don't keep showing an old reading
  const altText = alt === null ? "—" : alt >= 1000 ? `約${(alt / 1000).toFixed(1)} km` : `約${alt} m`;
  telemetry([
    ["速さ（管制の読み上げ）", speed === null ? "—" : `秒速 ${speed} m`, speed === null ? "" : `時速 ${Math.round(speed * 3.6).toLocaleString("ja-JP")} km`],
    ["高度（同）", altText],
  ], "NASA 管制の読み上げ");
  renderPhases(src);
  const sub = SUBTITLES.find(([a, b]) => src >= a && src < b);
  const text = sub ? sub[2] : "";
  if (text !== lastSub) {
    lastSub = text;
    $("vg-sub").hidden = !text;
    $("vg-sub").textContent = text;
  }
}

async function sceneEntry() {
  const token = sceneToken;
  setStage("entry", "着陸");
  badge("cg");
  hideCard();
  root.dataset.hull = "off";
  root.dataset.video = "off";
  sound.drone(false);
  setShip("capsule");
  bg = {stars: true, speed: 3, earth: 0, mars: 0, sun: 0, entry: 1};
  const light = data.days.at(-1).lightSec;
  telemetry([["突入の速さ", "時速 約19,500 km"], ["着地までの時間", "約7分"], ["電波が地球に届くまで", fmtDuration(light)]], "NASA / JPL Horizons");
  clockPill("2021-02-18", "着陸の日");
  sound.play("entry");
  caption("火星の大気に突入", "時速 約19,500 km から、約7分で時速 約3 km まで減速して着地します（NASA）", 3800);
  await sleep(3800);
  if (skipped(token)) return;
  caption("恐怖の7分間", `電波が地球に届くまで ${fmtDuration(light)}。管制室に知らせが届くのは、すべてが終わった後です`, 4200);
  await sleep(4200);
}

// Part 1 of the film: parachute, heat shield, the first look at the ground.
async function sceneDescent() {
  setStage("landing", "着陸");
  badge("nasa");
  clockPill("2021-02-18", "着陸の日");
  setShip(null); bg = {stars: false, speed: 0, earth: 0, mars: 0, sun: 0, entry: 0};
  hideCaption();
  $("vg-phases").hidden = false;
  $("vg-phases").replaceChildren(...PHASES.map((p) => { const li = document.createElement("li"); li.textContent = p.label; return li; }));
  card({kind: "info", label: "実際の映像", title: "パーサヴィアランスの着陸",
    message: "機体のカメラが撮った実際の映像です。音声は当日の管制室の読み上げ（英語）。字幕と右の数値は、その読み上げから付けています。",
    sources: [SOURCES.landing, SOURCES.edl]});
  const done = playVideo("landing.mp4", {fit: "contain", volume: 1});
  landingMode = true;
  setTimeout(hideCard, 7000);
  await until(() => { stageProgress = video.currentTime / TRN_CLIP[0]; renderProgress(); return video.currentTime >= TRN_CLIP[0] || done(); });
  landingMode = false;
  $("vg-sub").hidden = true;
}

// The game: backshell separation (2.6 km) to the sky crane (20 m), on NASA's hazard map.
async function runTrn() {
  setStage("trn", "着陸地点へ回避");
  badge("map");
  hideCaption();
  root.dataset.hull = "on";
  hull = 100; renderHull();
  renderPhases(126.1);
  for (;;) {
    const token = sceneToken;
    video.pause();
    try { if (Math.abs(video.currentTime - TRN_CLIP[0]) > 0.5) video.currentTime = TRN_CLIP[0]; } catch { /* not seekable */ }
    root.dataset.video = video.error ? "off" : "on";
    root.dataset.pip = "on"; // the real descent camera keeps running in a corner
    particles = [];
    trn = {state: "brief", t: 0, t0: 0, ox: 0, oy: 0, wind: {x: 0, y: 0}, gustIn: 1.2, hitCooldown: 0,
      under: "safe", damage: 0, hazardTime: 0, final: null, distance: null,
      notes: [{f: 0.02, text: "高度 2.6 km：回避開始", small: "バックシェルを切り離し、エンジンで横へ移動"},
        {f: 0.42, text: "高度 1 km：風が強まる", small: "流されないように"},
        {f: 0.72, text: "高度 300 m：着地点を決める", small: "緑の輪が実際の着陸地点"}]};
    Object.assign(trn, safeStart());
    renderSpeed();
    card({kind: "warn", label: "最大の難所", title: "着陸地点へ回避：地形相対航法",
      message: "NASA が着陸のために作った実際の危険度マップです。青は安全、黄は注意、赤は危険（崖・岩の多い場所・砂丘など）。赤の上を通らず、最後は青の上に降りてください。← → ↑ ↓・マウス・指で動かします。風で南東へ流されます。",
      facts: [["着陸の責任者の言葉", "「これまでで最も危険な着陸地点」"], ["回避を始める高度", "約2.6 km（管制の読み上げ）"], ["地図", "NASA PIA23970（HiRISE の画像から作成）"]],
      note: "地図と高度は NASA の記録。機体の絵・風の強さ・ダメージはゲームの設定です（AI生成のCG）。右下の小窓は同じ時間帯の実際の映像です。",
      sources: [SOURCES.hazard, SOURCES.usgs, SOURCES.chen]});
    $("vg-timer").textContent = "";
    sound.play("warn");
    await until(() => trn.state === "clear" || trn.state === "failed");
    root.dataset.playing = "";
    if (skipped(token)) { results.voyage = {...(results.voyage ?? {}), skippedLanding: true}; trn = null; hideCard(); return; }
    if (trn.state === "clear") {
      const safe = trn.final !== "hazard";
      const near = trn.distance <= TRN.nearPx;
      results.voyage = {hull: Math.ceil(hull), safe, near, hazardSeconds: +trn.hazardTime.toFixed(1)};
      sound.play(safe ? "clear" : "hit");
      caption(safe ? (near ? "実際の着陸地点にぴったり！" : "安全な場所に着地") : "危険な場所に着地…",
        `機体の状態 ${Math.ceil(hull)}%・赤の上にいた時間 ${trn.hazardTime.toFixed(1)} 秒`, 2600);
      hideCard();
      await sleep(1800);
      trn = null;
      return;
    }
    let retry = false;
    sound.play("fail");
    card({kind: "fail", label: "着陸失敗", title: "機体が大きく損傷しました",
      message: "もう一度挑戦できます。風が吹く向き（南東）の反対側に、早めに寄せておくのがこつです。",
      actions: [["もう一度挑戦する", () => { retry = true; }, true]]});
    await until(() => retry);
    hull = 100; renderHull();
    if (skipped(token)) { trn = null; hideCard(); return; }
  }
}

// Part 2 of the film: the sky crane and touchdown.
async function sceneTouchdown() {
  const token = sceneToken;
  setStage("touchdown", "着陸");
  badge("nasa");
  root.dataset.hull = "off";
  root.dataset.pip = "off";
  hideCard();
  if (video.error || !video.currentSrc.includes("landing")) return;
  try { if (video.currentTime < TRN_CLIP[1]) video.currentTime = TRN_CLIP[1]; } catch { /* not seekable */ }
  videoBaseRate = 1; applyRate();
  root.dataset.video = "on"; root.dataset.fit = "contain";
  const done = startVideo();
  landingMode = true;
  await until(() => { stageProgress = (video.currentTime - TRN_CLIP[1]) / 28; renderProgress(); return done(); });
  landingMode = false;
  $("vg-sub").hidden = true; $("vg-phases").hidden = true;
  if (skipped(token)) return;
  stopVideo();
}

async function sceneArrival() {
  setStage("arrival", "探査開始");
  badge("nasa");
  stopVideo(); hideCard(); setShip(null); landingMode = false; trn = null;
  $("vg-sub").hidden = true; $("vg-phases").hidden = true;
  bg = {stars: false, speed: 0, earth: 0, mars: 0, sun: 0, entry: 0};
  root.dataset.hull = "off";
  let photo = root.querySelector(".vg-arrival-photo");
  if (!photo && missionPhoto) {
    photo = document.createElement("img");
    photo.className = "vg-arrival-photo";
    photo.alt = "Perseverance の Navcam が撮影したジェゼロ・クレーター";
    photo.src = missionPhoto;
    root.prepend(photo);
  }
  sound.play("arrive");
  const v = results.voyage;
  const summary = v?.hull !== undefined ? `着陸の結果：機体 ${v.hull}%・${v.safe ? (v.near ? "実際の着陸地点に着地" : "安全な場所に着地") : "危険な場所に着地"}` : "";
  caption("探査開始！", `2021年2月18日 ジェゼロ・クレーターに着陸。${summary}`, 0);
  clockPill("Sol 15", "着陸から15 sol 後、最初の本格的な走行へ");
  await new Promise((resolve) => setTimeout(resolve, 3600));
  enterRover(true);
}

function enterRover(autoStart) {
  sceneToken += 1;
  stopVideo();
  sound.drone(false);
  root.classList.add("leaving");
  setTimeout(() => {
    document.body.dataset.scene = "rover";
    root.classList.remove("leaving");
    if (!autoStart) { document.getElementById("start")?.focus(); return; }
    const start = document.getElementById("start");
    const began = performance.now();
    const tryStart = () => {
      if (start && !start.disabled) start.click();
      else if (performance.now() - began < 20000) setTimeout(tryStart, 200);
    };
    tryStart();
  }, autoStart ? 900 : 300);
}

async function story(from = "launch") {
  results.voyage = {played: true};
  hull = 100; renderHull();
  if (from === "launch") {
    await sceneLiftoff();
    await sceneAscent();
    await sceneSeparation();
    await sceneCruise();
  }
  if (from === "launch" || from === "cruise") {
    if (from === "cruise") await sceneCruise();
    await sceneEntry();
  }
  await sceneDescent();
  await runTrn();
  await sceneTouchdown();
  await sceneArrival();
}

// ----- input -----
$("vg-skip").addEventListener("click", () => { sceneToken += 1; paused = false; hideCaption(); $("vg-count").hidden = true; });
$("vg-speed").addEventListener("click", () => {
  speedMul = SPEEDS[(SPEEDS.indexOf(speedMul) + 1) % SPEEDS.length];
  applyRate();
  renderSpeed();
});
const showSound = () => { $("vg-sound").textContent = sound.enabled ? "音 オン" : "音 オフ"; $("vg-sound").setAttribute("aria-pressed", sound.enabled); video.muted = !sound.enabled; };
$("vg-sound").addEventListener("click", () => { sound.unlock(); sound.toggle(); });
window.addEventListener("soundchange", showSound);
showSound();

function setPaused(value) {
  paused = value;
  if (paused) { video.pause(); caption("一時停止中", "Space で再開", 0); }
  else {
    hideCaption();
    const filmRunning = root.dataset.video === "on" && !video.ended && !(trn && trn.state !== "play");
    if (filmRunning) video.play().catch(() => {});
  }
}
const MOVE_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "d", "w", "s"];
document.addEventListener("keydown", (event) => {
  if (document.body.dataset.scene !== "voyage" || root.dataset.scene === "title") return;
  if (event.key === " ") { event.preventDefault(); setPaused(!paused); return; }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (trn && MOVE_KEYS.includes(key)) { keys.add(key); event.preventDefault(); }
});
document.addEventListener("keyup", (event) => { keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key); });
canvas.addEventListener("pointermove", (event) => { if (event.pointerType === "mouse" || event.buttons) pointer = {x: event.clientX, y: event.clientY}; });
canvas.addEventListener("pointerdown", (event) => { pointer = {x: event.clientX, y: event.clientY}; canvas.setPointerCapture?.(event.pointerId); });
document.addEventListener("visibilitychange", () => { if (document.hidden && document.body.dataset.scene === "voyage" && root.dataset.scene !== "title") setPaused(true); });
window.addEventListener("resize", resize);

// ----- start -----
resize();
makeStars();
buildMarks();
renderHull();
badge("cg");
requestAnimationFrame(frame);

try {
  const [voyage, mission] = await Promise.all(["voyage", "mission"].map(async (name) => {
    const response = await fetch(`assets/${name}.json`);
    if (!response.ok) throw new Error(`${name}.json: ${response.status}`);
    return response.json();
  }));
  data = voyage;
  missionPhoto = `assets/${mission.frames[0].name}`;
  await loadHazardMap();
  drawOrbit();
  renderOrbit(0);
  const begin = $("vg-begin");
  begin.disabled = false;
  begin.textContent = "ミッション開始";
  begin.addEventListener("click", () => { sound.unlock(); story("launch"); });
  $("vg-to-rover").addEventListener("click", () => { results.voyage = null; enterRover(false); });
  const scene = params.get("scene");
  if (scene === "rover") { results.voyage = null; enterRover(false); }
  else if (["cruise", "landing"].includes(scene)) { sound.unlock(); story(scene); }
  else begin.focus();
} catch (error) {
  console.error(error);
  $("vg-begin").textContent = "読み込めません（探査から始めてください）";
  $("vg-to-rover").addEventListener("click", () => enterRover(false));
}
