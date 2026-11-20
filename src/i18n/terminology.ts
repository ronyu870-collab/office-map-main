import glossary from './professional-glossary.json';

export type ProfessionalTerm = { domain: string; zh_cn: string; en_us: string };
export const professionalGlossary: readonly ProfessionalTerm[] = glossary;

/** UI copy is deliberately independent of this business glossary. */
export function findProfessionalEnglish(zhCn: string, domain?: string): string | undefined {
  const match = glossary.find((term) => term.zh_cn === zhCn && (!domain || term.domain === domain));
  return match?.en_us;
}
