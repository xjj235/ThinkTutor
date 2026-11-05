export interface EvidenceQuotes {
  quotes: string[];
  valid: boolean;
}

const closingQuotes = new Map([["“", "”"], ["「", "」"], ['"', '"']]);
const directionalClosers = new Set(["”", "」"]);

/** Extract whole outer quotations, retaining nested punctuation verbatim. */
export function parseEvidenceQuotes(text: string): EvidenceQuotes {
  const quotes: string[] = [];
  const expectedClosers: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (expectedClosers.length && character === expectedClosers.at(-1)) {
      expectedClosers.pop();
      if (!expectedClosers.length) {
        const quote = text.slice(start + 1, index);
        if (!quote.length || quote.length > 600 || /[\r\n]/u.test(quote)) return { quotes: [], valid: false };
        quotes.push(quote);
      }
      continue;
    }
    const closer = closingQuotes.get(character);
    if (closer) {
      if (!expectedClosers.length) start = index;
      expectedClosers.push(closer);
    } else if (directionalClosers.has(character)) {
      return { quotes: [], valid: false };
    }
  }
  return expectedClosers.length ? { quotes: [], valid: false } : { quotes, valid: true };
}
