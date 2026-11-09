"use strict";
/* ---------- 基礎工具 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pad = n => String(n).padStart(2, "0");
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayNum = (d = new Date()) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
const normWord = w => w.toLowerCase().replace(/[’]/g, "'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");

/** 把長句切成好跟讀的意群：先依標點，太長再於介系詞、連接詞前切開 */
function chunkSentence(en) {
  const parts = en.trim().split(/(?<=[,;:.!?])\s+/).filter(Boolean);
  const brk = /^(to|and|but|or|in|on|at|for|with|from|about|after|before|because|that|when|if|so)$/i;
  const out = [];
  for (const p of parts) {
    const ws = p.split(/\s+/);
    if (ws.length <= 4) { out.push(p); continue; }
    let cur = [];
    ws.forEach((w, i) => {
      const left = ws.length - i;
      if (cur.length >= 2 && left >= 2 && brk.test(w)) { out.push(cur.join(" ")); cur = []; }
      cur.push(w);
      if (cur.length >= 6 && left > 2) { out.push(cur.join(" ")); cur = []; }
    });
    if (cur.length) out.push(cur.join(" "));
  }
  return out;
}

/** 比對目標句與辨識結果（LCS），回傳命中的目標字索引 */
function compareWords(target, heard) {
  const a = target.split(/\s+/).map(normWord).filter(Boolean), b = heard.split(/\s+/).map(normWord).filter(Boolean);
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hit = new Set(); let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { hit.add(i); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return { hit, total: a.length, score: a.length ? Math.round(hit.size / a.length * 100) : 0 };
}

/* ---------- 資料儲存 ---------- */
const KEY = "shadowing_v1";
const STEP_DEFAULTS = {
  1: { rate: 0.7, times: 3, gap: false },
  2: { rate: 0.75, times: 2, gap: true },
  3: { rate: 0.9, times: 3, gap: true },
  free: { rate: 0.8, times: 2, gap: true },
  sound: { rate: 0.6, times: 3, gap: true },
};
function defaultState() { return { mine: [], star: {}, review: {}, days: {}, sounds: {}, steps: {}, ipa: {}, tab: "today", dictPos: 0, dictDays: {}, dictRes: {} }; }
function load() { try { return Object.assign(defaultState(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return defaultState(); } }
let state = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast("無法儲存，瀏覽器可能封鎖了本機儲存"); } }
const cfg = k => state.steps[k] || (state.steps[k] = { ...STEP_DEFAULTS[k] });

/* ---------- 句子登錄與音標 ---------- */
const REG = {};
const DICT = { ...COMMON_IPA };
const addVocab = v => (v || []).forEach(([w, ip]) => DICT[w.toLowerCase()] = ip);
Object.entries(THEMES).forEach(([k, t]) => t.items.forEach((it, i) => { REG[`t-${k}-${i}`] = { en: it[0], zh: it[1], vocab: it[2], src: t.name }; addVocab(it[2]); }));
DAILY.forEach((d, i) => {
  REG[`dl-${i}`] = { en: d.listen.en, zh: d.listen.zh, vocab: d.listen.vocab, note: d.listen.note, src: "每日聽力" };
  REG[`dt-${i}`] = { en: d.talk.opts[0].en, zh: d.talk.opts[0].zh, vocab: d.talk.vocab, note: d.talk.note, src: "每日會話" };
  REG[`ds-${i}`] = { en: d.shadow.en, zh: d.shadow.zh, vocab: d.shadow.vocab, note: d.shadow.note, src: "每日跟讀" };
  [d.listen, d.talk, d.shadow].forEach(x => addVocab(x.vocab));
});
[...VOWELS, ...CONSONANTS].forEach(s => { s[3].forEach(x => { const [w, i] = x.split("|"); DICT[w.toLowerCase()] = i; }); s[5].flat().forEach(x => { const [w, i] = x.split("|"); DICT[w.toLowerCase()] = i; }); });
DICTATION.forEach((d, i) => { REG[`dc-${i}`] = { en: d[0], zh: d[1], vocab: d[2], note: d[3], src: "聽寫" }; addVocab(d[2]); });
const getS = id => REG[id] || state.mine.find(m => m.id === id);
const missing = new Set();

async function ipaOf(word) {
  const w = normWord(word);
  if (!w) return "";
  if (DICT[w]) return DICT[w];
  if (state.ipa[w]) return state.ipa[w];
  if (missing.has(w)) return "";
  try {
    const r = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(w));
    if (!r.ok) throw 0;
    const data = await r.json();
    const ph = data.flatMap(e => e.phonetics || []).filter(p => p.text);
    const pick = ph.find(p => /-us\./.test(p.audio || "")) || ph[0];
    const ip = pick ? pick.text.replace(/[/\[\]]/g, "") : "";
    if (ip) { state.ipa[w] = ip; save(); return ip; }
  } catch { /* 離線或查無此字，下方標記不再重查 */ }
  missing.add(w);
  return "";
}

/* ---------- 語音播放 ---------- */
const TTS = {
  run: 0, busy: false, voice: null,
  pickVoice() {
    const all = speechSynthesis.getVoices();
    const us = all.filter(v => /^en[-_]US/i.test(v.lang));
    const vs = us.length ? us : all.filter(v => /^en([-_]|$)/i.test(v.lang));
    this.voice = vs.find(v => /natural|online/i.test(v.name)) || vs.find(v => /google/i.test(v.name)) || vs[0] || null;
    this.noEnglish = all.length > 0 && !this.voice;
  },
  speak(text, rate, onBoundary) {
    return new Promise(res => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US"; u.rate = rate;
      if (this.voice) u.voice = this.voice;
      let settled = false;
      const done = () => { if (!settled) { settled = true; clearTimeout(guard); res(); } };
      const guard = setTimeout(done, text.length * 220 / rate + 4000); // 語音引擎沒回應時不要卡死
      u.onend = u.onerror = done;
      if (onBoundary) u.onboundary = e => onBoundary(e.charIndex);
      speechSynthesis.speak(u);
    });
  },
  stop() { this.run++; this.busy = false; try { speechSynthesis.cancel(); } catch { } },
};
if (window.speechSynthesis) { TTS.pickVoice(); speechSynthesis.onvoiceschanged = () => { TTS.pickVoice(); if ($("#sheet").hidden && state.tab === "today") render(); }; }

async function sayOnce(text, rate = 0.8) { TTS.stop(); await sleep(60); return TTS.speak(text, rate); }

/** 依設定重複播放清單。times=0 代表無限循環 */
async function playList(list, key, hooks = {}) {
  TTS.stop(); await sleep(60);
  const run = ++TTS.run; TTS.busy = true;
  const alive = () => run === TTS.run;
  const once = async (text, i, n) => {
    const c = cfg(key);
    hooks.onItem && hooks.onItem(i);
    hooks.onStatus && hooks.onStatus(`播放中${n ? `（第 ${n} 遍）` : ""}`);
    const t0 = Date.now();
    await TTS.speak(text, c.rate, list.length === 1 ? hooks.onBoundary : null);
    if (!alive()) return;
    if (cfg(key).gap) { hooks.onStatus && hooks.onStatus("換你說"); await sleep(Date.now() - t0 + 500); }
    else await sleep(250);
  };
  if (cfg(key).times === 0) {
    for (let n = 1; alive(); n++) for (let i = 0; i < list.length && alive(); i++) await once(list[i], i, n);
  } else {
    for (let i = 0; i < list.length && alive(); i++)
      for (let n = 1; n <= (cfg(key).times || 1) && alive(); n++) await once(list[i], i, n);
  }
  if (alive()) { TTS.busy = false; hooks.onStatus && hooks.onStatus("播完了"); hooks.onEnd && hooks.onEnd(); }
}

/* ---------- 語音辨識與錄音 ---------- */
const speechOK = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
function recognize() {
  return new Promise((res, rej) => {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return rej("unsupported");
    const r = new R(); r.lang = "en-US"; r.maxAlternatives = 5; r.interimResults = false;
    let got = null, err = "no-speech";
    r.onresult = e => { got = Array.from(e.results[0]).map(a => a.transcript); };
    r.onerror = e => { err = e.error; };
    r.onend = () => got ? res(got) : rej(err);
    r.start();
  });
}
const SPEECH_ERR = { "not-allowed": "麥克風被封鎖了。請按網址列的鎖頭圖示，允許使用麥克風。", "no-speech": "沒有聽到聲音，靠近麥克風再試一次。", "network": "語音辨識需要網路，請確認連線。", "audio-capture": "找不到麥克風。", "unsupported": "這個瀏覽器不支援語音辨識，請改用 Chrome 或 Edge。" };
const speechErr = e => SPEECH_ERR[e] || "辨識失敗，請再試一次。";

const Rec = {
  mr: null, url: null, stream: null,
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    this.mr = new MediaRecorder(this.stream);
    this.mr.ondataavailable = e => chunks.push(e.data);
    return new Promise(res => {
      this.mr.onstop = () => {
        if (this.url) URL.revokeObjectURL(this.url);
        this.url = URL.createObjectURL(new Blob(chunks, { type: this.mr.mimeType }));
        this.release(); res(this.url);
      };
      this.mr.start();
    });
  },
  stop() { if (this.mr && this.mr.state === "recording") this.mr.stop(); },
  release() { if (this.stream) this.stream.getTracks().forEach(t => t.stop()); this.stream = null; },
  get active() { return !!(this.mr && this.mr.state === "recording"); },
};

/* ---------- 複習排程 ---------- */
const INTERVALS = [1, 3, 7, 14];
function addReview(id) { if (!state.review[id]) state.review[id] = { box: 0, due: dayNum() }; }
function rateItem(id, level) {
  if (level === "again") { state.review[id] = { box: 0, due: dayNum() + 1 }; }
  else if (state.review[id]) {
    const r = state.review[id];
    if (level === "good") r.box = Math.min(r.box + 1, INTERVALS.length - 1);
    r.due = dayNum() + INTERVALS[level === "good" ? r.box : 0];
  }
  save();
}
const dueIds = () => Object.keys(state.review).filter(id => getS(id) && state.review[id].due <= dayNum());

/* ---------- 今日內容 ---------- */
function today() {
  const n = dayNum(), set = n % DAILY.length;
  const pick = (k, off = 0) => { const len = THEMES[k].items.length; return `t-${k}-${(n + off) % len}`; };
  return { set, n, themes: ["life", "travel", "med"].map(k => ({ k, name: THEMES[k].name, id: pick(k), bonus: pick(k, 7) })) };
}
const doneList = () => state.days[dateKey()] || [];
function markDone(key) { const k = dateKey(); const a = state.days[k] || (state.days[k] = []); if (!a.includes(key)) a.push(key); save(); }
function streak() {
  let s = 0; const d = new Date();
  if (!(state.days[dateKey(d)] || []).length) d.setDate(d.getDate() - 1);
  while ((state.days[dateKey(d)] || []).length) { s++; d.setDate(d.getDate() - 1); }
  return s;
}

/* ---------- 共用片段 ---------- */
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); }
const vocabHTML = v => v && v.length ? `<div class="vocab">${v.map(([w, ip, zh]) => `<button class="icon" data-act="say" data-t="${esc(w)}" aria-label="播放 ${esc(w)}">${esc(w)}</button><span class="ip">/${esc(ip)}/</span><span>${esc(zh)}</span>`).join("")}</div>` : "";
const markBtns = id => `<button class="icon ${state.star[id] ? "on-star" : ""}" data-act="star" data-id="${id}" aria-pressed="${!!state.star[id]}">${state.star[id] ? "★ 已收藏" : "☆ 收藏"}</button>
  <button class="icon ${state.review[id] ? "on-rev" : ""}" data-act="rev" data-id="${id}" aria-pressed="${!!state.review[id]}">${state.review[id] ? "已在再複習" : "＋再複習"}</button>`;
function ctlHTML(key) {
  const c = cfg(key);
  const chips = (label, field, vals) => `<div class="ctlrow"><span>${label}</span>${vals.map(([v, t]) => `<button class="${c[field] === v ? "on" : ""}" data-act="ctl" data-key="${key}" data-f="${field}" data-v="${v}">${t}</button>`).join("")}</div>`;
  return chips("速度", "rate", [[0.5, "0.5"], [0.6, "0.6"], [0.7, "0.7"], [0.75, "0.75"], [0.8, "0.8"], [0.9, "0.9"], [1, "1.0"]])
    + chips("次數", "times", [[1, "1"], [2, "2"], [3, "3"], [5, "5"], [10, "10"], [0, "無限"]])
    + chips("跟讀空檔", "gap", [[true, "開"], [false, "關"]]);
}

/* ---------- 頁面：今日 ---------- */
const TABS = [["today", "今日"], ["lib", "句庫"], ["sound", "發音表"], ["review", "複習"], ["guide", "方法"]];
function taskList() {
  const t = today();
  const tasks = [
    { key: "listen", tag: "聽力題", title: "聽一句話，選出中文意思", act: "q", type: "listen" },
    { key: "dict", tag: "聽寫", title: `聽英文，打出你聽到的句子（${Object.keys(dictResToday()).length} / 3 題）`, act: "dict" },
    { key: "talk", tag: "會話題", title: "聽對方說，選出合適的回答", act: "q", type: "talk" },
    { key: "shadow", tag: "影子跟讀", title: DAILY[t.set].shadow.zh, act: "coach", id: `ds-${t.set}` },
    ...t.themes.map(x => ({ key: "t-" + x.k, tag: x.name, title: getS(x.id).zh, act: "coach", id: x.id })),
  ];
  return { t, tasks };
}
function vToday() {
  const { t, tasks } = taskList(), done = doneList();
  const fin = tasks.filter(x => done.includes(x.key)).length, next = tasks.find(x => !done.includes(x.key));
  const due = dueIds().length;
  const d = new Date();
  return `<header class="row between"><div><p class="mute">${d.getMonth() + 1} 月 ${d.getDate()} 日　連續 ${streak()} 天</p><h1>${fin === tasks.length ? "今天完成了" : "今天練 15 分鐘就好"}</h1></div></header>
  ${TTS.noEnglish ? `<section class="card"><p class="bad">這個瀏覽器找不到英文語音，念出來會有中文口音。</p><p>${/Android|iPhone|iPad/i.test(navigator.userAgent) ? "請到手機的「設定」搜尋「文字轉語音」或「語音內容」，下載英文（美國）語音後重新開啟 App。" : "請改用 Microsoft Edge 或 Google Chrome 開啟。若仍然出現這個訊息，請到 Windows「設定 → 時間與語言 → 語音」新增 English (United States) 語音。"}</p></section>` : ""}
  <section class="card"><div class="bar"><i style="width:${fin / tasks.length * 100}%"></i></div><p class="mute">已完成 ${fin} / ${tasks.length} 項</p>
  ${next ? `<button class="primary big" data-act="task" data-key="${next.key}">開始：${esc(next.tag)}</button>` : `<p>全部完成，明天會換新內容。想多練可以試試下面的加碼句。</p>`}</section>
  ${due ? `<button data-act="tab" data-t="review" class="big">今天有 ${due} 句要複習</button>` : ""}
  <section class="card"><h2>今日任務</h2>${tasks.map(x => `<button class="task ${done.includes(x.key) ? "done" : ""}" data-act="task" data-key="${x.key}"><span class="chk">${done.includes(x.key) ? "✓" : ""}</span><span class="grow"><span class="tag">${esc(x.tag)}</span>${esc(x.title)}</span></button>`).join("")}</section>
  <section class="card"><h2>行有餘力：加碼一句</h2>${t.themes.map(x => `<button class="task" data-act="coach" data-id="${x.bonus}"><span class="grow"><span class="tag">${esc(x.name)}</span>${esc(getS(x.bonus).zh)}</span></button>`).join("")}</section>`;
}

/* ---------- 頁面：句庫 ---------- */
const itemHTML = id => { const s = getS(id); return s ? `<article class="card item"><p class="en">${esc(s.en)}</p>${s.zh ? `<p class="mute">${esc(s.zh)}</p>` : ""}<div class="row"><button class="primary" data-act="coach" data-id="${id}">跟讀</button>${markBtns(id)}${id.startsWith("u-") ? `<button class="icon" data-act="del" data-id="${id}">刪除</button>` : ""}</div></article>` : ""; };
function vLib() {
  return `<h1>我的句庫</h1>
  <section class="card"><h2>匯入句子</h2><p class="mute">一行一句，用 | 分隔英文和中文。中文可省略。</p>
  <textarea id="imp" placeholder="How was your day? | 你今天過得如何？&#10;I'll be right back. | 我馬上回來。"></textarea>
  <div class="row"><button class="primary" data-act="import">加入句庫</button><label class="mute">或選 .txt 檔 <input type="file" id="impFile" accept=".txt,.csv,text/plain"></label></div></section>
  ${state.mine.length ? `<section class="card"><h2>連續播放全部（${state.mine.length} 句）</h2><div class="ctl" id="ctl-free">${ctlHTML("free")}</div><p class="status" id="libStatus"></p><button class="primary big" data-act="playAll">${TTS.busy ? "停止" : "播放全部"}</button></section>
  ${state.mine.map(m => itemHTML(m.id)).join("")}` : `<p class="mute">還沒有匯入句子。可以到「方法」頁複製提示詞，請 AI 幫你產生。</p>`}
  <section class="card"><h2>備份</h2><p class="mute">學習紀錄只存在這台電腦的這個瀏覽器。換電腦前請先匯出。</p><div class="row"><button data-act="backup">匯出備份</button><label class="mute">還原備份 <input type="file" id="restoreFile" accept=".json"></label></div></section>`;
}
function importText(text) {
  let n = 0;
  text.split(/\r?\n/).forEach(line => {
    const [en, zh] = line.split(/\s*[|\t]\s*/);
    if (!en || !/[a-z]/i.test(en) || state.mine.some(m => m.en === en.trim())) return;
    state.mine.unshift({ id: `u-${Date.now()}-${n}`, en: en.trim(), zh: (zh || "").trim(), src: "我的句子" }); n++;
  });
  save(); toast(n ? `已加入 ${n} 句` : "沒有新句子可加入"); render();
}

/* ---------- 頁面：發音表 ---------- */
function soundGroup(title, list, prefix) {
  return `<h2>${title}</h2><div class="tiles">${list.map((s, i) => `<button class="tile ${state.sounds[prefix + i] ? "done" : ""}" data-act="sound" data-g="${prefix}" data-i="${i}"><b>${s[0]}</b><small>${esc(s[3][0].split("|")[0])}</small></button>`).join("")}</div>`;
}
function vSound() {
  const n = Object.keys(state.sounds).length, all = VOWELS.length + CONSONANTS.length;
  return `<h1>母音子音表</h1><p class="mute">美式發音 ${VOWELS.length} 個母音、${CONSONANTS.length} 個子音。點一個音，跟讀後做 3 題小考。已通過 ${n} / ${all}。</p>
  ${soundGroup("母音", VOWELS, "v")}${soundGroup("子音", CONSONANTS, "c")}`;
}

/* ---------- 頁面：複習 ---------- */
let reviewSeg = "rev";
function vReview() {
  const due = new Set(dueIds());
  const revIds = Object.keys(state.review).filter(getS).sort((a, b) => due.has(b) - due.has(a));
  const starIds = Object.keys(state.star).filter(getS);
  const list = reviewSeg === "rev" ? revIds : starIds;
  return `<h1>複習</h1><div class="seg"><button class="${reviewSeg === "rev" ? "on" : ""}" data-act="seg" data-v="rev">再複習（${revIds.length}）</button><button class="${reviewSeg === "star" ? "on" : ""}" data-act="seg" data-v="star">收藏（${starIds.length}）</button></div>
  ${reviewSeg === "rev" && due.size ? `<button class="primary big" data-act="coach" data-id="${[...due][0]}">開始複習（今天 ${due.size} 句）</button>` : ""}
  ${list.length ? list.map(itemHTML).join("") : `<p class="mute">${reviewSeg === "rev" ? "目前沒有句子。練習時按「＋再複習」，或最後選「還要再練」就會出現在這裡。" : "目前沒有收藏。練習時按「☆ 收藏」就會出現在這裡。"}</p>`}`;
}

/* ---------- 頁面：方法與提示詞 ---------- */
const PROMPTS = [
  ["產生可匯入的句子", "請給我 10 句美國人日常會用的英文短句，主題是【餐廳點餐】。\n程度：初學者，每句 8 個字以內，只用常見單字。\n格式：一行一句，英文 | 繁體中文。不要編號，不要其他說明。"],
  ["我想說的話，教我最簡單的講法", "我的英文是初學者，還無法用英文思考。\n我想表達：【我今天有點累，想早點回家】\n請給我：\n1. 一句最簡單、美國人真的會說的講法（8 個字以內）\n2. 逐段對應的中文意思\n3. 可以替換的 2 個字，讓我換個情境也能用\n請用繁體中文說明，不要給太多選項。"],
  ["陪我練一段簡單對話", "請扮演【飯店櫃台人員】陪我練英文對話。規則：\n1. 每次只說一句，8 個字以內，用最常見的單字\n2. 每句後面附繁體中文翻譯\n3. 再給我 2 個可以照著念的回答，附中文\n4. 我答錯不要糾正太多，只提醒一個重點\n5. 六回合後結束，並用繁體中文整理 3 個我該記住的句子，格式：英文 | 中文"],
  ["拆解一句聽不懂的話", "請用繁體中文幫我拆解這句英文：【貼上句子】\n1. 整句意思\n2. 按意群切開，每段附中文\n3. 哪些地方會連音或弱讀，用中文諧音輔助說明\n4. 最重要的 1 個句型，再造 2 個簡單例句\n請保持簡短，我是初學者。"],
];
function vGuide() {
  return `<h1>學習方法</h1>
  <section class="card"><h2>為什麼不用先學會英文思考</h2><p>先用中文弄懂意思，再讓耳朵和嘴巴反覆模仿。句子練熟了，遇到相同情境就會直接說出來，不必在腦中翻譯。</p></section>
  <section class="card"><h2>每句話的五個步驟</h2><ol style="margin:0;padding-left:1.3em">
    <li><b>看懂：</b>先看中文，知道這句話在說什麼。</li><li><b>慢慢聽：</b>只聽不說，慢速聽 3 遍。</li><li><b>分段跟：</b>切成小段，播一段說一段。</li><li><b>影子跟讀：</b>整句跟著念，再錄音比對。</li><li><b>評分：</b>覺得還不順，就排進複習，隔天再見。</li></ol></section>
  <section class="card"><h2>每天 15 分鐘</h2><p>依序做完「今日」的 7 項就好。聽寫時聽不出來的字可以空著，第二次再補。卡住時把速度調到 0.5，一句練不好沒關係，留給複習。發音表每天挑 1 個音，別貪多。</p></section>
  <h2>AI 提示詞（複製到 Claude 或 ChatGPT）</h2><p class="mute">把【】裡的內容換成你要的。產生的句子可以貼回「句庫」匯入。</p>
  ${PROMPTS.map((p, i) => `<section class="card"><h2>${esc(p[0])}</h2><pre>${esc(p[1])}</pre><button data-act="copy" data-i="${i}">複製</button></section>`).join("")}`;
}

/* ---------- 導覽 ---------- */
function render() {
  const v = { today: vToday, lib: vLib, sound: vSound, review: vReview, guide: vGuide }[state.tab]();
  $("#view").innerHTML = v;
  $("#nav").innerHTML = TABS.map(([k, n]) => `<button class="${state.tab === k ? "on" : ""}" data-act="tab" data-t="${k}">${n}</button>`).join("");
}
function openSheet(html) { $("#sheetBody").innerHTML = html; $("#sheet").hidden = false; $("#sheet").scrollTop = 0; document.body.style.overflow = "hidden"; }
function closeSheet() { TTS.stop(); Rec.stop(); C = null; Q = null; SQ = null; D = null; $("#sheet").hidden = true; document.body.style.overflow = ""; render(); }
const sheetHead = t => `<div class="row between"><button class="icon" data-act="close">← 返回</button><span class="mute">${esc(t)}</span></div>`;

/* ---------- 跟讀教練 ---------- */
let C = null;
const STEP_NAMES = ["看懂", "慢慢聽", "分段跟", "影子跟讀", "評分"];
const STEP_TIPS = [
  "先不用管英文。看懂中文意思，點英文單字可以聽發音。",
  "現在只要聽，不用開口。眼睛跟著字走，聽 3 遍。",
  "聽一小段，出現「換你說」就照著念。念錯沒關係。",
  "跟著聲音一起念，像影子一樣。先模仿節奏，再顧發音。",
  "憑感覺選就好，系統會幫你安排下次複習的時間。",
];
function openCoach(id, doneKey, step = 0) { TTS.stop(); C = { id, doneKey, step }; renderCoach(); }
function sentHTML(en) {
  return `<div class="sent" id="sent">${[...en.matchAll(/\S+/g)].map(m => `<button class="w" data-act="word" data-w="${esc(m[0])}" data-o="${m.index}">${esc(m[0])}<small data-ipa="${esc(normWord(m[0]))}"></small></button>`).join("")}</div>`;
}
function fillIpa() {
  document.querySelectorAll("#sheetBody small[data-ipa]").forEach(async el => { const ip = await ipaOf(el.dataset.ipa); if (ip) el.textContent = ip; });
}
function renderCoach() {
  const s = getS(C.id), st = C.step;
  let body = "";
  if (st === 0) body = `${s.zh ? `<p style="font-size:1.3rem;font-weight:700">${esc(s.zh)}</p>` : `<p class="mute">這句沒有中文翻譯，可以回句庫編輯後重新匯入。</p>`}${sentHTML(s.en)}<div id="wordinfo" class="mute"></div>${vocabHTML(s.vocab)}${s.note ? `<p class="coachtip">${esc(s.note)}</p>` : ""}<button data-act="sayS">聽一次</button>`;
  if (st === 1) body = `${sentHTML(s.en)}<p class="mute">${esc(s.zh)}</p>`;
  if (st === 2) body = `<div class="ctl" style="gap:8px">${chunkSentence(s.en).map((c, i) => `<div class="chunk" data-chunk="${i}">${esc(c)}</div>`).join("")}</div><p class="mute">${esc(s.zh)}</p>`;
  if (st === 3) body = `${sentHTML(s.en)}<p class="mute">${esc(s.zh)}</p>`;
  if (st === 4) body = `<p class="en" style="font-size:1.2rem">${esc(s.en)}</p><div style="display:grid;gap:8px"><button class="primary big" data-act="rate" data-v="good">很順，下次晚點再複習</button><button class="big" data-act="rate" data-v="ok">還可以</button><button class="big" data-act="rate" data-v="again">還要再練，明天再來</button></div>`;
  const playable = st >= 1 && st <= 3;
  openSheet(`${sheetHead(s.src || "跟讀")}
  <div class="steps">${STEP_NAMES.map((n, i) => `<button class="${i === st ? "on" : ""}" data-act="step" data-v="${i}">${n}</button>`).join("")}</div>
  <p class="coachtip">${STEP_TIPS[st]}</p><section class="card">${body}</section>
  ${playable ? `<p class="status" id="status" aria-live="polite"></p><button class="primary big" id="playBtn" data-act="coachPlay">播放</button><details><summary class="mute">調整速度和次數</summary><div class="ctl" id="ctl-${st}" style="margin-top:8px">${ctlHTML(st)}</div></details>` : ""}
  ${st === 3 ? `<section class="card"><h2>檢查自己的發音</h2><div class="row"><button data-act="recog">念給系統聽</button><button data-act="record" id="recBtn">錄音</button></div><p id="recogOut" aria-live="polite"></p><div id="recOut" class="row"></div></section>` : ""}
  <div class="row">${markBtns(C.id)}</div>
  ${st < 4 ? `<button class="big" data-act="step" data-v="${st + 1}">下一步：${STEP_NAMES[st + 1]}</button>` : ""}`);
  fillIpa();
}
function setCoachBtn() { const b = $("#playBtn"); if (b) b.textContent = TTS.busy ? "停止" : "再播放"; }
function coachPlay() {
  if (TTS.busy) { TTS.stop(); setCoachBtn(); const s = $("#status"); if (s) s.textContent = ""; return; }
  const s = getS(C.id), key = C.step;
  const list = key === 2 ? chunkSentence(s.en) : [s.en];
  const words = [...document.querySelectorAll("#sent .w")];
  playList(list, key, {
    onStatus: t => { const e = $("#status"); if (e) e.textContent = t; setCoachBtn(); },
    onItem: i => document.querySelectorAll("[data-chunk]").forEach(e => e.classList.toggle("now", +e.dataset.chunk === i)),
    onBoundary: ci => { let cur = null; words.forEach(w => { w.classList.remove("now"); if (+w.dataset.o <= ci) cur = w; }); if (cur) cur.classList.add("now"); },
    onEnd: () => { words.forEach(w => w.classList.remove("now")); setCoachBtn(); },
  });
  const b = $("#playBtn"); if (b) b.textContent = "停止";
}
async function coachRecog() {
  TTS.stop();
  const out = $("#recogOut"), s = getS(C.id);
  out.textContent = "請現在念出整句…";
  try {
    const alts = await recognize();
    const best = alts.map(a => ({ a, r: compareWords(s.en, a) })).sort((x, y) => y.r.score - x.r.score)[0];
    if (!$("#recogOut")) return;
    document.querySelectorAll("#sent .w").forEach((w, i) => { w.classList.toggle("hit", best.r.hit.has(i)); w.classList.toggle("miss", !best.r.hit.has(i)); });
    const msg = best.r.score >= 90 ? "很棒，系統幾乎都聽懂了。" : best.r.score >= 60 ? "不錯！紅色的字再多練幾次。" : "沒關係，放慢速度，先把紅色的字念清楚。";
    out.innerHTML = `<b>${best.r.score} 分</b>　${msg}<br><span class="mute">系統聽到：${esc(best.a)}</span>`;
  } catch (e) { if ($("#recogOut")) out.textContent = speechErr(e); }
}
async function coachRecord(btn) {
  if (Rec.active) { Rec.stop(); return; }
  TTS.stop();
  try {
    const p = Rec.start(); btn.textContent = "停止錄音";
    const url = await p;
    if (!$("#recOut")) return;
    btn.textContent = "重新錄音";
    $("#recOut").innerHTML = `<audio controls src="${url}" style="width:100%"></audio><button data-act="compare">先聽原音，再聽我的</button>`;
  } catch { btn.textContent = "錄音"; toast("無法使用麥克風，請允許瀏覽器存取"); }
}

/* ---------- 每日題 ---------- */
let Q = null;
function openQ(type) {
  const t = today(), d = DAILY[t.set];
  Q = { type, set: t.set, data: d[type], answered: null, opts: shuffle(d[type].opts.map((o, i) => ({ o, right: i === 0 }))) };
  renderQ(); setTimeout(qPlay, 300);
}
const qAudio = () => Q.type === "listen" ? Q.data.en : Q.data.a;
async function qPlay() { if (!Q) return; const run = (TTS.stop(), await sleep(60), ++TTS.run); for (let i = 0; i < 2 && run === TTS.run; i++) { await TTS.speak(qAudio(), 0.8); await sleep(500); } }
function renderQ() {
  const { type, data, opts, answered, set } = Q, listen = type === "listen", show = answered !== null;
  const id = (listen ? "dl-" : "dt-") + set, right = opts.find(o => o.right).o;
  const label = o => listen ? esc(o) : `<span class="en">${esc(o.en)}</span><br><span class="mute">${esc(o.zh)}</span>`;
  openSheet(`${sheetHead(listen ? "聽力題" : "會話題")}
  <p class="coachtip">${listen ? "先不看英文，聽兩遍，抓關鍵字就好。" : "對方這樣跟你說，你要怎麼回答？可以看中文提示。"}</p>
  <section class="card">${listen ? `<p style="font-weight:700">${esc(data.q)}</p>` : `<p class="mute">對方說的意思：${esc(data.azh)}</p>`}
  <button class="primary big" data-act="qPlay">再聽一次</button>
  ${show ? `<p class="en" style="font-size:1.2rem">${esc(listen ? data.en : data.a)}</p>${listen ? `<p class="mute">${esc(data.zh)}</p>` : ""}` : ""}</section>
  <div style="display:grid;gap:8px">${opts.map((x, i) => `<button class="opt ${show ? (x.right ? "right" : (i === answered ? "wrong" : "")) : ""}" data-act="qAns" data-i="${i}" ${show ? "disabled" : ""}>${label(x.o)}</button>`).join("")}</div>
  ${show ? `<section class="card"><p class="${opts[answered].right ? "good" : "bad"}">${opts[answered].right ? "答對了！" : "答錯沒關係，這就是今天要記住的句子。"}</p>
  ${listen ? "" : `<p><b>建議回答：</b><span class="en">${esc(right.en)}</span></p>`}
  <h2>單字</h2>${vocabHTML(data.vocab)}<h2>文法與表達</h2><p>${esc(data.note)}</p></section>
  <div class="row">${markBtns(id)}</div><button class="primary big" data-act="coach" data-id="${id}">跟讀這句</button><button class="big" data-act="close">回今日</button>` : ""}`);
}

/* ---------- 發音考題 ---------- */
let SQ = null;
function openSound(g, i) {
  const s = (g === "v" ? VOWELS : CONSONANTS)[i];
  const parts = x => { const [w, ip] = x.split("|"); return { w, ip }; };
  const qs = s[5].map(p => { const opts = p.map(parts); return { kind: "pick", opts: shuffle(opts), target: opts[Math.random() < .6 ? 0 : 1] }; });
  qs.push({ kind: "speak", target: parts(s[3][0]) });
  SQ = { g, i, s, qs, cur: -1, right: 0, ans: null };
  renderSound();
}
function renderSound() {
  const { s, qs, cur } = SQ;
  const head = sheetHead(`${s[2]}`);
  if (cur === -1) {
    const ex = s[3].map(x => x.split("|"));
    const same = s[0] === s[1];
    openSheet(`${head}<section class="card" style="justify-items:center;text-align:center"><div class="bigsym">/${s[0]}/</div>${same ? "" : `<p class="mute">KK 音標 [${s[1]}]</p>`}<p>${esc(s[4])}</p></section>
    <p class="coachtip">英文的單音很難單獨念，所以我們用單字來練。聽一個、跟一個。</p>
    <section class="card">${ex.map(([w, ip]) => `<button class="task" data-act="say" data-t="${esc(w)}" data-r="0.6"><span class="grow en">${esc(w)}</span><span class="ip mute">/${esc(ip)}/</span></button>`).join("")}</section>
    <p class="status" id="sStatus" aria-live="polite"></p><button class="primary big" data-act="sPlay">反覆跟讀 3 個例字</button>
    <details><summary class="mute">調整速度和次數</summary><div class="ctl" id="ctl-sound" style="margin-top:8px">${ctlHTML("sound")}</div></details>
    <button class="big" data-act="sNext">開始小考（3 題）</button>`);
    return;
  }
  if (cur >= qs.length) {
    const pass = SQ.right === qs.length;
    if (pass) { state.sounds[SQ.g + SQ.i] = 1; save(); }
    openSheet(`${head}<section class="card" style="text-align:center"><div class="bigsym">${SQ.right} / ${qs.length}</div><p>${pass ? "全對，這個音通過了！" : "再聽幾次例字，然後重考一次。"}</p></section><button class="primary big" data-act="sRetry">再練一次</button><button class="big" data-act="close">回發音表</button>`);
    return;
  }
  const q = qs[cur], done = SQ.ans !== null;
  if (q.kind === "pick") {
    openSheet(`${head}<p class="mute">第 ${cur + 1} / ${qs.length} 題</p><p class="coachtip">聽聲音，選出你聽到的字。</p>
    <button class="primary big" data-act="sSay">再聽一次</button>
    <div style="display:grid;gap:8px">${q.opts.map((o, i) => `<button class="opt ${done ? (o.w === q.target.w ? "right" : (i === SQ.ans ? "wrong" : "")) : ""}" data-act="sAns" data-i="${i}" ${done ? "disabled" : ""}><span class="en">${esc(o.w)}</span>　<span class="ip mute">/${esc(o.ip)}/</span></button>`).join("")}</div>
    ${done ? `<div class="row">${q.opts.map(o => `<button data-act="say" data-t="${esc(o.w)}" data-r="0.6">聽 ${esc(o.w)}</button>`).join("")}</div><button class="big primary" data-act="sNext">下一題</button>` : ""}`);
    if (!done) setTimeout(() => SQ && sayOnce(q.target.w, 0.7), 250);
  } else {
    openSheet(`${head}<p class="mute">第 ${cur + 1} / ${qs.length} 題</p><p class="coachtip">換你念。按下按鈕後，對麥克風念出這個字。</p>
    <section class="card" style="text-align:center"><p class="en" style="font-size:2rem">${esc(q.target.w)}</p><p class="ip mute">/${esc(q.target.ip)}/</p><button data-act="say" data-t="${esc(q.target.w)}" data-r="0.6">先聽示範</button></section>
    <p id="spOut" aria-live="polite" style="text-align:center"></p>
    ${done ? `<button class="big primary" data-act="sNext">看結果</button>` : `${speechOK ? `<button class="primary big" data-act="sSpeak">我要念了</button>` : `<p class="mute">這個瀏覽器不支援語音辨識，請自己判斷。</p>`}<div class="row"><button class="grow" data-act="sSelf" data-v="1">我念得跟示範一樣</button><button class="grow" data-act="sSelf" data-v="0">還不太像</button></div>`}`);
  }
}
async function soundSpeak() {
  const q = SQ.qs[SQ.cur], out = $("#spOut"); TTS.stop(); out.textContent = "請念…";
  try {
    const alts = await recognize();
    const ok = alts.some(a => a.toLowerCase().split(/\s+/).map(normWord).includes(q.target.w.toLowerCase()));
    if (!SQ) return;
    SQ.ans = ok ? 1 : 0; if (ok) SQ.right++;
    renderSound();
    $("#spOut").innerHTML = ok ? `<span class="good">系統聽懂了！</span>` : `<span class="bad">系統聽成：${esc(alts[0])}</span>。再聽示範比較一下。`;
  } catch (e) { if ($("#spOut")) out.textContent = speechErr(e) + " 也可以用下面的按鈕自己評分。"; }
}

/* ---------- 聽寫 ---------- */
let D = null;
const dictResToday = () => state.dictRes[dateKey()] || {};
/** 今天的 3 題；還沒開始做之前只是預覽，不會推進進度 */
function dictToday() {
  const saved = state.dictDays[dateKey()];
  return saved || [0, 1, 2].map(i => (state.dictPos + i) % DICTATION.length);
}
function dictLevel(idx) {
  let end = 0;
  for (const [name, n] of DICT_LEVELS) { end += n; if (idx < end) return name; }
  return DICT_LEVELS[DICT_LEVELS.length - 1][0];
}
const CONTRACTIONS = [["i'm", "i am"], ["it's", "it is"], ["don't", "do not"], ["can't", "cannot"], ["i'll", "i will"]];
const NUM_WORDS = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten" };
/** 把使用者輸入整理成與題目相同的寫法：縮寫、數字不算錯 */
function normalizeTyped(typed, target) {
  const t = target.toLowerCase().replace(/’/g, "'");
  let s = ` ${typed.toLowerCase().replace(/’/g, "'").replace(/\b(10|[1-9])\b/g, m => NUM_WORDS[m])} `;
  for (const [short, long] of CONTRACTIONS) {
    const bare = short.replace("'", "'?");
    s = t.includes(short)
      ? s.replace(new RegExp(`\\b${long}\\b`, "g"), short).replace(new RegExp(`\\b${bare}(?![a-z])`, "g"), short)
      : s.replace(new RegExp(`\\b${bare}(?![a-z])`, "g"), long);
  }
  return s.trim();
}
const gradeDict = (target, typed) => compareWords(target, normalizeTyped(typed, target));

function openDict() {
  const k = dateKey();
  if (!state.dictDays[k]) { // 第一次開始做才佔用今天的題目並往後推進
    state.dictDays[k] = dictToday();
    state.dictPos = (state.dictPos + 3) % DICTATION.length;
    state.dictRes[k] = {};
    save();
  }
  const list = state.dictDays[k], res = dictResToday();
  const first = list.findIndex(i => res[i] === undefined);
  D = { list, cur: first < 0 ? 0 : first, tries: 0, text: "", hint: false, grade: null, revealed: false };
  renderDict(); setTimeout(() => D && dictPlay(0.7), 300);
}
const dictNow = () => D.list[D.cur];
const dictKeepText = () => { const el = $("#dictInput"); if (el) D.text = el.value; };
function slotsHTML(en) {
  const words = en.split(/\s+/);
  return `<div class="slots" aria-label="共 ${words.length} 個字">${words.map((w, i) => {
    const clean = w.replace(/[^a-z']/gi, "");
    if (D.revealed) return `<span class="slot ${D.grade && D.grade.hit.has(i) ? "hit" : "shown"}">${esc(w)}</span>`;
    if (D.grade && D.grade.hit.has(i)) return `<span class="slot hit">${esc(w)}</span>`;
    return `<span class="slot ${D.grade ? "miss" : ""}">${"_".repeat(clean.length)}</span>`;
  }).join("")}</div>`;
}
function dictPlay(rate) { return sayOnce(DICTATION[dictNow()][0], rate); }
function renderDict() {
  const idx = dictNow(), s = DICTATION[idx], id = `dc-${idx}`;
  const tip = D.revealed ? "看看哪裡不一樣，這些就是你的耳朵還要多聽的地方。"
    : D.grade ? "綠色的字答對了。空格的部分再聽一次，只要補上就好。"
      : "聽完把句子打出來。底線代表每個字有幾個字母，聽不出來的字可以空著。";
  let body = "";
  if (!D.revealed) {
    body = `<section class="card"><div class="row"><button class="primary grow" data-act="dPlay" data-r="0.7">播放</button><button class="grow" data-act="dPlay" data-r="0.5">更慢</button></div>
    <label for="dictInput" class="mute">打出你聽到的英文</label>
    <input id="dictInput" value="${esc(D.text)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" lang="en">
    ${D.hint ? `<p>中文意思：${esc(s[1])}</p>` : `<button data-act="dHint">看中文提示</button>`}</section>
    <button class="primary big" data-act="dCheck">${D.grade ? "再批改一次" : "批改"}</button>
    ${D.grade ? `<button class="big" data-act="dReveal">直接看答案</button>` : ""}`;
  } else {
    const first = dictResToday()[idx];
    body = `<section class="card"><p class="${first === 100 ? "good" : "bad"}">${first === 100 ? "全對！" : "沒關係，聽寫本來就要練。這句已加入再複習。"}</p>
    <p class="mute">你打的：${esc(D.text) || "（空白）"}</p><p>${esc(s[1])}</p>
    <button data-act="dPlay" data-r="0.7">再聽一次</button>
    <h2>單字</h2>${vocabHTML(s[2])}<h2>聽力小提示</h2><p>${esc(s[3])}</p></section>
    <div class="row">${markBtns(id)}</div>
    <button class="primary big" data-act="dNext">${D.cur < D.list.length - 1 ? "下一題" : "完成聽寫"}</button>
    <button class="big" data-act="coach" data-id="${id}">跟讀這句</button>`;
  }
  openSheet(`${sheetHead(`聽寫 ${D.cur + 1} / ${D.list.length}　${dictLevel(idx)}`)}<p class="coachtip">${tip}</p><section class="card">${slotsHTML(s[0])}</section>${body}`);
  // 手機不自動聚焦，否則鍵盤一彈出就蓋住播放按鈕
  const input = $("#dictInput"); if (input && matchMedia("(hover:hover)").matches) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}
function dictRecord(score) {
  const k = dateKey(), idx = dictNow(), res = state.dictRes[k] || (state.dictRes[k] = {});
  if (res[idx] !== undefined) return; // 只記第一次的成績，重做不覆蓋
  res[idx] = score;
  if (score < 100) addReview(`dc-${idx}`);
  if (D.list.every(i => res[i] !== undefined)) markDone("dict");
  save();
}
function dictFinish() {
  if (!D.grade) D.grade = gradeDict(DICTATION[dictNow()][0], D.text);
  dictRecord(D.firstScore ?? D.grade.score);
  D.revealed = true; TTS.stop(); renderDict();
}
function dictCheck() {
  dictKeepText();
  if (!D.text.trim()) { toast("先打幾個聽到的字，空著的可以略過"); return; }
  D.grade = gradeDict(DICTATION[dictNow()][0], D.text);
  D.tries++;
  if (D.firstScore === undefined) D.firstScore = D.grade.score;
  if (D.grade.score === 100 || D.tries >= 2) dictFinish();
  else { TTS.stop(); renderDict(); setTimeout(() => D && !D.revealed && dictPlay(0.6), 300); }
}
function dictNext() {
  if (D.cur >= D.list.length - 1) {
    const res = dictResToday(), perfect = D.list.filter(i => res[i] === 100).length;
    toast(`今天聽寫完成，全對 ${perfect} / ${D.list.length} 題`);
    closeSheet(); return;
  }
  Object.assign(D, { cur: D.cur + 1, tries: 0, text: "", hint: false, grade: null, revealed: false, firstScore: undefined });
  renderDict(); setTimeout(() => D && dictPlay(0.7), 300);
}

/* ---------- PWA ---------- */
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => { /* 不支援時仍可線上使用 */ });
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
// iPhone 規定語音必須由點擊啟動一次，之後程式才能自動播放
document.addEventListener("click", () => {
  if (TTS.unlocked || !window.speechSynthesis) return;
  TTS.unlocked = true;
  const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u);
}, { capture: true });

/* ---------- 事件 ---------- */
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "dictInput") { e.preventDefault(); dictCheck(); } });
const ACT = {
  tab: e => { TTS.stop(); state.tab = e.dataset.t; save(); render(); scrollTo(0, 0); },
  seg: e => { reviewSeg = e.dataset.v; render(); },
  close: closeSheet,
  say: e => sayOnce(e.dataset.t, +(e.dataset.r || 0.7)),
  task: e => {
    const x = taskList().tasks.find(t => t.key === e.dataset.key);
    if (x.act === "q") openQ(x.type); else if (x.act === "dict") openDict(); else openCoach(x.id, x.key);
  },
  coach: e => { const dk = Q ? Q.type : null; Q = null; D = null; openCoach(e.dataset.id, dk); },
  dPlay: e => dictPlay(+e.dataset.r),
  dHint: () => { D.hint = true; dictKeepText(); renderDict(); },
  dCheck: dictCheck,
  dReveal: () => { dictKeepText(); dictFinish(); },
  dNext: dictNext,
  star: e => { const id = e.dataset.id; if (state.star[id]) delete state.star[id]; else state.star[id] = 1; save(); e.outerHTML = markBtns(id).split("</button>")[0] + "</button>"; if ($("#sheet").hidden) render(); },
  rev: e => { const id = e.dataset.id; if (state.review[id]) delete state.review[id]; else addReview(id); save(); e.outerHTML = markBtns(id).split("</button>")[1] + "</button>"; if ($("#sheet").hidden) render(); },
  del: e => { state.mine = state.mine.filter(m => m.id !== e.dataset.id); delete state.star[e.dataset.id]; delete state.review[e.dataset.id]; save(); render(); },
  import: () => importText($("#imp").value),
  ctl: e => {
    const c = cfg(e.dataset.key), f = e.dataset.f; c[f] = f === "gap" ? e.dataset.v === "true" : +e.dataset.v; save();
    const box = $("#ctl-" + e.dataset.key); if (box) box.innerHTML = ctlHTML(e.dataset.key);
  },
  playAll: e => {
    if (TTS.busy) { TTS.stop(); e.textContent = "播放全部"; $("#libStatus").textContent = ""; return; }
    e.textContent = "停止";
    playList(state.mine.map(m => m.en), "free", {
      onItem: i => { const st = $("#libStatus"); if (st) st.textContent = state.mine[i].en; },
      onEnd: () => { const b = document.querySelector('[data-act="playAll"]'); if (b) b.textContent = "播放全部"; },
    });
  },
  backup: () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: "application/json" })); a.download = `shadowing-backup-${dateKey()}.json`; a.click(); },
  copy: e => { const t = PROMPTS[+e.dataset.i][1]; navigator.clipboard.writeText(t).then(() => toast("已複製"), () => toast("無法自動複製，請手動選取文字")); },
  step: e => { TTS.stop(); C.step = +e.dataset.v; renderCoach(); if (C.step >= 1 && C.step <= 3) setTimeout(() => C && !TTS.busy && coachPlay(), 250); },
  sayS: () => sayOnce(getS(C.id).en, 0.8),
  word: async e => {
    TTS.stop(); setCoachBtn(); sayOnce(e.dataset.w, 0.7);
    const info = $("#wordinfo"); if (!info) return;
    const w = normWord(e.dataset.w), ip = await ipaOf(w), v = (getS(C.id).vocab || []).find(x => x[0].toLowerCase() === w);
    info.textContent = `${w}　${ip ? "/" + ip + "/" : "（查不到音標，可能未連網）"}${v ? "　" + v[2] : ""}`;
  },
  coachPlay,
  recog: coachRecog,
  record: coachRecord,
  compare: async () => { await sayOnce(getS(C.id).en, cfg(3).rate); await sleep(300); const a = $("#recOut audio"); if (a) { a.currentTime = 0; a.play(); } },
  rate: e => {
    rateItem(C.id, e.dataset.v);
    if (C.doneKey) markDone(C.doneKey);
    toast(e.dataset.v === "again" ? "明天會再出現" : "完成一句了"); closeSheet();
  },
  qPlay,
  qAns: e => { Q.answered = +e.dataset.i; TTS.stop(); markDone(Q.type); renderQ(); },
  sound: e => { TTS.stop(); openSound(e.dataset.g, +e.dataset.i); },
  sPlay: e => {
    if (TTS.busy) { TTS.stop(); e.textContent = "反覆跟讀 3 個例字"; $("#sStatus").textContent = ""; return; }
    e.textContent = "停止";
    playList(SQ.s[3].map(x => x.split("|")[0]), "sound", {
      onStatus: t => { const st = $("#sStatus"); if (st) st.textContent = t; },
      onEnd: () => { const b = document.querySelector('[data-act="sPlay"]'); if (b) b.textContent = "反覆跟讀 3 個例字"; },
    });
  },
  sNext: () => { TTS.stop(); SQ.cur++; SQ.ans = null; renderSound(); },
  sRetry: () => openSound(SQ.g, SQ.i),
  sSay: () => sayOnce(SQ.qs[SQ.cur].target.w, 0.7),
  sAns: e => { const q = SQ.qs[SQ.cur]; SQ.ans = +e.dataset.i; if (q.opts[SQ.ans].w === q.target.w) SQ.right++; renderSound(); },
  sSpeak: soundSpeak,
  sSelf: e => { SQ.ans = +e.dataset.v; if (SQ.ans) SQ.right++; renderSound(); },
};
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el);
});
document.addEventListener("change", e => {
  if (e.target.id === "impFile" && e.target.files[0]) e.target.files[0].text().then(importText);
  if (e.target.id === "restoreFile" && e.target.files[0]) e.target.files[0].text().then(t => {
    try { const d = JSON.parse(t); if (!d || !Array.isArray(d.mine)) throw 0; state = Object.assign(defaultState(), d); save(); render(); toast("已還原備份"); }
    catch { toast("這不是有效的備份檔"); }
  });
});
render();
