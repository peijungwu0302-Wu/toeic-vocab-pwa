/**
 * src/services/freeApiService.ts
 * 100% Free Public Open API Integrations
 * 
 * Includes:
 * 1. Datamuse API: Business Collocations & Synonyms
 * 2. Free Dictionary API: Real Audio & Phonetics
 * 3. DiceBear Avatars: Deterministic Vector SVG Avatars
 * 4. Quotable API: Daily Business Leaders Quotes
 */

export interface CollocationResult {
  word: string;
  score: number;
}

export interface DailyQuote {
  quote: string;
  author: string;
}

export const freeApiService = {
  /**
   * Get business collocations (adjectives, nouns, verbs) using Datamuse API
   * Free, no API Key, 100k requests/day
   */
  async getCollocations(word: string): Promise<string[]> {
    try {
      const cleanWord = encodeURIComponent(word.trim().toLowerCase());
      // rel_jja: adjectives that modify noun, rel_trg: direct trigger/association
      const res = await fetch(`https://api.datamuse.com/words?rel_jja=${cleanWord}&max=6`);
      if (!res.ok) return [];
      const data: CollocationResult[] = await res.json();
      return data.map(item => item.word);
    } catch {
      return [];
    }
  },

  /**
   * Get synonyms using Datamuse API (TOEIC Part 7 Paraphrasing)
   */
  async getSynonyms(word: string): Promise<string[]> {
    try {
      const cleanWord = encodeURIComponent(word.trim().toLowerCase());
      const res = await fetch(`https://api.datamuse.com/words?rel_syn=${cleanWord}&max=5`);
      if (!res.ok) return [];
      const data: CollocationResult[] = await res.json();
      return data.map(item => item.word);
    } catch {
      return [];
    }
  },

  /**
   * Fetch audio & phonetics from Free Dictionary API
   */
  async getWordAudioAndIpa(word: string): Promise<{ audioUrl: string | null; ipa: string | null }> {
    try {
      const cleanWord = encodeURIComponent(word.trim().toLowerCase());
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`);
      if (!res.ok) return { audioUrl: null, ipa: null };
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return { audioUrl: null, ipa: null };

      const entry = data[0];
      const phonetics = entry.phonetics || [];
      const audioItem = phonetics.find((p: { audio?: string }) => Boolean(p.audio && p.audio.length > 0));
      const ipaItem = phonetics.find((p: { text?: string }) => Boolean(p.text));

      return {
        audioUrl: audioItem ? audioItem.audio : null,
        ipa: ipaItem ? ipaItem.text : (entry.phonetic || null)
      };
    } catch {
      return { audioUrl: null, ipa: null };
    }
  },

  /**
   * Get dynamic SVG avatar URL for student profile via DiceBear
   */
  getAvatarUrl(seed: string): string {
    const cleanSeed = encodeURIComponent(seed || 'Student');
    return `https://api.dicebear.com/9.x/avataaars/svg?seed=${cleanSeed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
  },

  /**
   * Get daily inspiring business quote
   */
  async getDailyQuote(): Promise<DailyQuote> {
    try {
      const res = await fetch('https://api.quotable.io/quotes/random?tags=business|technology|success');
      if (res.ok) {
        const data = await res.json();
        const item = Array.isArray(data) ? data[0] : data;
        if (item && item.content) {
          return { quote: item.content, author: item.author };
        }
      }
    } catch {
      // Fallback inspiring business quotes
    }

    const fallbackQuotes: DailyQuote[] = [
      { quote: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
      { quote: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
      { quote: "The secret of change is to focus all of your energy on building the new.", author: "Socrates" },
      { quote: "Quality is not an act, it is a habit.", author: "Aristotle" }
    ];

    const todayIndex = new Date().getDate() % fallbackQuotes.length;
    return fallbackQuotes[todayIndex];
  }
};
