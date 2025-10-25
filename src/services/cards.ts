import {
  App,
  FileSystemAdapter,
  parseFrontMatterEntry,
  parseFrontMatterTags,
  TFile,
} from 'obsidian';
import { Regex } from 'src/conf/regex';
import { Card } from 'src/entities/card';
import { Inlinecard } from 'src/entities/inlinecard';
import { Anki } from 'src/services/anki';
import { Parser } from 'src/services/parser';
import { Settings } from 'src/types/settings';
import { arrayBufferToBase64, showMessage } from 'src/utils';
import { ACNotesInfo } from './types';

export class CardsService {
  private app: App;
  private settings: Settings;
  private regex: Regex;
  private parser: Parser;
  private anki: Anki;

  private totalOffset: number;
  private file: string;

  constructor(app: App, settings: Settings) {
    this.app = app;
    this.settings = settings;
    this.regex = new Regex(this.settings);
    this.parser = new Parser(this.regex, this.settings);
    this.anki = new Anki();
  }

  /**
   * Process the flashcards in file and sync them with Anki
   *
   * Precondition: AnkiConnect connection established
   */
  public async process(file: TFile): Promise<void> {
    const fileContentsPromise = this.app.vault.read(file);

    // Determining deck name

    const fileCachedMetadata = this.app.metadataCache.getFileCache(file);
    // using negation due to possible undefined parent
    const isNoteNotInValutRoot = file.parent?.path !== '/';

    let deckName = this.settings.deck;
    if (fileCachedMetadata?.frontmatter) {
      const frontmatter = fileCachedMetadata.frontmatter;
      deckName = parseFrontMatterEntry(frontmatter, 'cards-deck');
    } else if (this.settings.folderBasedDeck && isNoteNotInValutRoot) {
      deckName = file.parent!.path.split('/').join('::');
    }

    // Sending static context stuff over to Anki
    // TODO:  shouldn't be done when processing every file

    this.anki.storeCodeHighlightMedias();
    await this.anki.createModels(this.settings.sourceSupport, this.settings.codeHighlightSupport);
    await this.anki.createDeck(deckName);

    // Preparing the card parsing

    const fileContents = await fileContentsPromise;
    // TODO: isn't this a problematic way to do share state between methods?
    this.file = fileContents;

    const ankiIdTags = this.parser.getAnkiIDsTags(fileContents);
    console.debug('Anki IDs found in the file', ankiIdTags);

    const ankiCardsPromise = ankiIdTags.length > 0 ? this.anki.getCards(ankiIdTags) : null;

    const valutName = this.app.vault.getName();
    const frontmatterTags = parseFrontMatterTags(fileCachedMetadata?.frontmatter);

    const generatedCards = this.parser.generateFlashcards({
      fileContents,
      deckName,
      valutName,
      frontmatterTags,
    });

    // Determining the Delta to Anki & apply transformations via AnkiConnect

    const ankiCards = await ankiCardsPromise;
    console.debug('Anki cards fetched from Anki', ankiCards);

    const { create, update, ignore } = this.filterForCreateUpdateIgnore(ankiCards, generatedCards);

    console.debug('Cards to create', create);
    console.debug('Cards to update', update);
    console.debug('Cards to ignore', ignore);

    this.insertMedias(generatedCards, file.path);

    await this.anki.updateCards(update, (msg) =>
      showMessage({
        type: 'info',
        message: msg,
      }),
    );
    await this.insertCardsOnAnki(create);

    // Write back changed file content

    this.writeAnkiBlocks(create);

    if (create.length || update.length) {
      try {
        await this.app.vault.modify(file, this.file);
      } catch (e) {
        console.error('❌ error', e);
        throw Error('Could not update the file.');
      }
    } else {
      showMessage({
        type: 'info',
        message: 'Nothing to do. Everything is up to date',
      });
    }
  }

  private async insertMedias(cards: Card[], sourcePath: string) {
    try {
      // Currently the media are created for every run, this is not a problem since Anki APIs overwrite the file
      // A more efficient way would be to keep track of the medias saved
      await this.generateMediaLinks(cards, sourcePath);
      await this.anki.storeMediaFiles(cards);
    } catch (e) {
      console.error('❌ error', e);
      Error('Error: Could not upload medias');
    }
  }

  private async generateMediaLinks(cards: Card[], sourcePath: string) {
    if (this.app.vault.adapter instanceof FileSystemAdapter) {
      // @ts-ignore: Unreachable code error

      for (const card of cards) {
        for (const media of card.mediaNames) {
          const image = this.app.metadataCache.getFirstLinkpathDest(
            decodeURIComponent(media),
            sourcePath,
          );
          try {
            console.debug('Reading media from vault:', image);
            const binaryMedia = await this.app.vault.readBinary(image!); // TODO image might be undefined
            card.mediaBase64Encoded.push(arrayBufferToBase64(binaryMedia));
          } catch (e) {
            console.error('❌ error', e);
            throw Error('Could not read media');
          }
        }
      }
    }
  }

  private async insertCardsOnAnki(cardsToCreate: Card[]): Promise<number | undefined> {
    if (cardsToCreate.length === 0) return;

    const ids = await this.anki.addCards(cardsToCreate);

    let cardsInserted = 0;
    cardsToCreate.map((card, idx) => {
      // TODO: how can id possibly be null here? Previous implementation had this check...
      card.id = ids[idx];
      cardsInserted += card.flags.isReversed ? 2 : 1;
    });

    showMessage({
      type: 'success',
      message: `Inserted ${cardsInserted} cards`,
    });
    return cardsInserted;
  }

  /**
   * Uses Obsidian's block reference syntax to write the Anki ID at the end of the card regex match
   * https://help.obsidian.md/links#Link+to+a+block+in+a+note
   */
  private writeAnkiBlocks(cardsToCreate: Card[]) {
    for (const card of cardsToCreate.toReversed()) {
      const isInline = card instanceof Inlinecard;
      const idFormatted = (card instanceof Inlinecard ? ' ' : '\n') + card.getIdFormatted();

      // shift old id tags behind the newly added one, even though the new tag isn't detected as valid Markdown in the editor...
      // Chose this  since it is easiest to parse the most likely working id with a regex as the first one
      let oldIdTagShift = 0;
      if (card.idBackup) oldIdTagShift += 14 + 1; // #('^' + ID) = 14; #(\n|  ) = 1 (second ' ' is added above for new id tags to have space)

      this.file =
        this.file.substring(0, card.endOffset - oldIdTagShift) +
        idFormatted +
        this.file.substring(card.endOffset - oldIdTagShift, this.file.length + 1);
    }
  }

  /**
   * TODO: Delete dangling tags and tags with strikethrough from anki
   */
  public async deleteTagsFromAnki(
    cards: number[],
    ankiBlocks: RegExpMatchArray[],
  ): Promise<number | undefined> {
    if (cards.length) {
      let deletedCards = 0;
      for (const block of ankiBlocks) {
        const id = Number(block[1]);

        // Deletion of cards that need to be deleted (i.e. blocks ID that don't have content)
        if (cards.includes(id)) {
          try {
            this.anki.deleteCards(cards);
            deletedCards++;

            this.file =
              this.file.substring(0, block['index']) +
              this.file.substring(
                // TODO check if the block is indexable with "index"
                block['index']! + block[0].length,
                this.file.length,
              );
            this.totalOffset -= block[0].length;
            showMessage({
              type: 'success',
              message: `Deleted ${deletedCards}/${cards.length} cards`,
            });
          } catch (e) {
            console.error('❌ error', e);
            throw Error('Error, could not delete the card from Anki');
          }
        }
      }

      return deletedCards;
    }
  }

  public filterForCreateUpdateIgnore(ankiCards: ACNotesInfo[] | null, generatedCards: Card[]) {
    const cardsToCreate: Card[] = [...generatedCards];
    if (!ankiCards) {
      return { create: cardsToCreate, update: [], ignore: [] };
    }

    const cardsToUpdate: {
      generated: Card;
      anki: ACNotesInfo;
      updatesToApply: {
        fields?: true;
        tags?: true;
        decks?: true;
      };
    }[] = [];
    const cardsNotToUpdate: Card[] = [];

    for (const card of generatedCards) {
      const shouldBePresentInAnki = card.id !== null;
      if (shouldBePresentInAnki) {
        const ankiCard = ankiCards.filter((c) => c.noteId === card.id)[0];
        // console.debug('Matching generated card', card, 'with Anki card', ankiCard);

        if (!ankiCard) {
          showMessage(
            {
              type: 'warning',
              message: `Card with ID tag "${card.id}" will be re-created with a new ID`,
            },
            'long',
          );
          continue;
        }
        cardsToCreate.splice(cardsToCreate.indexOf(card), 1);

        const changed = card.matches(ankiCard);
        if (changed) {
          cardsToUpdate.push({
            generated: card,
            anki: ankiCard,
            updatesToApply: changed,
          });
        } else {
          cardsNotToUpdate.push(card);
        }
      }
    }

    return { create: cardsToCreate, update: cardsToUpdate, ignore: cardsNotToUpdate };
  }
}
