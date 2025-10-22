/* eslint-disable @typescript-eslint/no-explicit-any */
import * as showdown from 'showdown';
import { Regex } from 'src/conf/regex';
import { Clozecard } from 'src/entities/clozecard';
import { Inlinecard, InlinecardFields } from 'src/entities/inlinecard';
import { Spacedcard } from 'src/entities/spacedcard';
import { Settings } from 'src/types/settings';
import { escapeMarkdown } from 'src/utils';
import { Flashcard, FlashcardFields } from '../entities/flashcard';
import { RegExps } from 'src/constants/regex';

// interface ParserSettings {};

export class Parser {
  private regex: Regex;
  private settings: Settings;
  private htmlConverter;

  private filterRanges: { from: number; to: number }[];
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

  public generateFlashcards(
    file: string,
    deck: string,
    vault: string,
    note: string,
    globalTags: string[] = [],
  ) {
    // Filter out cards that are fully inside a code block, a math block or a math inline block
    // TODO: why is this considered? Robustness?
    const codeBlocks = file.matchAll(this.regex.obsidianCodeBlock);
    const mathBlocks = file.matchAll(this.regex.mathBlock);
    const mathInline = file.matchAll(this.regex.mathInline);
    const frontMatter = file.matchAll(RegExps.frontMatter);
    const blocksToFilter = [...codeBlocks, ...mathBlocks, ...mathInline, ...frontMatter];
    this.filterRanges = blocksToFilter.map((x) => ({
      from: x.index,
      to: x.index + x[0].length,
    }));

    if (this.settings.contextAwareMode) {
      const headings = Array.from(
        file.matchAll(RegExps.Headings),
      ) as unknown as RegExps.HeadingsMatches;
      this.headings = headings.map(({ groups: { heading, headingLevel }, index }) => ({
        level: headingLevel.length,
        text: heading.trim(),
        index: index!,
      }));

      console.debug('Headings found: ', this.headings);
    }

    note = this.substituteObsidianLinks(`[[${note}]]`, vault);

    let cards: (Clozecard | Flashcard | Inlinecard | Spacedcard)[] = [];
    cards = cards.concat(this.generateCardsWithTag(file, deck, vault, note, globalTags));
    cards = cards.concat(this.generateInlineCards(file, deck, vault, note, globalTags));
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

  private generateCardsWithTag(
    file: string,
    deckName: string,
    vault: string,
    note: string,
    globalTags: string[] = [],
  ) {
    const matches = Array.from(
      file.matchAll(RegExps.flashscardsMultiline),
    ) as unknown as RegExps.FlashcardsMultilineMatches;

    const cards: Flashcard[] = [];
    for (const { groups, ...match } of matches) {
      const fullMatch = match[0];
      console.debug('Flashcard match groups:\n"' + fullMatch + '"', groups);
      const { content, heading, tags, headingLevel, id } = groups;

      const { tagsParsed, isFlashcard, isReversed } = this.parseTags(globalTags, tags);
      if (!isFlashcard) continue;

      const startIndex = match.index!;
      const headingLevelCount = headingLevel?.length ?? 0;

      let question = heading.trim();
      if (this.settings.contextAwareMode) {
        const contextHeadings = this.getHeadingContext(startIndex, headingLevelCount);
        // Remove current heading from context (should be fixed inside setHeadingContext)
        if (contextHeadings[contextHeadings.length - 1] === question) {
          contextHeadings.pop();
        }
        question = [...contextHeadings, question].join(this.settings.contextSeparator);
      }
      question = this.parseLine(question, vault);

      const answer = this.parseLine(content, vault);

      let media: string[] = this.getImageLinks(question);
      media = media.concat(this.getImageLinks(answer));
      media = media.concat(this.getAudioLinks(answer));

      const idParsed = id ? Number(id.substring(1)) : null;

      const fields: FlashcardFields = { Front: question, Back: answer };
      if (this.settings.sourceSupport) {
        fields['Source'] = note;
      }

      const containsCode = this.containsCode([question, answer]);

      const endingIndex = startIndex + fullMatch.length;

      // insert default tags if necessary
      if (this.settings.defaultAnkiTag) tagsParsed.push(this.settings.defaultAnkiTag);

      const card = new Flashcard({
        id: idParsed,
        deckName,
        fields,
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

  private generateInlineCards(
    file: string,
    deckName: string,
    vault: string,
    note: string,
    globalTags: string[] = [],
  ) {
    const sep = this.settings.inlineSeparator;
    const sepRev = this.settings.inlineSeparatorReverse;
    const matches = file.matchAll(
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

      let isReversed = inlineSeparator === this.settings.inlineSeparatorReverse;
      // no check for isFlashcard since no tag is required for inline cards
      const { tagsParsed, isReversed: hasReversedTag } = this.parseTags(globalTags, tags);
      isReversed = isReversed || hasReversedTag;

      let question = inlineFirst;
      if (this.settings.contextAwareMode) {
        const contextHeadings = this.getHeadingContext(startIndex, 0);
        question = [...contextHeadings, question].join(this.settings.contextSeparator);
      }
      question = this.parseLine(question, vault);

      const answer = this.parseLine(inlineSecond, vault);

      let medias: string[] = this.getImageLinks(question);
      medias = medias.concat(this.getImageLinks(answer));
      medias = medias.concat(this.getAudioLinks(answer));

      const idParsed = id ? Number(id.substring(1)) : null;

      const fields: InlinecardFields = { Front: question, Back: answer };
      if (this.settings.sourceSupport) {
        fields['Source'] = note;
      }

      const containsCode = this.containsCode([question, answer]);

      // insert default tags if necessary
      if (this.settings.defaultAnkiTag) tagsParsed.push(this.settings.defaultAnkiTag);

      const card = new Inlinecard({
        id: idParsed,
        deckName,
        fields,
        initialOffset: startIndex,
        endOffset: endingIndex,
        tags: tagsParsed,
        mediaNames: medias,
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

  private parseTags(globalTags: string[], tags?: string) {
    if (!tags) return { tagsParsed: [...globalTags], isFlashcard: false, isReversed: false };

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
    const tagsParsed = globalTags.concat(
      nonFlashcardSpecificTags.map((tag) => tag.replace(this.regex.tagHierarchy, '::')),
    );

    return {
      tagsParsed,
      isFlashcard,
      isReversed,
    };
  }

  public getAnkiIDsTags(file: string): number[] {
    const matches = [...file.matchAll(RegExps.andkiIdTag)] as unknown as RegExps.AnkiIdTagMatches;

    return matches.map((match) => Number(match.groups.id.substring(1)));
  }

  private getEmbedMap() {
    // key：link url
    // value： embed content parse from html document
    const embedMap = new Map();

    const embedList = Array.from(document.documentElement.getElementsByClassName('internal-embed'));

    Array.from(embedList).forEach((el) => {
      // markdown-embed-content markdown-embed-page
      const embedValue = this.htmlConverter.makeMarkdown(
        this.htmlConverter.makeHtml(el.outerHTML).toString(),
      );

      const embedKey = el.getAttribute('src');
      embedMap.set(embedKey, embedValue);

      // console.log("embedKey: \n" + embedKey);
      // console.log("embedValue: \n" + embedValue);
    });

    return embedMap;
  }

  private getEmbedWrapContent(embedMap: Map<any, any>, embedContent: string): string {
    let result = embedContent.match(this.regex.embedBlock);
    while ((result = this.regex.embedBlock.exec(embedContent))) {
      // console.log("result[0]: " + result[0]);
      // console.log("embedMap.get(result[1]): " + embedMap.get(result[1]));
      embedContent = embedContent.concat(embedMap.get(result[1]));
    }
    return embedContent;
  }
}
