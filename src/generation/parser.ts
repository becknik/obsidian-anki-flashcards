import dedent from 'dedent';
import { marked, MarkedExtension, Token, TokenizerObject } from 'marked';
import markedShiki from 'marked-shiki';
import { MetadataCache, parseFrontMatterEntry, parseFrontMatterTags, TFile } from 'obsidian';
import { codeToHtml } from 'shiki';
import * as SparkMD5 from 'spark-md5';
import { Clozecard } from 'src/entities/clozecard';
import { Inlinecard } from 'src/entities/inlinecard';
import { Spacedcard } from 'src/entities/spacedcard';
import { Settings, SETTINGS_FRONTMATTER_KEYS } from 'src/types/settings';
import { showMessage } from 'src/utils';
import { Flashcard } from '../entities/flashcard';
import { RegExps } from 'src/regex';
import { DEFAULT_SETTINGS } from 'src/constants';
import markedAlert from 'marked-alert';

type AnkiFields = { Front: string; Back: string; Source?: string };
type Range = { from: number; to: number };

// To later transform into AnkiConnect media objects
// https://git.sr.ht/~foosoft/anki-connect#codeaddnotecode
export type MediaLinkImmediate = {
  fileName: string;
  type: 'picture' | 'audio' | 'video' | 'other';
};

type DendenRubyToken = {
  type: 'dendenRuby';
  raw: string;
  base: string;
  rubySections: string[];
};

// DenDenRuby syntax based marked extension for ruby-character processing
// Can't get the typing to work properly, so am inlining it...
marked.use({
  extensions: [
    {
      name: 'dendenRuby',
      level: 'inline',
      start(src: string) {
        return src.indexOf('{');
      },
      tokenizer(src: string) {
        // Match {base|ruby|ruby|...}
        const rule = RegExps.dendenRuby;
        const match = rule.exec(src) as RegExps.DenDenRubyMatch | null;
        if (!match) return;

        const rubySections = match.groups.sections.split('|');
        const baseText = match.groups.base;

        return {
          type: 'dendenRuby',
          base: baseText,
          rubySections,
          raw: match[0],
        } satisfies DendenRubyToken;
      },
      renderer(token: DendenRubyToken) {
        const { base, rubySections } = token;

        // Break string in multi-byte Unicode characters compounds
        const baseChars = Array.from(base);

        if (rubySections.length === 1 || baseChars.length === 1) {
          return `<ruby>${base}<rt>${rubySections[0]}</rt></ruby>`;
        }

        let html = '<ruby>';
        for (let i = 0; i < baseChars.length; i++) {
          if (rubySections[i] === '') html += baseChars[i] + '<rt></rt>';
          else html += `${baseChars[i]}<rt>${rubySections[i]}</rt>`;
        }
        html += '</ruby>';

        return html;
      },
    },
  ],
});

marked.use(
  markedShiki({
    async highlight(code, lang) {
      // TODO: Find good themes/ make customizable: https://shiki.style/themes
      // TODO: Dark-Mode support: https://shiki.style/guide/dual-themes
      return await codeToHtml(code, {
        lang,
        theme: 'min-dark',
      });
    },
    container: dedent`
      <!-- TODO: define this CSS class -->
      <figure class="highlighted-code">
        %s
      </figure>
    `,
  }),
  markedAlert(),
);

marked.use({
  hooks: {
    preprocess(markdown) {
      return markdown.replace(/^((?<![\w])[\t ]*)→ (.+)$/gm, '$1- {{ARROW}} $2');
    },
    postprocess(html) {
      return html.replace(/<li>{{ARROW}}/g, '<li class="arrow-item">');
    },
  },
});

type ParserProcessingConfig = {
  deckName: string;
  frontmatterTags: string[] | null;
  headingContext: boolean;
  isDeckPathBased: boolean;
};

type ParserProps = {
  settings: Settings;
  fileContents: string;
  vaultName: string;
  /**
   * Used to resolve relative note path links
   */
  metadataCache: MetadataCache;
  file: TFile;
  config: ParserProcessingConfig;
};

type ParseCardContentProps = {
  questionRaw: string;
  answerRaw: string;
  headingLevelCount: number;
  startIndex: number;
};

export class Parser implements ParserProps {
  settings: Settings;
  fileContents: string;
  vaultName: string;

  metadataCache: MetadataCache;
  file: TFile;

  config: ParserProcessingConfig;

  private filterRangesMultiline: Range[];
  private filterRangesInline: Range[];
  private headings:
    | { level: number; text: string; index: number; deckModification?: string }[]
    | null;

  constructor({
    settings,
    fileContents,
    vaultName,
    metadataCache,
    file,
  }: Omit<ParserProps, 'config'>) {
    this.settings = settings;
    this.fileContents = fileContents;
    this.vaultName = vaultName;

    this.metadataCache = metadataCache;
    this.file = file;

    // Filter out cards that are fully inside code blocks, math blocks, comments, etc.
    const rangesToFilterInline = Array.from(
      fileContents.matchAll(RegExps.rangesToSkipInline),
    ) as unknown as RegExps.RangesToSkipInlineMatches;
    const blockRangesThatAreUsedInline: number[] = [];
    this.filterRangesInline = rangesToFilterInline.map((x) => {
      const fullMatch = x[0];

      // Some block regexes can be used inline only, so we have to filter those out from the block ranges
      if (x.groups.inline) blockRangesThatAreUsedInline.push(x.index!);
      return {
        from: x.index!,
        to: x.index! + fullMatch.length,
      };
    });

    const rangesToFilterBlock = Array.from(
      fileContents.matchAll(RegExps.rangesToSkipBlock),
    ) as unknown as RegExps.RangesToSkipBlockMatches;
    this.filterRangesMultiline = rangesToFilterBlock.map((x) => {
      const fullMatch = x[0];
      if (x.groups.content || x.groups.potentiallyBlock) {
        if (blockRangesThatAreUsedInline.includes(x.index!)) {
          return { from: -1, to: -1 };
        }
      }
      return {
        from: x.index!,
        to: x.index! + fullMatch.length,
      };
    });

    this.initConfig(file);

    if (!this.config.headingContext) {
      this.headings = null;
    } else {
      const headings = Array.from(
        fileContents.matchAll(RegExps.headings),
      ) as unknown as RegExps.HeadingsMatches;
      this.headings = headings
        .filter((h) => !this.isInFilterRange(h.index!, h.index! + h[0].length))
        .map(({ groups: { heading, headingLevel, deckModification }, index }) => ({
          level: headingLevel.length,
          text: heading.trim(),
          index: index!,
          deckModification,
        }));

      console.debug('Headings found: ', this.headings);
    }
  }

  private initConfig(file: TFile) {
    const {
      pathBasedDeckGlobal,
      deckNameGlobal,
      applyFrontmatterTagsGlobal,
      headingContextModeGlobal,
    } = this.settings;
    const frontmatter = this.metadataCache.getFileCache(file)?.frontmatter;

    // Set defaults first
    this.config = {
      deckName: pathBasedDeckGlobal
        ? (this.getPathBasedDeckName(file) ?? deckNameGlobal)
        : deckNameGlobal,
      isDeckPathBased: pathBasedDeckGlobal,
      frontmatterTags: null,
      headingContext: !!headingContextModeGlobal,
    };
    if (!frontmatter) return;

    const fmDeckName = parseFrontMatterEntry(frontmatter, SETTINGS_FRONTMATTER_KEYS.deckName);
    const isFmDeckNameValid =
      fmDeckName && typeof fmDeckName === 'string' && RegExps.ankiDeckName.test(fmDeckName.trim());

    // Determine deck name: frontmatter > path-based > default
    const fmPathBased = parseFrontMatterEntry(frontmatter, SETTINGS_FRONTMATTER_KEYS.pathBasedDeck);
    const isFmPathBasedValid = typeof fmPathBased === 'boolean';

    if (isFmPathBasedValid && fmPathBased && isFmDeckNameValid && fmDeckName) {
      showMessage(
        {
          type: 'warning',
          message: `Ignoring frontmatter entry "${SETTINGS_FRONTMATTER_KEYS.pathBasedDeck}" when "${SETTINGS_FRONTMATTER_KEYS.deckName}" is set`,
        },
        'long',
      );
    }

    let deckName = deckNameGlobal;

    if (isFmDeckNameValid) {
      deckName = fmDeckName.trim();
      this.config.isDeckPathBased = false;
    } else if (
      (pathBasedDeckGlobal && (!isFmPathBasedValid || fmPathBased)) ||
      (isFmPathBasedValid && fmPathBased)
    ) {
      this.config.isDeckPathBased = true;

      const pathBasedDeckName = this.getPathBasedDeckName(file);
      if (pathBasedDeckName) deckName = pathBasedDeckName;
    }

    this.config.deckName = deckName;

    // Determine if to include frontmatter tags into the notes
    const fmApplyTags = parseFrontMatterEntry(
      frontmatter,
      SETTINGS_FRONTMATTER_KEYS.applyFrontmatterTags,
    );
    const isFmApplyTagsValid = typeof fmApplyTags === 'boolean';

    let tags: null | string[] = null;

    if (
      (applyFrontmatterTagsGlobal && (!isFmApplyTagsValid || fmApplyTags)) ||
      (isFmApplyTagsValid && fmApplyTags)
    ) {
      tags = parseFrontMatterTags(frontmatter)?.map((tag) => tag.substring(1)) ?? null;
    }

    this.config.frontmatterTags = tags;

    // Determine if to be heading-context aware
    const fmHeadingContextMode = parseFrontMatterEntry(
      frontmatter,
      SETTINGS_FRONTMATTER_KEYS.headingContextMode,
    );
    const isFmHeadingContextModeValid = typeof fmHeadingContextMode === 'boolean';

    const headingContextMode =
      (headingContextModeGlobal && (!isFmHeadingContextModeValid || fmHeadingContextMode)) ||
      (isFmHeadingContextModeValid && fmHeadingContextMode);

    this.config.headingContext = headingContextMode;

    console.debug('frontmatter config:', this.config);
  }

  private getPathBasedDeckName(file: TFile): string | undefined {
    const isInRoot = file.parent?.path === '/';
    if (!isInRoot) {
      return file.parent!.path.split('/').join('::');
    }
  }

  /**
   * Main function to generate flashcards from a note's content
   *
   * Fully relying on regex-based parsing and not https://docs.obsidian.md/Reference/TypeScript+API/CachedMetadata
   * since more control is needed and mixture of both is really complex to handle & might break in between updates
   */
  public async generateFlashcards() {
    // FIXME: what did this?
    // note = this.substituteObsidianLinks(`[[${note}]]`, vault);

    // TODO: take filterRanges into account
    let cards: (Clozecard | Flashcard | Inlinecard | Spacedcard)[] = [];
    cards = cards.concat(await this.parseFlashcardsMultiline());
    cards = cards.concat(await this.parseFlashcardsInline());
    // cards = cards.concat(this.generateSpacedCards(file, deck, vault, note, globalTags));
    // cards = cards.concat(this.generateClozeCards(file, deck, vault, note, globalTags));

    cards.sort((a, b) => a.endOffset - b.endOffset);

    return cards;
  }

  private async parseFlashcardsMultiline() {
    const matches = this.fileContents.matchAll(
      RegExps.flashscardsMultiline,
    ) as unknown as RegExps.FlashcardsMultilineMatches;

    const cards: Flashcard[] = [];
    for (const { groups, ...match } of matches) {
      const fullMatch = match[0];
      const startIndex = match.index!;
      const endingIndex = startIndex + fullMatch.length;

      if (this.isInFilterRange(startIndex, endingIndex)) {
        console.warn(
          `Skipping processing flashcard at index ${startIndex}-${endingIndex} as it is inside a filtered range`,
          fullMatch,
        );
        continue;
      }

      console.debug('Flashcard match groups:\n"' + fullMatch + '"', groups);
      const { content, heading, tags, headingLevel, id } = groups;

      const { tagsParsed, isFlashcard, isReversed } = this.parseTags(tags);
      if (!isFlashcard) continue;

      const headingLevelCount = headingLevel?.length ?? 0;
      const { mediaLinks, fields, deckName } = await this.parseCardContent({
        startIndex,
        questionRaw: heading,
        answerRaw: content,
        headingLevelCount,
      });

      // Insert default tags if necessary
      if (this.settings.defaultAnkiTag) tagsParsed.push(this.settings.defaultAnkiTag);

      const idParsed = id ? Number(id.substring(1)) : null;
      const card = new Flashcard({
        id: idParsed,
        deckName: deckName ?? this.config.deckName,
        fields: fields,
        initialOffset: startIndex,
        endOffset: endingIndex,
        tags: tagsParsed,
        mediaLinks,
        flags: { isReversed },
      });
      cards.push(card);
    }

    return cards;
  }

  private async parseFlashcardsInline() {
    const sep = this.settings.inlineSeparator;
    const sepRev = this.settings.inlineSeparatorReversed;
    const matches = this.fileContents.matchAll(
      RegExps.flashcardsInline({ separator: sep, separatorReverse: sepRev }),
    ) as unknown as RegExps.FlashcardsInlineMatches;

    const cards: Inlinecard[] = [];
    for (const { groups, ...match } of matches) {
      const fullMatch = match[0];
      const startIndex = match.index!;
      const endingIndex = startIndex + fullMatch.length;

      if (this.isInFilterRange(startIndex, endingIndex)) {
        console.warn(
          `Skipping inline flashcard at index ${startIndex}-${endingIndex} as it is inside a filtered range`,
          fullMatch,
        );
        continue;
      }

      console.debug('Inline Flashcard match groups:\n"' + fullMatch + '"', groups);
      const { inlineFirst, inlineSeparator, inlineSecond, tags, id } = groups;

      // No check for isFlashcard since no tag is required for inline cards
      const { tagsParsed, isReversed: hasReversedTag } = this.parseTags(tags);
      // MODIFIED: Check separator first, then combine with tag-based reversed flag
      const isReversed =
        inlineSeparator === this.settings.inlineSeparatorReversed || hasReversedTag;

      const { mediaLinks, fields, deckName } = await this.parseCardContent({
        startIndex,
        questionRaw: inlineFirst,
        answerRaw: inlineSecond,
        headingLevelCount: 0,
      });

      // Insert default tags if necessary
      if (this.settings.defaultAnkiTag) tagsParsed.push(this.settings.defaultAnkiTag);

      const idParsed = id ? Number(id.substring(1)) : null;
      const card = new Inlinecard({
        id: idParsed,
        deckName: deckName ?? this.config.deckName,
        fields: fields,
        initialOffset: startIndex,
        endOffset: endingIndex,
        tags: tagsParsed,
        mediaLinks,
        flags: { isReversed },
      });
      cards.push(card);
    }

    return cards;
  }

  /**
   * Is the flashcard fully contained inside e.g. a code block, math block, comment, etc.
   */
  private isInFilterRange(startIndex: number, endingIndex: number) {
    return this.filterRangesMultiline.some(
      (range) => startIndex >= range.from && endingIndex <= range.to,
    );
  }

  /**
   * Is the character index inside e.g. an inline code span, inline math, etc.
   *
   * Useful to determine if a detected card marker is a valid one
   */
  private isIndexInInlineRange(index: number) {
    return this.filterRangesInline.some((range) => index >= range.from && index <= range.to);
  }

  /**
   * Gives back the ancestor headings of the provided character index
   * If the nearest heading also contains a deck modification, this method also returns it automatically
   */
  private getHeadingContext(
    index: number,
    headingLevel: number | 0,
  ): { contextHeadings: string[]; deckModification?: string } {
    if (!this.headings) return { contextHeadings: [] };

    console.debug('Getting context for index', index, 'and heading level', headingLevel);

    const indexPreviousHeading = this.headings.findLastIndex((heading) => heading.index <= index);
    if (indexPreviousHeading === -1) return { contextHeadings: [] };

    let deckModification: string | undefined;
    if (this.headings[indexPreviousHeading].deckModification) {
      const mod = this.headings[indexPreviousHeading].deckModification.trim();

      // might get out of sync when moving Obsidian files around
      if (this.config.isDeckPathBased) {
        showMessage(
          {
            type: 'warning',
            message: `Deck path modification "${mod}" is applied to a path-based deck`,
          },
          'long',
        );
      }
      deckModification = this.applyDeckModification(mod) ?? this.config.deckName;
    }

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

    const contextProcessed = context.filter((n) => n !== null).map((i) => this.headings![i].text);
    return {
      contextHeadings: contextProcessed,
      deckModification,
    };
  }

  private applyDeckModification(mod: string): string | null {
    if (mod.slice(0, 2) !== '<<' && mod.slice(0, 2) !== '::') {
      return mod;
    }

    const modFragments = mod.split('::');
    const result = this.config.deckName.split('::');

    for (let i = 0; i < modFragments.length; ++i) {
      const fragment = modFragments[i];

      if (fragment === '') {
        if (i === 0) continue;
        else {
          showMessage(
            {
              type: 'error',
              message: `Empty deck encountered in deck path modificator "${mod}". Defaulting to "${this.config.deckName}"`,
            },
            'long',
          );
          return null;
        }
      } else if (fragment === '<<') {
        // Trying to go above root
        if (result.length === 0) {
          showMessage(
            {
              type: 'error',
              message: `Deck path modifier "${mod}" tried to navigate out of bounds for"${this.config.deckName}"`,
            },
            'long',
          );
          return null;
        }
        result.pop();
      } else {
        result.push(fragment);
      }
    }

    if (result.length === 0) return null;

    return result.join('::');
  }

  private parseTags(tags?: string) {
    if (!tags)
      return {
        tagsParsed: this.config.frontmatterTags ? [...this.config.frontmatterTags] : [],
        isFlashcard: false,
        isReversed: false,
      };

    const tagsSplit = tags.split(/\s*#/).map((t) => t.trim());

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
    const tagsParsed = this.config.frontmatterTags
      ? this.config.frontmatterTags.concat(
          nonFlashcardSpecificTags.map((tag) => tag.replace('/', '::')),
        )
      : nonFlashcardSpecificTags;

    return {
      tagsParsed,
      isFlashcard,
      isReversed,
    };
  }

  /**
   * Raw property arguments are not trimmed yet
   */
  private async parseCardContent({
    questionRaw,
    answerRaw,
    headingLevelCount,
    startIndex,
  }: ParseCardContentProps) {
    let question = questionRaw.trim();

    const { contextHeadings, deckModification } = this.getHeadingContext(
      startIndex,
      headingLevelCount,
    );
    if (this.config.headingContext) {
      // Remove current heading from context (should be fixed inside setHeadingContext)
      if (contextHeadings[contextHeadings.length - 1] === question) contextHeadings.pop();
      question = [...contextHeadings, question].join(
        // FIXME: this really was a bad choice!
        (this.settings.headingContextModeGlobal as { separator?: string })?.separator ??
          (DEFAULT_SETTINGS.headingContextModeGlobal as { separator: string }).separator,
      );
    }

    // TODO: embed media was previously handled with a rather hacky document call:
    // Array.from(document.documentElement.getElementsByClassName('internal-embed'));

    // eslint-disable-next-line prefer-const
    let { cardContentSubstituted: questionHTML, mediaLinks: mediaLinksQuestion } =
      this.substituteAndGetMediaLinks(question);
    // eslint-disable-next-line prefer-const
    let { cardContentSubstituted: answerHTML, mediaLinks: mediaLinksAnswer } =
      this.substituteAndGetMediaLinks(answerRaw.trim());
    const mediaLinks = [...mediaLinksQuestion, ...mediaLinksAnswer];

    questionHTML = await this.parseLine(questionHTML);
    answerHTML = await this.parseLine(answerHTML);

    // TODO: source support was removed - what was note?
    // if (this.settings.sourceSupport) fields['Source'] = note;
    const fields: AnkiFields = { Front: questionHTML, Back: answerHTML };
    return {
      mediaLinks,
      fields,
      deckName: deckModification,
    };
  }

  private substituteAndGetMediaLinks(cardContent: string) {
    const mediaLinkMatches = Array.from(
      cardContent.matchAll(RegExps.linksMedia) as unknown as RegExps.LinksMediaMatches,
    );

    let cardMatchWithEscapedMedia: string = cardContent;
    const mediaLinks = mediaLinkMatches.reverse().map(({ groups, index, ...mediaLinkMatch }) => {
      const a = cardMatchWithEscapedMedia.substring(0, index);
      const b = cardMatchWithEscapedMedia.substring(index! + mediaLinkMatch[0].length);

      const { html: mediaLinkHtml, mediaLink } = this.mediaLinkToHTML(groups);
      cardMatchWithEscapedMedia = a + mediaLinkHtml + b;

      return mediaLink;
    });

    return {
      cardContentSubstituted: cardMatchWithEscapedMedia,
      mediaLinks,
    };
  }

  private mediaLinkToHTML({ fileName, ...fileType }: RegExps.LinksMediaMatches[number]['groups']) {
    let html: string;
    let fileNameFull = fileName + '.';
    let mediaType: MediaLinkImmediate['type'];

    if ('image' in fileType && fileType.image) {
      const dimensions = fileType.dimension?.match(RegExps.dimensionHeightWidth) as unknown as
        | RegExps.DimensionMatch
        | undefined;

      mediaType = 'picture';
      fileNameFull += fileType.image;

      html = `<img src="${fileNameFull}" width="${dimensions?.groups.width ?? ''}" height="${dimensions?.groups.height ?? ''}">`;
    } else if ('audio' in fileType && fileType.audio) {
      mediaType = 'audio';
      fileNameFull += fileType.audio;

      html = `<audio controls="" src="${fileNameFull}"></audio>`;
    } else if ('video' in fileType && fileType.video) {
      mediaType = 'video';
      fileNameFull += fileType.video;

      // TODO: can dimensions also apply to this?
      html = `<video controls><source src="${fileNameFull}" /></video>`;
    } else if ('pdf' in fileType && fileType.pdf) {
      mediaType = 'other';
      fileNameFull += fileType.pdf;

      // TODO: can dimensions also apply to this?
      html = `<embed src="${fileNameFull}" type="application/pdf" width="800" height="600" />`;
    } else {
      throw Error(`Parsed media type with no detected filetype: ${fileName}`);
    }

    const mediaLink: MediaLinkImmediate = {
      fileName: fileNameFull,
      type: mediaType,
    };

    return {
      html,
      mediaLink,
    };
  }

  private async parseLine(cardContent: string) {
    // TODO: substituteEmbeddedExternalMediaLinks
    const substitutedNoteLinks = this.substituteNoteLinks(cardContent);

    const { cardContentSubstituted: minusMathJaxContent, mathJaxContentMap } =
      this.substituteMathJax(substitutedNoteLinks);

    const html = (await marked.parse(minusMathJaxContent, { breaks: true })).trimEnd();

    const htmlPlusMathJaxContent = this.reinsertMathJax(html, mathJaxContentMap);
    return htmlPlusMathJaxContent;
  }

  private substituteNoteLinks(cardContent: string) {
    const vaultNameURI = encodeURIComponent(this.vaultName);

    const noteReferenceLinks = Array.from(
      cardContent.matchAll(RegExps.linksMarkdownNote),
    ) as unknown as RegExps.LinksMarkdownNoteMatches;

    let cardContentSubstituted = cardContent;
    for (const { groups, index, ...match } of noteReferenceLinks.reverse()) {
      const fullMatch = match[0];
      console.debug('Note reference link match groups:\n"' + fullMatch + '"', groups);

      const { embedded, noteReference, elementReference, alt } = groups;

      const uniqueReference = this.metadataCache.getFirstLinkpathDest(
        noteReference,
        this.file.path,
      );
      if (!uniqueReference) {
        showMessage({
          type: 'warning',
          message: `Could not resolve note link reference [[${noteReference}]] in file ${this.file.path}`,
        });
        continue;
      }

      const referenceURI = encodeURIComponent(uniqueReference.path + (elementReference ?? ''));
      const href = `obsidian://open?vault=${vaultNameURI}&file=${referenceURI}`;
      let displayName = alt ? alt : uniqueReference.basename;
      if (embedded) displayName = '[' + displayName + ']';

      const html = `<a href="${href}">${displayName}</a>`;
      cardContentSubstituted =
        cardContentSubstituted.substring(0, index) +
        html +
        cardContentSubstituted.substring(index! + fullMatch.length);
    }
    return cardContentSubstituted;
  }

  private substituteMathJax(cardContent: string) {
    const mathJaxContentMap = new Map<string, string>();

    const processMathJaxMatch = (match: string, content: string) => {
      console.debug('Substituting MathJax content:', match, content);
      // Remove \n from the string later sent to AnkiConnect
      const contentTrimmed = content.trim();

      const hash = SparkMD5.hash(contentTrimmed);
      mathJaxContentMap.set(hash, contentTrimmed);

      const placeholder = `{{${hash}}}`;
      // NOTE: Double escaping to account marked removing one backslash
      return '\\\\(' + placeholder + '\\\\)';
    };

    const cardContentSubstituted = cardContent
      .replace(RegExps.mathBlock, processMathJaxMatch)
      .replace(RegExps.mathInline, processMathJaxMatch);

    return {
      mathJaxContentMap,
      cardContentSubstituted,
    };
  }

  private reinsertMathJax(cardContentHtml: string, mathJaxContentMap: Map<string, string>) {
    return cardContentHtml.replace(RegExps.mathJaxSubstitute, (match, start, md5Hash, end) => {
      const mathJaxContent = mathJaxContentMap.get(md5Hash);
      console.debug('Reinserting MathJax content for hash:', md5Hash, mathJaxContent);
      if (!mathJaxContent) {
        showMessage({
          type: 'warning',
          message: `Could not find MathJax content for substitute hash match "${match}"`,
        });
        return match;
      }
      return start + mathJaxContent + end;
    });
  }

  public getAnkiIDsTags(): number[] {
    const matches = [
      ...this.fileContents.matchAll(RegExps.andkiIdTags),
    ] as unknown as RegExps.AnkiIdTagsMatches;

    return matches.map((match) => Number(match.groups.id.substring(1)));
  }
}
