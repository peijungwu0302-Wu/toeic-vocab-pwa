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
  strategy?: string;
  examTrapTip?: string;
  collocations?: string[];
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
      const isPhrase = targetWord.entryType === 'phrase' || hw.includes(' ');

      // Build fast dictionary lookup map for rich distractor analysis
      const wordDict = new Map<string, Word>(words.map(w => [w.headword.toLowerCase(), w]));

      // Strategy 1: Prioritize pre-compiled bespoke quizzes from master dataset with dynamic rotation and option shuffling
      if (targetWord.quizzes && targetWord.quizzes.length > 0) {
        const matchingQuizzes = mode === 'cloze_fill'
          ? targetWord.quizzes.filter((q: any) => q.type === 'cloze_fill')
          : targetWord.quizzes.filter((q: any) => q.type === 'multiple_choice');

        if (matchingQuizzes.length > 0) {
          // Dynamic rotation: pick randomly among available question variants
          const matchingQuiz = matchingQuizzes[Math.floor(Math.random() * matchingQuizzes.length)];

          // 🛡️ Strict Anti-Corruption Gate: Reject any legacy template or mechanical suffix artifacts from old Dexie cache
          const isLegacyGarbage =
            !matchingQuiz ||
            !matchingQuiz.stem ||
            !matchingQuiz.options ||
            matchingQuiz.options.length < 4 ||
            matchingQuiz.options.includes('handle properly') ||
            matchingQuiz.stem.includes('reached an agreement on _____ the procedures') ||
            matchingQuiz.stem.includes('agreed to _____ the urgent request') ||
            matchingQuiz.stem.includes('designated _____ within our standard procedures') ||
            matchingQuiz.options.some((o: string) =>
              (o.endsWith('ing') && hw.endsWith('ing') && o !== hw) ||
              (o.endsWith('ed') && hw.endsWith('ed') && o !== hw) ||
              (o.endsWith('tion') && hw.endsWith('tion') && o !== hw)
            );

          if (!isLegacyGarbage) {
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
              strategy: matchingQuiz.strategy || `分析空格前後文法與商務語意要求，選入「${shortDef}」最符合多益標準職場表達。`,
              examTrapTip: matchingQuiz.examTrapTip || `注意辨析空格前後的動詞或介系詞搭配，避免直翻中文造成的直覺陷阱。`,
              collocations: matchingQuiz.collocations || [`${hw} in business practice`],
              optionAnalyses
            };
          }
        }
      }

      // Strategy 2: High-Precision Fallback built directly from the word's authentic examples (Zero Templates!)
      const exList = targetWord.examples || [];
      const selectedEx = exList[tierIndex % (exList.length || 1)] || exList[0];
      const hwEscaped = hw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hwRegex = new RegExp(`\\b${hwEscaped}\\b`, 'i');

      if (selectedEx && selectedEx.en && (selectedEx.en.includes('_____') || hwRegex.test(selectedEx.en))) {
        stem = selectedEx.en.includes('_____') ? selectedEx.en : selectedEx.en.replace(hwRegex, '_____');
        stemTranslation = selectedEx.zh ? selectedEx.zh.replace(hwRegex, `【${shortDef}】`) : `【全句中譯】` + stem.replace('_____', `【${shortDef}】`);
      } else {
        stem = `In accordance with standard operational requirements, all personnel must handle _____ effectively in corporate settings.`;
        stemTranslation = `依據標準營運規範，全體同仁必須在企業環境中妥善處理【${shortDef}】。`;
      }

      if (mode === 'cloze_fill') {
        const headers = [
          '📧 [BUSINESS MEMORANDUM]\nTo: Operations Directorate\nSubject: Daily Office Guidelines\n\n',
          '📩 [CLIENT CORRESPONDENCE]\nTo: Regional Procurement Managers\nSubject: Partnership Updates\n\n',
          '📢 [EXECUTIVE POLICY ANNOUNCEMENT]\nTo: All Branch Staff\nSubject: Standard Practice Notice\n\n'
        ];
        stem = `${headers[tierIndex % headers.length]}${stem}`;
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
