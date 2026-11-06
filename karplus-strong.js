/**
 * Karplus-Strong 物理建模吉他拨弦合成器
 * 不需要任何音频样本，纯算法合成钢弦吉他音色。
 *
 * 原理:
 *   1. 对每个频率 f, 构造长度 N = sampleRate/f 的噪声缓冲区
 *   2. 反复应用低通反馈滤波: y[i] = decay * (y[i] + y[i+1]) / 2
 *   3. 弦的能量在反馈中自然振荡衰减, 产生类似拨弦的频谱演化
 */

class GuitarSynth {
  constructor() {
    this.ctx = null;
    this.buffers = {};   // midi -> AudioBuffer
    this.masterGain = null;
  }

  /** 必须在用户手势后调用（浏览器自动播放策略） */
  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);
      this._preRender();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /** MIDI 编号 -> 频率 */
  static midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  /**
   * 用 KS 算法离线渲染一个音符的 AudioBuffer
   * @param {number} midiNote
   * @param {number} duration  渲染时长(秒)
   */
  _renderPluck(midiNote, duration = 4.0) {
    const sampleRate = this.ctx.sampleRate;
    const freq = GuitarSynth.midiToFreq(midiNote);
    const N = Math.round(sampleRate / freq);

    // 用 OfflineAudioContext 做离线渲染
    const length = Math.ceil(sampleRate * duration);
    const offline = new OfflineAudioContext(1, length, sampleRate);
    const buffer = offline.createBuffer(1, N, sampleRate);
    const data = buffer.getChannelData(0);

    // 初始激励: 短段白噪声（模拟拨片拨弦）
    // 噪声长度取 N 的一小段, 更像拨弦而不是击弦
    const pluckLen = Math.max(4, Math.floor(N * 0.15));
    for (let i = 0; i < N; i++) {
      data[i] = (i < pluckLen) ? (Math.random() * 2 - 1) : 0;
    }

    // KS 滤波器: 用 ScriptProcessor 在 offline context 里跑循环
    // 为了简单, 直接在 CPU 上把整段波形算出来更可控
    const out = new Float32Array(length);
    let pos = 0;
    const decay = 0.996;   // 衰减系数, 越大弦响越久

    // 复制初始噪声到输出
    for (let i = 0; i < Math.min(N, length); i++) out[i] = data[i];

    // 迭代 KS 滤波
    let idx = 0;
    for (let i = N; i < length; i++) {
      const next = (idx + 1) % N;
      data[idx] = decay * 0.5 * (data[idx] + data[next]);
      out[i] = data[idx];
      idx = next;
    }

    // 转成 AudioBuffer
    const audioBuf = this.ctx.createBuffer(1, length, sampleRate);
    audioBuf.copyToChannel(out, 0);
    return audioBuf;
  }

  /** 预渲染所有需要的音符 */
  _preRender() {
    // 开放和弦用到的所有 MIDI 音 (重复的不重复渲染)
    const needed = new Set();
    Object.values(CHORD_NOTES).forEach(notes => notes.forEach(n => needed.add(n)));
    needed.forEach(m => {
      try {
        this.buffers[m] = this._renderPluck(m, 4.5);
      } catch (e) {
        console.warn('渲染音符失败', m, e);
      }
    });
    console.log('合成器就绪, 预渲染', needed.size, '个音符');
  }

  /** 拨响一个和弦 */
  playChord(chordName, strumMs = 60) {
    this.ensureContext();
    const notes = CHORD_NOTES[chordName];
    if (!notes) return;

    const now = this.ctx.currentTime;
    // 扫弦: 从最低音到最高音依次拨, 间隔 strumMs/notes.length
    notes.forEach((midi, i) => {
      const buf = this.buffers[midi];
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;

      // 简单包络: 起音瞬间稍弱, 模拟拨片触弦
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, now + i * strumMs / 1000);
      g.gain.linearRampToValueAtTime(0.9, now + i * strumMs / 1000 + 0.005);

      src.connect(g).connect(this.masterGain);
      src.start(now + i * strumMs / 1000);
    });
  }
}

/**
 * 开放和弦的 MIDI 音符 (标准调弦 EADGBE)
 * 顺序从低音弦到高音弦, 扫弦时按这个顺序
 */
const CHORD_NOTES = {
  'C':  [48, 52, 55, 60, 64],          // C3 E3 G3 C4 E4
  'G':  [55, 59, 62, 67, 71],          // G3 B3 D4 G4 B4
  'D':  [50, 57, 62, 66, 69],          // D3 A3 D4 F#4 A4
  'A':  [45, 52, 57, 61, 64],          // A2 E3 A3 C#4 E4
  'E':  [40, 47, 52, 56, 59, 64],      // E2 B2 E3 G#3 B3 E4
  'Em': [40, 47, 52, 55, 59, 64],      // E2 B2 E3 G3 B3 E4
};
