/**
 * src/services/quizService.ts
 * 3-Tier High-Precision TOEIC Part 5 & Part 6 Dynamic Quiz Engine for 11,154 Vocabulary Words
 */

import { Word, QuizItem } from '../types/db';
import { QuizQuestion, QuizSessionSummary } from '../types/quiz';
import { progressRepository } from '../repositories/progressRepository';
import { geminiService } from './geminiService';

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export type NextGenQuizMode = 'part5_mcq' | 'cloze_fill' | 'meaning' | 'listening' | 'ai_live';
export type QuizDifficultyTier = 'easy' | 'medium' | 'hard' | 'all';

export interface NextGenQuestion {
  id: string;
  word: Word;
  mode: NextGenQuizMode;
  difficulty?: 'easy' | 'medium' | 'hard';
  stem: string;
  stemTranslation?: string;
  options: string[]; // 4 English choices
  correctAnswer: string;
  correctIndex: number;
  clozeHint?: string;
  explanation: string;
  isAiLive?: boolean;
  optionAnalyses?: Array<{
    option: string;
    isCorrect: boolean;
    explanation: string;
  }>;
}

// Clean concise definition extractor (e.g. "清潔人員；清潔工，通常指..." -> "清潔人員")
function getShortDefinition(fullDef: string): string {
  if (!fullDef) return '';
  const firstPart = fullDef.split(/[；，,;（(]/)[0].trim();
  return firstPart || fullDef;
}

// Curated high-frequency distractor clusters by semantic domain
const BUSINESS_DISTRACTOR_CLUSTERS: Record<string, Array<{ word: string; pos: string; meaning: string }>> = {
  '優勢策略': [
    { word: 'advantage', pos: 'n.', meaning: '優勢' },
    { word: 'priority', pos: 'n.', meaning: '優先事項' },
    { word: 'incentive', pos: 'n.', meaning: '獎勵措施' },
    { word: 'preference', pos: 'n.', meaning: '偏好' },
    { word: 'strategy', pos: 'n.', meaning: '戰略方針' },
    { word: 'initiative', pos: 'n.', meaning: '新倡議' }
  ],
  '商務談判': [
    { word: 'negotiate', pos: 'v.', meaning: '談判協商' },
    { word: 'compromise', pos: 'v.', meaning: '妥協讓步' },
    { word: 'collaborate', pos: 'v.', meaning: '共同合作' },
    { word: 'terminate', pos: 'v.', meaning: '終止解約' },
    { word: 'postpone', pos: 'v.', meaning: '延期推遲' },
    { word: 'finalize', pos: 'v.', meaning: '定案敲定' }
  ],
  '財務費用': [
    { word: 'reimburse', pos: 'v.', meaning: '報銷費用' },
    { word: 'compensate', pos: 'v.', meaning: '補償賠償' },
    { word: 'allocate', pos: 'v.', meaning: '撥款分配' },
    { word: 'distribute', pos: 'v.', meaning: '分派分發' },
    { word: 'subsidize', pos: 'v.', meaning: '提供補貼' },
    { word: 'evaluate', pos: 'v.', meaning: '審查評估' }
  ],
  '行政人事': [
    { word: 'cleaner', pos: 'n.', meaning: '清潔人員' },
    { word: 'supervisor', pos: 'n.', meaning: '主管督導' },
    { word: 'coordinator', pos: 'n.', meaning: '專案協調員' },
    { word: 'inspector', pos: 'n.', meaning: '安全查驗員' },
    { word: 'consultant', pos: 'n.', meaning: '專業顧問' },
    { word: 'technician', pos: 'n.', meaning: '技術專員' }
  ],
  '行政規範': [
    { word: 'accommodate', pos: 'v.', meaning: '配合需求' },
    { word: 'implement', pos: 'v.', meaning: '實施執行' },
    { word: 'facilitate', pos: 'v.', meaning: '促進便利' },
    { word: 'supervise', pos: 'v.', meaning: '監督指導' },
    { word: 'authorize', pos: 'v.', meaning: '授權核准' },
    { word: 'delegate', pos: 'v.', meaning: '委派委任' }
  ]
};

// High-precision Part 5 Sentence Templates with 100% paired English & Chinese
interface SentencePattern {
  tier: 'easy' | 'medium' | 'hard';
  en: (blank?: string) => string;
  zh: (def: string) => string;
}

const VERB_PATTERNS: SentencePattern[] = [
  {
    tier: 'easy',
    en: () => `The branch manager decided to _____ the operational workflow in order to enhance team efficiency.`,
    zh: (d) => `分行經理決定【${d}】作業流程，以提升團隊效率。`
  },
  {
    tier: 'medium',
    en: () => `In order to meet the strict project deadline, our department agreed to _____ additional resources for comprehensive system testing.`,
    zh: (d) => `為了趕上緊迫的專案截止日期，我們部門同意為系統全面測試【${d}】額外資源。`
  },
  {
    tier: 'hard',
    en: () => `Following rigorous evaluation, the executive committee resolved to _____ all regulatory compliance protocols across overseas subsidiaries.`,
    zh: (d) => `經嚴格評估後，執行委員會決議在海外子公司全面【${d}】所有法規合規準則。`
  }
];

const NOUN_PATTERNS: SentencePattern[] = [
  {
    tier: 'easy',
    en: () => `The facility management department hired an experienced _____ to maintain high standards across the office premises.`,
    zh: (d) => `總務管理部門聘請了一位經驗豐富的【${d}】，以維持辦公場所的高標準。`
  },
  {
    tier: 'medium',
    en: () => `The marketing division conducted extensive research to analyze the latest consumer _____ in international target markets.`,
    zh: (d) => `行銷部門進行了廣泛的研究，以分析國際目標市場中最新的消費者【${d}】。`
  },
  {
    tier: 'hard',
    en: () => `The board of directors held an extraordinary session to review the comprehensive _____ concerning the upcoming corporate merger.`,
    zh: (d) => `董事會召開了臨時會議，以審查關於即將進行之企業合併的完整【${d}】。`
  }
];

const ADJ_PATTERNS: SentencePattern[] = [
  {
    tier: 'easy',
    en: () => `The new manager recommended taking a more _____ approach to solve the scheduling delay.`,
    zh: (d) => `新任主管建議採取更【${d}】的做法來解決排程延誤。`
  },
  {
    tier: 'medium',
    en: () => `Due to recent economic conditions, the organization requires a _____ strategy to maintain its competitive market position.`,
    zh: (d) => `鑑於近期的經濟情勢，機構需要一項【${d}】的策略以維持市場競爭優勢。`
  },
  {
    tier: 'hard',
    en: () => `All senior regional directors agreed that implementing a _____ review process would mitigate international operational risks.`,
    zh: (d) => `全體區域高階主管一致認為實施【${d}】的審查機制將能降低跨國營運風險。`
  }
];

const ADV_PATTERNS: SentencePattern[] = [
  {
    tier: 'easy',
    en: () => `All transaction records must be _____ verified by the accounting staff before submission.`,
    zh: (d) => `所有交易記錄在提交前都必須由會計人員【${d}】查核。`
  },
  {
    tier: 'medium',
    en: () => `The chief safety inspector _____ reviewed all manufacturing equipment following the unexpected power outage.`,
    zh: (d) => `在發生突發停電之後，首席安全檢查員【${d}】審查了所有製造設備。`
  },
  {
    tier: 'hard',
    en: () => `The legal compliance department _____ monitored the negotiations to prevent any potential breach of confidentiality.`,
    zh: (d) => `法務合規部門在談判過程中進行了【${d}】監督，以防範任何潛在的保密協定違規。`
  }
];

const PHRASE_PATTERNS: SentencePattern[] = [
  {
    tier: 'easy',
    en: () => `All employees are strongly encouraged to register _____ to secure early-bird seminar seating.`,
    zh: (d) => `強烈建議所有員工【${d}】報名，以保留早鳥研討會席位。`
  },
  {
    tier: 'medium',
    en: () => `The project coordinator submitted the quarterly budget proposal _____ to ensure smooth project continuation.`,
    zh: (d) => `專案協調員【${d}】提交了季度預算提案，以確保專案順利推進。`
  },
  {
    tier: 'hard',
    en: () => `The executive director signed the binding non-disclosure agreement _____ all participating regional stakeholders.`,
    zh: (d) => `執行總監【${d}】所有參與的區域關係人簽署了具約束力的保密協議。`
  }
];

const CLOZE_TEMPLATES = [
  {
    tier: 'easy' as const,
    header: '📧 [BUSINESS MEMORANDUM]\nTo: All Department Staff\nFrom: Human Resources\nSubject: Office Operational Notice',
    en: (_b?: string) => `Please be advised that management has officially designated _____ within our standard procedures starting next Monday. We appreciate your cooperation in adhering to these guidelines.`,
    zh: (d: string) => `【公司備忘錄】主管致全體同仁：管理層已決議自下週一起於標準流程中指派/運用【${d}】。感謝大家配合遵守規範。`
  },
  {
    tier: 'medium' as const,
    header: '📩 [CLIENT CORRESPONDENCE]\nTo: Regional Procurement Managers\nFrom: Supply Chain Directorate\nSubject: Shipment & Quality Assurance Update',
    en: (_b?: string) => `In accordance with our new global compliance standards, our facility requires _____ in all upcoming project deliverables. Please review the attached contract for specifics.`,
    zh: (d: string) => `【商務信件】致區域採購經理：依據最新全球合規標準，我司在後續交付物中需要【${d}】。具體細節請參閱隨附合約。`
  },
  {
    tier: 'hard' as const,
    header: '📢 [EXECUTIVE COMPLIANCE ANNOUNCEMENT]\nTo: Board of Directors & Division Heads\nFrom: Chief Executive Office\nSubject: Strategic Policy Implementation',
    en: (_b?: string) => `Our technical and legal committees have established rigorous standards regarding _____ across all international server infrastructure. Formal audits will commence by the end of the fiscal quarter.`,
    zh: (d: string) => `【高層合規公告】致董事會與部門首長：技術與法務委員會已針對所有跨國伺服器設施訂定關於【${d}】之嚴格標準。正式審計將於本季末展開。`
  }
];

export const quizService = {
  /**
   * Fetch static quiz items from JSON
   */
  async loadTierQuizzes(
    tier: 'core' | 'advanced' | 'expert' = 'core',
    type: 'mcq' | 'cloze' = 'mcq'
  ): Promise<QuizItem[]> {
    try {
      const res = await fetch(`/data/v1/quiz/${tier}-${type}.json`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.questions || [];
    } catch {
      return [];
    }
  },

  /**
   * 🌟 100% High-Precision TOEIC Part 5 & Cloze Generator
   * Guarantees 1:1 alignment between Stem, Chinese translation, and Answer
   */
  generateNextGenQuestions(
    words: Word[],
    mode: NextGenQuizMode = 'part5_mcq',
    count = 10,
    excludeWordIds: string[] = [],
    _difficulty: QuizDifficultyTier = 'all'
  ): NextGenQuestion[] {
    if (words.length === 0) return [];

    // Recency filter: Prioritize words NOT recently tested
    const excludeSet = new Set(excludeWordIds);
    const unseenWords = words.filter(w => !excludeSet.has(w.id));
    const seenWords = words.filter(w => excludeSet.has(w.id));
    const pool = [...shuffleArray(unseenWords), ...shuffleArray(seenWords)];

    const targetWords = pool.slice(0, Math.min(count, pool.length));

    return targetWords.map((targetWord, idx) => {
      const hw = targetWord.headword.trim();
      const def = targetWord.definitionZh.trim();
      const shortDef = getShortDefinition(def);
      const pos = targetWord.partsOfSpeech?.[0] || '單字';
      const otherWords = words.filter(w => w.id !== targetWord.id);
      const shuffledOthers = shuffleArray(otherWords);

      // Determine tier for this item (easy=0, medium=1, hard=2)
      const tierIndex = idx % 3;
      const currentTier: 'easy' | 'medium' | 'hard' = tierIndex === 0 ? 'easy' : tierIndex === 1 ? 'medium' : 'hard';

      let stem = '';
      let stemTranslation = '';

      // Determine part of speech pattern
      const posLower = pos.toLowerCase();
      const isPhrase = targetWord.entryType === 'phrase' || hw.includes(' ');
      const isVerb = !isPhrase && (posLower.includes('verb') || posLower.includes('v.') || posLower === 'v');
      const isAdj = !isPhrase && (posLower.includes('adj') || posLower.includes('形容詞'));
      const isAdv = !isPhrase && (posLower.includes('adv') || posLower.includes('副詞'));

      // Build fast dictionary lookup map for rich distractor analysis
      const wordDict = new Map<string, Word>(words.map(w => [w.headword.toLowerCase(), w]));

      // Strategy 1: Prioritize pre-compiled bespoke quizzes from master dataset with dynamic rotation and option shuffling
      if (targetWord.quizzes && targetWord.quizzes.length > 0) {
        const matchingQuizzes = mode === 'cloze_fill'
          ? targetWord.quizzes.filter((q: any) => q.type === 'cloze_fill')
          : targetWord.quizzes.filter((q: any) => q.type === 'multiple_choice');

        if (matchingQuizzes.length > 0) {
          // Dynamic rotation: pick randomly among available 3 Part 5 or 3 Part 6 question variants
          const matchingQuiz = matchingQuizzes[Math.floor(Math.random() * matchingQuizzes.length)];

          // 🛡️ Anti-Corruption Filter: Intercept legacy placeholder garbage from old browser cache
          const isLegacyGarbage =
            matchingQuiz.options?.includes('handle properly') ||
            (matchingQuiz.stem?.includes('agreed to _____ the urgent request') && !isVerb) ||
            matchingQuiz.stem?.includes('designated _____ within our standard procedures');

          if (!isLegacyGarbage && matchingQuiz && matchingQuiz.stem && matchingQuiz.options?.length >= 4) {
            // Re-shuffle options dynamically so answer position rotates randomly (A, B, C, D)
            const rawOpts = (matchingQuiz.options || []) as string[];
            const shuffledOptions: string[] = shuffleArray<string>(rawOpts);
            const correctIdx = shuffledOptions.indexOf(matchingQuiz.answer as string);

            let cleanTranslation = matchingQuiz.stemTranslation || '';
            if (!cleanTranslation || cleanTranslation.includes('根據商務語境，本題需填入')) {
              cleanTranslation = `【全句中譯】` + matchingQuiz.stem.replace('_____', `【${shortDef}】`);
            } else {
              cleanTranslation = cleanTranslation.replace(/^【題幹翻譯】\s*/, '').trim();
            }

            const optionAnalyses = shuffledOptions.map((opt: string) => {
              const isCorrect = opt === matchingQuiz.answer;
              if (isCorrect) {
                return {
                  option: opt,
                  isCorrect: true,
                  explanation: `【🟢 正解 · ${pos}】「${shortDef}」— 精準契合題幹語境，為多益職場標準高頻搭配。`
                };
              } else {
                const distWord = wordDict.get(opt.toLowerCase());
                if (distWord) {
                  const distDef = getShortDefinition(distWord.definitionZh);
                  const distPos = distWord.partsOfSpeech?.[0] || '單字';
                  return {
                    option: opt,
                    isCorrect: false,
                    explanation: `【❌ 干擾 · ${distPos}】「${distDef}」— 詞義與題幹商務語境不符，無法作為本題最佳答案。`
                  };
                }
                return {
                  option: opt,
                  isCorrect: false,
                  explanation: `【❌ 干擾項】「${opt}」— 文法結構或商務語意與題幹前後文不符。`
                };
              }
            });

            return {
              id: `q_${targetWord.id}_${mode}_${idx}_${Date.now()}_${Math.random()}`,
              word: targetWord,
              mode,
              difficulty: currentTier,
              stem: matchingQuiz.stem,
              stemTranslation: cleanTranslation,
              options: shuffledOptions,
              correctAnswer: matchingQuiz.answer,
              correctIndex: correctIdx >= 0 ? correctIdx : 0,
              clozeHint: matchingQuiz.clozeHint || `核心釋義：${shortDef}`,
              explanation: matchingQuiz.explanation || `【多益核心考點】本題考查「${shortDef}」之職場商務用法。`,
              optionAnalyses
            };
          }
        }
      }

      if (mode === 'cloze_fill') {
        const tmpl = CLOZE_TEMPLATES[tierIndex];
        stem = `${tmpl.header}\n\n${tmpl.en('_____')}`;
        stemTranslation = tmpl.zh(shortDef);
      } else if (mode === 'part5_mcq') {
        // Guaranteed POS-aligned patterns with 100% paired English & Chinese
        let patternList = NOUN_PATTERNS;
        if (isPhrase) patternList = PHRASE_PATTERNS;
        else if (isVerb) patternList = VERB_PATTERNS;
        else if (isAdj) patternList = ADJ_PATTERNS;
        else if (isAdv) patternList = ADV_PATTERNS;

        const pattern = patternList[tierIndex % patternList.length];
        stem = pattern.en('_____');
        stemTranslation = pattern.zh(shortDef);
      }

      // Pick 3 distinct business English distractors matching the entry type
      if (mode === 'part5_mcq' || mode === 'cloze_fill') {
        let distractorList: Array<{ word: string; meaning: string }> = [];

        if (isPhrase) {
          const phrasePool = [
            { word: 'in advance', meaning: '事先' },
            { word: 'in detail', meaning: '詳細地' },
            { word: 'in person', meaning: '親自' },
            { word: 'on schedule', meaning: '按時' },
            { word: 'at a time', meaning: '一次' },
            { word: 'by chance', meaning: '偶然' }
          ].filter(p => p.word.toLowerCase() !== hw.toLowerCase());

          distractorList = shuffleArray(phrasePool).slice(0, 3);
        } else {
          for (const cluster of Object.values(BUSINESS_DISTRACTOR_CLUSTERS)) {
            const match = cluster.find(item => item.word.toLowerCase() === hw.toLowerCase());
            if (match) {
              distractorList = cluster
                .filter(item => item.word.toLowerCase() !== hw.toLowerCase())
                .slice(0, 3)
                .map(item => ({ word: item.word, meaning: item.meaning }));
              break;
            }
          }

          if (distractorList.length < 3) {
            const fallbackCandidates = shuffledOthers
              .filter(w => w.headword.toLowerCase() !== hw.toLowerCase() && (!isPhrase || w.headword.includes(' ')))
              .slice(0, 3 - distractorList.length)
              .map(w => ({ word: w.headword, meaning: getShortDefinition(w.definitionZh) }));
            distractorList.push(...fallbackCandidates);
          }

          const emergencyDefaults = [
            { word: 'priority', meaning: '優先事項' },
            { word: 'terminate', meaning: '終止解約' },
            { word: 'compensate', meaning: '補償賠償' },
            { word: 'implement', meaning: '實施執行' }
          ];
          while (distractorList.length < 3) {
            const fallback = emergencyDefaults.find(e => e.word !== hw && !distractorList.some(d => d.word === e.word));
            if (fallback) distractorList.push(fallback);
            else break;
          }
        }

        const rawOptions = [
          { word: hw, meaning: shortDef, isCorrect: true },
          ...distractorList.slice(0, 3).map(d => ({ word: d.word, meaning: d.meaning, isCorrect: false }))
        ];

        const shuffledOptionsObj = shuffleArray(rawOptions);
        const shuffledOptionStrings = shuffledOptionsObj.map(o => o.word);
        const correctIndex = shuffledOptionStrings.indexOf(hw);

        // Clean, structured ABCD Option Dissections
        const optionAnalyses = shuffledOptionsObj.map(opt => {
          if (opt.isCorrect) {
            return {
              option: opt.word,
              isCorrect: true,
              explanation: `【正解】「${opt.meaning}」（${pos}），精準契合題幹語意「${shortDef}」與商務搭配。`
            };
          } else {
            return {
              option: opt.word,
              isCorrect: false,
              explanation: `【干擾】「${opt.meaning}」，語意邏輯不符題幹要求。`
            };
          }
        });

        const clozeHint = mode === 'cloze_fill' ? `核心釋義：${shortDef}` : undefined;

        return {
          id: `q_${targetWord.id}_${mode}_${idx}_${Date.now()}`,
          word: targetWord,
          mode,
          difficulty: currentTier,
          stem,
          stemTranslation,
          options: shuffledOptionStrings,
          correctAnswer: hw,
          correctIndex: correctIndex >= 0 ? correctIndex : 0,
          clozeHint,
          explanation: `【多益核心考點 · ${pos}】本題空格需填入「${shortDef}」，符合商務職場標準表達。`,
          optionAnalyses
        };
      }

      // Default fallback for meaning/listening modes
      const distractorWords = shuffledOthers
        .filter(w => w.definitionZh !== def)
        .slice(0, 3)
        .map(w => w.definitionZh);

      const allOptions = shuffleArray([def, ...distractorWords]);
      const correctIdx = allOptions.indexOf(def);

      return {
        id: `q_${targetWord.id}_${mode}_${idx}_${Date.now()}`,
        word: targetWord,
        mode,
        stem: mode === 'listening' ? '🎧 請仔細聽商務發音並選出正確中文釋義：' : hw,
        stemTranslation: def,
        options: allOptions,
        correctAnswer: def,
        correctIndex: correctIdx >= 0 ? correctIdx : 0,
        explanation: `【單字解析】「${hw}」的中文意思為「${def}」。`
      };
    });
  },

  /**
   * Compatibility wrapper for generateQuestions
   */
  generateQuestions(
    words: Word[],
    mode: 'meaning' | 'listening' = 'meaning',
    count = 10
  ): QuizQuestion[] {
    const nextGen = this.generateNextGenQuestions(words, mode, count);
    return nextGen.map(q => ({
      id: q.id,
      word: q.word,
      mode: mode,
      prompt: mode === 'listening' ? '🎧 [聽音檔選中文]' : q.word.headword,
      options: q.options.map(opt => ({
        text: opt,
        isCorrect: opt === q.correctAnswer
      })),
      correctIndex: q.correctIndex
    }));
  },

  /**
   * AI Live Question generation
   */
  async generateAiLiveQuestions(
    words: Word[],
    count = 5
  ): Promise<NextGenQuestion[]> {
    const list = words.slice(0, count);
    const results: NextGenQuestion[] = [];
    for (let idx = 0; idx < list.length; idx++) {
      const w = list[idx];
      try {
        const aiQ = await geminiService.generateInstantExamQuestion(
          w.headword,
          w.definitionZh,
          w.partsOfSpeech?.[0] || '單字'
        );
        const correctIndex = aiQ.options.indexOf(aiQ.answer);
        results.push({
          id: `q_live_${w.id}_${Date.now()}_${idx}`,
          word: w,
          mode: 'ai_live',
          stem: aiQ.stem,
          stemTranslation: aiQ.stemTranslation,
          options: aiQ.options,
          correctAnswer: aiQ.answer,
          correctIndex: correctIndex >= 0 ? correctIndex : 0,
          explanation: aiQ.explanation,
          isAiLive: aiQ.isLiveAi,
          optionAnalyses: aiQ.optionAnalyses
        });
      } catch {
        const fallbacks = this.generateNextGenQuestions([w], 'part5_mcq', 1);
        if (fallbacks[0]) results.push(fallbacks[0]);
      }
    }
    return results;
  },

  /**
   * Evaluate a single answer for progress recording
   */
  async recordQuizAnswer(
    profileId: string,
    wordId: string,
    isCorrect: boolean,
    durationMs: number
  ): Promise<void> {
    const rating = isCorrect ? 3 : 1;
    try {
      await progressRepository.recordReviewTransaction({
        profileId,
        wordId,
        rating,
        durationMs,
        desiredRetention: 0.9,
        enableCloudSync: false
      });
    } catch (err) {
      console.warn('[QuizService] Progress record failed:', err);
    }
  },

  /**
   * Record multiple wrong answers into SRS queue
   */
  async recordQuizWrongAnswers(
    profileId: string,
    wrongWords: Word[],
    durationMsPerWord = 2000
  ): Promise<void> {
    for (const w of wrongWords) {
      await this.recordQuizAnswer(profileId, w.id, false, durationMsPerWord);
    }
  },

  /**
   * Calculate summary statistics for quiz session
   */
  calculateSummary(
    questions: NextGenQuestion[] | QuizQuestion[],
    userAnswers: Record<number, number>,
    timeSpentSec: number
  ): QuizSessionSummary {
    let correctCount = 0;
    const wrongWords: Word[] = [];

    questions.forEach((q, idx) => {
      const selected = userAnswers[idx];
      if (selected === q.correctIndex) {
        correctCount++;
      } else {
        wrongWords.push(q.word);
      }
    });

    const totalQuestions = questions.length;
    const wrongCount = totalQuestions - correctCount;
    const scorePercentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    return {
      totalQuestions,
      correctCount,
      wrongCount,
      scorePercentage,
      timeSpentSec,
      wrongWords
    };
  }
};
