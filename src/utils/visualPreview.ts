/** Enable candidate visuals only when the URL explicitly requests the experiment. */
export function isEditorialVisualPreview(search: string): boolean {
  return new URLSearchParams(search).get('visual') === 'editorial';
}
