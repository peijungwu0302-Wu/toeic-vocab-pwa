import { Word, QuizItem } from '../types/db';
import { QuizMode, QuizQuestion, QuizSessionSummary } from '../types/quiz';
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

export interface NextGenQuestion {
  id: string;
  word: Word;
  mode: NextGenQuizMode;
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

// Curated high-frequency distractor clusters by semantic domain
const BUSINESS_DISTRACTOR_CLUSTERS: Record<string, Array<{ word: string; pos: string; meaning: string }>> = {
  '優勢策略': [
    { word: 'advantage', pos: 'n.', meaning: '優勢' },
    { word: 'priority', pos: 'n.', meaning: '優先事項' },
    { word: 'incentive', pos: 'n.', meaning: '獎勵措施' },
    { word: 'preference', pos: 'n.', meaning: '偏好' },
    { word: 'strategy', pos: 'n.', meaning: '戰略方針' },
    { word: 'initiative', pos: 'n.', meaning: '新措施' }
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
   * Next-Gen Question Generator: Dynamic real-sentence cloze & ABCD Deep Dissection
   */
  generateNextGenQuestions(
    words: Word[],
    mode: NextGenQuizMode = 'part5_mcq',
    count = 10
  ): NextGenQuestion[] {
    if (words.length === 0) return [];

    const pool = shuffleArray(words);
    const targetWords = pool.slice(0, Math.min(count, pool.length));

    return targetWords.map((targetWord, idx) => {
      const hw = targetWord.headword;
      const def = targetWord.definitionZh;
      const pos = targetWord.partsOfSpeech?.[0] || '單字';
      const otherWords = words.filter(w => w.id !== targetWord.id);
      const shuffledOthers = shuffleArray(otherWords);

      // Mode: Part 5 MCQ / Cloze Fill
      if (mode === 'part5_mcq' || mode === 'cloze_fill') {
        const exampleObj = targetWord.examples?.[0];
        const rawExample =
          exampleObj?.en ||
          exampleObj?.english ||
          `The board of directors agreed to _____ the proposal to strengthen international operations.`;

        const stemTranslation =
          exampleObj?.zh ||
          exampleObj?.chinese ||
          `董事會同意${def}該提案，以強化跨國營運。`;

        // Blank out the headword or word family form
        const regex = new RegExp(`\\b${hw}\\w*`, 'gi');
        const stem = rawExample.replace(regex, '_____');

        // Pick 3 distinct business English distractors
        let distractorList: Array<{ word: string; meaning: string }> = [];

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
            .filter(w => w.headword.toLowerCase() !== hw.toLowerCase())
            .slice(0, 3 - distractorList.length)
            .map(w => ({ word: w.headword, meaning: w.definitionZh }));
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

        const rawOptions = [
          { word: hw, meaning: def, isCorrect: true },
          ...distractorList.slice(0, 3).map(d => ({ word: d.word, meaning: d.meaning, isCorrect: false }))
        ];

        const shuffledOptionsObj = shuffleArray(rawOptions);
        const shuffledOptionStrings = shuffledOptionsObj.map(o => o.word);
        const correctIndex = shuffledOptionStrings.indexOf(hw);

        // Concise, non-redundant ABCD Option Dissections
        const optionAnalyses = shuffledOptionsObj.map(opt => {
          if (opt.isCorrect) {
            return {
              option: opt.word,
              isCorrect: true,
              explanation: `【正解】「${opt.meaning}」（${pos}），精準契合題意與主受詞商務搭配。`
            };
          } else {
            return {
              option: opt.word,
              isCorrect: false,
              explanation: `【干擾】「${opt.meaning}」，語意與空格後方搭配邏輯不符。`
            };
          }
        });

        const clozeHint = mode === 'cloze_fill' ? `核心題意：${def}` : undefined;

        return {
          id: `q_${targetWord.id}_${mode}_${idx}`,
          word: targetWord,
          mode,
          stem,
          stemTranslation,
          options: shuffledOptionStrings,
          correctAnswer: hw,
          correctIndex: correctIndex >= 0 ? correctIndex : 0,
          clozeHint,
          explanation: `🎯 破題關鍵：本題考查「${hw}（${def}）」的精確詞義，空格前後為典型商務搭配。`,
          optionAnalyses
        };
      }

      // Mode: Listening / Meaning
      const distractors = shuffledOthers.slice(0, 3).map(w => w.definitionZh);
      while (distractors.length < 3) distractors.push('（其他商務選項）');
      const rawOptions = [def, ...distractors.slice(0, 3)];
      const shuffledOptions = shuffleArray(rawOptions);
      const correctIndex = shuffledOptions.indexOf(def);

      return {
        id: `q_${targetWord.id}_${mode}_${idx}`,
        word: targetWord,
        mode,
        stem: mode === 'listening' ? '🔊 點擊按鈕聽取音檔並選出正確繁中釋義' : hw,
        stemTranslation: mode === 'listening' ? `目標單字：${hw}（${def}）` : `詞性：${pos} · 核心釋義：${def}`,
        options: shuffledOptions,
        correctAnswer: def,
        correctIndex: correctIndex >= 0 ? correctIndex : 0,
        explanation: `🎯 考點解析：「${hw}」繁中釋義為「${def}」（${pos}）。`
      };
    });
  },

  /**
   * 🤖 Generate 100% Live AI TOEIC Questions via Gemini 3.6-Flash
   */
  async generateAiLiveQuestions(words: Word[], count = 5): Promise<NextGenQuestion[]> {
    const targetWords = shuffleArray(words).slice(0, count);
    const questions: NextGenQuestion[] = [];

    for (let i = 0; i < targetWords.length; i++) {
      const word = targetWords[i];
      try {
        const aiItem = await geminiService.generateInstantExamQuestion(word.headword, word.definitionZh);
        const correctIdx = aiItem.options.indexOf(aiItem.answer);

        questions.push({
          id: `q_ai_${word.id}_${i}`,
          word,
          mode: 'ai_live',
          stem: aiItem.stem,
          stemTranslation: `【AI 題幹中譯】根據語境，此處需填入符合「${word.definitionZh}」之動詞/名詞。`,
          options: aiItem.options,
          correctAnswer: aiItem.answer,
          correctIndex: correctIdx >= 0 ? correctIdx : 0,
          explanation: aiItem.explanation,
          isAiLive: true,
          optionAnalyses: aiItem.optionAnalyses
        });
      } catch {
        // Fallback to local high-yield question if offline
        const fallback = this.generateNextGenQuestions([word], 'part5_mcq', 1)[0];
        if (fallback) questions.push(fallback);
      }
    }

    return questions;
  },

  /**
   * Legacy format adapter for existing components
   */
  generateQuestions(words: Word[], mode: QuizMode = 'meaning', count = 10): QuizQuestion[] {
    if (words.length === 0) return [];

    const pool = shuffleArray(words);
    const targetWords = pool.slice(0, Math.min(count, pool.length));

    return targetWords.map((targetWord, idx) => {
      const correctDefinition = targetWord.definitionZh;
      const otherWords = words.filter(w => w.id !== targetWord.id);
      const shuffledOthers = shuffleArray(otherWords);
      const distractors = shuffledOthers.slice(0, 3).map(w => w.definitionZh);

      while (distractors.length < 3) {
        distractors.push(`（其他商務選項 ${distractors.length + 1}）`);
      }

      const rawOptions = [
        { text: correctDefinition, isCorrect: true },
        { text: distractors[0], isCorrect: false },
        { text: distractors[1], isCorrect: false },
        { text: distractors[2], isCorrect: false }
      ];

      const shuffledOptions = shuffleArray(rawOptions);
      const correctIndex = shuffledOptions.findIndex(o => o.isCorrect);

      return {
        id: `q_${targetWord.id}_${idx}`,
        word: targetWord,
        mode,
        prompt: mode === 'listening' ? '🔊 點擊按鈕聽音檔選出中文' : targetWord.headword,
        options: shuffledOptions,
        correctIndex
      };
    });
  },

  async recordQuizWrongAnswers(profileId: string, wrongWords: Word[]): Promise<void> {
    for (const word of wrongWords) {
      try {
        await progressRepository.recordReviewTransaction({
          profileId,
          wordId: word.id,
          rating: 1, // Again
          durationMs: 3000
        });
      } catch (err) {
        console.warn('[QuizService] Failed to record lapse for word:', word.id, err);
      }
    }
  },

  calculateSummary(
    questions: Array<{ correctIndex: number; word: Word }>,
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

    const total = questions.length;
    const scorePercentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    return {
      totalQuestions: total,
      correctCount,
      wrongCount: total - correctCount,
      scorePercentage,
      timeSpentSec,
      wrongWords
    };
  }
};
