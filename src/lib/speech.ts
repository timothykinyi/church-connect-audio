// Robust Web Speech API helpers.
// Voices load asynchronously in most browsers; we wait until they're ready before speaking.

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
    // Fallback: poll briefly in case the event never fires (Safari, some Androids)
    let tries = 0;
    const id = setInterval(() => {
      const v = synth.getVoices();
      if (v && v.length) {
        clearInterval(id);
        finish(v);
      } else if (++tries > 20) {
        clearInterval(id);
        finish([]);
      }
    }, 100);
  });
  return voicesPromise;
};

const pickDefaultVoice = (voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined => {
  if (!voices.length) return undefined;
  const lang = (navigator.language || "en-US").toLowerCase();
  return (
    voices.find((v) => v.default && v.lang.toLowerCase().startsWith(lang.slice(0, 2))) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) ||
    voices.find((v) => v.default) ||
    voices[0]
  );
};

export interface SpeakOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: string) => void;
}

/**
 * Speak text after voices are fully loaded. Cancels any in-flight speech first.
 * Returns a promise that resolves when speech ends.
 */
export const speak = async (text: string, opts: SpeakOptions = {}): Promise<void> => {
  if (!("speechSynthesis" in window)) {
    opts.onError?.("Speech synthesis not supported");
    return;
  }
  const synth = window.speechSynthesis;
  const voices = await getVoices();

  return new Promise((resolve) => {
    try {
      synth.cancel();
    } catch {}

    const utt = new SpeechSynthesisUtterance(text);
    const voice = pickDefaultVoice(voices);
    if (voice) {
      utt.voice = voice;
      utt.lang = voice.lang;
    }
    utt.rate = 1;
    utt.pitch = 1;
    utt.volume = 1;

    utt.onstart = () => opts.onStart?.();
    utt.onend = () => {
      opts.onEnd?.();
      resolve();
    };
    utt.onerror = (e) => {
      opts.onError?.(e.error || "speech error");
      resolve();
    };

    // Tiny delay helps Chrome/Safari reliably start after cancel().
    setTimeout(() => synth.speak(utt), 60);
  });
};

/** Unlock audio on iOS/Safari — must be called from a user gesture. */
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
  try {
    window.speechSynthesis.cancel();
  } catch {}
};
