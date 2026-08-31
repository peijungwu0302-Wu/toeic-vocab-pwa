import { Word } from '../types/db';
import { QuizMode, QuizQuestion, QuizSessionSummary } from '../types/quiz';
import { progressRepository } from '../repositories/progressRepository';

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export const quizService = {
  generateQuestions(words: Word[], mode: QuizMode = 'meaning', count = 10): QuizQuestion[] {
    if (words.length === 0) return [];

    const pool = shuffleArray(words);
    const targetWords = pool.slice(0, Math.min(count, pool.length));

    return targetWords.map((targetWord, idx) => {
      // 1 correct definition
      const correctDefinition = targetWord.definitionZh;

      // 3 distractors from other words in pool
      const otherWords = words.filter(w => w.id !== targetWord.id);
      const shuffledOthers = shuffleArray(otherWords);
      const distractors = shuffledOthers.slice(0, 3).map(w => w.definitionZh);

      // In case pool is smaller than 4 words, add dummy fallback options
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
    questions: QuizQuestion[],
    userAnswers: Record<number, number>, // questionIndex -> selectedOptionIndex
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
