import { describe, it, expect } from 'vitest';
import { quizService } from '../src/services/quizService';
import { Word } from '../src/types/db';

describe('Quiz Service Unit Tests', () => {
  const sampleWords: Word[] = [
    {
      id: 'w1',
      headword: 'accommodate',
      normalizedHeadword: 'accommodate',
      entryType: 'word',
      definitionZh: '容納；配合',
      starRating: 4,
      toeicScoreRange: '600-780',
      category: '商務差旅',
      partsOfSpeech: ['verb'],
      wordForms: [],
      phoneticUS: null,
      phoneticUK: null,
      examples: [],
      examTips: [],
      audioUSUrl: null,
      audioUKUrl: null
    },
    {
      id: 'w2',
      headword: 'agenda',
      normalizedHeadword: 'agenda',
      entryType: 'word',
      definitionZh: '議程；待議事項',
      starRating: 5,
      toeicScoreRange: '400-600',
      category: '商務會議',
      partsOfSpeech: ['noun'],
      wordForms: [],
      phoneticUS: null,
      phoneticUK: null,
      examples: [],
      examTips: [],
      audioUSUrl: null,
      audioUKUrl: null
    },
    {
      id: 'w3',
      headword: 'reimburse',
      normalizedHeadword: 'reimburse',
      entryType: 'word',
      definitionZh: '核銷；退款',
      starRating: 4,
      toeicScoreRange: '600-780',
      category: '財務會計',
      partsOfSpeech: ['verb'],
      wordForms: [],
      phoneticUS: null,
      phoneticUK: null,
      examples: [],
      examTips: [],
      audioUSUrl: null,
      audioUKUrl: null
    },
    {
      id: 'w4',
      headword: 'feasibility',
      normalizedHeadword: 'feasibility',
      entryType: 'word',
      definitionZh: '可行性',
      starRating: 4,
      toeicScoreRange: '780-900',
      category: '專案企劃',
      partsOfSpeech: ['noun'],
      wordForms: [],
      phoneticUS: null,
      phoneticUK: null,
      examples: [],
      examTips: [],
      audioUSUrl: null,
      audioUKUrl: null
    }
  ];

  it('generates 4-choice questions with correct option and 3 distractors', () => {
    const questions = quizService.generateQuestions(sampleWords, 'meaning', 2);
    expect(questions).toHaveLength(2);

    for (const q of questions) {
      expect(q.options).toHaveLength(4);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(4);
      expect(q.options[q.correctIndex].text).toBe(q.word.definitionZh);
      expect(q.options[q.correctIndex].isCorrect).toBe(true);
    }
  });

  it('generates listening mode questions with audio prompt', () => {
    const questions = quizService.generateQuestions(sampleWords, 'listening', 1);
    expect(questions).toHaveLength(1);
    expect(questions[0].mode).toBe('listening');
    expect(questions[0].prompt).toContain('聽音檔');
  });

  it('calculates quiz session summary properly', () => {
    const questions = quizService.generateQuestions(sampleWords, 'meaning', 2);
    // User gets question 0 right, question 1 wrong
    const userAnswers: Record<number, number> = {
      0: questions[0].correctIndex,
      1: (questions[1].correctIndex + 1) % 4
    };

    const summary = quizService.calculateSummary(questions, userAnswers, 15);
    expect(summary.totalQuestions).toBe(2);
    expect(summary.correctCount).toBe(1);
    expect(summary.wrongCount).toBe(1);
    expect(summary.scorePercentage).toBe(50);
    expect(summary.wrongWords).toHaveLength(1);
    expect(summary.wrongWords[0].id).toBe(questions[1].word.id);
  });

  it('validates QuizItemSchema for MCQ and Cloze fill items', async () => {
    const { QuizItemSchema } = await import('../src/types/quiz');

    const validMcq = {
      id: 'q_test_1',
      wordId: 'tw_w_1',
      type: 'multiple_choice' as const,
      subType: 'vocab_choice' as const,
      stem: 'The department needs to _____ the final version.',
      options: ['finalize', 'reject', 'delay', 'ignore'],
      answer: 'finalize',
      explanation: '考查商務語意搭配。',
      frequencyTier: 'core_1200' as const
    };

    const validCloze = {
      id: 'q_test_2',
      wordId: 'tw_w_1',
      type: 'cloze_fill' as const,
      subType: 'active_recall' as const,
      stem: 'Please _____ the invoice before sending.',
      options: ['verify', 'cancel', 'dismiss', 'exceed'],
      answer: 'verify',
      clozeHint: '首字母：v... 提示：確認/核對',
      explanation: '主動回憶考點。',
      frequencyTier: 'core_1200' as const
    };

    expect(QuizItemSchema.safeParse(validMcq).success).toBe(true);
    expect(QuizItemSchema.safeParse(validCloze).success).toBe(true);

    const invalidItem = {
      id: 'q_bad',
      wordId: 'tw_w_1',
      type: 'unknown_type' // Invalid enum
    };
    expect(QuizItemSchema.safeParse(invalidItem).success).toBe(false);
  });
});

