/**
 * Builds a spelling-tolerant search key for a person's name.
 *
 * Roman Urdu has no fixed spelling, so Muhammad, Mohammed and Mohamad should find each other.
 * The key keeps the consonant skeleton of each Latin word. Words written in Urdu script are kept
 * as they are after removing optional marks.
 * The key starts with a space so a word-prefix search can match on a space followed by the token.
 */

const URDU_SCRIPT = /[؀-ۿ]/;
const COMBINING_MARKS = /[̀-ًͯ-ٰٟ]/g;

const WORD_ALIASES: Readonly<Record<string, string>> = {
  mohd: 'mmd',
  md: 'mmd',
  mhd: 'mmd',
  mohammad: 'mmd',
  muhammad: 'mmd',
  mohammed: 'mmd',
  muhammed: 'mmd',
};

function normalizeUrduWord(word: string): string {
  return word
    .replace(COMBINING_MARKS, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ہۂھ]/g, 'ہ');
}

function latinSkeleton(word: string): string {
  const alias = WORD_ALIASES[word];
  if (alias !== undefined) return alias;

  const collapsed = word
    .replace(/sh/g, 'S')
    .replace(/ch/g, 'C')
    .replace(/kh/g, 'K')
    .replace(/gh/g, 'G')
    .replace(/ph/g, 'f')
    .replace(/q/g, 'k')
    .replace(/c/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/w/g, 'v')
    .replace(/(.)\1+/g, '$1');

  let result = '';
  let previousWasVowel = false;
  for (let index = 0; index < collapsed.length; index += 1) {
    const letter = collapsed.charAt(index);
    const isVowel = 'aeiouy'.includes(letter) && !(index === 0 && letter === 'y');
    if (isVowel) {
      if (index === 0) result += 'a';
      previousWasVowel = true;
      continue;
    }
    // An h after a vowel is silent or only adds breath, as in Mohammad and Fatimah.
    if (letter === 'h' && previousWasVowel) {
      previousWasVowel = false;
      continue;
    }
    previousWasVowel = false;
    result += letter;
  }
  return result;
}

export function nameWords(name: string): string[] {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[’'`.-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

export function wordKey(input: string): string {
  const word = input.normalize('NFKD').toLowerCase();
  if (URDU_SCRIPT.test(word)) return normalizeUrduWord(word);
  const latin = word.replace(COMBINING_MARKS, '').replace(/[^a-z]/g, '');
  return latinSkeleton(latin);
}

export function nameKey(name: string): string {
  const keys = nameWords(name)
    .map(wordKey)
    .filter((key) => key.length > 0);
  return ` ${keys.join(' ')}`;
}
