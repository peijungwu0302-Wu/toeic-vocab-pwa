import { GeminiAdapterError } from './types';

export interface ConversationSnapshot {
  userTurnIds: string[];
  assistantResponseIds: string[];
}

export function chooseFirstAvailableSelector(candidates: readonly string[], available: ReadonlySet<string>): string | null {
  return candidates.find((candidate) => available.has(candidate)) ?? null;
}

export function choosePromptSubmissionAction(sendAvailable: boolean): 'click' | 'enter' {
  return sendAvailable ? 'click' : 'enter';
}

export function bindOwnedAssistantResponse(
  before: ConversationSnapshot,
  after: ConversationSnapshot,
  confirmedUserTurnId: string,
): string {
  if (!after.userTurnIds.includes(confirmedUserTurnId) || before.userTurnIds.includes(confirmedUserTurnId)) {
    throw new GeminiAdapterError('USER_TURN_NOT_CONFIRMED', 'The submitted prompt did not produce a new, identifiable user turn');
  }
  const newResponses = after.assistantResponseIds.filter((id) => !before.assistantResponseIds.includes(id));
  if (newResponses.length === 0) {
    throw new GeminiAdapterError('RESPONSE_NOT_FOUND', 'No new assistant response followed the confirmed user turn');
  }
  if (newResponses.length !== 1) {
    throw new GeminiAdapterError('RESPONSE_OWNERSHIP_UNCERTAIN', 'More than one new assistant response exists after submission');
  }
  return newResponses[0];
}

export const GEMINI_SELECTORS = {
  composer: [
    'textarea[aria-label]',
    '[contenteditable="true"][role="textbox"]',
    'rich-textarea [contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
  ],
  sendButton: [
    'button[aria-label*="Send"]',
    'button[aria-label*="傳送"]',
    'button[aria-label*="送出"]',
  ],
  blockingOverlay: ['.mat-drawer-backdrop.mat-drawer-shown'],
  closeSidebar: [
    'button[aria-label*="Close side"]',
    'button[aria-label*="關閉側欄"]',
  ],
  userTurn: [
    '[data-message-author-role="user"]',
    'user-query',
    '[data-test-id*="user"]',
  ],
  assistantResponse: [
    '[data-message-author-role="assistant"]',
    'model-response',
    '[data-test-id*="assistant"]',
  ],
  officialDownload: [
    'button[aria-label*="Download full"]',
    'button[aria-label*="Download image"]',
    'button[aria-label*="Download original"]',
    'button[aria-label*="下載完整"]',
    'button[aria-label*="下載圖片"]',
    'button[aria-label*="下載原尺寸"]',
  ],
  newChat: [
    'a[aria-label*="New chat"]',
    'button[aria-label*="New chat"]',
    'a[aria-label*="新對話"]',
    'button[aria-label*="新對話"]',
  ],
  activeGeneration: [
    'button[aria-label*="Stop response"]',
    'button[aria-label*="停止回應"]',
    'button[aria-label*="停止生成"]',
    '[aria-busy="true"]',
  ],
  loading: ['[aria-busy="true"]', '.skeleton', 'mat-progress-spinner'],
} as const;

export const HARD_STOP_PATTERNS: ReadonlyArray<[RegExp, 'CAPTCHA_DETECTED' | 'VERIFICATION_REQUIRED' | 'QUOTA_OR_RATE_LIMIT' | 'LOGIN_REQUIRED']> = [
  [/captcha|recaptcha/i, 'CAPTCHA_DETECTED'],
  [/verify it'?s you|驗證.*(?:身分|本人)|確認.*(?:身分|本人)|suspicious activity/i, 'VERIFICATION_REQUIRED'],
  [/rate limit|quota|too many requests|使用額度|速率限制|請稍後再試/i, 'QUOTA_OR_RATE_LIMIT'],
  [/\bsign in\b|登入/i, 'LOGIN_REQUIRED'],
];

export function classifyHardStopText(
  text: string,
): 'CAPTCHA_DETECTED' | 'VERIFICATION_REQUIRED' | 'QUOTA_OR_RATE_LIMIT' | 'LOGIN_REQUIRED' | null {
  return HARD_STOP_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}
