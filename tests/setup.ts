import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Mock Web Speech API
if (typeof window !== 'undefined') {
  window.speechSynthesis = {
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn().mockReturnValue([
      { name: 'Alex', lang: 'en-US', default: true } as SpeechSynthesisVoice,
      { name: 'Daniel', lang: 'en-GB', default: false } as SpeechSynthesisVoice
    ]),
    onvoiceschanged: null,
    pending: false,
    speaking: false,
    paused: false
  } as unknown as SpeechSynthesis;

  // Mock AudioContext
  window.AudioContext = vi.fn().mockImplementation(() => ({
    state: 'running',
    createBuffer: vi.fn().mockReturnValue({}),
    createBufferSource: vi.fn().mockReturnValue({
      buffer: null,
      connect: vi.fn(),
      start: vi.fn()
    }),
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined)
  })) as unknown as typeof AudioContext;

  // Mock navigator.storage
  Object.defineProperty(navigator, 'storage', {
    value: {
      estimate: vi.fn().mockResolvedValue({ usage: 1024 * 1024 * 5, quota: 1024 * 1024 * 1000 }),
      persist: vi.fn().mockResolvedValue(true),
      persisted: vi.fn().mockResolvedValue(true)
    },
    writable: true
  });
}
