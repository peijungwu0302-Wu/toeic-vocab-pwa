export function isAttachExistingMode(args: readonly string[] = process.argv.slice(2)): boolean {
  return args.includes('--attach-existing');
}
