export type MarkerTierVisibility = {
  submarket: boolean;
  dot: boolean;
  detail: boolean;
  names: boolean;
};

export function visibilityForTier(tier: 'submarket' | 'dot' | 'building', showNames: boolean): MarkerTierVisibility {
  if (tier === 'submarket') {
    return { submarket: true, dot: false, detail: false, names: false };
  }
  if (tier === 'dot') {
    return { submarket: false, dot: true, detail: false, names: false };
  }
  return { submarket: false, dot: false, detail: true, names: showNames };
}
