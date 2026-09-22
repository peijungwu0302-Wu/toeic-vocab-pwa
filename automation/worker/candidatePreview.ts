import { resolveControlledCandidate } from './candidateResolver';

const index = process.argv.indexOf('--word-id');
const wordId = index >= 0 ? process.argv[index + 1] : undefined;

if (!wordId) {
  console.error('[Phase2B] CANDIDATE_PREVIEW_FAILED --word-id is required');
  process.exitCode = 1;
} else {
  resolveControlledCandidate(wordId)
    .then((candidate) => console.log(JSON.stringify(candidate, null, 2)))
    .catch((error) => { console.error(`[Phase2B] CANDIDATE_PREVIEW_FAILED ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
}

