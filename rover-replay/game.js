import {gradeAnswer} from "./grader.js";
import {Sound} from "./audio.js";

const byId = (id) => document.getElementById(id);
const map = byId("map");
const photo = byId("photo");
const start = byId("start");
const reset = byId("reset");
const title = byId("mission-title");
const message = byId("message");
const facts = byId("facts");
const rule = byId("rule");
const choices = byId("choices");
const freeform = byId("freeform");
const answer = byId("answer");
const submit = byId("submit");
const giveUp = byId("give-up");
const accidentPick = byId("accident-pick");
const controls = document.querySelector(".controls");
const sound = new Sound();
const MM_SCALE = 0.55; // minimap zoom: map pixels to minimap units (about 24 m across the radius)
const KIND_LABELS = {info: "MISSION CONTROL", plan: "走行計画", accident: "アクシデント", result: "結果",
  success: "ミッション成功", fail: "ミッション失敗"};

// Game settings. The values each decision is judged against come from NASA data
// (assets/mission.json); these thresholds and the power model are invented.
const RULES = {
  tiltLimitDeg: 3,        // slopes at or above this: measure slip with visual odometry
  driveEndLimit: "15:30", // finish driving by this local mean solar time
  power: {
    start: 100,           // %
    planDrain: 1.0,       // % per real second while deciding a plan
    accidentDrain: 1.5,   // % per real second while an accident is unsolved
    wrongChoice: 12,      // % lost per wrong plan choice
    wrongAnswer: 8,       // % lost per rejected accident answer
    giveUp: 20,           // % lost when revealing the answer
    wrongQuiz: 5,         // % lost per wrong answer on a large-event question
    perMetre: 0.25,       // % per metre driven
    perClimbMetre: 4,     // % per metre climbed
    rechargePerSol: 3,    // % recharged per idle sol between drives (MMRTG)
  },
  accidentAt: 22,         // game second of the accident (during the Sol 20 drive)
};
const SI_TO_LMST = 86_400 / 88_775.244; // one Mars solar day is 88,775 SI seconds

let mission;
let accidents;
let accident;
let bigEvents;
let toastTimer;
let duration;
let plans;
let events;
let energy;
let marker;
let traveled;
let state = "ready";
let pausedFrom;
let elapsed = 0;
let frameIndex = -1;
let activeEvent = -1;
let resolved = new Set();
let mistakes = 0;
let power = RULES.power.start;
let request;
let lastTick;
let mmHeading = null;
let nextPing;

function svg(tag, attrs) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

// "HH:MM" or "HH:MM:SS" (LMST) to seconds after midnight.
const seconds = (clock) => {
  const [hours, minutes, secs = 0] = clock.split(":").map(Number);
  return hours * 3600 + minutes * 60 + secs;
};
const clock = (value) => {
  const s = Math.round(value) % 86_400;
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;
};
const deg = (value, digits = 1) => `${value.toFixed(digits)}°`;
const signed = (value, unit) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)} ${unit}`;
const hoursMinutes = (ms) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}分`;
  return `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ""}`;
};

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

// PLACES attitude at a route distance. poses[i] belongs to route[i].
function poseAt(distance) {
  const {route, poses} = mission;
  const next = route.findIndex((point) => point[2] > distance);
  if (next < 0) return {...poses.at(-1), lmst: clock(seconds(poses.at(-1).lmst))};
  const a = poses[next - 1], b = poses[next];
  const t = (distance - route[next - 1][2]) / (route[next][2] - route[next - 1][2]);
  const mix = (key) => a[key] + t * (b[key] - a[key]);
  const time = a.sol === b.sol ? clock(seconds(a.lmst) + t * (seconds(b.lmst) - seconds(a.lmst)))
    : clock(seconds(a.lmst));
  return {sol: a.sol, lmst: time, pitch: mix("pitch"), roll: mix("roll"),
    elevationM: mix("elevationM"), yaw: (t < 0.5 ? a : b).yaw};
}

function buildPlans() {
  const {frames, drives} = mission;
  const frameOfDrive = (drive) => frames.find((frame) => frame.drive === drive);
  const length = (drive) => `${drive.lengthM.toFixed(1)} m`;
  const minutes = (drive) => Math.round((drive.endSclk - drive.startSclk) / 60);

  const tilt = (drive) => {
    const s = drive.steepest;
    const worst = Math.max(Math.abs(s.pitch), Math.abs(s.roll));
    const steep = worst >= RULES.tiltLimitDeg;
    return {
      kind: "tilt", focus: ["pitch", "roll", "elevation"],
      title: `Sol ${drive.sol} の走行計画：地形の傾き`,
      prompt: "PLACES に記録された、この区間の傾きを見て走り方を決めてください。",
      facts: [
        ["区間", `Drive ${drive.fromDrive} → ${drive.toDrive}（${length(drive)}）`],
        ["最大の傾き", `前後 ${deg(Math.abs(s.pitch))}・左右 ${deg(Math.abs(s.roll))}（Drive ${s.drive}）`],
        ["標高差", signed(drive.climbM, "m")],
      ],
      rule: `傾きが ${RULES.tiltLimitDeg}° 以上の地点を含む区間は、視覚オドメトリ（カメラで実際の移動量を測る機能）で滑りを確かめながら走る。`,
      options: [
        {label: "通常走行で進む",
          hint: `最大 ${deg(worst)} の傾きがあり、基準の ${RULES.tiltLimitDeg}° 以上です。`},
        {label: "視覚オドメトリで滑りを確かめながら進む",
          hint: `最大の傾きは ${deg(worst)} で、基準の ${RULES.tiltLimitDeg}° 未満です。`},
        {label: "この区間の走行を見送る",
          hint: `${deg(worst)} は走行を見送るほどの傾きではありません。`},
      ],
      correct: steep ? 1 : 0,
      record: `実際の記録：Sol ${drive.sol} に ${length(drive)} を約 ${minutes(drive)} 分で走行（LMST ${clock(seconds(drive.startLmst))}〜${clock(seconds(drive.endLmst))}）。`,
    };
  };

  const daylight = (drive, previous) => {
    const pace = previous.lengthM / ((previous.endSclk - previous.startSclk) / 60); // m per minute
    const startAt = seconds(drive.startLmst);
    const finish = (metres) => startAt + (metres / pace) * 60 * SI_TO_LMST;
    const limit = seconds(RULES.driveEndLimit);
    const sun = frames.find((frame) => frame.sol === drive.sol).env;
    const correct = finish(drive.lengthM) <= limit ? 0 : finish(drive.lengthM / 2) <= limit ? 1 : 2;
    const actualMinutes = minutes(drive);
    return {
      kind: "time", focus: ["clock", "sun"],
      title: `Sol ${drive.sol} の走行計画：時刻と日照`,
      prompt: "前回の走行の速さから終わる時刻を見積もり、どこまで走るかを決めてください。",
      facts: [
        ["走行開始", `LMST ${clock(startAt)}`],
        ["予定の距離", length(drive)],
        ["前回の速さ", `${pace.toFixed(2)} m/分（Sol ${previous.sol} の実績）`],
        ["終了の見込み", `LMST ${clock(finish(drive.lengthM))}`],
        ["太陽高度", `${deg(sun.sunElevation)}（同じ sol の LMST ${clock(seconds(sun.lmst))} の画像）`],
      ],
      rule: `走行は LMST ${RULES.driveEndLimit} までに終える（夕方は影が長くなり、画像で障害物を見分けにくくなる想定）。`,
      options: [
        {label: `全区間（${length(drive)}）を走る`,
          hint: `全区間だと LMST ${clock(finish(drive.lengthM))} に終わる見込みで、${RULES.driveEndLimit} を過ぎます。`},
        {label: "半分で止め、残りは次の sol に回す",
          hint: correct === 0 ? `全区間でも LMST ${clock(finish(drive.lengthM))} に終わる見込みです。`
            : `半分でも LMST ${clock(finish(drive.lengthM / 2))} までかかる見込みです。`},
        {label: "この sol の走行を取りやめる",
          hint: `LMST ${RULES.driveEndLimit} までに走れる見込みがあります。`},
      ],
      correct,
      record: `実際の記録：Sol ${drive.sol} の走行は LMST ${clock(startAt)}〜${clock(seconds(drive.endLmst))}（約 ${actualMinutes} 分。見込みとの差 ${Math.round(actualMinutes - (drive.lengthM / pace))} 分）。`,
    };
  };

  const downlink = (drive) => {
    const last = frameOfDrive(drive.fromDrive);
    const captured = Date.parse(last.env.utc);
    const received = Date.parse(last.env.earthReceived);
    const sameSol = frames.find((frame) => frame.sol === drive.sol);
    const driveStart = Date.parse(sameSol.env.utc) + (drive.startSclk - sameSol.sclk) * 1000;
    const arrived = received < driveStart;
    return {
      kind: "downlink", focus: ["delay"],
      title: `Sol ${drive.sol} の走行計画：画像の到着`,
      prompt: "前回の走行の終点で撮った画像が地球に届いているかを確かめ、計画の立て方を決めてください。",
      facts: [
        ["前回終点の画像", `Sol ${last.sol} の LMST ${clock(seconds(last.env.lmst))} に撮影`],
        ["地球での受信", `撮影の ${hoursMinutes(received - captured)} 後`],
        ["次の走行", arrived ? `Sol ${drive.sol}（受信の約 ${Math.round((driveStart - received) / 3_600_000)} 時間後）`
          : `Sol ${drive.sol}（受信より前）`],
      ],
      rule: "前方の地形を画像で確かめてから、次の走行を計画する。",
      options: [
        {label: "受信した終点画像で前方を確かめ、計画を送る",
          hint: "終点の画像は、次の走行の時点でまだ地球に届いていません。"},
        {label: "画像を待たず、前回と同じ距離を指示する",
          hint: "前方の地形を確かめないまま走らせることになります。"},
        {label: "画像が届くまで計画を延期する",
          hint: `画像は撮影の ${hoursMinutes(received - captured)} 後に届いており、次の走行に間に合います。`},
      ],
      correct: arrived ? 0 : 2,
      record: `実際の記録：Sol ${drive.sol} に ${length(drive)} を走行（LMST ${clock(seconds(drive.startLmst))}〜${clock(seconds(drive.endLmst))}）。`,
    };
  };

  return [tilt(drives[0]), daylight(drives[1], drives[0]), downlink(drives[2])].map((plan, index) => ({
    ...plan, at: frameOfDrive(drives[index].fromDrive).at,
  }));
}

function drawMap() {
  const {width, height, tiles, route, scale20m} = mission;
  map.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const content = svg("g", {id: "map-content"});
  map.append(content);
  for (const tile of tiles) {
    content.append(svg("image", {href: `assets/${tile.name}`, x: tile.x, y: tile.y,
      width: tile.size, height: tile.size}));
  }
  const points = route.map(([x,y]) => `${x},${y}`).join(" ");
  content.append(svg("polyline", {points, fill: "none", stroke: "#18201a",
    "stroke-width": 5, "stroke-linejoin": "round"}));
  content.append(svg("polyline", {points, fill: "none", stroke: "#edf6e6",
    "stroke-width": 2, "stroke-linejoin": "round"}));
  traveled = svg("polyline", {fill: "none", stroke: "#b8f98e",
    "stroke-width": 3, "stroke-linejoin": "round"});
  content.append(traveled);
  for (const frame of mission.frames) {
    const [x,y] = positionAt(frame.distance);
    content.append(svg("circle", {cx:x, cy:y, r:2, fill:"#f9fff4", stroke:"#18201a"}));
  }
  let planNumber = 0;
  for (const event of events) {
    const [x,y] = positionAt(distanceAt(event.at));
    const group = svg("g", {transform:`translate(${x} ${y})`});
    if (event.type === "plan") {
      planNumber += 1;
      group.append(svg("rect", {x:-4,y:-4,width:8,height:8,rx:1,
        fill:"#ffbb76",stroke:"#312419",transform:"rotate(45)"}));
    } else {
      group.append(svg("circle", {r: 4.5, fill: event.type === "accident" ? "#ff7a6b" : "#8fc7ff", stroke: "#18201a"}));
    }
    const label = svg("text", {x:0,y:-8,"text-anchor":"middle",fill:"#fff4e2",
      stroke:"#141a14","stroke-width":2,"paint-order":"stroke","font-size":9});
    label.textContent = event.type === "plan" ? planNumber : event.type === "accident" ? "!" : "★";
    group.append(label);
    content.append(group);
  }
  nextPing = svg("circle", {r: 6, class: "next-ping"});
  content.append(nextPing);
  marker = svg("circle", {r:5, fill:"#b8f98e", stroke:"#18201a", "stroke-width":2});
  content.append(marker);
  const y = height - 13;
  map.append(svg("path", {d:`M10 ${y-3}v3h${scale20m}v-3`,stroke:"#fff",
    "stroke-width":1.2,fill:"none"}));
  const scale = svg("text", {x:10,y:y-6,fill:"#fff",stroke:"#121613",
    "stroke-width":2,"paint-order":"stroke","font-size":8});
  scale.textContent = "20 m";
  map.append(scale);
  const ticks = byId("mm-ticks");
  for (let angle = 0; angle < 360; angle += 30) {
    ticks.append(svg("line", {x1: 0, y1: -46.5, x2: 0, y2: angle % 90 ? -44.5 : -43, transform: `rotate(${angle})`}));
  }
}

// Heading-up minimap: the map turns so the rover's heading points up.
function renderMinimap(distance, [x, y]) {
  const target = ((poseAt(distance).yaw % 360) + 360) % 360;
  if (mmHeading === null) mmHeading = target;
  mmHeading += (((target - mmHeading + 540) % 360) - 180) * 0.18;
  byId("mm-content").setAttribute("transform", `rotate(${-mmHeading}) scale(${MM_SCALE}) translate(${-x} ${-y})`);
  byId("mm-ticks").setAttribute("transform", `rotate(${-mmHeading})`);
  byId("mm-north").setAttribute("transform", `rotate(${-mmHeading})`);
  setText("mm-dist", `${distance.toFixed(1)} m`);
  const next = events.find((event, index) => !resolved.has(index));
  nextPing.style.display = next ? "" : "none";
  if (next) {
    const [px, py] = positionAt(distanceAt(next.at));
    nextPing.setAttribute("cx", px);
    nextPing.setAttribute("cy", py);
  }
}

function buildTimeline() {
  byId("timeline-marks").replaceChildren(...events.map((event) => {
    const mark = document.createElement("span");
    mark.className = `tm ${event.type}`;
    mark.style.left = `${event.at / duration * 100}%`;
    return mark;
  }));
}

function toggleMap(open = byId("map-overlay").hidden) {
  byId("map-overlay").hidden = !open;
  if (open) sound.play("open");
}

const DIRECTIONS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
const direction = (azimuth) => DIRECTIONS[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8];
const DAY_START = 6 * 3600, DAY_LENGTH = 12 * 3600; // the day bar spans LMST 06:00-18:00
const dayPercent = (secs) => Math.min(100, Math.max(0, (secs - DAY_START) / DAY_LENGTH * 100));
const TILT_ICON_SCALE = 4; // tilts are a few degrees; exaggerate the drawing so they show
const MAX_DELAY_MS = 9 * 3_600_000;

function setText(id, value) {
  const element = byId(id);
  if (element.textContent !== value) element.textContent = value;
}

// Parts of the HUD that do not change while playing.
function drawHud() {
  byId("h-limit").style.left = `${dayPercent(seconds(RULES.driveEndLimit))}%`;
  byId("h-limit").querySelector("i").textContent = `走行終了の基準 ${RULES.driveEndLimit}`;
  byId("h-tilt-limit").style.left = "50%"; // the bar spans 0 to twice the limit
  setText("h-tilt-rule", `${RULES.tiltLimitDeg}°`);
  const ticks = byId("h-ticks");
  for (let angle = 0; angle < 360; angle += 30) {
    ticks.append(svg("line", {x1: 0, y1: -44, x2: 0, y2: angle % 90 ? -40 : -37,
      transform: `rotate(${angle})`}));
  }
  const {route, poses} = mission;
  const total = route.at(-1)[2];
  const heights = poses.map((pose) => pose.elevationM);
  const low = Math.min(...heights), high = Math.max(...heights);
  const point = (i) => [route[i][2] / total * 200, 36 - (heights[i] - low) / (high - low || 1) * 32];
  const line = route.map((_, i) => point(i).join(",")).join(" ");
  const profile = byId("h-profile");
  profile.append(svg("polygon", {points: `0,40 ${line} 200,40`, class: "area"}),
    svg("polyline", {points: line, class: "line"}));
  profile.done = svg("polyline", {class: "done"});
  profile.now = svg("line", {y1: 0, y2: 40, class: "now"});
  profile.append(profile.done, profile.now);
  profile.point = point;
}

function renderTelemetry(distance, frame) {
  const pose = poseAt(distance);
  const env = frame.env;

  setText("h-clock", `Sol ${pose.sol} · ${pose.lmst}`);
  const sun = byId("h-sun");
  sun.style.left = `${dayPercent(seconds(pose.lmst))}%`;
  sun.style.bottom = `${34 + Math.max(0, env.sunElevation) / 90 * 54}%`; // keep clear of the label
  setText("h-sun-elev", deg(env.sunElevation));

  const tilt = Math.max(Math.abs(pose.pitch), Math.abs(pose.roll));
  byId("h-pitch-icon").setAttribute("transform", `rotate(${-pose.pitch * TILT_ICON_SCALE})`);
  byId("h-roll-icon").setAttribute("transform", `rotate(${pose.roll * TILT_ICON_SCALE})`);
  setText("h-pitch", deg(Math.abs(pose.pitch)));
  setText("h-roll", deg(Math.abs(pose.roll)));
  setText("h-tilt", deg(tilt));
  byId("h-tilt-bar").style.width = `${Math.min(100, tilt / (RULES.tiltLimitDeg * 2) * 100)}%`;
  byId("h-tilt-bar").closest(".widget").dataset.warn = tilt >= RULES.tiltLimitDeg;
  const profile = byId("h-profile");
  const route = mission.route;
  const done = route.map((r, i) => [r, i]).filter(([r]) => r[2] <= distance).map(([, i]) => profile.point(i));
  const x = distance / route.at(-1)[2] * 200;
  profile.done.setAttribute("points", done.map((p) => p.join(",")).join(" "));
  profile.now.setAttribute("x1", x);
  profile.now.setAttribute("x2", x);
  setText("h-elev", signed(pose.elevationM, "m"));

  const heading = ((pose.yaw % 360) + 360) % 360;
  byId("h-heading-arrow").setAttribute("transform", `rotate(${heading})`);
  byId("h-sun-mark").setAttribute("transform", `rotate(${env.sunAzimuth})`);
  setText("h-heading", `${direction(heading)}（${Math.round(heading)}°）`);
  setText("h-sun-az", `${direction(env.sunAzimuth)}（${Math.round(env.sunAzimuth)}°）`);

  const delay = Date.parse(env.earthReceived) - Date.parse(env.utc);
  setText("h-delay", hoursMinutes(delay));
  byId("h-delay-bar").style.width = `${Math.min(100, delay / MAX_DELAY_MS * 100)}%`;
}

function renderPlayback() {
  const frames = mission.frames;
  const index = frames.findLastIndex((frame) => frame.at <= elapsed);
  const frame = frames[index];
  if (index !== frameIndex) {
    photo.src = `assets/${frame.name}`;
    byId("frame-info").textContent = `${index + 1} / ${frames.length}`;
    byId("capture").textContent = `SOL ${frame.sol} · LMST ${clock(seconds(frame.env.lmst))} · DRIVE ${frame.drive}`;
    frameIndex = index;
  }
  const distance = distanceAt(elapsed);
  const [x,y] = positionAt(distance);
  marker.setAttribute("cx", x);
  marker.setAttribute("cy", y);
  const points = mission.route.filter((point) => point[2] <= distance);
  points.push([x,y]);
  traveled.setAttribute("points", points.map(([px,py]) => `${px},${py}`).join(" "));
  renderTelemetry(distance, frame);
  renderMinimap(distance, [x, y]);
  for (const [i, mark] of [...byId("timeline-marks").children].entries()) mark.classList.toggle("done", resolved.has(i));
  byId("progress").value = elapsed;
  byId("elapsed").textContent = "00:" + String(Math.floor(elapsed)).padStart(2,"0");
}

// Cumulative drive energy (% of battery) at each route vertex, from distance and climb.
function buildEnergy() {
  const {route, poses} = mission;
  const {perMetre, perClimbMetre} = RULES.power;
  const total = [0];
  for (let i = 1; i < route.length; i += 1) {
    const climb = Math.max(0, poses[i].elevationM - poses[i - 1].elevationM);
    total.push(total[i - 1] + perMetre * (route[i][2] - route[i - 1][2]) + perClimbMetre * climb);
  }
  return total;
}

function energyAt(distance) {
  const route = mission.route;
  const next = route.findIndex((point) => point[2] > distance);
  if (next < 0) return energy.at(-1);
  const t = (distance - route[next - 1][2]) / (route[next][2] - route[next - 1][2]);
  return energy[next - 1] + t * (energy[next] - energy[next - 1]);
}

// Which panels are on screen: drive (map and a slim bar), plan (state + mission),
// accident (mission), bigevent (its own screen), panel (start and result).
function setState(next) {
  state = next;
  const shown = state === "paused" ? pausedFrom : state;
  const mode = {running: "drive", planning: "plan", accident: "accident", bigevent: "bigevent"}[shown] ?? "panel";
  document.querySelector(".screen").dataset.mode = mode;
  sound.scene(state === "paused" ? "paused" : mode);
}

function toast(heading, text, link) {
  const box = byId("toast");
  const strong = document.createElement("b");
  strong.textContent = heading;
  box.replaceChildren(strong, ` ${text}`);
  if (link) {
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = `出典：${link.label}`;
    box.append(" ", anchor);
  }
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 9000);
}

function hideToast() {
  clearTimeout(toastTimer);
  byId("toast").hidden = true;
}

function buildEvents() {
  const list = plans.map((plan, index) => ({type: "plan", at: plan.at, plan, drive: mission.drives[index]}));
  list.push({type: "accident", at: RULES.accidentAt});
  list.push(...bigEvents.map((data) => ({type: "big", at: data.at, data})));
  return list.sort((a, b) => a.at - b.at);
}

function chooseAccident() {
  const picked = accidentPick.value;
  return accidents.find((item) => item.id === picked)
    ?? accidents[Math.floor(Math.random() * accidents.length)];
}

function renderPower(note) {
  const value = Math.max(0, power);
  byId("power-bar").style.width = `${value}%`;
  byId("power-value").textContent = `${Math.ceil(value)}%`;
  byId("power").dataset.level = value <= 25 ? "low" : value <= 50 ? "mid" : "ok";
  byId("power").setAttribute("aria-valuenow", Math.ceil(value));
  if (note) byId("power-note").textContent = note;
}

// A one-off change (a mistake, a recharge) floats its amount beside the gauge.
function floatPower(change) {
  const float = byId("power-float");
  float.textContent = `${change > 0 ? "+" : "−"}${Math.round(Math.abs(change))}%`;
  float.className = `power-float mono ${change > 0 ? "up" : "down"}`;
  void float.offsetWidth; // restart the animation
  float.className = `power-float mono ${change > 0 ? "up" : "down"}`;
}

function spend(amount, note) {
  const before = power;
  power = Math.min(RULES.power.start, power - amount);
  renderPower(note);
  if (note && Math.abs(power - before) >= 1) floatPower(power - before);
  if (power <= 25 && power > 0 && ACTIVE.includes(state)) sound.lowWarning();
  if (power <= 0) {
    end("failed", "ミッション失敗：電力切れ", "電力が尽き、ローバーは動けなくなりました。判断にかかった時間と、間違えた選択の分だけ電力が減ります。");
    return false;
  }
  return true;
}

// While a plan is open, light up the widgets it is judged on and dim the rest.
function setFocus(keys) {
  document.querySelector(".telemetry").dataset.focusing = keys.length > 0;
  for (const widget of document.querySelectorAll(".telemetry [data-key]")) {
    widget.dataset.focus = widget.dataset.key.split(" ").some((key) => keys.includes(key));
  }
  // If the HUD scrolls inside itself (short screens), bring the lit widget into view.
  const hud = document.querySelector(".telemetry");
  const lit = hud.querySelector('[data-focus="true"]');
  if (lit && hud.scrollHeight > hud.clientHeight) {
    const top = lit.offsetTop, bottom = top + lit.offsetHeight;
    if (top < hud.scrollTop || bottom > hud.scrollTop + hud.clientHeight) hud.scrollTop = top - 8;
  }
}

function showStatus(heading, detail, alert = false, kind = alert ? "fail" : "info") {
  title.textContent = heading;
  message.textContent = detail;
  controls.dataset.alert = alert;
  controls.dataset.kind = kind;
  byId("mission-kind").textContent = KIND_LABELS[kind];
  facts.hidden = rule.hidden = choices.hidden = freeform.hidden = true;
  activeEvent = -1;
  setFocus([]);
}

function fillFacts(rows) {
  facts.replaceChildren(...rows.map(([label, value]) => {
    const tile = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    tile.className = "fact";
    term.textContent = label;
    detail.textContent = value;
    tile.append(term, detail);
    return tile;
  }));
}

function showPlan(index) {
  const {plan, drive} = events[index];
  const previous = events.slice(0, index).filter((event) => event.type === "plan").at(-1);
  const idle = drive.sol - (previous ? previous.drive.sol : mission.frames[0].sol);
  showStatus(plan.title, plan.prompt, true, "plan");
  activeEvent = index;
  sound.play("plan");
  const gain = Math.min(idle * RULES.power.rechargePerSol, RULES.power.start - power);
  if (idle > 0) {
    spend(-gain, gain > 0 ? `前回の走行から ${idle} sol 休止：MMRTG で充電 +${Math.round(gain)}%`
      : `前回の走行から ${idle} sol 休止：電力は満タン`);
  }
  fillFacts(plan.facts);
  rule.textContent = `判断の基準（ゲーム設定）：${plan.rule}`;
  choices.replaceChildren(...plan.options.map((option, choice) => {
    const button = document.createElement("button");
    button.textContent = option.label;
    button.addEventListener("click", () => resolvePlan(index, choice));
    return button;
  }));
  facts.hidden = rule.hidden = choices.hidden = false;
  setFocus(plan.focus);
}

function showAccident(index) {
  showStatus(accident.title, accident.situation, true, "accident");
  activeEvent = index;
  sound.play("accident");
  fillFacts([["回答", "自由記述。考えている間も電力が減ります（Ctrl+Enter でも送信）。"]]);
  facts.hidden = false;
  answer.value = "";
  freeform.hidden = false;
  answer.focus();
}

function step(dt) {
  if (state === "planning") { spend(RULES.power.planDrain * dt); return; }
  if (state === "accident") { spend(RULES.power.accidentDrain * dt); return; }
  const next = events.findIndex((event, index) => !resolved.has(index));
  const stopAt = next >= 0 ? events[next].at : Infinity;
  const before = distanceAt(elapsed);
  elapsed = Math.min(duration, stopAt, elapsed + dt);
  renderPlayback();
  if (!spend(energyAt(distanceAt(elapsed)) - energyAt(before))) return;
  if (next >= 0 && elapsed >= stopAt) {
    const type = events[next].type;
    if (type === "plan") { setState("planning"); showPlan(next); }
    else if (type === "accident") { setState("accident"); showAccident(next); }
    else { setState("bigevent"); showBigEvent(next); }
    return;
  }
  if (elapsed >= duration) {
    end("complete", "ミッション成功",
      `全区間を完走しました。残り電力 ${Math.ceil(power)}%・判断ミス ${mistakes} 回。`);
  }
}

function resolvePlan(index, choice) {
  if (state !== "planning" || activeEvent !== index) return;
  const plan = events[index].plan;
  if (choice !== plan.correct) {
    mistakes += 1;
    message.textContent = plan.options[choice].hint;
    sound.play("wrong");
    const button = choices.children[choice];
    button.classList.remove("wrong");
    void button.offsetWidth;
    button.classList.add("wrong");
    spend(RULES.power.wrongChoice, `判断ミス −${RULES.power.wrongChoice}%`);
    return;
  }
  resolved.add(index);
  setState("running");
  sound.play("correct");
  showStatus("計画を送信", `${plan.options[choice].label}。${plan.record}`, false, "result");
  toast("計画を送信", `${plan.options[choice].label}。${plan.record}`);
  start.focus();
}

function closeAccident(index, heading) {
  resolved.add(index);
  setState("running");
  showStatus(heading, `実際の対応（${accident.rover}・${accident.date}）：${accident.answer}`, false, "result");
  const link = document.createElement("a");
  link.href = accident.source.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = `出典：${accident.source.label}`;
  message.append(" ", link);
  toast(heading, `実際の対応（${accident.rover}・${accident.date}）：${accident.answer}`, accident.source);
  start.focus();
}

function submitAnswer() {
  if (state !== "accident") return;
  const index = activeEvent;
  const result = gradeAnswer(answer.value, accident);
  if (result.passed) {
    sound.play("correct");
    closeAccident(index, `対処成功：${result.matched.map((group) => group.name).join("・")}`);
    return;
  }
  mistakes += 1;
  const hint = result.missing[0]?.hint ?? "もう少し具体的に書いてください。";
  message.textContent = `${accident.situation}　ヒント：${hint}`;
  sound.play("wrong");
  spend(RULES.power.wrongAnswer, `回答が不十分 −${RULES.power.wrongAnswer}%`);
}

function revealAnswer() {
  if (state !== "accident") return;
  const index = activeEvent;
  if (!spend(RULES.power.giveUp, `答えを見た −${RULES.power.giveUp}%`)) return;
  closeAccident(index, "答えを確認");
}

function showBigEvent(index) {
  const data = events[index].data;
  hideToast();
  toggleMap(false);
  activeEvent = index;
  sound.play("big");
  byId("be-title").textContent = data.title;
  byId("be-lead").textContent = data.lead;
  byId("be-observed").textContent = data.observed;
  byId("be-note").textContent = data.media.note;
  byId("be-credit").textContent = `画像：${data.credit}`;
  byId("be-facts").replaceChildren(...data.facts.flatMap(([label, value]) => {
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    return [term, detail];
  }));
  byId("be-question").textContent = `問題：${data.quiz.question}`;
  byId("be-choices").replaceChildren(...data.quiz.options.map((option, choice) => {
    const button = document.createElement("button");
    button.textContent = option.label;
    button.addEventListener("click", () => answerQuiz(index, choice));
    return button;
  }));
  byId("be-message").textContent = "";
  byId("be-sources").replaceChildren(...[data.source, data.detail].map((item) => {
    const anchor = document.createElement("a");
    anchor.href = item.url;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = item.label;
    return anchor;
  }));
  byId("be-return").hidden = true;
  const main = byId("be-img"), zoom = byId("be-zoom-img");
  main.alt = data.media.alt;
  const layout = () => { fitFrame(data.media.zoom); placeZoom(data.media.zoom); };
  main.onload = zoom.onload = layout;
  main.src = zoom.src = data.media.src;
  byId("big-event").hidden = false;
  layout();
}

// Size the frame to the image so the marker's percentages land on the image itself.
function fitFrame(spec) {
  const main = byId("be-img");
  if (!main.naturalWidth) return;
  const ratio = main.naturalWidth / main.naturalHeight;
  const frame = byId("be-frame");
  frame.style.aspectRatio = `${main.naturalWidth} / ${main.naturalHeight}`;
  frame.style.width = `min(100%, calc(50vh * ${ratio}))`;
  byId("be-marker").style.left = `${spec.x}%`;
  byId("be-marker").style.top = `${spec.y}%`;
}

// The zoom box shows `window` of the image width around (x%, y%).
function placeZoom(spec) {
  const zoom = byId("be-zoom-img");
  const box = zoom.parentElement;
  if (!zoom.naturalWidth || !box.clientWidth) return;
  const width = box.clientWidth / spec.window;
  const height = width * zoom.naturalHeight / zoom.naturalWidth;
  zoom.style.width = `${width}px`;
  zoom.style.left = `${box.clientWidth / 2 - spec.x / 100 * width}px`;
  zoom.style.top = `${Math.min(0, Math.max(box.clientHeight - height, box.clientHeight / 2 - spec.y / 100 * height))}px`;
}

function answerQuiz(index, choice) {
  if (state !== "bigevent" || activeEvent !== index) return;
  const quiz = events[index].data.quiz;
  const note = byId("be-message");
  if (choice !== quiz.correct) {
    mistakes += 1;
    note.textContent = quiz.options[choice].hint;
    sound.play("wrong");
    spend(RULES.power.wrongQuiz, `大型イベントの問題を間違えた −${RULES.power.wrongQuiz}%`);
    return;
  }
  const strong = document.createElement("b");
  strong.textContent = "正解。";
  sound.play("correct");
  note.replaceChildren(strong, ` ${quiz.answer}`);
  for (const button of byId("be-choices").children) button.disabled = true;
  byId("be-return").hidden = false;
  byId("be-return").focus();
}

function closeBigEvent() {
  if (state !== "bigevent") return;
  const data = events[activeEvent].data;
  resolved.add(activeEvent);
  byId("big-event").hidden = true;
  setState("running");
  showStatus("走行中", "次の計画に備えてください。");
  toast("大型イベントの観測を記録", `${data.title}（${data.observed.replace("実際の観測：", "")}）`);
  lastTick = performance.now();
  request = requestAnimationFrame(tick);
}

function end(nextState, heading, detail) {
  byId("big-event").hidden = true;
  hideToast();
  setState(nextState);
  cancelAnimationFrame(request);
  showStatus(heading, detail, nextState === "failed", nextState === "failed" ? "fail" : "success");
  sound.play(nextState === "failed" ? "fail" : "success");
  sound.stopAll();
  start.disabled = true;
  start.textContent = "走行終了";
  reset.focus();
}

const ACTIVE = ["running", "planning", "accident"];

function tick(now) {
  if (!ACTIVE.includes(state)) return;
  step(Math.max(0, (now - lastTick) / 1000));
  lastTick = now;
  if (ACTIVE.includes(state)) request = requestAnimationFrame(tick);
}

function setInputsDisabled(disabled) {
  for (const button of choices.children) button.disabled = disabled;
  answer.disabled = submit.disabled = giveUp.disabled = disabled;
}

start.addEventListener("click", () => {
  if (ACTIVE.includes(state)) {
    pausedFrom = state;
    setState("paused");
    cancelAnimationFrame(request);
    start.textContent = "再開";
    setInputsDisabled(true);
    return;
  }
  sound.start();
  if (state === "ready") {
    accident = chooseAccident();
    accidentPick.disabled = true;
    showStatus("走行中", "各 sol の走行の前に、データを見て計画を送ってください。");
    setState("running");
  } else {
    setState(pausedFrom);
  }
  start.textContent = "一時停止";
  setInputsDisabled(false);
  lastTick = performance.now();
  request = requestAnimationFrame(tick);
});

submit.addEventListener("click", submitAnswer);
byId("be-return").addEventListener("click", closeBigEvent);
byId("toast").addEventListener("click", hideToast);
window.addEventListener("resize", () => {
  if (state === "bigevent") { fitFrame(events[activeEvent].data.media.zoom); placeZoom(events[activeEvent].data.media.zoom); }
});
giveUp.addEventListener("click", revealAnswer);
byId("minimap-btn").addEventListener("click", () => toggleMap());
byId("map-close").addEventListener("click", () => toggleMap(false));
const soundButton = byId("sound");
const showSound = () => {
  soundButton.textContent = sound.enabled ? "音 オン" : "音 オフ";
  soundButton.setAttribute("aria-pressed", sound.enabled);
};
showSound();
soundButton.addEventListener("click", () => { sound.start(); sound.toggle(); showSound(); });

// Keys: 1-3 choose, M map, Esc close the map, Space pause or resume.
document.addEventListener("keydown", (event) => {
  const typing = ["TEXTAREA", "INPUT", "SELECT"].includes(event.target.tagName);
  if (event.key === "Escape") { toggleMap(false); return; }
  if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "m" || event.key === "M") { toggleMap(); return; }
  if (event.key === " " && event.target.tagName !== "BUTTON" && !start.disabled) { event.preventDefault(); start.click(); return; }
  const number = Number(event.key);
  if (number >= 1 && number <= 9) {
    const list = state === "bigevent" ? byId("be-choices") : state === "planning" ? choices : null;
    const button = list?.children[number - 1];
    if (button && !button.disabled) button.click();
  }
});
answer.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) submitAnswer();
});

reset.addEventListener("click", () => {
  cancelAnimationFrame(request);
  setState("ready");
  elapsed = 0;
  mistakes = 0;
  power = RULES.power.start;
  resolved = new Set();
  mmHeading = null;
  toggleMap(false);
  hideToast();
  byId("big-event").hidden = true;
  accidentPick.disabled = false;
  start.disabled = false;
  start.textContent = "走行開始";
  showStatus("走行を開始", "各 sol の走行の前に、データを見て計画を送ってください。電力が尽きると失敗です。");
  renderPower("—");
  renderPlayback();
  start.focus();
});

try {
  const responses = await Promise.all(["mission", "accidents", "events"].map((name) => fetch(`assets/${name}.json`)));
  for (const response of responses) if (!response.ok) throw new Error(`${response.url}: ${response.status}`);
  const [missionData, accidentData, eventData] = await Promise.all(responses.map((response) => response.json()));
  mission = missionData;
  accidents = accidentData.accidents;
  bigEvents = eventData.events;
  if (!mission.poses || !mission.drives || !mission.frames.every((frame) => frame.env)) {
    throw new Error("mission.json lacks environment data; rerun tools/prepare_rover_replay.py");
  }
  for (const item of accidents) accidentPick.append(new Option(`${item.title}（${item.rover}）`, item.id));
  const requested = new URLSearchParams(location.search).get("accident");
  if (accidents.some((item) => item.id === requested)) accidentPick.value = requested;
  duration = mission.frames.at(-1).at;
  plans = buildPlans();
  events = buildEvents();
  energy = buildEnergy();
  byId("progress").max = duration;
  drawMap();
  buildTimeline();
  drawHud();
  renderPlayback();
  renderPower("—");
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
