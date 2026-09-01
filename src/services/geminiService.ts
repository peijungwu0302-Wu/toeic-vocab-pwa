/**
 * src/services/geminiService.ts
 * Next-Gen Free Gemini AI Features Engine with 2026 Models Support & Universal Auth
 */

import { db } from '../db';
import { quizService } from './quizService';

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
  stemTranslation?: string;
  options: string[];
  answer: string;
  explanation: string;
  optionAnalyses: Array<{
    option: string;
    isCorrect: boolean;
    meaning?: string;
    pos?: string;
    explanation: string;
  }>;
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
      if (typeof window !== 'undefined' && window.localStorage) {
        const localKey = window.localStorage.getItem('toeic_custom_gemini_api_key');
        if (localKey && localKey.trim()) return localKey.trim();
      }
      const setting = await db.appSettings.get('custom_gemini_api_key');
      if (setting && setting.value && setting.value.trim()) {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('toeic_custom_gemini_api_key', setting.value.trim());
        }
        return setting.value.trim();
      }
    } catch {
      // ignore db error
    }
    return import.meta.env.VITE_GEMINI_API_KEY || '';
  },

  /**
   * Save custom API key to local DB and localStorage
   */
  async setApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('toeic_custom_gemini_api_key', trimmed);
    }
    await db.appSettings.put({
      key: 'custom_gemini_api_key',
      value: trimmed
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
Target Meaning: "${definition}"
Roots/Etymology breakdown hint: "${roots || 'word association'}"

Guidelines:
1. Provide a memorable sound-alike hook or vivid corporate workplace scenario.
2. Clearly explain how the story links directly to "${definition}".
3. Keep it punchy, enjoyable, and easy to memorize in 3 seconds.

Return strict JSON:
{
  "mnemonic": "Your creative 1-2 sentence story in Traditional Chinese"
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
          mnemonic: `【高效記憶】「${headword}」（${definition}）：拆解詞根 [${roots || headword}]，想像在商務會議中大家討論關鍵方案，走在最前面自然能掌握【${definition}】！`,
          isLiveAi: false,
          error: errorMsg !== 'NO_API_KEY' ? `${diagnosis}（${errorMsg}）` : undefined
        };
      }
    }

    return {
      mnemonic: `【高效記憶】把「${headword}」拆解為 ${roots || '核心詞根'}：想像在跨國專案會議上，只要提前做好充分準備，就能在談判桌上順利達到【${definition}】！`,
      isLiveAi: false
    };
  },

  /**
   * 🎯 1-Click Instant Part 5 Exam Question Generator (一鍵考我一題)
   * With full stem translation, option Chinese definitions, and in-depth reasoning
   */
  async generateInstantExamQuestion(headword: string, definition: string, pos = '單字'): Promise<InstantQuizResult> {
    const apiKey = await this.getApiKey();

    if (apiKey) {
      const prompt = `
You are a senior TOEIC test writer and ETS examiner.
Create an authentic, challenging Part 5 business sentence fill-in-the-blank question for the target word "${headword}" (Meaning: "${definition}", Part of Speech: "${pos}").
Requirements:
1. The stem MUST be a realistic 15-25 word corporate sentence with a "_____" blank where "${headword}" is the only correct answer grammatically and semantically.
2. Provide "stemTranslation": The complete and accurate Traditional Chinese (繁體中文) translation of the stem sentence.
3. Provide 4 DISTINCT English business vocabulary options (A, B, C, D) with same part of speech and high plausibility. One must be "${headword}".
4. For EACH option in "optionAnalyses", provide:
   - "option": English word
   - "isCorrect": boolean
   - "meaning": Traditional Chinese definition (繁體中文)
   - "explanation": Detailed reasoning why it is correct or incorrect with collocations and context.

Return strict JSON:
{
  "stem": "The executive board agreed to _____ the proposal to improve operational efficiency.",
  "stemTranslation": "董事會同意【${definition}】該提案，以提升營運效率。",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "answer": "${headword}",
  "explanation": "Detailed TOEIC exam point analysis in Traditional Chinese",
  "optionAnalyses": [
    { "option": "Option A", "isCorrect": true/false, "meaning": "中文意思", "explanation": "Why correct/incorrect in Traditional Chinese" },
    { "option": "Option B", "isCorrect": true/false, "meaning": "中文意思", "explanation": "Why correct/incorrect in Traditional Chinese" },
    { "option": "Option C", "isCorrect": true/false, "meaning": "中文意思", "explanation": "Why correct/incorrect in Traditional Chinese" },
    { "option": "Option D", "isCorrect": true/false, "meaning": "中文意思", "explanation": "Why correct/incorrect in Traditional Chinese" }
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
      }
    }

    // Dynamic Offline Generator: 100% paired English stem, Chinese translation, and ABCD analyses
    const mockWord = {
      id: `w_instant_${headword}`,
      headword,
      definitionZh: definition,
      partsOfSpeech: [pos],
      category: '辦公日常',
      starRating: 5,
      toeicScoreRange: '750+'
    } as any;

    const questions = quizService.generateNextGenQuestions([mockWord], 'part5_mcq', 1);
    const q = questions[0];

    return {
      stem: q.stem,
      stemTranslation: q.stemTranslation,
      options: q.options,
      answer: q.correctAnswer,
      explanation: q.explanation,
      optionAnalyses: q.optionAnalyses || [],
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
        if (parsed.feedback && typeof parsed.score === 'number') {
          return { ...parsed, isLiveAi: true, modelUsed: model };
        }
      } catch (err) {
        console.warn('[GeminiService] Live Sentence error:', err);
      }
    }

    // Rule-based fallback evaluation
    const containsWord = userSentence.toLowerCase().includes(headword.toLowerCase());
    const lengthValid = userSentence.trim().split(/\s+/).length >= 5;

    let score = 7;
    let feedback = '';
    if (!containsWord) {
      score = 4;
      feedback = `【離線批改】句子中未偵測到目標單字「${headword}」，請務必在造句中運用此單字。`;
    } else if (!lengthValid) {
      score = 6;
      feedback = `【離線批改】句子長度稍短，建議補充更具體的商務語境（如時間、部門、目的或受詞）。`;
    } else {
      score = 8;
      feedback = `【離線批改】句子結構完整，成功運用「${headword}」！在正式商務書信中可使用更精準的動詞與商務搭配詞。`;
    }

    return {
      score,
      isGrammarCorrect: containsWord && lengthValid,
      feedback,
      betterVersions: {
        formal: `The management team has decided to leverage ${headword} to ensure strategic alignment across all regional operations.`,
        concise: `We will utilize ${headword} to optimize our department's upcoming workflow.`
      },
      isLiveAi: false
    };
  },

  /**
   * 🔍 AI Synonym & Nuance Explainer (易混淆詞微細差異分析)
   */
  async explainNuance(word1: string, word2: string): Promise<NuanceExplanationResult> {
    const apiKey = await this.getApiKey();

    if (apiKey) {
      const prompt = `
You are a Senior Lexicographer and TOEIC Master Teacher.
Explain the subtle nuance, tone differences, and common TOEIC traps between the two business English words "${word1}" and "${word2}".

Return strict JSON:
{
  "summary": "1 sentence executive summary in Traditional Chinese / 繁體中文 contrasting the core concepts",
  "differences": [
    {
      "aspect": "使用情境 / 語意著重點",
      "word1Usage": "Detailed usage of ${word1} with typical business collocations in Traditional Chinese",
      "word2Usage": "Detailed usage of ${word2} with typical business collocations in Traditional Chinese"
    },
    {
      "aspect": "語氣語體 / 介系詞搭配",
      "word1Usage": "Grammar & preposition patterns of ${word1}",
      "word2Usage": "Grammar & preposition patterns of ${word2}"
    }
  ],
  "toeicTrapTip": "1 key TOEIC exam trap hint in Traditional Chinese explaining how ETS tests the distinction"
}
`;
      try {
        const { rawJson, model } = await this.callGeminiRaw(prompt);
        const parsed = JSON.parse(rawJson);
        if (parsed.summary && parsed.differences?.length > 0) {
          return { ...parsed, isLiveAi: true, modelUsed: model };
        }
      } catch (err) {
        console.warn('[GeminiService] Live Nuance error:', err);
      }
    }

    return {
      summary: `「${word1}」與「${word2}」在多益中常同時出現在 Part 5 選項中，主要差異在於語意強烈程度與搭配受詞的不同。`,
      differences: [
        {
          aspect: '核心概念差異',
          word1Usage: `「${word1}」通常強調客觀的具體條件、法律合約或組織常規流程。`,
          word2Usage: `「${word2}」通常著重於主觀的策略評估、相對優勢或成果效益。`
        },
        {
          aspect: '多益常見搭配詞',
          word1Usage: `常與 process, policy, standard, requirement 連用。`,
          word2Usage: `常與 result, benefit, market, opportunity 連用。`
        }
      ],
      toeicTrapTip: `【多益陷阱提示】在第五部分解題時，請先觀察空格後方的「介系詞」與「受詞名詞」，往往直接決定應選 ${word1} 還是 ${word2}。`,
      isLiveAi: false
    };
  }
};
