export function shouldSubmitComposerKey(
  key: string,
  shiftKey: boolean,
  isComposing: boolean,
): boolean {
  if (isComposing) return false;
  if (key !== 'Enter') return false;
  return !shiftKey;
}
