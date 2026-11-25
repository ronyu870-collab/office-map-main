/** Shared Office engine, dynamically loaded by authorized export paths only.
 * Domain content, brand themes and layout remain the caller's responsibility. */
export async function createOfficePresentation(input: { author: string; title: string; subject: string; font: string }) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE'; deck.author = input.author; deck.title = input.title; deck.subject = input.subject;
  deck.theme = { headFontFace: input.font, bodyFontFace: input.font };
  return deck;
}
