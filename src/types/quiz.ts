import { z } from 'zod';
import { Word } from './db';
import { FrequencyTier } from './vocab';

export type QuizMode = 'meaning' | 'listening';

export type QuizType = 'multiple_choice' | 'cloze_fill';

export type QuizSubType =
  | 'vocab_choice'
  | 'grammar_form'
  | 'synonym_context'
  | 'collocation_cloze'
  | 'active_recall'
  | 'sentence_complete';

export interface OptionAnalysis {
  option: string;
  isCorrect: boolean;
  explanation: string;
}

export interface QuizItem {
  id: string;
  wordId: string;
  type: QuizType;
  subType?: QuizSubType;
  stem: string;
  options: string[];
  answer: string;
  clozeHint?: string;
  explanation: string;
  optionAnalyses?: OptionAnalysis[];
  frequencyTier?: FrequencyTier;
}

export const QuizItemSchema = z.object({
  id: z.string(),
  wordId: z.string(),
  type: z.enum(['multiple_choice', 'cloze_fill']),
  subType: z
    .enum([
      'vocab_choice',
      'grammar_form',
      'synonym_context',
      'collocation_cloze',
      'active_recall',
      'sentence_complete'
    ])
    .optional(),
  stem: z.string(),
  options: z.array(z.string()),
  answer: z.string(),
  clozeHint: z.string().optional(),
  explanation: z.string(),
  frequencyTier: z.enum(['core_1200', 'advanced_2500', 'expert_high']).optional()
});

export interface QuizOption {
  text: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  id: string;
  word: Word;
  mode: QuizMode;
  prompt: string; // Headword or '[聽力播放]'
  options: QuizOption[];
  correctIndex: number;
}

export interface QuizSessionSummary {
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  scorePercentage: number;
  timeSpentSec: number;
  wrongWords: Word[];
}

