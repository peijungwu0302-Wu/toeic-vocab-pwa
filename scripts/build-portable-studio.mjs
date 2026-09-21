// Retired: the old generator template predates R2 publishing and manual-workflow safety fixes.
// Portable Studio behavior has one authoritative source: public/portable_studio.html.
console.error('Legacy Portable Studio builder is retired. Use python scripts/sync_portable_dataset.py to refresh data, then npm run build.');
process.exitCode = 1;
