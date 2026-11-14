const modes = {
  forecast: {
    title: "数か月後、発電量はどうなる？",
    prompt: "1月の記録から、4月中旬の発電量を予測してください。予測を変えるとしたら、何を追加で観測しますか？",
    clue: "季節が進むと日照条件が変わります。パネル上のほこりの量も、今後ずっと同じとは限りません。",
    options: ["300 Wh未満まで低下", "300〜450 Wh程度で推移", "600 Whを超えて回復"],
    answer: "2",
    takeaway: "実際は620 Wh超でした。予測には日照の変化だけでなく、パネル表面の状態も必要です。"
  },
  detective: {
    title: "電力が戻った原因は？",
    prompt: "数か月後、1日の発電量が大きく回復しました。管制ログを手がかりに、もっとも説明力のある仮説を選んでください。",
    clue: "前後の自画像を比べると、パネルの表面が以前より暗く見えます。この時期は日も長くなっていました。",
    options: ["パネルの状態は同じで、日が長くなったことだけが原因", "パネルのほこりが減り、日も長くなった", "発電量の増加は計器の誤差で、パネルにも日照にも変化はない"],
    answer: "1",
    takeaway: "日が長くなっただけでは、パネルの外観の変化を説明できません。画像と発電記録を組み合わせると、二つの要因が見えてきます。"
  },
  evidence: {
    title: "自然清掃の証拠を集める",
    prompt: "「表面のほこりが減った」「その時期に発電量が回復した」の両方を示す記録をすべて選んでください。",
    clue: "発電量は日照にも左右されます。表面の変化と発電の変化は、別の観測で確かめられます。",
    options: ["同じパネルを写した清掃前後の自画像", "同じ期間の1日あたりの発電記録", "着陸地点からの累積走行距離", "打ち上げ時の探査機の質量"],
    answer: "0,1",
    takeaway: "前後写真はパネル表面の変化、発電記録は電力の変化を示します。両方を確認しても、風と日照それぞれの寄与を数値で分けるには追加データが必要です。"
  },
  order: {
    title: "ばらばらの記録を復元する",
    prompt: "記録A〜Cを古い順に並べてください。表面の変化が確認された時点と、発電量が報告された時点を区別します。",
    clue: "A：清掃後の自画像（3月下旬）／ B：1日の発電量が620 Wh超（4月中旬）／ C：1日の発電量が375 Wh未満（1月）",
    options: ["A → B → C", "C → B → A", "C → A → B", "B → C → A"],
    answer: "2",
    takeaway: "1月の低発電、3月の清掃後の写真、4月中旬の発電回復の順です。写真の日付と発電量の報告日には間隔があります。"
  },
  budget: {
    title: "限られた電力で何を続ける？",
    prompt: "ゲーム上の利用枠は330 Wh。必須の保温・通信に240 Whを使い、残りでできる科学活動をすべて選んでください。",
    clue: "活動と消費量は試作用の仮設定です。科学活動を少なくとも1つ行い、利用枠の中で活動数を最大化してください。",
    options: ["風景の撮影（30 Wh）", "短時間の分光観測（60 Wh）", "長距離の移動（110 Wh）"],
    answer: "0,1",
    takeaway: "仮の利用枠では撮影と分光で合計330 Wh。発電が回復すると活動の選択肢が増えます。実際に使える電力は発電量だけでなく、蓄電池や保温の必要量にも左右されます。"
  }
};

const element = (id) => document.getElementById(id);
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const form = element("challenge");
const reveal = element("reveal");
const feedback = element("feedback");
const submit = form.querySelector("button[type=submit]");
let mode = "forecast";

function render(next, focus = false) {
  mode = next;
  const data = modes[mode];
  element("task").textContent = data.title;
  element("prompt").textContent = data.prompt;
  element("clues").textContent = data.clue;
  element("reason").value = "";
  element("reason").disabled = false;
  reveal.hidden = true;
  feedback.textContent = "";
  submit.disabled = false;
  const multiple = mode === "evidence" || mode === "budget";
  const options = data.options.map((label, index) => {
    const wrapper = document.createElement("label");
    wrapper.className = "option";
    const input = document.createElement("input");
    input.type = multiple ? "checkbox" : "radio";
    input.name = "choice";
    input.value = index;
    wrapper.append(input, document.createTextNode(label));
    return wrapper;
  });
  element("inputs").replaceChildren(...options);
  for (const button of modeButtons) {
    button.setAttribute("aria-pressed", button.dataset.mode === mode);
  }
  if (focus) element("task").focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  const selected = new FormData(form).getAll("choice");
  if (!selected.length) {
    feedback.textContent = "選択肢を選んでから判断を確定してください。";
    element("inputs").querySelector("input").focus();
    return;
  }
  const data = modes[mode];
  const answer = data.answer.split(",").map((index) => data.options[Number(index)]).join(" ／ ");
  element("result").textContent = (selected.join(",") === data.answer ? "正解です。" : "記録や条件と照らし合わせてみましょう。") + " この問題の答えは「" + answer + "」です。";
  element("takeaway").textContent = data.takeaway;
  const reason = element("reason").value.trim();
  element("reflection").textContent = reason ? "あなたが選んだ理由　" + reason : "";
  submit.disabled = true;
  element("reason").disabled = true;
  for (const input of element("inputs").querySelectorAll("input")) input.disabled = true;
  reveal.hidden = false;
  element("reveal-title").focus();
});

for (const button of modeButtons) {
  button.addEventListener("click", () => render(button.dataset.mode, true));
}
element("retry").addEventListener("click", () => render(mode, true));
render(mode);
