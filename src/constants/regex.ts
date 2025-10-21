import { re } from 're-template-tag';

/**
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec#return_value
 * Returned returned by `matchAll` method
 **/
type MakeRgexMatchGroups<T extends Record<string, string>> = (Omit<RegExpMatchArray, 'groups'> & {
  groups: T;
})[];

const newLineLookBehind = /(?<=\n|^)/;
const headingLevel = /(?<headingLevel>#{1,6})/;
const headingLevelOrInline = /(?<headingLevel>#*)/;
// heading ends when tags or newline starts
const heading = /(?<heading>[^\n#]+)/;
// https://help.obsidian.md/tags
// Let's say we won't give nested tags any special handling here
const tags = /(?<tags>(?:#[\w\d_\\/\-]+ *)+)/;
// content ends with `\n` & end of line or `\^\d{13}` Anki id tag
const multilineContent = /(?<content>[\s\S]+?)/;
const ankiIdTag = /(?<id>\^\d{13})/;

export const regExpAndkiIdTag = re`/${ankiIdTag}/g`;
export type MatchesAndkiIdTag = MakeRgexMatchGroups<{ id: string }>;

const idTagNextLine = re`(?:${ankiIdTag}|\n\n|$)`;

// Previous RegExp: https://regex101.com/r/BOieWh/1
export const regExpHeadings = re`/${newLineLookBehind}${headingLevel}${heading}/g`;
export type MatchesHeadings = MakeRgexMatchGroups<{
  headingLevel: string;
  heading: string;
}>;

// Previous RegExp: https://regex101.com/r/p3yQwY/2
// FIXME needs + '\n' at the end when used
export const regExpFlashscardsMultiline = re`/${headingLevelOrInline}${heading}${tags}\n${multilineContent}${idTagNextLine}/g`;
export type MatchesFlashcardsMultiline = MakeRgexMatchGroups<{
  headingLevel?: string;
  heading: string;
  tags: string;
  content: string;
  id?: string;
}>;

console.log('regExpFlashscardsMultiline', regExpFlashscardsMultiline);

// Previous RegExp: https://regex101.com/r/cgtnLf/1
//'( {0,3}[#]{0,6})?(?:(?:[\\t ]*)(?:\\d.|[-+*]|#{1,6}))?(.*?(==.+?==|\\{.+?\\}).*?)((?: *#[\\w\\-\\/_]+)+|$)(?:\n\\^(\\d{13}))?';
const clozeClosure = /(?:.*?(?<cloze>==(?<clozeContent>.*?)==).*)/;
export const regExpCloze = re`/${clozeClosure}${ankiIdTag}/g`;
export type MatchesCloze = MakeRgexMatchGroups<{
  cloze: string;
  clozeContent?: string;
  id?: string;
}>;

console.log('regExpCloze', regExpCloze);

const inlineFirst = /(?<inlineFirst>.+?)/;
const inlineSeparator = (longer: string, shorter: string) =>
  re`(?<inlineSeparator>${longer}|${shorter})`;
// match lazily until \n, #, ^
const inlineSecond = /(?<inlineSecond>[^\n#^]+?)/;
const idTagInline = re`(?:${ankiIdTag}$|$)`;

// Previous RegExp: https://regex101.com/r/8wmOo8/1
export const regExpFlashcardInline = ({
  separator,
  separatorReverse,
}: {
  separator: string;
  separatorReverse: string;
}) => {
  const inlineSepRegExp =
    separator.length >= separatorReverse.length
      ? inlineSeparator(separator, separatorReverse)
      : inlineSeparator(separatorReverse, separator);
  // NOTE: the 'm' flag is required to make ^ and $ work line by line
  return re`/${newLineLookBehind}-\s*${inlineFirst}${inlineSepRegExp}${inlineSecond}${tags}?${idTagInline}/gm`;
};
export type MatchesFlashcardsInline = MakeRgexMatchGroups<{
  inlineFirst: string;
  inlineSeparator: string;
  inlineSecond: string;
  tags?: string;
  id?: string;
}>;

console.log(
  'regExpFlashcardInline',
  regExpFlashcardInline({ separator: '::', separatorReverse: '--' }),
);

// https://regex101.com/r/HOXF5E/1
// str =
//   '( {0,3}[#]*)((?:[^\\n]\\n?)+?)(#' +
//   settings.flashcardsTag +
//   '[/-]spaced)((?: *#[\\p{Letter}-]+)*) *\\n?(?:\\^(\\d{13}))?';
// const cardsSpacedStyle = new RegExp(str, flags);

export const regExpFrontMatter = /^---\n([\s\S]*?)---\n/g;
