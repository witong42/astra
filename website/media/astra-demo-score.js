const BEAT = 60 / 128;
const BAR = BEAT * 4;
const QUIET = BAR * 11.5;
const PAYOFF = BAR * 12;
const OUTRO = BAR * 14;
const bassNotes = ["D2", "D2", "A2", "C3", "D2", "F2", "A2", "C3"];
const melody = ["D5", "F5", "A5", "G5", "F5", "E5", "D5", "A4"];

function kick(t, velocity) {
  const oscillator = osc("sine", 150, t, t + 0.28);
  oscillator.frequency.exponentialRampToValueAtTime(43, t + 0.11);
  const gain = ac.createGain();
  env(gain, t, 0.002, velocity, 0.24);
  oscillator.connect(gain);
  out(gain);
}
function synthBass(t, note, velocity) {
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1000, t);
  filter.frequency.exponentialRampToValueAtTime(150, t + 0.18);
  const gain = ac.createGain();
  env(gain, t, 0.004, velocity, 0.2);
  osc("sawtooth", nz(note), t, t + 0.25).connect(filter);
  filter.connect(gain);
  out(gain, -0.08);
}
function stab(t, notes, velocity, duration = 0.32) {
  const gain = ac.createGain();
  env(gain, t, 0.005, velocity, duration);
  for (const note of notes)
    osc("triangle", nz(note), t, t + duration + 0.04).connect(gain);
  out(gain, 0.12);
}
to = "m";
for (let beat = 0; beat < 64; beat++) {
  const t = beat * BEAT;
  if (t >= QUIET && t < PAYOFF) continue;
  const intro = t < BAR * 3;
  const outro = t >= OUTRO;
  const gain = outro ? 0.2 : intro ? 0.52 : 1;
  if (!intro || beat % 2 === 0) kick(t, 0.47 * gain);
  if (beat % 4 === 1 || beat % 4 === 3) {
    noiseHit(t, 0.09, "bandpass", 2200, 0.8, 0.11 * gain, 0.08);
    noiseHit(t + 0.012, 0.07, "highpass", 5200, 0.7, 0.05 * gain, -0.18);
  }
  for (let half = 0; half < 2; half++) {
    const at = t + (half * BEAT) / 2;
    if (at >= QUIET && at < PAYOFF) continue;
    noiseHit(
      at,
      half ? 0.065 : 0.024,
      "highpass",
      6800,
      0.7,
      (half ? 0.023 : 0.012) * gain,
      half ? 0.4 : -0.35,
    );
  }
  if (!intro || beat >= 4) {
    synthBass(t + BEAT / 2, bassNotes[beat % bassNotes.length], 0.068 * gain);
    if (beat % 4 === 2) synthBass(t + BEAT * 0.75, "A2", 0.037 * gain);
  }
  if (beat >= 12 && beat % 2 === 0) {
    const note = melody[Math.floor(beat / 2) % melody.length];
    pluck(t + BEAT / 2, nz(note), 0.055 * gain, 0.25, 0.24, 3600, 0);
    pluck(t + BEAT, nz(note), 0.015 * gain, -0.35, 0.14, 1800, 0);
  }
  if (beat >= 12 && beat % 4 === 0 && !outro)
    stab(t + BEAT / 2, ["D3", "F3", "A3"], 0.008);
}
to = "s";
for (const start of [BAR * 3, BAR * 5, BAR * 7, BAR * 10]) {
  noiseHit(start - 0.13, 0.13, "bandpass", 900, 0.7, 0.055, -0.25, 0, 5000);
  blip(start, 720, 380, 0.04, 0.038, 0.15);
}
for (let key = 0; key < 14; key++)
  blip(
    BAR * 3 + (key * BEAT) / 4,
    1100 + (key % 3) * 170,
    600,
    0.012,
    0.011,
    -0.2,
  );
sub(PAYOFF, 0.72);
stab(PAYOFF, ["D3", "F3", "A3", "D4"], 0.115, 0.4);
chime(PAYOFF, [HZ.D5, HZ.A5], 0.17, 0.05);
blip(OUTRO, 650, 330, 0.07, 0.025);
function duckDialogue(bus, level) {
  bus.gain.setValueAtTime(1, 0);
  for (const [start, end] of [
    [0.4, 4.9],
    [5.6, 7.1],
    [9.35, 14.75],
  ]) {
    bus.gain.setValueAtTime(1, start - 0.2);
    bus.gain.linearRampToValueAtTime(level, start);
    bus.gain.setValueAtTime(level, end);
    bus.gain.linearRampToValueAtTime(1, end + 0.4);
  }
  bus.gain.setValueAtTime(0, QUIET);
  bus.gain.setValueAtTime(1, PAYOFF);
}
if (part !== "sfx") duckDialogue(musicBus, 0.12);
if (part !== "music") duckDialogue(sfxBus, 0.2);
