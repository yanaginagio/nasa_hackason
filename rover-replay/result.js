// Mission report: score, review of the questions the player got wrong, and the
// celebration on success. game.js calls showResult() when the mission ends.
// The confetti and fireworks are computer graphics written by AI; the screen says so.
import {gradeAnswer} from "./grader.js?v=2";
import {sound} from "./audio.js?v=2";
import {results} from "./results.js";
import {tr} from "./locale.js";

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// ----- score -----
// Points per part (game settings). Each line is [label, points, max, detail].
function score(summary) {
  const lines = [];
  const voyage = results.voyage;
  if (voyage && voyage.hull !== undefined) {
    const points = Math.round(voyage.hull * 1.5) + (voyage.safe ? 30 : 0) + (voyage.near ? 20 : 0);
    lines.push([tr("着陸（危険をよけて降りる）", "Landing (avoid hazards)"), points, 200,
      tr(`機体 ${voyage.hull}%・${voyage.safe ? (voyage.near ? "実際の着陸地点に着地" : "安全な場所に着地") : "危険な場所に着地"}`, `Hull: ${voyage.hull}% · ${voyage.safe ? (voyage.near ? "Reached the real landing site" : "Landed in a safe area") : "Landed in a hazard zone"}`)]);
  }
  for (const item of summary.plans) {
    const points = !item.done ? 0 : item.wrong.length === 0 ? 100 : item.wrong.length === 1 ? 50 : 20;
    lines.push([item.plan.title.replace(/^Sol (\d+) の走行計画：/, "走行計画 Sol $1："), points, 100,
      !item.done ? tr("未回答", "Unanswered") : item.wrong.length ? tr(`${item.wrong.length + 1} 回目で正解`, `Correct on attempt ${item.wrong.length + 1}`) : tr("1回目で正解", "Correct on the first try")]);
  }
  if (summary.accident) {
    const a = summary.accident;
    const points = a.passed ? Math.max(80, 200 - 60 * (a.tries - 1)) : a.gaveUp ? 40 : 0;
    lines.push([tr(`アクシデント：${a.data.title}`, `Incident: ${a.data.title}`), points, 200,
      a.passed ? (a.tries === 1 ? tr("1回目で対処成功", "Resolved on the first try") : tr(`${a.tries} 回目で対処成功`, `Resolved on attempt ${a.tries}`)) : a.gaveUp ? tr("答えを見た", "Answer revealed") : a.tries ? tr(`${a.tries} 回回答したが対処できず`, `Unresolved after ${a.tries} attempt(s)`) : tr("未回答", "Unanswered")]);
  }
  for (const quiz of summary.quizzes) {
    const points = !quiz.done ? 0 : quiz.wrong.length ? 50 : 100;
    lines.push([tr(`大型イベント：${quiz.data.title}`, `Major event: ${quiz.data.title}`), points, 100, !quiz.done ? tr("未回答", "Unanswered") : quiz.wrong.length ? tr(`${quiz.wrong.length + 1} 回目で正解`, `Correct on attempt ${quiz.wrong.length + 1}`) : tr("1回目で正解", "Correct on the first try")]);
  }
  for (const sample of summary.samples) lines.push([tr(`採取：${sample.data.title.replace(/^岩石採取：/, "")}`, `Sampling: ${sample.data.title.replace(/^Rock sampling: /, "")}`), sample.done ? 100 : 0, 100, sample.done ? tr("採取成功", "Sample collected") : tr("未到達", "Not reached")]);
  const total = lines.reduce((sum, line) => sum + line[1], 0);
  const max = lines.reduce((sum, line) => sum + line[2], 0);
  const ratio = total / max;
  const rank = ratio >= 0.9 ? "S" : ratio >= 0.75 ? "A" : ratio >= 0.6 ? "B" : ratio >= 0.4 ? "C" : "D";
  return {lines, total, max, rank};
}
const COMMENTS = {
  S: ["完璧な管制です。NASA の運用チームに迎えたいレベル。", "Excellent work from mission control."],
  A: ["見事な判断でした。あと少しで満点です。", "Good decisions. You’re close to a perfect score."],
  B: ["ミッションを支えきりました。復習でさらに上を目指しましょう。", "You kept the mission going. Review your answers to improve your score."],
  C: ["なんとか乗り切りました。下の復習で判断のこつを確かめましょう。", "You made it. Review the decisions below before trying again."],
  D: ["火星は厳しい場所です。復習してもう一度挑戦しましょう。", "Mars is a tough place to operate. Review your answers, then try again."],
};

// ----- review -----
function optionQuiz(options, correct, onExplain) {
  const box = el("div", "rs-choices");
  const feedback = el("p", "rs-feedback");
  options.forEach((option, index) => {
    const button = el("button", "", option.label);
    button.addEventListener("click", () => {
      if (index === correct) {
        feedback.className = "rs-feedback ok";
        feedback.textContent = tr(`正解！ ${onExplain()}`, `Correct! ${onExplain()}`);
        for (const b of box.children) b.disabled = true;
        button.classList.add("right");
        sound.play("correct");
      } else {
        feedback.className = "rs-feedback ng";
        feedback.textContent = option.hint || tr("ちがいます。もう一度考えてみましょう。", "Try another answer.");
        button.classList.add("wrong");
        sound.play("wrong");
      }
    });
    box.append(button);
  });
  return [el("p", "rs-try", tr("もう一度解いてみる", "Try the question again")), box, feedback];
}
function factList(rows) {
  const dl = el("dl", "rs-facts");
  for (const [term, value] of rows) dl.append(el("dt", "", term), el("dd", "", value));
  return dl;
}
function reviewItem(kind, title, nodes, open) {
  const item = el("details", `rs-item ${kind}`);
  item.open = open;
  item.append(el("summary", "", title), ...nodes);
  return item;
}
function buildReview(summary) {
  const items = [];
  for (const entry of summary.plans.filter((p) => p.wrong.length || !p.done)) {
    const {plan} = entry;
    const nodes = [el("p", "rs-q", plan.prompt), factList(plan.facts)];
    if (!entry.done && !entry.wrong.length) nodes.push(el("p", "rs-why", tr("この計画の前でミッションが終わりました。どう判断するか、考えてみましょう。", "The mission ended before this drive plan. How would you handle it?")));
    for (const choice of entry.wrong) {
      nodes.push(el("p", "rs-yours", tr(`あなたの選択：${plan.options[choice].label}`, `Your choice: ${plan.options[choice].label}`)), el("p", "rs-why", tr(`なぜちがう？ ${plan.options[choice].hint}`, `Why that choice was incorrect: ${plan.options[choice].hint}`)));
    }
    if (plan.rule) nodes.push(el("p", "rs-rule", tr(`判断の基準：${plan.rule}`, `Hint: ${plan.rule}`)));
    nodes.push(...optionQuiz(plan.options, plan.correct, () => `${plan.options[plan.correct].label}${tr("。", ". ")}${plan.record}`));
    items.push(reviewItem("plan", plan.title, nodes, items.length === 0));
  }
  const a = summary.accident;
  if (a && (a.tries > 1 || a.gaveUp || !a.passed)) {
    const nodes = [el("p", "rs-q", a.data.situation)];
    if (a.answers.length) {
      const list = el("ul", "rs-answers");
      for (const text of a.answers) list.append(el("li", "", text || tr("（空欄）", "(blank)")));
      nodes.push(el("p", "rs-yours", tr("あなたの回答", "Your answers")), list);
    }
    nodes.push(el("p", "rs-why", tr(`大切な観点：${a.data.groups.map((g) => g.name).join("・")}（${a.data.min} つ以上入れると正解）`, `Key ideas: ${a.data.groups.map((g) => g.name).join(", ")}. Include at least ${a.data.min}.`)));
    const model = el("p", "rs-answer", tr(`実際の対応（${a.data.rover}・${a.data.date}）：${a.data.answer}`, `What happened (${a.data.rover}, ${a.data.date}): ${a.data.answer}`));
    const link = el("a", "", tr(`出典：${a.data.source.label}`, `Source: ${a.data.source.label}`));
    link.href = a.data.source.url; link.target = "_blank"; link.rel = "noopener";
    nodes.push(model, link);
    // Try again in free text, graded the same way as in the game.
    const area = el("textarea", "rs-text");
    area.rows = 2; area.placeholder = tr("もう一度、ひとことで答える", "Try a word or short phrase");
    const button = el("button", "", tr("採点する", "Check answer"));
    const feedback = el("p", "rs-feedback");
    button.addEventListener("click", () => {
      const graded = gradeAnswer(area.value, a.data);
      feedback.className = `rs-feedback ${graded.passed ? "ok" : "ng"}`;
      feedback.textContent = graded.passed ? tr(`正解！：${graded.matched.map((g) => g.name).join("・")}`, `Correct: ${graded.matched.map((g) => g.name).join(", ")}`)
        : tr(`もう少し。ヒント：${graded.missing[0]?.hint ?? "具体的に書いてください。"}`, `Try again. Hint: ${graded.missing[0]?.hint ?? "Be more specific."}`);
      sound.play(graded.passed ? "correct" : "wrong");
    });
    nodes.push(el("p", "rs-try", tr("もう一度ひとことで答える", "Try a word or short phrase")), area, button, feedback);
    items.push(reviewItem("accident", tr(`アクシデント：${a.data.title}`, `Incident: ${a.data.title}`), nodes, items.length === 0));
  }
  for (const quiz of summary.quizzes.filter((q) => q.wrong.length || !q.done)) {
    const q = quiz.data.quiz;
    const nodes = [el("p", "rs-q", q.question)];
    for (const choice of quiz.wrong) nodes.push(el("p", "rs-yours", tr(`あなたの選択：${q.options[choice].label}`, `Your choice: ${q.options[choice].label}`)), el("p", "rs-why", tr(`なぜちがう？ ${q.options[choice].hint}`, `Why that choice was incorrect: ${q.options[choice].hint}`)));
    nodes.push(...optionQuiz(q.options, q.correct, () => q.answer));
    items.push(reviewItem("quiz", tr(`大型イベント：${quiz.data.title}`, `Major event: ${quiz.data.title}`), nodes, items.length === 0));
  }
  return items;
}

// ----- celebration (AI-made graphics) -----
let fxRequest;
function celebrate(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ["#b8f98e", "#ffbb76", "#8fc7ff", "#ff7a6b", "#fff3b0", "#e0764a"];
  const bits = [];
  const confetti = (x, y, n, spread) => {
    for (let i = 0; i < n; i += 1) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * spread, v = 300 + Math.random() * 600;
      bits.push({x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
        size: 5 + Math.random() * 7, color: colors[i % colors.length], life: 4 + Math.random() * 2, kind: "paper"});
    }
  };
  const firework = (x, y) => {
    const color = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < 70; i += 1) {
      const a = (i / 70) * Math.PI * 2, v = 120 + Math.random() * 220;
      bits.push({x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 2.5, color, life: 1.2 + Math.random() * 0.6, kind: "spark"});
    }
    sound.play("pop");
  };
  confetti(w * 0.15, h, 120, 1.0); confetti(w * 0.85, h, 120, 1.0);
  const schedule = [[0.5, 0.3, 0.3], [0.9, 0.7, 0.25], [1.3, 0.5, 0.18], [1.9, 0.22, 0.4], [2.4, 0.78, 0.35], [3.0, 0.5, 0.25]];
  let t = 0, last = performance.now();
  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    while (schedule.length && t >= schedule[0][0]) { const [, fx, fy] = schedule.shift(); firework(fx * w, fy * h); }
    ctx.clearRect(0, 0, w, h);
    for (const b of bits) {
      b.life -= dt;
      b.vy += (b.kind === "paper" ? 420 : 160) * dt;
      if (b.kind === "paper") { b.vx *= 1 - dt * 1.2; b.vy = Math.min(b.vy, 140); b.rot += b.vr * dt; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, b.life));
      ctx.fillStyle = b.color;
      if (b.kind === "paper") {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2 * Math.abs(Math.cos(b.rot * 1.7)) + 1);
        ctx.restore();
      } else {
        ctx.fillRect(b.x, b.y, b.size, b.size);
      }
    }
    ctx.globalAlpha = 1;
    for (let i = bits.length - 1; i >= 0; i -= 1) if (bits[i].life <= 0) bits.splice(i, 1);
    if (bits.length || schedule.length) fxRequest = requestAnimationFrame(step);
  };
  fxRequest = requestAnimationFrame(step);
}

function countUp(node, target) {
  const began = performance.now(), length = 1400;
  const step = (now) => {
    const f = Math.min(1, (now - began) / length);
    node.textContent = Math.round(target * (1 - (1 - f) ** 3));
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ----- screen -----
export function showResult(summary, {onRetry} = {}) {
  const screen = $("result");
  const {lines, total, max, rank} = score(summary);
  screen.dataset.outcome = summary.complete ? "complete" : "failed";
  screen.dataset.rank = rank;
  $("rs-title").textContent = summary.complete ? "MISSION COMPLETE" : "MISSION FAILED";
  $("rs-sub").textContent = summary.complete
    ? tr("打ち上げから岩石の採取まで、ミッションを成し遂げました。", "You completed your mission and collected a rock core.")
    : tr("電力が尽き、ローバーは動けなくなりました。", "The rover ran out of power and can no longer move.");
  $("rs-rank").textContent = rank;
  $("rs-max").textContent = max;
  $("rs-comment").textContent = summary.complete ? tr(...COMMENTS[rank]) : tr("下の復習で判断のこつを確かめて、もう一度挑戦しましょう。", "Review your decisions below, then try again.");
  $("rs-breakdown").replaceChildren(...lines.map(([label, points, lineMax, detail]) => {
    const li = el("li");
    const head = el("div", "rs-line");
    head.append(el("span", "", label), el("b", "mono", `${points} / ${lineMax}`));
    const bar = el("div", "rs-bar");
    const fill = el("i");
    fill.style.setProperty("--to", `${points / lineMax * 100}%`);
    bar.append(fill);
    li.append(head, bar, el("small", "", detail));
    return li;
  }));
  if (!results.voyage || results.voyage.hull === undefined) {
    $("rs-breakdown").append(el("li", "rs-skip", tr("着陸（危険をよけて降りる）：未プレイのため点数に含めていません", "Landing (avoid hazards): Skipped and excluded from the score.")));
  }
  const review = buildReview(summary);
  $("rs-review-note").textContent = review.length ? tr(`間違えた問題が ${review.length} つあります。開いて、もう一度解いてみましょう。`, `Review ${review.length} ${review.length === 1 ? "question" : "questions"}. Open each one to try it again.`) : tr("全問、1回目で正解でした。復習する問題はありません。", "You got every question right on the first try.");
  $("rs-review").replaceChildren(...review);
  $("rs-fx-note").hidden = !summary.complete;
  screen.hidden = false;
  screen.scrollTop = 0;
  countUp($("rs-points"), total);
  cancelAnimationFrame(fxRequest);
  const canvas = $("rs-fx");
  if (summary.complete) {
    sound.play("fanfare");
    requestAnimationFrame(() => celebrate(canvas));
  } else {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }
  $("rs-retry").onclick = () => { hideResult(); onRetry?.(); };
  $("rs-restart").onclick = () => { location.href = location.pathname; };
  $("rs-close").onclick = hideResult;
  $("rs-retry").focus({preventScroll: true}); // keep the score at the top in view
}

export function hideResult() {
  cancelAnimationFrame(fxRequest);
  $("result").hidden = true;
}
