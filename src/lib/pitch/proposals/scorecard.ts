/** Relative comparison within a complete, common candidate sample. */
export const SCORE_CRITERIA = {
  netEffectiveRent: 'lower',
  vacancyRate: 'higher',
  transitWalkingMinutes: 'lower',
} as const;

export type ScoreCriterion = keyof typeof SCORE_CRITERIA;
export type ScoreWeights = Partial<Record<ScoreCriterion, number>>;
export type ScoringCandidate = {
  buildingId: string;
  values: Partial<Record<ScoreCriterion, number | null>>;
};

export interface ScoreRow {
  buildingId: string;
  score: number | null;
  missingCriteria: ScoreCriterion[];
}

export function scoreShortlist(candidates: readonly ScoringCandidate[], weights: ScoreWeights): ScoreRow[] {
  const criteria = Object.entries(weights).map(([id, weight]) => {
    if (!Object.hasOwn(SCORE_CRITERIA, id) || typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 100) {
      throw new Error('Each scoring weight must be between 0 and 100 for a supported criterion.');
    }
    return { id: id as ScoreCriterion, weight };
  }).filter(({ weight }) => weight > 0);
  const totalWeight = criteria.reduce((sum, { weight }) => sum + weight, 0);
  if (!totalWeight) throw new Error('Select at least one criterion with a positive weight.');

  const eligibility = candidates.map(candidate => ({
    candidate,
    missingCriteria: criteria.filter(({ id }) => {
      const value = candidate.values[id];
      return value == null || !Number.isFinite(value) || value < 0 || (id === 'vacancyRate' && value > 1);
    }).map(({ id }) => id),
  }));
  const complete = eligibility.filter(({ missingCriteria }) => !missingCriteria.length);
  const ranges = criteria.map(({ id, weight }) => {
    const values = complete.map(({ candidate }) => candidate.values[id]!);
    return { id, weight, min: Math.min(...values), max: Math.max(...values) };
  });
  return eligibility.map(({ candidate, missingCriteria }) => ({
    buildingId: candidate.buildingId,
    missingCriteria,
    score: missingCriteria.length || complete.length < 2 ? null : ranges.reduce((sum, { id, weight, min, max }) => {
      const value = candidate.values[id]!;
      const position = max === min ? 0.5 : SCORE_CRITERIA[id] === 'lower'
        ? (max - value) / (max - min) : (value - min) / (max - min);
      return sum + (100 * weight * position) / totalWeight;
    }, 0),
  }));
}
