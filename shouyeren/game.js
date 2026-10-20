"use strict";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const ui = {
  score: document.getElementById("scoreValue"), combo: document.getElementById("comboValue"), best: document.getElementById("bestValue"),
  progress: document.getElementById("progressFill"), lifePips: [...document.querySelectorAll("#lifePips i")],
  homeScreen: document.getElementById("homeScreen"), gameScreen: document.getElementById("gameScreen"),
  homeStartButton: document.getElementById("homeStartButton"), homeButton: document.getElementById("homeButton"),
  homeBest: document.getElementById("homeBestValue"), leaderboard: document.getElementById("leaderboardList"),
  emptyLeaderboard: document.getElementById("emptyLeaderboard"), pause: document.getElementById("pauseOverlay"), end: document.getElementById("endOverlay"),
  pauseButton: document.getElementById("pauseButton"),
  resumeButton: document.getElementById("resumeButton"), restartButton: document.getElementById("restartButton"),
  soundButton: document.getElementById("soundButton"), finalScore: document.getElementById("finalScore"),
  finalCombo: document.getElementById("finalCombo"), endTitle: document.getElementById("endTitle"),
};

const WORLD = { width: 900, height: 600 };
const NIGHT_DURATION = 75;
const HISTORY_KEY = "lantern-keeper-history";
const keys = new Set();
const touchDirections = new Set();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let state = "ready", score = 0, lives = 3, combo = 1, maxCombo = 1, comboTimer = 0, elapsed = 0;
let spawnTimer = 0, dropTimer = 0, shake = 0, lastTime = performance.now(), audioContext = null;
let best = Number(localStorage.getItem("lantern-keeper-best") || 0);
let history = loadHistory();
let soundEnabled = localStorage.getItem("lantern-keeper-sound") !== "off";
let fireflies = [], raindrops = [], particles = [], ripples = [];

const player = { x: 450, y: 455, radius: 25, speed: 285, targetX: 450, targetY: 455, pointerActive: false, invulnerable: 0, trail: [] };
const skyline = [
  { x: 0, w: 116, h: 122, roof: 18 }, { x: 108, w: 98, h: 88, roof: 0 }, { x: 198, w: 132, h: 145, roof: 24 },
  { x: 318, w: 86, h: 104, roof: 0 }, { x: 396, w: 142, h: 132, roof: 18 }, { x: 526, w: 104, h: 92, roof: 0 },
  { x: 620, w: 136, h: 154, roof: 28 }, { x: 746, w: 162, h: 112, roof: 14 },
];

const random = (min, max) => min + Math.random() * (max - min);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const formatScore = (value) => String(Math.max(0, Math.floor(value))).padStart(4, "0");

function loadHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(stored) ? stored.filter(record => Number.isFinite(record.score) && record.playedAt) : [];
  } catch {
    return [];
  }
}

function formatRecordTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "未知日期", time: "" };
  return {
    date: new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date),
    time: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
  };
}

function renderLeaderboard() {
  const ranked = [...history].sort((a, b) => b.score - a.score || new Date(b.playedAt) - new Date(a.playedAt)).slice(0, 10);
  ui.leaderboard.replaceChildren();
  ranked.forEach((record, index) => {
    const item = document.createElement("li");
    const rank = document.createElement("span");
    const time = document.createElement("span");
    const dateText = document.createElement("strong");
    const detailText = document.createElement("span");
    const recordScore = document.createElement("strong");
    const formatted = formatRecordTime(record.playedAt);

    rank.className = "rank";
    rank.textContent = String(index + 1).padStart(2, "0");
    time.className = "record-time";
    dateText.textContent = formatted.date;
    detailText.textContent = `${formatted.time} · 连击 ×${record.combo || 1}`;
    time.append(dateText, detailText);
    recordScore.className = "record-score";
    recordScore.textContent = formatScore(record.score);
    item.append(rank, time, recordScore);
    ui.leaderboard.append(item);
  });
  ui.emptyLeaderboard.hidden = ranked.length > 0;
  ui.homeBest.textContent = formatScore(best);
}

function saveRun() {
  const record = { score: Math.floor(score), combo: maxCombo, playedAt: new Date().toISOString() };
  history = [record, ...history].slice(0, 50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderLeaderboard();
}

function setOverlay(element, visible) {
  element.classList.toggle("visible", visible);
  element.setAttribute("aria-hidden", String(!visible));
}

function updateHud() {
  ui.score.textContent = formatScore(score);
  ui.combo.textContent = `×${combo}`;
  ui.best.textContent = formatScore(best);
  ui.progress.style.width = `${Math.min(100, (elapsed / NIGHT_DURATION) * 100)}%`;
  ui.lifePips.forEach((pip, index) => pip.classList.toggle("lost", index >= lives));
}

function resetGame() {
  score = 0; lives = 3; combo = 1; maxCombo = 1; comboTimer = 0; elapsed = 0; spawnTimer = 0; dropTimer = 0; shake = 0;
  fireflies = []; raindrops = []; particles = []; ripples = [];
  Object.assign(player, { x: 450, y: 455, targetX: 450, targetY: 455, invulnerable: 0, trail: [] });
  updateHud();
}

function startGame() {
  initializeAudio(); resetGame(); state = "playing";
  ui.homeScreen.hidden = true; ui.gameScreen.hidden = false;
  setOverlay(ui.pause, false); setOverlay(ui.end, false);
  lastTime = performance.now();
}

function showHome() {
  state = "home";
  keys.clear(); touchDirections.clear();
  setOverlay(ui.pause, false); setOverlay(ui.end, false);
  ui.gameScreen.hidden = true; ui.homeScreen.hidden = false;
  renderLeaderboard();
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
}

function togglePause(forceResume = false) {
  if (state !== "playing" && state !== "paused") return;
  state = forceResume || state === "paused" ? "playing" : "paused";
  setOverlay(ui.pause, state === "paused");
  ui.pauseButton.querySelector("span").textContent = state === "paused" ? "▶" : "Ⅱ";
  ui.pauseButton.setAttribute("aria-label", state === "paused" ? "继续游戏" : "暂停游戏");
  lastTime = performance.now();
}

function endGame() {
  state = "ended"; best = Math.max(best, score); localStorage.setItem("lantern-keeper-best", String(best));
  saveRun();
  ui.finalScore.textContent = formatScore(score); ui.finalCombo.textContent = `×${maxCombo}`;
  ui.endTitle.textContent = lives > 0 ? "今夜的灯，很亮。" : "雨停了，灯还会亮。";
  updateHud(); setOverlay(ui.end, true); playTone("end");
}

function initializeAudio() {
  if (!soundEnabled || audioContext) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (AudioCtx) audioContext = new AudioCtx();
}

function playTone(type) {
  if (!soundEnabled) return;
  initializeAudio();
  if (!audioContext) return;
  if (audioContext.state === "suspended") audioContext.resume();
  const settings = { collect: [660,.075,"sine",.08], golden: [880,.16,"triangle",.11], hit: [110,.22,"sawtooth",.08], end: [392,.4,"sine",.06] }[type];
  const now = audioContext.currentTime, oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.type = settings[2]; oscillator.frequency.setValueAtTime(settings[0], now);
  if (type === "collect" || type === "golden") oscillator.frequency.exponentialRampToValueAtTime(settings[0] * 1.35, now + settings[1]);
  gain.gain.setValueAtTime(settings[3], now); gain.gain.exponentialRampToValueAtTime(.001, now + settings[1]);
  oscillator.connect(gain).connect(audioContext.destination); oscillator.start(now); oscillator.stop(now + settings[1]);
}

function spawnFirefly() {
  const golden = Math.random() < .1;
  const lifetime = random(golden ? 6 : 5, golden ? 9 : 8);
  fireflies.push({ x: random(56,844), y: random(90,508), radius: golden ? 11 : 8, phase: random(0,Math.PI*2), driftX: random(-15,15), driftY: random(-10,10), life: lifetime, maxLife: lifetime, golden });
}

function spawnRaindrop() {
  const difficulty = 1 + elapsed / NIGHT_DURATION;
  raindrops.push({ x: random(30,870), y: -30, radius: random(10,16), speed: random(230,340) * difficulty, drift: random(28,64) });
}

function burst(x, y, color, count, speed = 90) {
  const amount = reducedMotion ? Math.ceil(count / 3) : count;
  for (let i = 0; i < amount; i++) {
    const angle = random(0, Math.PI * 2), velocity = random(speed * .35, speed);
    particles.push({ x, y, vx: Math.cos(angle)*velocity, vy: Math.sin(angle)*velocity, life: random(.35,.75), maxLife: .75, radius: random(1.5,4), color });
  }
}

function updatePlayer(dt) {
  let dx = 0, dy = 0;
  if (keys.has("ArrowLeft") || keys.has("KeyA") || touchDirections.has("left")) dx--;
  if (keys.has("ArrowRight") || keys.has("KeyD") || touchDirections.has("right")) dx++;
  if (keys.has("ArrowUp") || keys.has("KeyW") || touchDirections.has("up")) dy--;
  if (keys.has("ArrowDown") || keys.has("KeyS") || touchDirections.has("down")) dy++;
  if (dx || dy) {
    player.pointerActive = false;
    const length = Math.hypot(dx,dy) || 1;
    player.x += dx / length * player.speed * dt; player.y += dy / length * player.speed * dt;
  } else if (player.pointerActive) {
    const tx = player.targetX - player.x, ty = player.targetY - player.y, d = Math.hypot(tx,ty);
    if (d > 3) { const step = Math.min(player.speed * 1.25 * dt,d); player.x += tx/d*step; player.y += ty/d*step; }
  }
  player.x = Math.max(34,Math.min(866,player.x)); player.y = Math.max(62,Math.min(550,player.y));
  player.invulnerable = Math.max(0,player.invulnerable-dt); player.trail.unshift({x:player.x,y:player.y});
  if (player.trail.length > 11) player.trail.pop();
}

function updateEntities(dt) {
  spawnTimer -= dt; dropTimer -= dt;
  if (spawnTimer <= 0 && fireflies.length < 8) { spawnFirefly(); spawnTimer = random(.55,1.1); }
  const rainRate = Math.max(.27,.86-elapsed*.006);
  if (dropTimer <= 0) { spawnRaindrop(); dropTimer = random(rainRate*.65,rainRate*1.2); }
  fireflies.forEach(fly => {
    fly.phase += dt*2.5; fly.x += (fly.driftX+Math.sin(fly.phase)*8)*dt; fly.y += (fly.driftY+Math.cos(fly.phase*.8)*6)*dt; fly.life -= dt;
    if (fly.x < 28 || fly.x > 872) fly.driftX *= -1; if (fly.y < 65 || fly.y > 545) fly.driftY *= -1;
  });
  raindrops.forEach(drop => { drop.x += drop.drift*dt; drop.y += drop.speed*dt; });
  particles.forEach(p => { p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 55*dt; p.life -= dt; });
  ripples.forEach(r => { r.radius += 85*dt; r.life -= dt; });

  for (let i = fireflies.length-1; i >= 0; i--) {
    const fly = fireflies[i];
    if (distance(player,fly) < player.radius+fly.radius+5) {
      score += (fly.golden ? 50 : 10)*combo; combo = Math.min(9,combo+1); maxCombo = Math.max(maxCombo,combo); comboTimer = 2.8;
      burst(fly.x,fly.y,fly.golden ? "#fff3a6" : "#ffca57",fly.golden ? 20 : 12,120);
      ripples.push({x:fly.x,y:fly.y,radius:8,life:.55,color:"#ffca57"}); playTone(fly.golden ? "golden" : "collect"); fireflies.splice(i,1);
    } else if (fly.life <= 0) { fireflies.splice(i,1); combo = 1; }
  }
  for (let i = raindrops.length-1; i >= 0; i--) {
    const drop = raindrops[i];
    if (drop.y > 635) { ripples.push({x:drop.x,y:580,radius:4,life:.35,color:"#65c2b4"}); raindrops.splice(i,1); }
    else if (player.invulnerable <= 0 && distance(player,drop) < player.radius+drop.radius-2) {
      lives--; combo = 1; comboTimer = 0; player.invulnerable = 1.25; shake = reducedMotion ? 0 : 8;
      burst(player.x,player.y,"#e46851",18,150); playTone("hit"); raindrops.splice(i,1); if (lives <= 0) endGame();
    }
  }
  fireflies = fireflies.filter(f => f.life > 0); particles = particles.filter(p => p.life > 0); ripples = ripples.filter(r => r.life > 0);
  comboTimer -= dt; if (comboTimer <= 0) combo = 1;
}

function update(dt) {
  if (state !== "playing") return;
  elapsed += dt;
  if (elapsed >= NIGHT_DURATION) { elapsed = NIGHT_DURATION; endGame(); return; }
  updatePlayer(dt); updateEntities(dt); shake = Math.max(0,shake-28*dt); updateHud();
}

function drawBackground(time) {
  const sky = ctx.createLinearGradient(0,0,0,600); sky.addColorStop(0,"#212938"); sky.addColorStop(.62,"#3d4850"); sky.addColorStop(1,"#8d655b");
  ctx.fillStyle = sky; ctx.fillRect(0,0,900,600); ctx.save(); ctx.globalAlpha = .72;
  for (let i = 0; i < 20; i++) {
    const x = (i*137+38)%900, y = 38+(i*83)%230, flicker = .55+Math.sin(time*.0015+i)*.18;
    ctx.fillStyle = i%3===0 ? `rgba(101,194,180,${flicker})` : `rgba(245,240,229,${flicker})`; ctx.fillRect(x,y,i%4===0?2:1,i%4===0?2:1);
  }
  ctx.restore();
  const moonGlow = ctx.createRadialGradient(735,95,4,735,95,82); moonGlow.addColorStop(0,"rgba(255,232,171,.32)"); moonGlow.addColorStop(1,"rgba(255,232,171,0)");
  ctx.fillStyle = moonGlow; ctx.fillRect(650,10,170,170); ctx.fillStyle = "#f4dfab"; ctx.beginPath(); ctx.arc(735,95,30,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "#26303d"; ctx.beginPath(); ctx.arc(746,84,30,0,Math.PI*2); ctx.fill();
  skyline.forEach((b,index) => {
    const y = 558-b.h; ctx.fillStyle = index%2 ? "#25292e" : "#20242a"; ctx.fillRect(b.x,y,b.w,b.h+42);
    if (b.roof) { ctx.beginPath(); ctx.moveTo(b.x-8,y); ctx.lineTo(b.x+b.w/2,y-b.roof); ctx.lineTo(b.x+b.w+8,y); ctx.closePath(); ctx.fill(); }
    for (let wx=b.x+18; wx<b.x+b.w-10; wx+=30) for (let wy=y+25; wy<540; wy+=34) {
      ctx.fillStyle = (Math.floor(wx)+Math.floor(wy)+index)%4 ? "rgba(255,202,87,.35)" : "rgba(8,12,16,.6)"; ctx.fillRect(wx,wy,8,12);
    }
  });
  ctx.fillStyle = "#171a20"; ctx.fillRect(0,556,900,44); ctx.strokeStyle = "rgba(101,194,180,.22)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0,562); ctx.lineTo(900,562); ctx.stroke();
}

function drawRipples() {
  ripples.forEach(r => { ctx.save(); ctx.globalAlpha = Math.max(0,r.life*1.8); ctx.strokeStyle = r.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(r.x,r.y,r.radius*1.8,r.radius*.55,0,0,Math.PI*2); ctx.stroke(); ctx.restore(); });
}

function drawFireflies(time) {
  fireflies.forEach(fly => {
    const remaining = Math.max(0, fly.life / fly.maxLife);
    const urgency = remaining < .3 ? .52 + Math.sin(time * .025) * .35 : 1;
    const pulse = (.86+Math.sin(time*.006+fly.phase)*.14) * urgency; ctx.save(); ctx.translate(fly.x,fly.y);
    const glow = ctx.createRadialGradient(0,0,1,0,0,fly.golden?34:25); glow.addColorStop(0,fly.golden?"rgba(255,245,174,.95)":"rgba(255,202,87,.9)"); glow.addColorStop(1,"rgba(255,202,87,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0,0,(fly.golden?34:25)*pulse,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = remaining < .3 ? "#e46851" : "rgba(245,240,229,.55)"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0,0,fly.golden?20:17,-Math.PI/2,-Math.PI/2+Math.PI*2*remaining); ctx.stroke();
    ctx.fillStyle = fly.golden?"#fff3a6":"#ffca57"; ctx.beginPath(); ctx.arc(0,0,fly.radius*pulse*.55,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = "rgba(245,240,229,.75)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(-5,-2,6,2.5,-.5,0,Math.PI*2); ctx.ellipse(5,-2,6,2.5,.5,0,Math.PI*2); ctx.stroke(); ctx.restore();
  });
}

function drawRaindrops() {
  raindrops.forEach(drop => {
    ctx.save(); ctx.translate(drop.x,drop.y); ctx.rotate(-.16); const gradient = ctx.createLinearGradient(0,-22,0,20);
    gradient.addColorStop(0,"rgba(175,225,232,.2)"); gradient.addColorStop(1,"rgba(101,194,180,.9)"); ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.moveTo(0,-drop.radius*1.8); ctx.bezierCurveTo(drop.radius,-3,drop.radius,drop.radius,0,drop.radius*1.2); ctx.bezierCurveTo(-drop.radius,drop.radius,-drop.radius,-3,0,-drop.radius*1.8); ctx.fill(); ctx.restore();
  });
}

function drawPlayer(time) {
  player.trail.forEach((p,i) => { if (i%2) return; ctx.fillStyle = `rgba(255,202,87,${.13*(1-i/player.trail.length)})`; ctx.beginPath(); ctx.arc(p.x,p.y+7,Math.max(2,8-i*.55),0,Math.PI*2); ctx.fill(); });
  if (player.invulnerable > 0 && Math.floor(time/90)%2===0) return;
  ctx.save(); ctx.translate(player.x,player.y); const bob = Math.sin(time*.005)*2;
  const light = ctx.createRadialGradient(0,bob,5,0,bob,68); light.addColorStop(0,"rgba(255,220,116,.7)"); light.addColorStop(.35,"rgba(255,202,87,.3)"); light.addColorStop(1,"rgba(255,202,87,0)");
  ctx.fillStyle = light; ctx.beginPath(); ctx.arc(0,bob,68,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = "#15181d"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0,-17+bob,15,Math.PI,0); ctx.stroke();
  ctx.fillStyle = "#29242a"; ctx.fillRect(-21,-12+bob,42,44); ctx.strokeStyle = "#f0b64d"; ctx.lineWidth = 3; ctx.strokeRect(-19.5,-10.5+bob,39,41);
  ctx.fillStyle = "#ffca57"; ctx.fillRect(-13,-4+bob,26,28); ctx.fillStyle = "rgba(255,244,185,.86)"; ctx.fillRect(-6,-1+bob,6,20); ctx.fillStyle = "#171a20"; ctx.fillRect(-25,31+bob,50,6); ctx.restore();
}

function drawParticles() {
  particles.forEach(p => { ctx.save(); ctx.globalAlpha = Math.max(0,p.life/p.maxLife); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius,0,Math.PI*2); ctx.fill(); ctx.restore(); });
}

function draw(time) {
  ctx.save(); if (shake > 0) ctx.translate(random(-shake,shake),random(-shake,shake));
  drawBackground(time); drawRipples(); drawFireflies(time); drawRaindrops(); drawPlayer(time); drawParticles(); ctx.restore();
}

function frame(time) {
  const dt = Math.min(.033,Math.max(0,(time-lastTime)/1000)); lastTime = time; update(dt); draw(time); requestAnimationFrame(frame);
}

function setPointerTarget(event) {
  const rect = canvas.getBoundingClientRect(); player.targetX = (event.clientX-rect.left)/rect.width*900; player.targetY = (event.clientY-rect.top)/rect.height*600; player.pointerActive = true;
}

addEventListener("keydown", event => {
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(event.code)) event.preventDefault();
  if ((event.code === "Space" || event.code === "KeyP") && !event.repeat) { togglePause(); return; }
  keys.add(event.code);
});
addEventListener("keyup", event => keys.delete(event.code));
addEventListener("blur", () => { keys.clear(); touchDirections.clear(); if (state === "playing") togglePause(); });
canvas.addEventListener("pointerdown", event => { canvas.setPointerCapture(event.pointerId); setPointerTarget(event); });
canvas.addEventListener("pointermove", event => { if (event.buttons || event.pointerType === "touch") setPointerTarget(event); });
document.querySelectorAll(".touch-controls button").forEach(button => {
  const direction = button.dataset.direction;
  const press = event => { event.preventDefault(); touchDirections.add(direction); player.pointerActive = false; };
  const release = event => { event.preventDefault(); touchDirections.delete(direction); };
  button.addEventListener("pointerdown",press); button.addEventListener("pointerup",release); button.addEventListener("pointercancel",release); button.addEventListener("pointerleave",release);
});
ui.homeStartButton.addEventListener("click",startGame); ui.restartButton.addEventListener("click",startGame); ui.homeButton.addEventListener("click",showHome);
ui.pauseButton.addEventListener("click",() => togglePause()); ui.resumeButton.addEventListener("click",() => togglePause(true));
ui.soundButton.addEventListener("click",() => {
  soundEnabled = !soundEnabled; localStorage.setItem("lantern-keeper-sound",soundEnabled?"on":"off"); ui.soundButton.classList.toggle("muted",!soundEnabled);
  ui.soundButton.querySelector("span").textContent = soundEnabled?"♪":"×"; ui.soundButton.setAttribute("aria-label",soundEnabled?"关闭声音":"开启声音"); if (soundEnabled) playTone("collect");
});
document.addEventListener("visibilitychange",() => { if (document.hidden && state === "playing") togglePause(); });

best = Math.max(best, ...history.map(record => record.score), 0);
ui.best.textContent = formatScore(best); ui.soundButton.classList.toggle("muted",!soundEnabled); ui.soundButton.querySelector("span").textContent = soundEnabled?"♪":"×";
renderLeaderboard(); updateHud(); requestAnimationFrame(frame);
