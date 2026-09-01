#!/usr/bin/env node
/**
 * scripts/manage-image-queue.mjs
 * Image Generation Queue Manager for Core 1,200 High-Frequency Words.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const QUEUE_STATE_FILE = path.join(__dirname, 'image_queue_state.json');
const CORE_1200_FILE = path.join(ROOT_DIR, 'public', 'data', 'v1', 'core-1200.json');

export function initQueueState() {
  const coreData = JSON.parse(fs.readFileSync(CORE_1200_FILE, 'utf8'));
  const allCoreWords = coreData.words.map(w => ({
    id: w.id,
    headword: w.headword,
    partsOfSpeech: w.partsOfSpeech || ['noun'],
    definitionZh: w.definitionZh,
    category: w.category || 'Core'
  }));

  const knownCompleted = [
    { word: 'arm in arm', file: 'arm_in_arm_1788252689563.jpg', completedAt: '2026-09-01T08:51:29Z' },
    { word: 'cleaner', file: 'cleaner_1788252707326.jpg', completedAt: '2026-09-01T08:51:47Z' },
    { word: 'inbox', file: 'email_inbox_1788253218364.jpg', completedAt: '2026-09-01T09:00:18Z' },
    { word: 'at a time', file: 'at_a_time_1788253237445.jpg', completedAt: '2026-09-01T09:00:37Z' },
    { word: 'on schedule', file: 'on_schedule_1788253257675.jpg', completedAt: '2026-09-01T09:00:57Z' },
    { word: 'contract', file: 'contract_signing_1788254483587.jpg', completedAt: '2026-09-01T09:21:23Z' },
    { word: 'boarding', file: 'boarding_gate_1788254499900.jpg', completedAt: '2026-09-01T09:21:39Z' },
    { word: 'warehouse', file: 'warehouse_logistics_1788254515192.jpg', completedAt: '2026-09-01T09:21:55Z' },
    { word: 'presentation', file: 'business_presentation_1788254534156.jpg', completedAt: '2026-09-01T09:22:14Z' },
    { word: 'interview', file: 'job_interview_1788254552793.jpg', completedAt: '2026-09-01T09:22:32Z' },
    { word: 'commute', file: 'commute_transit_1788254678913.jpg', completedAt: '2026-09-01T09:24:38Z' },
    { word: 'brainstorming', file: 'brainstorming_ideas_1788254696120.jpg', completedAt: '2026-09-01T09:24:56Z' },
    { word: 'deadline', file: 'deadline_calendar_1788254713935.jpg', completedAt: '2026-09-01T09:25:13Z' }
  ];

  const completedMap = new Set(knownCompleted.map(k => k.word.toLowerCase()));
  const pendingWords = allCoreWords.filter(w => !completedMap.has(w.headword.toLowerCase()));

  const state = {
    totalTarget: allCoreWords.length,
    completedCount: knownCompleted.length,
    pendingCount: pendingWords.length,
    lastUpdated: new Date().toISOString(),
    completed: knownCompleted,
    pending: pendingWords
  };

  fs.writeFileSync(QUEUE_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  console.log('✅ Image Queue State Initialized: ' + state.completedCount + ' completed, ' + state.pendingCount + ' pending.');
  return state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initQueueState();
}
