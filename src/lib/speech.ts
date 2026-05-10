// Robust Web Speech API helpers with English + Swahili support.

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

    synth.addEventListener?.("voiceschanged", () => finish(synth.getVoices()), { once: true } as any);
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

const pickVoice = (voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined => {
  if (!voices.length) return undefined;
  const code = lang.toLowerCase().slice(0, 2);
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase())) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(code)) ||
    voices.find((v) => v.default) ||
    voices[0]
  );
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
    utt.rate = 1; utt.pitch = 1; utt.volume = 1;

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
