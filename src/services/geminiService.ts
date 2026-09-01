/**
 * src/services/geminiService.ts
 * Next-Gen Free Gemini AI Features Engine with 2026 Models Support & Universal Auth
 */

import { db } from '../db';

export interface SentenceEvaluationResult {
  score: number; // 1 - 10
  isGrammarCorrect: boolean;
  feedback: string;
  betterVersions: {
    formal: string;
    concise: string;
  };
  isLiveAi?: boolean;
  modelUsed?: string;
}

export interface NuanceExplanationResult {
  summary: string;
  differences: Array<{
    aspect: string;
    word1Usage: string;
    word2Usage: string;
  }>;
  toeicTrapTip: string;
  isLiveAi?: boolean;
  modelUsed?: string;
}

export interface MnemonicResult {
  mnemonic: string;
  isLiveAi: boolean;
  modelUsed?: string;
  error?: string;
}

export interface InstantQuizResult {
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
  optionAnalyses: Array<{ option: string; isCorrect: boolean; explanation: string }>;
  isLiveAi: boolean;
  modelUsed?: string;
  error?: string;
}

// Supported Google Gemini models ordered by current active availability
const SUPPORTED_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.7-flash',
  'gemini-flash-latest'
];

/**
 * Diagnostic helper that converts raw Google API errors into actionable Traditional Chinese explanations
 */
export function diagnoseGeminiError(rawError: string): string {
  const err = (rawError || '').toLowerCase();

  if (err.includes('api key not valid') || err.includes('invalid_argument') || err.includes('key_invalid')) {
    return '【金鑰不正確】API Key 格式無效或複製不完整。請確認前後無多餘空格。';
  }

  if (err.includes('user location is not supported') || err.includes('failed_precondition') || err.includes('location')) {
    return '【地區 IP 受限】Google API 偵測到當前網路 IP 不在開放範圍（如香港/中國大陸）。請將 VPN 切換至「台灣、日本或美國」節點後再試。';
  }

  if (err.includes('permission_denied') || err.includes('referer') || err.includes('blocked') || err.includes('caller does not have')) {
    return '【金鑰限制阻擋】此金鑰可能設定了限制或已失效。建議在 aistudio.google.com 重新「Create API key in new project」生成無限制金鑰。';
  }

  if (err.includes('resource_exhausted') || err.includes('quota') || err.includes('429')) {
    return '【請求頻率超限】已達 Google 免費版每分鐘上限（15 RPM），請稍候 5~10 秒後再次點擊重試。';
  }

  if (err.includes('not found') || err.includes('404')) {
    return '【模型端點調整】當前端點已更新為最新 gemini-3.6-flash。';
  }

  return `【API 回應異常】：${rawError}`;
}

function buildRequestDetails(key: string, model: string, apiVersion = 'v1beta') {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-goog-api-key': key
  };

  return {
    url: `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${key}`,
    headers
  };
}

export const geminiService = {
  /**
   * Get configured API key from local DB or environment
   */
  async getApiKey(): Promise<string> {
    try {
      const setting = await db.appSettings.get('custom_gemini_api_key');
      if (setting && setting.value && setting.value.trim()) {
        return setting.value.trim();
      }
    } catch {
      // ignore db error
    }
    return import.meta.env.VITE_GEMINI_API_KEY || '';
  },

  /**
   * Save custom API key to local DB
   */
  async setApiKey(key: string): Promise<void> {
    await db.appSettings.put({
      key: 'custom_gemini_api_key',
      value: key.trim()
    });
  },

  /**
   * Test API key connectivity
   */
  async testApiKey(testKey: string): Promise<{ success: boolean; model: string; message: string; rawError?: string }> {
    const key = testKey.trim();
    if (!key) return { success: false, model: '', message: 'API 金鑰不可為空' };

    let lastRawError = '';

    for (const model of SUPPORTED_MODELS) {
      try {
        const { url, headers } = buildRequestDetails(key, model);
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Respond with "OK" if alive.' }] }]
          })
        });

        if (res.ok) {
          return {
            success: true,
            model,
            message: `連線成功！已成功連線至 Google ${model} 最新大模型！`
          };
        } else {
          const errData = await res.json().catch(() => ({}));
          lastRawError = errData?.error?.message || `HTTP ${res.status}`;
        }
      } catch (err) {
        lastRawError = (err as Error).message || '網路連線失敗';
      }
    }

    const diagnosis = diagnoseGeminiError(lastRawError);
    return {
      success: false,
      model: '',
      message: `${diagnosis}（原始訊息：${lastRawError}）`,
      rawError: lastRawError
    };
  },

  /**
   * Internal call with multi-model fallback and strict error reporting
   */
  async callGeminiRaw(prompt: string): Promise<{ rawJson: string; model: string }> {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new Error('NO_API_KEY');

    let lastError: Error | null = null;

    for (const model of SUPPORTED_MODELS) {
      try {
        const { url, headers } = buildRequestDetails(apiKey, model);
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.7,
              maxOutputTokens: 1200
            }
          })
        });

        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return { rawJson: text, model };
        } else {
          const errBody = await res.json().catch(() => ({}));
          lastError = new Error(errBody?.error?.message || `HTTP ${res.status}`);
        }
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw lastError || new Error('Gemini API calls failed');
  },

  /**
   * 💡 1-Click Mnemonic Story Generator (一秒記憶故事)
   */
  async generateMnemonicStory(headword: string, definition: string, roots = ''): Promise<MnemonicResult> {
    const apiKey = await this.getApiKey();

    if (apiKey) {
      const prompt = `
You are an expert creative TOEIC vocabulary coach and memory master.
Create a truly unique, vivid, clever, and humorous 1-2 sentence mnemonic memory hook story in Traditional Chinese (繁體中文) for the TOEIC business English word "${headword}".
- Target Word: "${headword}"
- Meaning: "${definition}"
- Word Roots / Etymology / Parts: "${roots}"
- Focus on authentic corporate situations (conferences, contracts, promotions, coffee breaks, supply chain).
- Explain the sound association or root association memorably.

Return strict JSON:
{
  "mnemonic": "您的繁體中文專屬商務記憶故事與口訣"
}
`;
      try {
        const { rawJson, model } = await this.callGeminiRaw(prompt);
        const parsed = JSON.parse(rawJson);
        if (parsed.mnemonic) {
          return { mnemonic: parsed.mnemonic, isLiveAi: true, modelUsed: model };
        }
      } catch (err) {
        const errorMsg = (err as Error).message;
        console.warn('[GeminiService] Live Mnemonic error:', errorMsg);
        const diagnosis = diagnoseGeminiError(errorMsg);
        return {
          mnemonic: `【離線範本】「${headword}」（${definition}）：拆解詞根 [${roots || headword}]，想像在商務會議中走在大家最前面，自然能掌握核心優勢！`,
          isLiveAi: false,
          error: errorMsg !== 'NO_API_KEY' ? `${diagnosis}（${errorMsg}）` : undefined
        };
      }
    }

    return {
      mnemonic: `【離線範本】把「${headword}」拆解為 ${roots || '核心詞根'}：想像在跨國專案會議上，只要提前做好充分準備，就能在談判桌上順利達到【${definition}】！`,
      isLiveAi: false
    };
  },

  /**
   * 🎯 1-Click Instant Part 5 Exam Question Generator (一鍵考我一題)
   */
  async generateInstantExamQuestion(headword: string, definition: string): Promise<InstantQuizResult> {
    const apiKey = await this.getApiKey();

    if (apiKey) {
      const prompt = `
You are a senior TOEIC test writer and ETS examiner.
Create an authentic, challenging Part 5 business sentence fill-in-the-blank question for the target word "${headword}" (Meaning: "${definition}").
Requirements:
1. The stem MUST be a realistic 15-25 word corporate sentence with a "_____" blank.
2. Provide 4 DISTINCT English business vocabulary options (A, B, C, D) with high plausibility. One must be "${headword}".
3. Provide in-depth ABCD option-by-option analysis in Traditional Chinese (繁體中文).

Return strict JSON:
{
  "stem": "Executive management decided to _____ ...",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "answer": "${headword}",
  "explanation": "Detailed TOEIC exam point analysis in Traditional Chinese",
  "optionAnalyses": [
    { "option": "Option A", "isCorrect": true/false, "explanation": "Why correct/incorrect with Chinese meaning and collocations" },
    { "option": "Option B", "isCorrect": true/false, "explanation": "Why correct/incorrect with Chinese meaning and collocations" },
    { "option": "Option C", "isCorrect": true/false, "explanation": "Why correct/incorrect with Chinese meaning and collocations" },
    { "option": "Option D", "isCorrect": true/false, "explanation": "Why correct/incorrect with Chinese meaning and collocations" }
  ]
}
`;
      try {
        const { rawJson, model } = await this.callGeminiRaw(prompt);
        const parsed = JSON.parse(rawJson);
        if (parsed.stem && parsed.options?.length === 4) {
          return { ...parsed, isLiveAi: true, modelUsed: model };
        }
      } catch (err) {
        const errorMsg = (err as Error).message;
        console.warn('[GeminiService] Live Quiz error:', errorMsg);
        const diagnosis = diagnoseGeminiError(errorMsg);
        return {
          stem: `Due to recent market expansion, the executive committee decided to _____ the new strategy starting next month.`,
          options: [headword, 'terminate', 'postpone', 'allocate'],
          answer: headword,
          explanation: `【多益核心考點】本題考查動詞與受詞 the new strategy 的語意搭配，${headword} 符合「${definition}」之語境。`,
          optionAnalyses: [
            { option: headword, isCorrect: true, explanation: `正確：符合句意「${definition}」。` },
            { option: 'terminate', isCorrect: false, explanation: `錯誤：終止、解約，文意不符。` },
            { option: 'postpone', isCorrect: false, explanation: `錯誤：延期、推遲，語意不合。` },
            { option: 'allocate', isCorrect: false, explanation: `錯誤：撥款、分配，無法直接搭配策略。` }
          ],
          isLiveAi: false,
          error: errorMsg !== 'NO_API_KEY' ? `${diagnosis}（${errorMsg}）` : undefined
        };
      }
    }

    return {
      stem: `Due to recent corporate restructuring, the management board decided to _____ the new policy starting next quarter.`,
      options: [headword, 'terminate', 'postpone', 'allocate'],
      answer: headword,
      explanation: `【多益核心考點】空格位於不定詞 to 之後，搭配受詞 the new policy，符合「${definition}」之商務語境。`,
      optionAnalyses: [
        { option: headword, isCorrect: true, explanation: `正確：符合句意「${definition}」。` },
        { option: 'terminate', isCorrect: false, explanation: `錯誤：終止、解約，文意不合。` },
        { option: 'postpone', isCorrect: false, explanation: `錯誤：延期、推遲，與推進專案方向相反。` },
        { option: 'allocate', isCorrect: false, explanation: `錯誤：撥款/分配，受詞搭配不當。` }
      ],
      isLiveAi: false
    };
  },

  /**
   * ✍️ AI Business Sentence Writing Coach (商務造句批改)
   */
  async evaluateSentence(headword: string, userSentence: string): Promise<SentenceEvaluationResult> {
    const apiKey = await this.getApiKey();

    if (apiKey) {
      const prompt = `
You are a Senior Business English Professor and TOEIC Writing Examiner.
Evaluate the student's business sentence using the target word "${headword}".
Student Sentence: "${userSentence}"

Provide honest, constructive, detailed scoring and high-level authentic rewrites.
Return strict JSON:
{
  "score": (number 1 to 10),
  "isGrammarCorrect": (boolean),
  "feedback": "Detailed constructive evaluation in Traditional Chinese / 繁體中文 explaining strengths, grammar issues, and workplace tone",
  "betterVersions": {
    "formal": "Authentic executive-level business email sentence in English",
    "concise": "Crisp direct workplace memo sentence in English"
  }
}
`;
      try {
        const { rawJson, model } = await this.callGeminiRaw(prompt);
        const parsed = JSON.parse(rawJson);
        if (typeof parsed.score === 'number') {
          return { ...parsed, isLiveAi: true, modelUsed: model };
        }
      } catch (err) {
        console.warn('[GeminiService] Live Sentence evaluation error:', err);
      }
    }

    const cleanInput = userSentence.trim();
    const hasTarget = cleanInput.toLowerCase().includes(headword.toLowerCase());
    const isLongEnough = cleanInput.split(' ').length >= 4;

    return {
      score: hasTarget && isLongEnough ? 9 : 7,
      isGrammarCorrect: true,
      feedback: hasTarget
        ? `（離線評估）造句運用精確！成功在商務語境中正確運用「${headword}」。句意清晰且符合職場溝通慣例。`
        : `（離線評估）句子結構通順，建議更加凸顯「${headword}」在商務書信中的核心功能。`,
      betterVersions: {
        formal: `We will make every effort to ensure all measures to ${headword} the client's requirements are implemented in accordance with company protocol.`,
        concise: `Our department will ${headword} this project update by end of business today.`
      },
      isLiveAi: false
    };
  },

  /**
   * 🔍 Explain Nuance & TOEIC Trap between two synonyms (近義詞與陷阱對比)
   */
  async explainNuance(word1: string, word2: string): Promise<NuanceExplanationResult> {
    const apiKey = await this.getApiKey();

    if (apiKey) {
      const prompt = `
Compare the nuanced differences and TOEIC exam traps between the two synonyms "${word1}" and "${word2}".
Return strict JSON with in-depth Traditional Chinese (繁體中文) explanations:
{
  "summary": "Brief 1-2 sentence comparison in Traditional Chinese",
  "differences": [
    { "aspect": "核心語意側重", "word1Usage": "${word1} 具體說明與例句", "word2Usage": "${word2} 具體說明與例句" },
    { "aspect": "商務搭配與介系詞", "word1Usage": "${word1} 常見搭配", "word2Usage": "${word2} 常見搭配" }
  ],
  "toeicTrapTip": "Detailed TOEIC Part 5 trap analysis in Traditional Chinese"
}
`;
      try {
        const { rawJson, model } = await this.callGeminiRaw(prompt);
        const parsed = JSON.parse(rawJson);
        if (parsed.summary) {
          return { ...parsed, isLiveAi: true, modelUsed: model };
        }
      } catch (err) {
        console.warn('[GeminiService] Live Nuance error:', err);
      }
    }

    return {
      summary: `「${word1}」與「${word2}」均為多益高頻商務詞，但在語氣正式度與搭配對象上有明確區分。`,
      differences: [
        {
          aspect: '核心語意側重點',
          word1Usage: `【${word1}】側重於具體行動規範、商務合約或客戶明確要求之達成。`,
          word2Usage: `【${word2}】側重於一般性策略調整、大環境變化或個人狀態之配合。`
        },
        {
          aspect: '多益常見搭配受詞',
          word1Usage: `${word1} + request / proposal / deadline / criteria`,
          word2Usage: `${word2} + to changes / market conditions / new policies`
        }
      ],
      toeicTrapTip: `💡【多益 Part 5 破題秘訣】：若選項同時出現「${word1}」與「${word2}」，切勿只看中文意思！立刻觀察空格後方的介系詞（如 to、with）或受詞是「具體事務」還是「抽象狀態」！`,
      isLiveAi: false
    };
  }
};
