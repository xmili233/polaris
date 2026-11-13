export function milliseconds(value: string): number {
  const text = value.trim();
  return parseFloat(text) * (text.endsWith('ms') ? 1 : 1000);
}
export function duration(name: string): number {
  return milliseconds(getComputedStyle(document.documentElement).getPropertyValue(name));
}
export function dimension(name: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
}
