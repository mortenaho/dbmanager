/** Match a Latin letter by physical key so shortcuts work on Persian and other layouts. */
export function isLetterKey(
  event: Pick<KeyboardEvent, "code" | "key">,
  letter: string,
): boolean {
  const upper = letter.toUpperCase();
  if (event.code === `Key${upper}`) return true;
  return event.key.length === 1 && event.key.toLowerCase() === letter.toLowerCase();
}

export function hasPrimaryMod(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): boolean {
  return event.ctrlKey || event.metaKey;
}
