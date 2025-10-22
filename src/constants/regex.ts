import { re } from 're-template-tag';

/**
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec#return_value
 * Returned returned by `matchAll` method
 **/
type MakeRgexMatches<T extends Record<string, string>> = (Omit<RegExpMatchArray, 'groups'> & {
  groups: T;
})[];

// General regex parts

const ankiIdTag = /(?<id>\^\d{13})/;
// https://help.obsidian.md/tags
// Let's say we won't give nested tags any special handling here
const tags = /(?<tags>(?:#[\w\d_\\/\\-]+ *)+)/;
// Lazily matches multiple lines
const multilineContent = /(?<content>[\s\S]+?)/;
// heading ends when tag or newline starts
const headingLevel = /(?<headingLevel>#{1,6})/;
const headingLevelOrInline = /(?<headingLevel>#*)/;
const heading = /(?<heading>[^\n#]+)/;

// FlashcardsMultiline

const newLineLookBehind = /(?<=\n|^)/;
// content ends with `\n` & end of line or `\^\d{13}` Anki id tag
const idTagNextLine = re`(?:${ankiIdTag}|(?=\n\n)|$)`;

// FlashcardsCloze

const inlineClozure = /(?:.*?(?<cloze>==(?<clozeContent>.*?)==).*)/;

// FlashcardsInline

const inlineFirst = /(?<inlineFirst>.+?)/;
const inlineSeparator = (longer: string, shorter: string) =>
  re`(?<inlineSeparator>${longer}|${shorter})`;
// match lazily until \n, #, ^
const inlineSecond = /(?<inlineSecond>[^\n#^]+?)/;
const idTagInline = re`(?:${ankiIdTag}$|$)`;

// ---

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace RegExps {
  console.debug('--- start of regex enummeration ---');

  export const andkiIdTags = re`/${ankiIdTag}$/mg`;
  export type AnkiIdTagsMatches = MakeRgexMatches<{ id: string }>;

  // Previous RegExp: https://regex101.com/r/p3yQwY/2
  export const flashscardsMultiline = re`/${headingLevelOrInline}${heading}${tags}\n${multilineContent}${idTagNextLine}/g`;
  export type FlashcardsMultilineMatches = MakeRgexMatches<{
    headingLevel?: string;
    heading: string;
    tags: string;
    content: string;
    id?: string;
  }>;
  console.debug('flashscardsMultiline', flashscardsMultiline);

  // Previous RegExp: https://regex101.com/r/BOieWh/1
  export const Headings = re`/${newLineLookBehind}${headingLevel}${heading}/g`;
  export type HeadingsMatches = MakeRgexMatches<{
    headingLevel: string;
    heading: string;
  }>;

  // Previous RegExp: https://regex101.com/r/cgtnLf/1
  //'( {0,3}[#]{0,6})?(?:(?:[\\t ]*)(?:\\d.|[-+*]|#{1,6}))?(.*?(==.+?==|\\{.+?\\}).*?)((?: *#[\\w\\-\\/_]+)+|$)(?:\n\\^(\\d{13}))?';
  export const clozes = re`/${inlineClozure}${ankiIdTag}/g`;
  export type ClozesMatches = MakeRgexMatches<{
    cloze: string;
    clozeContent?: string;
    id?: string;
  }>;
  console.debug('clozes', clozes);

  type FlashcardsInlineParams = {
    separator: string;
    separatorReverse: string;
  };

  // Previous RegExp: https://regex101.com/r/8wmOo8/1
  export const flashcardsInline = ({
    separator,
    separatorReverse,
  }: FlashcardsInlineParams) => {
    const inlineSepRegExp =
      separator.length >= separatorReverse.length
        ? inlineSeparator(separator, separatorReverse)
        : inlineSeparator(separatorReverse, separator);
    // NOTE: the 'm' flag is required to make ^ and $ work line by line
    return re`/${newLineLookBehind}-\s*${inlineFirst}${inlineSepRegExp}${inlineSecond}${tags}?${idTagInline}/gm`;
  };
  export type FlashcardsInlineMatches = MakeRgexMatches<{
    inlineFirst: string;
    inlineSeparator: string;
    inlineSecond: string;
    tags?: string;
    id?: string;
  }>;

  console.debug(
    'lashcardsInline',
    flashcardsInline({ separator: '::', separatorReverse: '--' }),
  );

  // https://regex101.com/r/HOXF5E/1
  // str =
  //   '( {0,3}[#]*)((?:[^\\n]\\n?)+?)(#' +
  //   settings.flashcardsTag +
  //   '[/-]spaced)((?: *#[\\p{Letter}-]+)*) *\\n?(?:\\^(\\d{13}))?';
  // const cardsSpacedStyle = new RegExp(str, flags);

  // https://regex101.com/r/HOXF5E/1
  // str =
  //   '( {0,3}[#]*)((?:[^\\n]\\n?)+?)(#' +
  //   settings.flashcardsTag +
  //   '[/-]spaced)((?: *#[\\p{Letter}-]+)*) *\\n?(?:\\^(\\d{13}))?';
  // const cardsSpacedStyle = new RegExp(str, flags);

  export const frontMatter = /^---\n([\s\S]*?)---\n/g;

  console.debug('--- end of regex enummeration ---');
}
