/** 蓋章的「咚」聲：以 Web Audio 合成，不需音檔 */
let ctx: AudioContext | null = null;

export function playStampSound(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const c = ctx;
    if (c.state === 'suspended') void c.resume();
    const t = c.currentTime;

    // 低頻撞擊
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.26);

    // 紙張的短促雜音
    const len = Math.floor(c.sampleRate * 0.06);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const noise = c.createBufferSource();
    const ng = c.createGain();
    noise.buffer = buf;
    ng.gain.value = 0.25;
    noise.connect(ng).connect(c.destination);
    noise.start(t);
  } catch {
    /* 音效失敗不影響蓋章 */
  }
}

export function vibrate(ms = 30): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iOS 不支援 */
  }
}
