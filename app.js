/**
 * 吉他手动挡 - 网页端主逻辑
 * 1. 连接公共 MQTT broker (wss)
 * 2. 订阅 ESP32 发布的和弦消息
 * 3. 收到按下事件 -> 触发 GuitarSynth 拨弦
 */

// ============ 配置 ============
// ⚠️ 必须和 esp32/guitar_manual.ino 里的 MQTT_TOPIC_PREFIX 完全一致！
// 建议改成你自己的随机字符串，避免和别人撞 topic
const MQTT_TOPIC_PREFIX = 'guitar-lvyz-replace-me/chord';

const MQTT_URL = 'wss://broker.emqx.io:8084/mqtt';
// ==============================

const synth = new GuitarSynth();
const chordOrder = ['C', 'G', 'D', 'A', 'E', 'Em'];
const lastPressed = {};   // chord -> bool, 用于边沿检测

// ---------- UI ----------
const chordsEl = document.getElementById('chords');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = 'status ' + cls;
}

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

function setChordActive(name, active) {
  const btn = chordsEl.querySelector(`[data-chord="${name}"]`);
  if (btn) btn.classList.toggle('active', active);
}

// ---------- 拨弦 ----------
function triggerChord(name) {
  synth.playChord(name);
  log(`🎵 拨弦 <b>${name}</b>`);
}

// ---------- MQTT ----------
let client = null;

function connectMQTT() {
  setStatus('连接中...', 'connecting');
  log(`连接 ${MQTT_URL} ...`);

  client = mqtt.connect(MQTT_URL, {
    clientId: 'web-' + Math.random().toString(16).slice(2, 10),
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 8000,
  });

  client.on('connect', () => {
    setStatus('已连接', 'connected');
    log('✅ MQTT 已连接');
    client.subscribe(`${MQTT_TOPIC_PREFIX}/press`, { qos: 0 });
    client.subscribe(`${MQTT_TOPIC_PREFIX}/status`, { qos: 1 });
    log(`订阅主题: ${MQTT_TOPIC_PREFIX}/#`);
  });

  client.on('reconnect', () => {
    setStatus('重连中...', 'connecting');
  });

  client.on('error', (err) => {
    log('❌ MQTT 错误: ' + err.message);
  });

  client.on('close', () => {
    setStatus('已断开', 'disconnected');
  });

  client.on('message', (topic, payload) => {
    const text = payload.toString();
    handleMessage(topic, text);
  });
}

function handleMessage(topic, text) {
  if (topic.endsWith('/status')) {
    log(`📡 设备状态: <b>${text}</b>`);
    return;
  }

  if (topic.endsWith('/press')) {
    // payload 形如 "C:1" / "Em:0"
    const m = text.match(/^(\w+):([01])$/);
    if (!m) return;
    const [, chord, state] = m;
    const pressed = state === '1';

    // 边沿检测: 只在 0->1 跳变时拨弦
    const was = lastPressed[chord] || false;
    if (pressed && !was) {
      triggerChord(chord);
    }
    lastPressed[chord] = pressed;
    setChordActive(chord, pressed);
  }
}

// ---------- 启动 ----------
renderChordButtons();

// 第一次任意点击解锁音频
document.body.addEventListener('click', function unlock() {
  synth.ensureContext();
  document.body.removeEventListener('click', unlock);
}, { once: true });

connectMQTT();
