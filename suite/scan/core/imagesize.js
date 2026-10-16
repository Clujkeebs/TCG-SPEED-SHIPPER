// Keep pictures small before they are read: a big phone photo uses a lot of memory on an iPad and is slower to read
// without being more accurate. Long side at most MAX_SIDE.
export const MAX_SIDE = 1600;

export function scaleToMax(width, height, max = MAX_SIDE) {
  const long = Math.max(width, height);
  if (long <= max) return { width, height, scale: 1 };
  const scale = max / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}
