import { createHmac } from "node:crypto";

// A tiny "language": each slot is a group of words that all fit there.
const SLOTS: string[][] = [
  ["The", "Our", "This", "That"],
  ["small", "tiny", "simple", "quick", "careful", "new"],
  ["agent", "model", "service", "worker", "tool", "system"],
  ["fixed", "patched", "repaired", "checked", "reviewed", "updated"],
  ["the", "one", "each", "every"],
  ["bug", "issue", "test", "query", "report", "file"],
  ["quickly.", "calmly.", "carefully.", "safely.", "quietly.", "today."],
];

type Dist = { word: string; p: number }[];

// A deterministic 32-bit hash, so the toy model is the same every run.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// The mock model: a next-word distribution for slot t, given the last word.
// "open" text has many good choices. "rigid" text (think math) has one.
function nextWordDist(t: number, prev: string, style: "open" | "rigid"): Dist {
  const group = SLOTS[t % SLOTS.length];
  if (style === "rigid") {
    const top = hash(prev) % group.length;
    const rest = 0.1 / (group.length - 1);
    return group.map((word, i) => ({ word, p: i === top ? 0.9 : rest }));
  }
  const weights = group.map((w) => 1 + (hash(prev + "|" + w) % 8));
  const total = weights.reduce((a, b) => a + b, 0);
  return group.map((word, i) => ({ word, p: weights[i] / total }));
}

// Keyed randomness: a number in (0, 1) for (context, candidate word).
// Only someone with the key can recompute it.
function prf(key: string, context: string, word: string): number {
  const mac = createHmac("sha256", key).update(`${context}\u0000${word}`).digest();
  return (mac.readUInt32BE(0) + 0.5) / 2 ** 32;
}

// The context is the three previous words.
function contextAt(words: string[], t: number): string {
  return [t - 3, t - 2, t - 1].map((i) => words[i] ?? "^").join(" ");
}

// A seeded random number generator, so every run prints the same numbers.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32;
  };
}

// Normal sampling: roll a die weighted by the model's probabilities.
function sample(dist: Dist, rand: () => number): string {
  let u = rand();
  for (const { word, p } of dist) {
    if ((u -= p) <= 0) return word;
  }
  return dist[dist.length - 1].word;
}

// Watermarked sampling: replace the die with keyed randomness.
// Pick the word with the largest r ** (1 / p). Averaged over keys,
// this picks each word with exactly probability p.
function sampleWatermarked(dist: Dist, key: string, context: string): string {
  let best = dist[0].word;
  let bestScore = -Infinity;
  for (const { word, p } of dist) {
    const score = Math.log(prf(key, context, word)) / p;
    if (score > bestScore) {
      bestScore = score;
      best = word;
    }
  }
  return best;
}

type Options = { tokens: number; style: "open" | "rigid"; key?: string; seed: number };

function generate({ tokens, style, key, seed }: Options): string[] {
  const rand = rng(seed);
  const words: string[] = [];
  for (let t = 0; t < tokens; t++) {
    const dist = nextWordDist(t, words[t - 1] ?? "^", style);
    words.push(key ? sampleWatermarked(dist, key, contextAt(words, t)) : sample(dist, rand));
  }
  return words;
}

// P(Gamma(n, 1) >= s), the chance of a score this high with no watermark.
function gammaTail(n: number, s: number): number {
  if (n === 0) return 1;
  let logTerm = -s; // log of e^-s * s^k / k!, starting at k = 0
  let logSum = logTerm;
  for (let k = 1; k < n; k++) {
    logTerm += Math.log(s) - Math.log(k);
    const hi = Math.max(logSum, logTerm);
    logSum = hi + Math.log(Math.exp(logSum - hi) + Math.exp(logTerm - hi));
  }
  return Math.min(1, Math.exp(logSum));
}

type Verdict = { scored: number; score: number; pValue: number; detected: boolean };

// The detector needs only the text and the key. No model, no prompt.
function detect(words: string[], key: string, alpha = 0.01): Verdict {
  const seen = new Set<string>();
  let score = 0;
  for (let t = 0; t < words.length; t++) {
    const context = contextAt(words, t);
    if (seen.has(context)) continue; // score each context once
    seen.add(context);
    score += -Math.log(1 - prf(key, context, words[t]));
  }
  const pValue = gammaTail(seen.size, score);
  return { scored: seen.size, score, pValue, detected: pValue < alpha };
}

// The edit attack: swap a share of words for a synonym from the same slot.
function swapSynonyms(words: string[], share: number, seed: number): string[] {
  const rand = rng(seed);
  return words.map((word, t) => {
    if (rand() >= share) return word;
    const others = SLOTS[t % SLOTS.length].filter((w) => w !== word);
    return others[Math.floor(rand() * others.length)];
  });
}

// What a detection result can and cannot say.
function report(v: Verdict): string {
  if (v.detected) return `watermark detected (p = ${v.pValue.toExponential(1)})`;
  return `no watermark detected (p = ${v.pValue.toFixed(2)}). This does not prove a human wrote it.`;
}

const KEY = "demo-key-not-a-secret";
const show = (w: string[]) => w.join(" ").replace(/\. (\w)/g, (_, c) => `. ${c}`);

console.log("One passage, 21 words\n");
const marked = generate({ tokens: 21, style: "open", key: KEY, seed: 1 });
const plain = generate({ tokens: 21, style: "open", seed: 1 });
console.log("watermarked:  ", show(marked));
console.log("  ->", report(detect(marked, KEY)));
console.log("unwatermarked:", show(plain));
console.log("  ->", report(detect(plain, KEY)));
console.log("wrong key:    ", report(detect(marked, "some-other-key")));

const TRIALS = 500;

// Each trial gets its own key, so every passage is different.
type Make = (tokens: number, key: string, seed: number) => string[];

function detectionRate(tokens: number, make: Make): string {
  let hits = 0;
  for (let i = 1; i <= TRIALS; i++) {
    const seed = tokens * 10_000 + i;
    const key = `${KEY}-${seed}`;
    if (detect(make(tokens, key, seed), key).detected) hits++;
  }
  return `${((100 * hits) / TRIALS).toFixed(1)}%`;
}

const open = (n: number, key: string | undefined, s: number) => generate({ tokens: n, style: "open", key, seed: s });

const rows: [string, Make][] = [
  ["no watermark (false positives)", (n, _k, s) => open(n, undefined, s)],
  ["watermarked, untouched", (n, k, s) => open(n, k, s)],
  ["watermarked, 10% of words swapped", (n, k, s) => swapSynonyms(open(n, k, s), 0.1, s)],
  ["watermarked, 25% of words swapped", (n, k, s) => swapSynonyms(open(n, k, s), 0.25, s)],
  ["watermarked, rigid text (math-like)", (n, k, s) => generate({ tokens: n, style: "rigid", key: k, seed: s })],
];

const lengths = [14, 28, 56];
console.log(`\nDetection rate over ${TRIALS} passages, 1% false positive target\n`);
console.log("".padEnd(36) + lengths.map((n) => `${n} words`.padStart(10)).join(""));
for (const [label, make] of rows) {
  console.log(label.padEnd(36) + lengths.map((n) => detectionRate(n, make).padStart(10)).join(""));
}
