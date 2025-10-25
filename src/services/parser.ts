import * as showdown from 'showdown';
import { Regex } from 'src/conf/regex';
import { RegExps } from 'src/constants/regex';
import { Clozecard } from 'src/entities/clozecard';
import { Inlinecard } from 'src/entities/inlinecard';
import { Spacedcard } from 'src/entities/spacedcard';
import { Settings } from 'src/types/settings';
import { escapeMarkdown } from 'src/utils';
import { Flashcard } from '../entities/flashcard';
import { group } from 'console';

type AnkiFields = { Front: string; Back: string; Source?: string };

type GenerateFlashcardsParams = {
  fileContents: string;
  deckName: string;
  valutName: string;
  frontmatterTags: string[] | null;
};

export class Parser {
  private regex: Regex;
  private settings: Settings;
  private htmlConverter;

  private filterRanges: { from: number; to: number }[];
  private mediaLinks: (RegExps.LinksMediaMatches[number]['groups'] & { index: number })[] = [];
  private headings: { level: number; text: string; index: number }[] | undefined;
  // private localSettings: ParserSettings;

  constructor(regex: Regex, settings: Settings) {
    this.regex = regex;
    this.settings = settings;

    this.htmlConverter = new showdown.Converter();
    this.htmlConverter.setOption('simplifiedAutoLink', true);
    this.htmlConverter.setOption('tables', true);
    this.htmlConverter.setOption('tasks', true);
    this.htmlConverter.setOption('strikethrough', true);
    this.htmlConverter.setOption('ghCodeBlocks', true);
    this.htmlConverter.setOption('requireSpaceBeforeHeadingText', true);
    this.htmlConverter.setOption('simpleLineBreaks', true);
  }

  /**
   * Main function to generate flashcards from a note's content
   *
   * Fully relying on regex-based parsing and not https://docs.obsidian.md/Reference/TypeScript+API/CachedMetadata
   * since more control is needed and mixture of both is really complex to handle & might break in between updates
   */
  public generateFlashcards({
    fileContents,
    deckName,
    valutName,
    frontmatterTags,
  }: GenerateFlashcardsParams) {
    // Filter out cards that are fully inside a code block, a math block or a math inline block
    // TODO: why is this considered? Robustness?
    const codeBlocks = fileContents.matchAll(this.regex.obsidianCodeBlock);
    const mathBlocks = fileContents.matchAll(this.regex.mathBlock);
    const mathInline = fileContents.matchAll(this.regex.mathInline);
    const frontMatter = fileContents.matchAll(RegExps.frontMatter);
    const blocksToFilter = [...codeBlocks, ...mathBlocks, ...mathInline, ...frontMatter];
    this.filterRanges = blocksToFilter.map((x) => ({
      from: x.index,
      to: x.index + x[0].length,
    }));

    // TODO: take filterRanges into account
    if (this.settings.contextAwareMode) {
      const headings = Array.from(
        fileContents.matchAll(RegExps.Headings),
      ) as unknown as RegExps.HeadingsMatches;
      this.headings = headings.map(({ groups: { heading, headingLevel }, index }) => ({
        level: headingLevel.length,
        text: heading.trim(),
        index: index!,
      }));

      console.debug('Headings found: ', this.headings);
    }

    // TODO: take filterRanges into account
    const mediaLinks = Array.from(
      fileContents.matchAll(RegExps.linksMedia),
    ) as unknown as RegExps.LinksMediaMatches;
    this.mediaLinks = mediaLinks.map(({ index, groups }) => ({ index: index!, ...groups }));

    // FIXME: what did this?
    // note = this.substituteObsidianLinks(`[[${note}]]`, vault);

    // TODO: take filterRanges into account
    let cards: (Clozecard | Flashcard | Inlinecard | Spacedcard)[] = [];
    cards = cards.concat(
      this.parseFlashcardsMultiline(fileContents, deckName, valutName, frontmatterTags),
    );
    cards = cards.concat(
      this.parseFlashcardsInline(fileContents, deckName, valutName, frontmatterTags),
    );
    // cards = cards.concat(this.generateSpacedCards(file, deck, vault, note, globalTags));
    // cards = cards.concat(this.generateClozeCards(file, deck, vault, note, globalTags));

    cards.sort((a, b) => a.endOffset - b.endOffset);

    return cards;
  }

  /**
   * Gives back the ancestor headings of the provided character index
   */
  private getHeadingContext(index: number, headingLevel: number | 0): string[] {
    if (!this.headings) throw new Error('Headings not initialized');
    console.debug('Getting context for index', index, 'and heading level', headingLevel);

    const indexPreviousHeading = this.headings.findLastIndex((heading) => heading.index <= index);
    if (indexPreviousHeading === -1) return [];

    // FIXME:
    // headingLevel === 0 => card is inline => use previous heading level
    // headingLevel > 0 => card is in a heading => the heading itself shouldn't be included in the context
    let currentHeadingLevel =
      headingLevel > 0 ? headingLevel : this.headings[indexPreviousHeading].level;
    const context: (number | null)[] = Array(currentHeadingLevel).fill(null);
    context[currentHeadingLevel - 1] = indexPreviousHeading;

    for (let i = indexPreviousHeading - 1; i >= 0 && context[0] === null; i--) {
      const heading = this.headings[i];
      if (heading.level < currentHeadingLevel) {
        console.debug(
          'New context for level ' + heading.level + ' detected:',
          this.headings[i],
          'headings[' + i + ']',
        );
        context[heading.level - 1] = i;
        currentHeadingLevel = heading.level;
      }
    }

    return context.filter((n) => n !== null).map((i) => this.headings![i].text);
  }

  /**
   * TODO: Precondition: input strings are trimmed
   */
  private parseCardContent(
    questionRaw: string,
    answerRaw: string,
    startIndex: number,
    headingLevelCount: number,
    vault: string,
  ) {
    let question = questionRaw;
    if (this.settings.contextAwareMode) {
      const contextHeadings = this.getHeadingContext(startIndex, headingLevelCount);
      // Remove current heading from context (should be fixed inside setHeadingContext)
      if (contextHeadings[contextHeadings.length - 1] === question) contextHeadings.pop();
      question = [...contextHeadings, question].join(this.settings.contextSeparator);
    }
    question = this.parseLine(question, vault);
    const answer = this.parseLine(answerRaw, vault);

    // TODO: embed media was previously handled with a rather hacky document call:
    // Array.from(document.documentElement.getElementsByClassName('internal-embed'));
    let media: string[] = this.getImageLinks(question);
    media = media.concat(this.getImageLinks(answer));
    media = media.concat(this.getAudioLinks(answer));

    const fields: AnkiFields = { Front: question, Back: answer };
    // TODO: source support was removed - what was note?
    // if (this.settings.sourceSupport) fields['Source'] = note;

    const containsCode = this.containsCode([question, answer]);

    return { question, answer, media, fields, containsCode };
  }

  private parseFlashcardsMultiline(
    fileContents: string,
    deckName: string,
    vaultName: string,
    frontmatterTags: string[] | null,
  ) {
    const matches = fileContents.matchAll(
      RegExps.flashscardsMultiline,
    ) as unknown as RegExps.FlashcardsMultilineMatches;

    const cards: Flashcard[] = [];
    for (const { groups, ...match } of matches) {
      const fullMatch = match[0];
      console.debug('Flashcard match groups:\n"' + fullMatch + '"', groups);
      const { content, heading, tags, headingLevel, id } = groups;

      const { tagsParsed, isFlashcard, isReversed } = this.parseTags(frontmatterTags, tags);
      if (!isFlashcard) continue;

      const startIndex = match.index!;
      const endingIndex = startIndex + fullMatch.length;
      const headingLevelCount = headingLevel?.length ?? 0;

      const { media, fields, containsCode } = this.parseCardContent(
        heading.trim(),
        content,
        startIndex,
        headingLevelCount,
        vaultName,
      );

      // Insert default tags if necessary
      if (this.settings.defaultAnkiTag) tagsParsed.push(this.settings.defaultAnkiTag);

      const idParsed = id ? Number(id.substring(1)) : null;
      const card = new Flashcard({
        id: idParsed,
        deckName,
        fields: fields,
        initialOffset: startIndex,
        endOffset: endingIndex,
        tags: tagsParsed,
        mediaNames: media,
        flags: { isReversed, containsCode },
      });
      cards.push(card);
    }

    return cards;
  }

  private parseFlashcardsInline(
    fileContents: string,
    deckName: string,
    vaultName: string,
    frontmatterTags: string[] | null,
  ) {
    const sep = this.settings.inlineSeparator;
    const sepRev = this.settings.inlineSeparatorReverse;
    const matches = fileContents.matchAll(
      RegExps.flashcardsInline({ separator: sep, separatorReverse: sepRev }),
    ) as unknown as RegExps.FlashcardsInlineMatches;

    const cards: Inlinecard[] = [];
    for (const { groups, ...match } of matches) {
      const fullMatch = match[0];
      const startIndex = match.index!;
      const endingIndex = startIndex + fullMatch.length;

      if (this.filterRanges.some((range) => startIndex >= range.from && endingIndex <= range.to)) {
        console.debug(
          `Skipping inline flashcard at index ${startIndex}-${endingIndex} as it is inside a filtered range`,
        );
        continue;
      }

      console.debug('Inline Flashcard match groups:\n"' + fullMatch + '"', groups);
      const { inlineFirst, inlineSeparator, inlineSecond, tags, id } = groups;

      // No check for isFlashcard since no tag is required for inline cards
      const { tagsParsed, isReversed: hasReversedTag } = this.parseTags(frontmatterTags, tags);
      // MODIFIED: Check separator first, then combine with tag-based reversed flag
      const isReversed = inlineSeparator === this.settings.inlineSeparatorReverse || hasReversedTag;

      const { media, fields, containsCode } = this.parseCardContent(
        inlineFirst,
        inlineSecond,
        startIndex,
        0,
        vaultName,
      );

      // Insert default tags if necessary
      if (this.settings.defaultAnkiTag) tagsParsed.push(this.settings.defaultAnkiTag);

      const idParsed = id ? Number(id.substring(1)) : null;
      const card = new Inlinecard({
        id: idParsed,
        deckName,
        fields: fields,
        initialOffset: startIndex,
        endOffset: endingIndex,
        tags: tagsParsed,
        mediaNames: media,
        flags: { isReversed, containsCode },
      });
      cards.push(card);
    }

    return cards;
  }

  public containsCode(str: string[]): boolean {
    for (const s of str) {
      if (s.match(this.regex.codeBlock)) {
        return true;
      }
    }
    return false;
  }

  private parseLine(str: string, vaultName: string) {
    return this.htmlConverter.makeHtml(
      this.mathToAnki(
        this.substituteObsidianLinks(
          this.substituteImageLinks(this.substituteAudioLinks(str.trim())),
          vaultName,
        ),
      ),
    );
  }

  private getMediaLinks(str: string) {
    const imageLinks = this.getImageLinks(str);
    const audioLinks = this.getAudioLinks(str);
    return { imageLinks, audioLinks };
  }

  private getImageLinks(str: string) {
    const wikiMatches = str.matchAll(this.regex.wikiImageLinks);
    const markdownMatches = str.matchAll(this.regex.markdownImageLinks);
    const links: string[] = [];

    for (const wikiMatch of wikiMatches) {
      links.push(wikiMatch[1]);
    }

    for (const markdownMatch of markdownMatches) {
      links.push(decodeURIComponent(markdownMatch[1]));
    }

    return links;
  }

  private getAudioLinks(str: string) {
    const wikiMatches = str.matchAll(this.regex.wikiAudioLinks);
    const links: string[] = [];

    for (const wikiMatch of wikiMatches) {
      links.push(wikiMatch[1]);
    }

    return links;
  }

  private substituteObsidianLinks(str: string, vaultName: string) {
    const linkRegex = /\[\[(.+?)(?:\|(.+?))?\]\]/gim;
    vaultName = encodeURIComponent(vaultName);

    return str.replace(linkRegex, (match, filename, rename) => {
      const href = `obsidian://open?vault=${vaultName}&file=${encodeURIComponent(filename)}.md`;
      const fileRename = rename ? rename : filename;
      return `<a href="${href}">${fileRename}</a>`;
    });
  }

  private substituteImageLinks(str: string): string {
    str = str.replace(this.regex.wikiImageLinks, "<img src='$1'>");
    str = str.replace(this.regex.markdownImageLinks, "<img src='$1'>");

    return str;
  }

  private substituteAudioLinks(str: string): string {
    return str.replace(this.regex.wikiAudioLinks, '[sound:$1]');
  }

  private mathToAnki(str: string) {
    str = str.replace(this.regex.mathBlock, function (match, p1, p2) {
      return '\\\\[' + escapeMarkdown(p2) + ' \\\\]';
    });

    str = str.replace(this.regex.mathInline, function (match, p1, p2) {
      return '\\\\(' + escapeMarkdown(p2) + '\\\\)';
    });

    return str;
  }

  private parseTags(globalTags: string[] | null, tags?: string) {
    if (!tags)
      return {
        tagsParsed: globalTags ? [...globalTags] : [],
        isFlashcard: false,
        isReversed: false,
      };

    const tagsSplit = tags
      .trim()
      .split(/\s*#/)
      .map((t) => t.trim());

    let isFlashcard = false;
    let isReversed = false;

    const nonFlashcardSpecificTags = tagsSplit.filter((tag) => {
      if (!tag) return false;

      const isCurrentFlashcard = tag.toLowerCase() === this.settings.flashcardsTag;
      if (isCurrentFlashcard) isFlashcard = true;
      const isCurrentReversed =
        tag === this.settings.flashcardsTag + '-reverse' ||
        tag === this.settings.flashcardsTag + '/reverse';
      if (isCurrentReversed) isReversed = true;

      return !isCurrentFlashcard && !isCurrentReversed;
    });

    // Replace obsidian hierarchy tags delimiter \ with anki delimiter ::
    const tagsParsed = globalTags
      ? globalTags.concat(
          nonFlashcardSpecificTags.map((tag) => tag.replace(this.regex.tagHierarchy, '::')),
        )
      : nonFlashcardSpecificTags;

    return {
      tagsParsed,
      isFlashcard,
      isReversed,
    };
  }

  public getAnkiIDsTags(file: string): number[] {
    const matches = [...file.matchAll(RegExps.andkiIdTags)] as unknown as RegExps.AnkiIdTagsMatches;

    return matches.map((match) => Number(match.groups.id.substring(1)));
  }
}
