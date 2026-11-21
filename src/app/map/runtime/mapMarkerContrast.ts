// Marker fills carry business meaning; adjust only text when a configured fill
// cannot support the preferred foreground (including light comparison colors).
function luminance(hex: string): number | null {
  const match = /^#([\da-f]{6}|[\da-f]{3})$/i.exec(hex);
  if (!match) return null;
  const value = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
  const rgb = [0, 2, 4].map(offset => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}

export function markerTextColor(background: string, preferred = '#ffffff'): string {
  const fill = luminance(background);
  const foreground = luminance(preferred);
  if (fill === null || foreground === null) return preferred;
  const contrast = (value: number) => (Math.max(fill, value) + .05) / (Math.min(fill, value) + .05);
  if (contrast(foreground) >= 4.5) return preferred;
  if (contrast(luminance('#172033')!) >= 4.5) return '#172033';
  return contrast(0) > contrast(1) ? '#000000' : '#ffffff';
}
