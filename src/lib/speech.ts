// Free, device-native Web Speech helpers with English + Swahili support.

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

export const getVoices = (): Promise<SpeechSynthesisVoice[]> => {
  if (voicesPromise) return voicesPromise;
  voicesPromise = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const existing = synth.getVoices();
    if (existing && existing.length) return resolve(existing);

    let settled = false;
    const finish = (v: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    synth.addEventListener?.("voiceschanged", () => finish(synth.getVoices()), { once: true });
    let tries = 0;
    const id = setInterval(() => {
      const v = synth.getVoices();
      if (v && v.length) { clearInterval(id); finish(v); }
      else if (++tries > 20) { clearInterval(id); finish([]); }
    }, 100);
  });
  return voicesPromise;
};

// Heuristic: detect Swahili by common stop-words/markers. Falls back to English.
const SW_WORDS = /\b(na|ya|wa|kwa|ni|si|hii|hiyo|hapa|pale|sasa|asante|karibu|habari|jambo|tafadhali|samahani|ndiyo|hapana|mimi|wewe|yeye|sisi|nyinyi|wao|mzuri|vizuri|sawa|nataka|nina|kuna|hakuna)\b/i;
export const detectLang = (text: string): "sw-KE" | "en-US" => (SW_WORDS.test(text) ? "sw-KE" : "en-US");

const NATURAL_VOICE_MARKERS = ["natural", "neural", "premium", "enhanced", "google", "microsoft"];
const NOVELTY_VOICE_MARKERS = ["whisper", "zarvox", "trinoids", "bells", "boing", "bubbles", "cellos"];

const voiceScore = (voice: SpeechSynthesisVoice, lang: string) => {
  const requested = lang.toLowerCase();
  const language = voice.lang.toLowerCase();
  const name = voice.name.toLowerCase();
  let score = 0;

  if (language === requested) score += 120;
  else if (language.startsWith(requested.slice(0, 2))) score += 90;
  else if (requested.startsWith("sw") && language.startsWith("en")) score += 20;
  if (NATURAL_VOICE_MARKERS.some((marker) => name.includes(marker))) score += 30;
  if (!voice.localService) score += 8;
  if (voice.default) score += 4;
  if (NOVELTY_VOICE_MARKERS.some((marker) => name.includes(marker))) score -= 100;
  return score;
};

const pickVoice = (voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined => {
  if (!voices.length) return undefined;
  return [...voices].sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang))[0];
};

export interface SpeakOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: string) => void;
  lang?: string; // override auto-detect
}

export const speak = async (text: string, opts: SpeakOptions = {}): Promise<void> => {
  if (!("speechSynthesis" in window)) { opts.onError?.("Speech synthesis not supported"); return; }
  const synth = window.speechSynthesis;
  const voices = await getVoices();
  const lang = opts.lang || detectLang(text);

  return new Promise((resolve) => {
    try { synth.cancel(); } catch {}
    const utt = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(voices, lang);
    if (voice) utt.voice = voice;
    utt.lang = lang;
    // A slightly slower pace keeps short production instructions clear and human.
    utt.rate = lang.toLowerCase().startsWith("sw") ? 0.9 : 0.94;
    utt.pitch = 1;
    utt.volume = 1;

    utt.onstart = () => opts.onStart?.();
    utt.onend = () => { opts.onEnd?.(); resolve(); };
    utt.onerror = (e) => { opts.onError?.(e.error || "speech error"); resolve(); };

    setTimeout(() => synth.speak(utt), 60);
  });
};

export const primeSpeech = async () => {
  if (!("speechSynthesis" in window)) return;
  await getVoices();
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {}
};

export const stopSpeaking = () => {
  try { window.speechSynthesis.cancel(); } catch {}
};
