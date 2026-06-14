// Lightweight synthesized sound + mobile haptics. No audio files — tones are
// generated with the Web Audio API so the bundle stays tiny.

let ctx: AudioContext | null = null;
let muted = localStorage.getItem("pn.muted") === "1";

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem("pn.muted", m ? "1" : "0");
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx = ctx || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, durMs: number, type: OscillatorType = "sine", gain = 0.07, delay = 0) {
  const ac = audio();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  g.connect(ac.destination);
  const t = ac.currentTime + delay;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
  o.start(t);
  o.stop(t + durMs / 1000);
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

export const sound = {
  yourTurn() {
    tone(680, 90, "sine", 0.06);
    tone(900, 110, "sine", 0.06, 0.1);
    vibrate(40);
  },
  deal() {
    tone(320, 60, "triangle", 0.05);
    tone(380, 60, "triangle", 0.04, 0.06);
  },
  check() {
    tone(440, 70, "sine", 0.05);
  },
  bet() {
    tone(520, 70, "square", 0.04);
    tone(620, 70, "square", 0.035, 0.05);
  },
  fold() {
    tone(240, 120, "sine", 0.04);
  },
  win() {
    tone(660, 120, "sine", 0.06);
    tone(880, 120, "sine", 0.06, 0.12);
    tone(1100, 180, "sine", 0.06, 0.24);
    vibrate([30, 40, 60]);
  },
};
