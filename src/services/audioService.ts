class AudioService {
  private audioCtx: AudioContext | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private isUnlocked = false;
  private availableVoices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => {
          this.loadVoices();
        };
      }
    }
  }

  private loadVoices() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.availableVoices = window.speechSynthesis.getVoices();
    }
  }

  /**
   * Must be called during a direct user touch/click gesture (e.g. "開始學習")
   * to unlock AudioContext on iOS Safari.
   */
  public async unlockAudio(): Promise<boolean> {
    if (this.isUnlocked) return true;

    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        if (!this.audioCtx) {
          this.audioCtx = new AudioCtxClass();
        }
        if (this.audioCtx.state === 'suspended') {
          await this.audioCtx.resume();
        }

        // Play a short silent buffer
        const buffer = this.audioCtx.createBuffer(1, 1, 22050);
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioCtx.destination);
        source.start(0);
      }

      this.isUnlocked = true;
      return true;
    } catch (e) {
      console.warn('[AudioService] AudioContext unlock warning:', e);
      return false;
    }
  }

  /**
   * Stops any currently playing audio or speech synthesis immediately.
   */
  public stopAll() {
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement.currentTime = 0;
      this.currentAudioElement = null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Speak a headword using remote audio URL or Web Speech API fallback.
   */
  public async playWord(params: {
    headword: string;
    audioUrl?: string | null;
    accent?: 'US' | 'UK';
    isMuted?: boolean;
  }): Promise<boolean> {
    if (params.isMuted) {
      return false;
    }

    this.stopAll();

    const textToSpeak = params.headword.trim();
    if (!textToSpeak) return false;

    // 1. Try remote audio URL if provided
    if (params.audioUrl) {
      try {
        const played = await this.playRemoteAudio(params.audioUrl);
        if (played) return true;
      } catch (err) {
        console.warn('[AudioService] Remote audio failed, falling back to Web Speech API:', err);
      }
    }

    // 2. Fallback to Web Speech API
    return this.playSpeechSynthesis(textToSpeak, params.accent || 'US');
  }

  /**
   * Dedicated natural pronunciation for long business example sentences using Web Speech API.
   */
  public async speakSentence(text: string, accent: 'US' | 'UK' = 'US'): Promise<boolean> {
    const cleanText = text.trim();
    if (!cleanText) return false;

    this.stopAll();

    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve(false);
        return;
      }

      try {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(cleanText);
        const targetLang = accent === 'UK' ? 'en-GB' : 'en-US';
        utterance.lang = targetLang;
        utterance.rate = 0.88; // Natural, steady cadence for business sentences
        utterance.pitch = 1.0;

        if (this.availableVoices.length === 0) {
          this.loadVoices();
        }

        const matchedVoice =
          this.availableVoices.find(v => v.lang.replace('_', '-').toLowerCase() === targetLang.toLowerCase()) ||
          this.availableVoices.find(v => v.lang.startsWith('en'));

        if (matchedVoice) {
          utterance.voice = matchedVoice;
        }

        utterance.onend = () => resolve(true);
        utterance.onerror = () => resolve(false);

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[AudioService] Speak sentence error:', err);
        resolve(false);
      }
    });
  }

  private playRemoteAudio(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const audio = new Audio();
      this.currentAudioElement = audio;

      let timeoutId: number | null = window.setTimeout(() => {
        audio.src = '';
        resolve(false);
      }, 3500);

      audio.oncanplaythrough = async () => {
        try {
          await audio.play();
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          resolve(true);
        } catch {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          resolve(false);
        }
      };

      audio.onerror = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        resolve(false);
      };

      audio.onended = () => {
        this.currentAudioElement = null;
      };

      audio.src = url;
      audio.load();
    });
  }

  private playSpeechSynthesis(text: string, accent: 'US' | 'UK'): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve(false);
        return;
      }

      try {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        const targetLang = accent === 'UK' ? 'en-GB' : 'en-US';
        utterance.lang = targetLang;
        utterance.rate = 0.92; // Slightly natural for learning
        utterance.pitch = 1.0;

        if (this.availableVoices.length === 0) {
          this.loadVoices();
        }

        // Try to pick a natural English voice matching target accent
        const matchedVoice = this.availableVoices.find(
          v => v.lang.replace('_', '-').toLowerCase() === targetLang.toLowerCase()
        ) || this.availableVoices.find(v => v.lang.startsWith('en'));

        if (matchedVoice) {
          utterance.voice = matchedVoice;
        }

        utterance.onend = () => resolve(true);
        utterance.onerror = (e) => {
          console.warn('[AudioService] Speech synthesis error:', e);
          resolve(false);
        };

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('[AudioService] Speech synthesis failed:', err);
        resolve(false);
      }
    });
  }
}

export const audioService = new AudioService();
