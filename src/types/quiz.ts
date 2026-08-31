import { Word } from './db';

export type QuizMode = 'meaning' | 'listening';

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
