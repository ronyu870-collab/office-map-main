/** Enable candidate visuals only when the URL explicitly requests the experiment. */
export function isEditorialVisualPreview(url: string): boolean {
  return new URL(url, 'https://preview.local').searchParams.get('visual') === 'editorial';
}
