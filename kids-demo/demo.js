const DURATION = 52000;

const cues = [
  { at: 0, card: "title" },
  { at: 3800, card: "story", caption: "Hello, little sun!", sun: "up" },
  { at: 8000, caption: "Hello, little sun!" },
  { at: 11800, caption: "You warm up the day" },
  { at: 15500, caption: "Hello, little bird!", bird: "in" },
  { at: 19500, caption: "Wave your wing this way", wave: true },
  { at: 24000, caption: "One little flower", flower: 1, count: "1" },
  { at: 28500, caption: "Two little flowers", flower: 2, count: "2" },
  { at: 33000, caption: "Three little flowers", flower: 3, count: "3" },
  { at: 37500, caption: "Look, a rainbow!", rainbow: true },
  { at: 42500, caption: "Friends shine together" },
  { at: 47500, card: "end", caption: "" },
];

const stage = document.getElementById("stage");
const playButton = document.getElementById("play");
const replayButton = document.getElementById("replay");
const caption = document.getElementById("caption");
const titleCard = document.getElementById("title-card");
const endCard = document.getElementById("end-card");
const bar = document.getElementById("bar");
const countPop = document.getElementById("count-pop");
const sun = document.getElementById("sun");
const bird = document.getElementById("bird");
const rainbow = document.getElementById("rainbow");

let audioCtx = null;
let runId = 0;
let noteTimer = 0;

playButton.addEventListener("click", start);
replayButton.addEventListener("click", start);

function start() {
  const id = ++runId;
  resetScene();
  stage.dataset.state = "playing";
  playButton.hidden = true;
  const started = performance.now();
  playSong();
  noteTimer = window.setInterval(() => {
    if (id !== runId) return;
    spawnNote();
  }, 700);

  function frame(now) {
    if (id !== runId) return;
    const elapsed = now - started;
    bar.style.width = Math.min(100, (elapsed / DURATION) * 100) + "%";
    applyCues(elapsed);
    if (elapsed < DURATION) requestAnimationFrame(frame);
    else finish(id);
  }

  requestAnimationFrame(frame);
}

function finish(id) {
  if (id !== runId) return;
  window.clearInterval(noteTimer);
  stage.dataset.state = "ended";
  bar.style.width = "100%";
}

function resetScene() {
  window.clearInterval(noteTimer);
  titleCard.classList.remove("hide");
  endCard.hidden = true;
  caption.textContent = "";
  caption.classList.remove("show");
  countPop.classList.remove("show");
  sun.classList.remove("up", "wave");
  bird.classList.remove("in", "wave");
  rainbow.classList.remove("show");
  for (let i = 1; i <= 3; i += 1) {
    document.getElementById("flower-" + i).classList.remove("show");
  }
  bar.style.width = "0%";
  stage.querySelectorAll(".note").forEach((note) => note.remove());
  stage.dataset.cues = "0";
}

function applyCues(elapsed) {
  let reached = 0;
  for (let i = 0; i < cues.length; i += 1) {
    if (elapsed >= cues[i].at) reached = i + 1;
  }
  const previous = Number(stage.dataset.cues || 0);
  if (reached === previous) return;
  for (let i = previous; i < reached; i += 1) showCue(cues[i]);
  stage.dataset.cues = String(reached);
}

function showCue(cue) {
  if (cue.card === "story") titleCard.classList.add("hide");
  if (cue.card === "end") {
    caption.classList.remove("show");
    endCard.hidden = false;
  }
  if (cue.sun === "up") sun.classList.add("up");
  if (cue.bird === "in") bird.classList.add("in");
  if (cue.wave) {
    sun.classList.add("wave");
    bird.classList.add("wave");
  }
  if (cue.flower) document.getElementById("flower-" + cue.flower).classList.add("show");
  if (cue.rainbow) rainbow.classList.add("show");
  if (cue.count) popCount(cue.count);
  if (typeof cue.caption === "string") setCaption(cue.caption);
}

function setCaption(text) {
  caption.textContent = text;
  caption.classList.remove("show");
  if (!text) return;
  void caption.offsetWidth;
  caption.classList.add("show");
}

function popCount(text) {
  countPop.textContent = text;
  countPop.classList.remove("show");
  void countPop.offsetWidth;
  countPop.classList.add("show");
}

function spawnNote() {
  if (stage.dataset.state !== "playing") return;
  const note = document.createElement("span");
  note.className = "note";
  note.textContent = Math.random() > 0.5 ? "♪" : "♫";
  note.style.left = 18 + Math.random() * 64 + "%";
  note.style.color = ["#ff7a59", "#5b8def", "#e07a3d", "#2f9e44"][Math.floor(Math.random() * 4)];
  stage.appendChild(note);
  window.setTimeout(() => note.remove(), 2300);
}

function playSong() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  if (!audioCtx) audioCtx = new AudioContext();
  audioCtx.resume();
  const phrase = [262, 330, 392, 330, 349, 440, 392, 330, 294, 349, 330, 262, 392, 330, 294, 262];
  const step = 0.42;
  const start = audioCtx.currentTime + 0.15;
  for (let loop = 0; loop < 4; loop += 1) {
    phrase.forEach((freq, index) => {
      tone(freq, start + (loop * phrase.length + index) * step, step * 0.86, 0.06);
    });
  }
  [0, 1.68, 3.36].forEach((offset, index) => {
    const when = start + 19.5 + offset;
    tone(523 + index * 40, when, 0.28, 0.05, "triangle");
  });
}

function tone(freq, when, length, volume, type) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(volume, when + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(when);
  osc.stop(when + length + 0.02);
}
