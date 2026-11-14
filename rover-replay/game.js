const byId = (id) => document.getElementById(id);
const map = byId("map");
const photo = byId("photo");
const start = byId("start");
const reset = byId("reset");
const title = byId("mission-title");
const message = byId("message");
const choices = byId("choices");
const controls = document.querySelector(".controls");

const incidents = [
  {
    warning: 4, arrival: 14, title: "通信リンクが不安定",
    prompt: "次の区間に入る前に、管制との通信を確保してください。",
    options: ["映像の送信を続ける", "予備の通信リンクに切り替える"], correct: 1,
    hint: "映像送信を続けても通信は復旧しません。別の対応を選べます。",
  },
  {
    warning: 21, arrival: 32, title: "車輪の滑りを検知",
    prompt: "次の区間に入る前に、シミュレーターの走行設定を変更してください。",
    options: ["低速走行に切り替える", "加速して区間を通過する"], correct: 0,
    hint: "加速では滑りが増えます。別の対応を選べます。",
  },
];

let mission;
let duration;
let marker;
let traveled;
let state = "ready";
let elapsed = 0;
let frameIndex = -1;
let visibleIncident = -1;
let resolved = new Set();
let countdown;
let request;
let startedAt;

function svg(tag, attrs) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function distanceAt(time) {
  const frames = mission.frames;
  const next = frames.findIndex((frame) => frame.at > time);
  if (next < 0) return frames.at(-1).distance;
  const a = frames[next - 1], b = frames[next];
  return a.distance + ((time - a.at) / (b.at - a.at)) * (b.distance - a.distance);
}

function positionAt(distance) {
  const route = mission.route;
  const next = route.findIndex((point) => point[2] > distance);
  if (next < 0) return route.at(-1).slice(0, 2);
  const a = route[next - 1], b = route[next];
  const t = (distance - a[2]) / (b[2] - a[2]);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

function drawMap() {
  const {width, height, tiles, route, scale20m} = mission;
  map.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const imagery = svg("svg", {width, height, overflow: "hidden"});
  map.append(imagery);
  for (const tile of tiles) {
    imagery.append(svg("image", {href: `assets/${tile.name}`, x: tile.x, y: tile.y,
      width: tile.size, height: tile.size}));
  }
  const points = route.map(([x,y]) => `${x},${y}`).join(" ");
  map.append(svg("polyline", {points, fill: "none", stroke: "#18201a",
    "stroke-width": 5, "stroke-linejoin": "round"}));
  map.append(svg("polyline", {points, fill: "none", stroke: "#edf6e6",
    "stroke-width": 2, "stroke-linejoin": "round"}));
  traveled = svg("polyline", {fill: "none", stroke: "#b8f98e",
    "stroke-width": 3, "stroke-linejoin": "round"});
  map.append(traveled);
  for (const frame of mission.frames) {
    const [x,y] = positionAt(frame.distance);
    map.append(svg("circle", {cx:x, cy:y, r:2, fill:"#f9fff4", stroke:"#18201a"}));
  }
  for (const [index, incident] of incidents.entries()) {
    const [x,y] = positionAt(distanceAt(incident.arrival));
    const group = svg("g", {transform:`translate(${x} ${y})`});
    group.append(svg("rect", {x:-4,y:-4,width:8,height:8,rx:1,
      fill:"#ffbb76",stroke:"#312419",transform:"rotate(45)"}));
    const number = svg("text", {x:0,y:-8,"text-anchor":"middle",fill:"#fff4e2",
      stroke:"#141a14","stroke-width":2,"paint-order":"stroke","font-size":9});
    number.textContent = index + 1;
    group.append(number);
    map.append(group);
  }
  marker = svg("circle", {r:5, fill:"#b8f98e", stroke:"#18201a", "stroke-width":2});
  map.append(marker);
  const y = height - 13;
  map.append(svg("path", {d:`M10 ${y-3}v3h${scale20m}v-3`,stroke:"#fff",
    "stroke-width":1.2,fill:"none"}));
  const scale = svg("text", {x:10,y:y-6,fill:"#fff",stroke:"#121613",
    "stroke-width":2,"paint-order":"stroke","font-size":8});
  scale.textContent = "20 m";
  map.append(scale);
}

function renderPlayback() {
  const frames = mission.frames;
  const index = frames.findLastIndex((frame) => frame.at <= elapsed);
  if (index !== frameIndex) {
    const frame = frames[index];
    photo.src = `assets/${frame.name}`;
    byId("frame-info").textContent = `${index + 1} / ${frames.length}`;
    byId("capture").textContent = `SOL ${frame.sol} · SITE 3 / DRIVE ${frame.drive}`;
    frameIndex = index;
  }
  const distance = distanceAt(elapsed);
  const [x,y] = positionAt(distance);
  marker.setAttribute("cx", x);
  marker.setAttribute("cy", y);
  const points = mission.route.filter((point) => point[2] <= distance);
  points.push([x,y]);
  traveled.setAttribute("points", points.map(([px,py]) => `${px},${py}`).join(" "));
  byId("progress").value = elapsed;
  byId("elapsed").textContent = "00:" + String(Math.floor(elapsed)).padStart(2,"0");
}

function showStatus(heading, detail, alert = false) {
  title.textContent = heading;
  message.textContent = detail;
  controls.dataset.alert = alert;
  choices.hidden = true;
  countdown = null;
  visibleIncident = -1;
}

function showIncident(index) {
  const incident = incidents[index];
  showStatus(incident.title, incident.prompt, true);
  visibleIncident = index;
  countdown = document.createElement("span");
  countdown.setAttribute("aria-live", "off");
  title.append(countdown);
  choices.replaceChildren();
  for (const [answer, label] of incident.options.entries()) {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => resolveIncident(index, answer));
    choices.append(button);
  }
  choices.hidden = false;
  updateCountdown();
}

function updateCountdown() {
  if (!countdown) return;
  const seconds = Math.ceil(incidents[visibleIncident].arrival - elapsed);
  const label = ` · 到達まで ${seconds} 秒`;
  if (countdown.textContent !== label) countdown.textContent = label;
}

function advance(now) {
  const nextTime = Math.min(duration, (now - startedAt) / 1000);
  const missed = incidents.findIndex((incident, index) =>
    !resolved.has(index) && nextTime >= incident.arrival);
  if (missed >= 0) {
    elapsed = incidents[missed].arrival;
    renderPlayback();
    end("failed", "ミッション失敗", `「${incidents[missed].title}」の地点に未解決のまま到達しました。`);
    return;
  }
  elapsed = nextTime;
  renderPlayback();
  if (elapsed >= duration) {
    end("complete", "ミッション成功", "2件のトラブルを解決し、走行区間を完走しました。");
    return;
  }
  const active = incidents.findIndex((incident, index) =>
    !resolved.has(index) && elapsed >= incident.warning);
  if (active >= 0 && active !== visibleIncident) showIncident(active);
  updateCountdown();
}

function resolveIncident(index, answer) {
  if (state !== "running") return;
  advance(performance.now());
  if (state !== "running" || visibleIncident !== index) return;
  const incident = incidents[index];
  if (answer !== incident.correct) {
    message.textContent = incident.hint;
    return;
  }
  resolved.add(index);
  showStatus("対処完了", "走行を継続しています。");
  start.focus();
}

function end(nextState, heading, detail) {
  state = nextState;
  showStatus(heading, detail, nextState === "failed");
  start.disabled = true;
  start.textContent = "走行終了";
  reset.focus();
}

function tick(now) {
  if (state !== "running") return;
  advance(Math.max(startedAt, now));
  if (state === "running") request = requestAnimationFrame(tick);
}

start.addEventListener("click", () => {
  if (state === "running") {
    advance(performance.now());
    if (state !== "running") return;
    state = "paused";
    cancelAnimationFrame(request);
    start.textContent = "走行再開";
    for (const button of choices.children) button.disabled = true;
    return;
  }
  if (state === "ready") showStatus("走行中", "次のトラブル警告に備えてください。");
  state = "running";
  startedAt = performance.now() - elapsed * 1000;
  start.textContent = "一時停止";
  for (const button of choices.children) button.disabled = false;
  request = requestAnimationFrame(tick);
});

reset.addEventListener("click", () => {
  cancelAnimationFrame(request);
  state = "ready";
  elapsed = 0;
  resolved = new Set();
  start.disabled = false;
  start.textContent = "走行開始";
  showStatus("走行を開始", "走行を開始し、トラブル地点に着く前に対処してください。");
  renderPlayback();
  start.focus();
});

try {
  const response = await fetch("assets/mission.json");
  if (!response.ok) throw new Error(`Mission data: ${response.status}`);
  mission = await response.json();
  duration = mission.frames.at(-1).at;
  byId("progress").max = duration;
  drawMap();
  renderPlayback();
  await Promise.all(mission.frames.map(async (frame) => {
    const image = new Image();
    image.src = `assets/${frame.name}`;
    await image.decode();
  }));
  start.disabled = false;
  reset.disabled = false;
} catch (error) {
  console.error(error);
  showStatus("データを読み込めません", "ローカルサーバーと assets フォルダを確認してください。", true);
}
