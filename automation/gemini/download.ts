export function isCompletedDownloadState(state: string): boolean {
  return state === 'completed';
}

export function chooseCompletedDownload(entries: readonly string[]): string {
  if (entries.some((entry) => entry.endsWith('.crdownload'))) {
    throw new Error('Download directory still contains a temporary .crdownload file');
  }
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one completed artifact, found ${entries.length}`);
  }
  return entries[0];
}
