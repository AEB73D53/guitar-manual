/**
 * 吉他手动挡 - 网页端 (Web Serial 直连版)
 *
 * 不需要网络, 不需要 MQTT.
 * ESP32 用 USB 线插电脑 -> 点"连接 ESP32"选串口 -> 捏铜箔即拨弦.
 */

const synth = new GuitarSynth();
const chordOrder = ['C', 'G', 'D', 'A', 'E', 'Em'];

// ---------- UI ----------
const chordsEl   = document.getElementById('chords');
const connectBtn = document.getElementById('connectBtn');
const logEl      = document.getElementById('log');

function log(msg) {
  const li = document.createElement('li');
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  li.innerHTML = `<span class="time">${t}</span>${msg}`;
  logEl.prepend(li);
  while (logEl.children.length > 50) logEl.removeChild(logEl.lastChild);
}

function renderChordButtons() {
  chordsEl.innerHTML = '';
  chordOrder.forEach(name => {
    const btn = document.createElement('div');
    btn.className = 'chord-btn';
    btn.dataset.chord = name;
    btn.innerHTML = `${name}<small>点击试听</small>`;
    btn.addEventListener('click', () => {
      synth.ensureContext();
      triggerChord(name);
    });
    chordsEl.appendChild(btn);
  });
}

function setChordActive(name, active, ms = 150) {
  const btn = chordsEl.querySelector(`[data-chord="${name}"]`);
  if (!btn) return;
  btn.classList.add('active');
  setTimeout(() => btn.classList.remove('active'), ms);
}

function triggerChord(name) {
  synth.playChord(name);
  setChordActive(name, true);
  log(`🎵 <b>${name}</b>`);
}

// ---------- Web Serial ----------
let port = null;
let reader = null;
let keepReading = false;

async function connectSerial() {
  if (!('serial' in navigator)) {
    alert('当前浏览器不支持 Web Serial API。请用 Chrome 或 Edge 打开本页面。');
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    connectBtn.textContent = '🟢 已连接 ESP32';
    connectBtn.classList.add('connected');
    log('✅ 串口已打开 (115200)');
    readLoop();
  } catch (e) {
    log('❌ 连接失败: ' + e.message);
  }
}

async function readLoop() {
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable).catch(() => {});
  reader = decoder.readable.getReader();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      handleSerialLine(line);
    }
  }
}

function handleSerialLine(line) {
  // ESP32 会发: "C", "G", ..., 或者启动日志里以 === 开头的行
  if (chordOrder.includes(line)) {
    triggerChord(line);
  } else {
    log('📋 ' + line);
  }
}

// ---------- 启动 ----------
renderChordButtons();
connectBtn.addEventListener('click', () => {
  synth.ensureContext();
  if (port) {
    log('已连接');
  } else {
    connectSerial();
  }
});

// 第一次任意点击解锁音频
document.body.addEventListener('click', function unlock() {
  synth.ensureContext();
  document.body.removeEventListener('click', unlock);
}, { once: true });
