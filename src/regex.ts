import { re } from 're-template-tag';

/**
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec#return_value
 * Returned returned by `matchAll` method
 **/
type MakeRgexMatches<T extends Record<string, string>> = (Omit<RegExpMatchArray, 'groups'> & {
  groups: T;
})[];

// General regex parts

const ankiIdTag = /(?<id>(?<=\s)\^\d{13})/;
// https://help.obsidian.md/tags
// Let's say we won't give nested tags any special handling here
const tags = /(?<tags>(?:#[\w\d_\\/\\-]+ *)+)/;
// Lazily matches multiple lines
const multilineContent = /(?<content>[^]*?)/;
// heading ends when tag or newline starts
const headingLevel = /(?<headingLevel>#{1,6})/;
const headingLevelOrInline = /(?<headingLevel>#*)/;
const heading = /(?<heading>[^\n#]+)/;

// FlashcardsMultiline

const newLineLookBehind = /(?<=\n|^)/;
// content ends with `\n` & end of line or `\^\d{13}` Anki id tag
// or next heading or card separator `%%%%` should also be used as delimiter
const idTagNextLine = re`(?:${ankiIdTag}|(?=\n#+)|(?<cardSeparator>%%%%)|(?=\n\n\n|$))`;

// FlashcardsCloze

const inlineClozure = /(?:.*?(?<cloze>==(?<clozeContent>.*?)==).*)/;

// FlashcardsInline

const inlinePrefix = /(?<prefix>(\s*[-*→]|\d+\.|#{1,6})\s*|)/;
const inlineFirst = /(?<inlineFirst>.+?)/;
const inlineSeparator = (longer: string, shorter: string) =>
  re`(?<inlineSeparator>${longer}|${shorter})`;
// match lazily until \n, #, ^
const inlineSecond = /(?<inlineSecond>[^\n#^]+?)/;
// NOTE: for valid Markdown tag, a space before the '^' is necessary
const idTagInline = re`(?: ${ankiIdTag}|$)`;

// ---

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace RegExps {
  console.debug('--- start of regex enummeration ---');

  export const andkiIdTags = re`/${ankiIdTag}/mg`;
  export type AnkiIdTagsMatches = MakeRgexMatches<{ id: string }>;

  // + is necessary to be distinct from %%%%
  export const scopedSettings = /%%(?<scopedSettings>[^]+?)%%/;
  export type ScopedSettingsMatch = MakeRgexMatches<{
    scopedSettings: string;
  }>[number];

  // Previous RegExp: https://regex101.com/r/p3yQwY/2
  export const flashscardsMultiline = re`/${headingLevelOrInline}${heading}${tags}(?:\n${scopedSettings})?${multilineContent}${idTagNextLine}/g`;
  export type FlashcardsMultilineMatches = MakeRgexMatches<{
    headingLevel?: string;
    heading: string;
    tags: string;
    content: string;
    id?: string;
    // is handled with headings regex
    // deckModification?: string;
  }>;
  console.debug('flashscardsMultiline', flashscardsMultiline);

  // Previous RegExp: https://regex101.com/r/BOieWh/1
  export const headings = re`/${newLineLookBehind}${headingLevel}${heading}${tags}?(?:[^\n]*\n${scopedSettings})?/g`;
  export type HeadingsMatches = MakeRgexMatches<{
    headingLevel: string;
    heading: string;
    tags?: string;
    scopedSettings?: string;
  }>;
  console.debug('headings', headings);

  // Previous RegExp: https://regex101.com/r/cgtnLf/1
  //'( {0,3}[#]{0,6})?(?:(?:[\\t ]*)(?:\\d.|[-+*]|#{1,6}))?(.*?(==.+?==|\\{.+?\\}).*?)((?: *#[\\w\\-\\/_]+)+|$)(?:\n\\^(\\d{13}))?';
  // singleClozeCurly = /((?:{)(?:(\d):?)?(.+?)(?:}))/g;
  // singleClozeHighlight = /((?:==)(.+?)(?:==))/g;

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
  export const flashcardsInline = ({ separator, separatorReverse }: FlashcardsInlineParams) => {
    const inlineSepRegExp =
      separator.length >= separatorReverse.length
        ? inlineSeparator(separator, separatorReverse)
        : inlineSeparator(separatorReverse, separator);
    // NOTE: the 'm' flag is required to make ^ and $ work line by line
    // Spaces around the separator are matched explicitly to not accidentally detect them as part of a math or code expression
    // It is the ursers obligation to avoid the latter
    //
    // leaving a non-capturing group around scopedSettings to avoid obsolete ids showing the settings
    return re`/${newLineLookBehind}${inlinePrefix}${inlineFirst} ${inlineSepRegExp} ${inlineSecond}${tags}?${idTagInline}(?:(?: .*?|\n)${scopedSettings})?/gm`;
  };
  export type FlashcardsInlineMatches = MakeRgexMatches<{
    inlinePrefix?: string;
    inlineFirst: string;
    inlineSeparator: string;
    inlineSecond: string;
    tags?: string;
    id?: string;
    scopedSettings?: string;
  }>;

  console.debug('flashcardsInline', flashcardsInline({ separator: '::', separatorReverse: ':::' }));

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

  const frontMatter = /^---\n([^]*?)---$/g;
  const codeBlocks = /```\w*\n([^]*?)```$/g;

  export const mathBlock = /\$\$(?<content>[^]*?)\$\$/g;
  export const mathBlockInline = /\$\$(?<inline>[^\n]*?)\$\$/g;
  export const mathInline = /\$(?<content>.*?)(?<!\\)\$/g;
  export type mathMatches = MakeRgexMatches<{ content: string }>;

  export const mathJaxSubstitute = /(?<start>\\\()\{\{(?<md5Hash>[\da-f]{32})\}\}(?<end>\\\))/g;
  export type MathJaxSubstituteMatches = MakeRgexMatches<{
    start: string;
    md5Hash: string;
    end: string;
  }>;

  const obsidianCommentPotentiallyBlock = /%%(?<potentiallyBlock>[^]*?)%%/g;
  const obsidianCommentInline = /%%(?<inline>[^\n]*?)%%/g;
  const htmlCommentPotentiallyBlock = /<!--(?<potentiallyBlock>[^]*?)-->/g;
  const htmlCommentInline = /<!--(?<inline>[^\n]*?)-->/g;
  // m flag needed to make ^ and $ work as introduced by the frontmatter regex
  export const rangesToSkipBlock = re`/${mathBlock}|${frontMatter}|${codeBlocks}|${obsidianCommentPotentiallyBlock}|${htmlCommentPotentiallyBlock}/mg`;
  export type RangesToSkipBlockMatches = MakeRgexMatches<{
    potentiallyBlock?: string;
    content?: string;
  }>;
  console.debug('rangesToSkipBlock', rangesToSkipBlock);

  const codeInline = /`(.*?)(?<!\\)`/g;
  export const rangesToSkipInline = re`/${mathInline}|${mathBlockInline}|${codeInline}|${obsidianCommentInline}|${htmlCommentInline}/g`;
  export type RangesToSkipInlineMatches = MakeRgexMatches<{
    /**
     * Used as flag to persist that this regex, which could have matched in a block, is inline only to remove it from
     * the block regex results
     */
    inline?: string;
  }>;
  console.debug('rangesToSkipInline', rangesToSkipInline);

  export const dimensionHeightWidth = /(?<width>\d+)(?:x(?<height>\d+))?/;
  export type DimensionMatch = MakeRgexMatches<{ width: string; height?: string }>[number];
  // TODO: check links in tables due to \| escaping
  const dimension = /(?:\|(?<dimension>\d+(?:x\d+)?))?/;
  // https://publish.obsidian.md/help/How+to/Embed+files
  // https://github.com/ankitects/anki/blob/main/qt/aqt/editor.py#L66
  const feImage = re`(?<image>avif|bmp|gif|jpeg|jpg|png|svg|webp)${dimension}`;
  const feAudio = /(?<audio>flac|m4a|mp3|ogg|wav|webm|3gp)/;
  const feVideo = /(?<video>mkv|mov|mp4|ogv|webm)/;
  const feDocuments = /(?<pdf>pdf(?<reference>#(?:page|height)=\d+)?)/;

  export const linksMedia = re`/!\[\[(?<fileName>.*?)\.(?:${feImage}|${feAudio}|${feVideo}|${feDocuments})\]\]/g`;
  export type LinksMediaMatches = MakeRgexMatches<
    { fileName: string } & (
      | {
          image: string;
          dimension?: string;
        }
      | {
          audio: string;
        }
      | {
          video: string;
        }
      | {
          pdf: string;
          reference?: string;
        }
    )
  >;
  console.debug('linksMedia', linksMedia);

  export const linksEmbedded = re`/!\[(?<alt>.*?)${dimension}\]\((?<href>.*?\))/g`;
  export type LinksEmbeddedMatches = MakeRgexMatches<{
    href: string;
    alt?: string;
    dimension?: string;
  }>;
  console.debug('linksEmbedded', linksEmbedded);

  export const linksMarkdownNote =
    /(?<embedded>!)?\[\[(?<noteReference>.*?)(?<elementReference>#.+?)?(?:\|(?<alt>.*?))?\]\]/g;
  export type LinksMarkdownNoteMatches = MakeRgexMatches<{
    embedded?: string;
    noteReference: string;
    elementReference?: string;
    alt?: string;
  }>;
  console.debug('linksMarkdownNote', linksMarkdownNote);

  const ankiDeckNameChars = /[\w ._"*?<>()[\]-]+/;
  export const ankiDeckName = re`/${ankiDeckNameChars}(?:::${ankiDeckNameChars})?/`;
  export const ankiDeckModification = re`/^(?:<<)?(?:::(?:<<|${ankiDeckNameChars}))*$/`;

  // Tried to mimic the behavior of https://github.com/steven-kraft/obsidian-markdown-furigana as close as possible
  // Uses the DenDenRuby syntax processing of https://github.com/lostandfound/markdown-it-ruby under the hood
  export const dendenRuby = /^\{(?<base>[^{}|\s]+)\|(?<sections>(?:[^{}\\?|\s]*\|*)*)\}/;
  export type DenDenRubyMatch = MakeRgexMatches<{
    base: string;
    sections: string;
  }>[number];

  // Specification what is allowed in the heading context settings yaml
  const yamlKey = /[\w_][\w\d\-_]*/;
  const yamlValue = (v: string) =>
    re`/(?<boolean${v}>true|false)|(?<string${v}>[^,]+)/i`;

  export const yamlKV = (v: string) => re`/(?<key${v}>${yamlKey})(?<gap${v}>:\s*)(?:${yamlValue(v)})?/`;
  export const yamlKVLine = re`/^${yamlKV('')}$/`;
  export type YamlKVMatch = MakeRgexMatches<{
    key: string;
    gap: string;
    string?: string;
    boolean?: string;
  }>[number];

  export const yamlObject = re`/\{(?<content>(?:\s*${yamlKV('')})(?:,\s*${yamlKV('b')})*)?\s*\}/`;
  export type YamlObjectMatch = MakeRgexMatches<{
    content?: string;
  }>[number];

  export const applySyntaxHighlighting = /(?<=#+ [^\n]+?\n)%%([^]*?)%%/g;

  console.debug('yamlKV', yamlKV(''));
  console.debug('yamlKVLine', yamlKVLine);
  console.debug('yamlObject', yamlObject);

  console.debug('--- end of regex enummeration ---');
}
