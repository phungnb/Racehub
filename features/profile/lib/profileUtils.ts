export function formatDistance(meters: number): string {
  return (meters / 1000).toFixed(1) + ' KM';
}
