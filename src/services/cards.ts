import { App, FileSystemAdapter, FrontMatterCache, parseFrontMatterEntry, TFile } from 'obsidian';
import { Regex } from 'src/conf/regex';
import { Card } from 'src/entities/card';
import { Inlinecard } from 'src/entities/inlinecard';
import { Anki } from 'src/services/anki';
import { Parser } from 'src/services/parser';
import { Settings } from 'src/types/settings';
import { arrayBufferToBase64 } from 'src/utils';
import { FlashcardProcessingLog, ACNotesInfoResult, CardUpdateDelta, ACNotesInfo } from './types';

export class CardsService {
  private app: App;
  private settings: Settings;
  private regex: Regex;
  private parser: Parser;
  private anki: Anki;

  private updateFile: boolean;
  private totalOffset: number;
  private file: string;
  private notifications: FlashcardProcessingLog[];

  constructor(app: App, settings: Settings) {
    this.app = app;
    this.settings = settings;
    this.regex = new Regex(this.settings);
    this.parser = new Parser(this.regex, this.settings);
    this.anki = new Anki();
  }

  public async process(activeFile: TFile): Promise<FlashcardProcessingLog[]> {
    this.regex.update(this.settings);

    await this.anki.ping();

    // Init for the execute phase
    this.updateFile = false;
    this.totalOffset = 0;
    this.notifications = [];
    const filePath = activeFile.basename;
    const sourcePath = activeFile.path;
    const fileCachedMetadata = this.app.metadataCache.getFileCache(activeFile);
    const vaultName = this.app.vault.getName();
    let globalTags: string[] | undefined = undefined;

    // Parse frontmatter
    const frontmatter = fileCachedMetadata?.frontmatter!; // TODO check if frontmatter is undefined
    let deckName = '';
    if (parseFrontMatterEntry(frontmatter, 'cards-deck')) {
      deckName = parseFrontMatterEntry(frontmatter, 'cards-deck');
    } else if (this.settings.folderBasedDeck && activeFile.parent?.path !== '/') {
      // If the current file is in the path "programming/java/strings.md" then the deck name is "programming::java"
      // TODO parent might be undefined
      deckName = activeFile.parent!.path.split('/').join('::');
    } else {
      deckName = this.settings.deck;
    }

    try {
      this.anki.storeCodeHighlightMedias();
      await this.anki.createModels(this.settings.sourceSupport, this.settings.codeHighlightSupport);
      await this.anki.createDeck(deckName);
      this.file = await this.app.vault.read(activeFile);
      if (!this.file.endsWith('\n')) {
        this.file += '\n';
      }

      // TODO:
      globalTags = this.parseGlobalTags(this.file);

      const ankiIdTags = this.parser.getAnkiIDsTags(this.file);
      console.debug('Anki IDs found in the file', ankiIdTags);

      const ankiCardsPromise = this.anki.getCards(ankiIdTags);

      const generatedCards = this.parser.generateFlashcards(
        this.file,
        deckName,
        vaultName,
        filePath,
        globalTags,
      );

      const ankiCards = await ankiCardsPromise;
      console.debug('Anki cards fetched from Anki', ankiCards);

      const { create, update, ignore } = this.filterForCreateUpdateIgnore(
        ankiCards,
        generatedCards,
      );

      console.debug('Cards to create', create);
      console.debug('Cards to update', update);
      console.debug('Cards to ignore', ignore);

      this.insertMedias(generatedCards, sourcePath);

      await this.anki.updateCards(update, (msg) =>
        this.notifications.push({
          type: 'info',
          message: msg,
        }),
      );
      await this.insertCardsOnAnki(create, frontmatter, deckName);

      // Update file

      if (this.updateFile) {
        try {
          await this.app.vault.modify(activeFile, this.file);
        } catch (e) {
          console.error('❌ error', e);
          throw Error('Could not update the file.');
        }
      }

      if (!this.notifications.length) {
        this.notifications.push({
          type: 'info',
          message: 'Nothing to do. Everything is up to date',
        });
      }
      return this.notifications;
    } catch (e) {
      console.error('❌ error', e);
      throw Error('Something went wrong');
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

  // TODO: overhaul this one too
  private async insertCardsOnAnki(
    cardsToCreate: Card[],
    frontmatter: FrontMatterCache,
    deckName: string,
  ): Promise<number | undefined> {
    if (cardsToCreate.length === 0) return;

    let ids: number[] | undefined = undefined;
    try {
      ids = await this.anki.addCards(cardsToCreate);
    } catch (e) {
      console.error('❌ error', e);
      throw Error('Could not write cards to Anki');
    }

    ids.forEach((id, idx) => (cardsToCreate[idx].id = id));

    let cardsInserted = 0;
    let cardsTotal = 0;
    cardsToCreate.forEach((card) => {
      cardsTotal += card.flags.isReversed ? 2 : 1;
      if (card.id !== null) {
        cardsInserted += card.flags.isReversed ? 2 : 1;
      } else {
        this.notifications.push({
          type: 'error',
          message: `Could not add '${card.frontContent}'`,
        });
      }
    });

    // update frontmatter
    // TODO this might not be needed?
    const activeFile = this.app.workspace.getActiveFile()!;
    this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
      frontmatter['cards-deck'] = deckName;
    });

    this.writeAnkiBlocks(cardsToCreate);

    this.notifications.push({
      type: 'success',
      message: `Inserted successfully ${cardsInserted}/${cardsTotal} cards`,
    });
    return cardsInserted;
  }

  private writeAnkiBlocks(cardsToCreate: Card[]) {
    for (const card of cardsToCreate) {
      // Card.id cannot be null, because if written already previously it has an ID,
      //   if it has been inserted it has an ID too
      if (card.id !== null && !card.flags.presentInAnki) {
        let id = card.getIdFormat();
        if (card instanceof Inlinecard) {
          if (this.settings.inlineID) {
            id = ' ' + id;
          } else {
            id = '\n' + id;
          }
        }
        card.endOffset += this.totalOffset;
        const offset = card.endOffset;

        this.updateFile = true;
        this.file =
          this.file.substring(0, offset) + id + this.file.substring(offset, this.file.length + 1);
        this.totalOffset += id.length;
      }
    }
  }

  /**
   * TODO: Delete dangling tags and tags with strikethough from anki
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

            this.updateFile = true;
            this.file =
              this.file.substring(0, block['index']) +
              this.file.substring(
                // TODO check if the block is indexable with "index"
                block['index']! + block[0].length,
                this.file.length,
              );
            this.totalOffset -= block[0].length;
            this.notifications.push({
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

  public filterForCreateUpdateIgnore(ankiCards: ACNotesInfo[], generatedCards: Card[]) {
    const cardsToCreate: Card[] = [...generatedCards];
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
      const shouldBePresentInAnki = card.flags.presentInAnki;
      if (shouldBePresentInAnki) {
        const ankiCard = ankiCards.filter((c) => c.noteId === card.id)[0];
        console.debug('Matching generated card', card, 'with Anki card', ankiCard);

        if (!ankiCard) {
          this.notifications.push({
            type: 'warning',
            message: `Card ${card.id} should be present in Anki but wasn't found! Will re-create...`,
          });
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

  // TODO: overhaul
  public parseGlobalTags(file: string): string[] {
    let globalTags: string[] = [];

    const tags = file.match(/(?:cards-)?tags: ?(.*)/im);
    globalTags = tags ? tags[1].match(this.regex.globalTagsSplitter)! : [];

    if (globalTags) {
      for (let i = 0; i < globalTags.length; i++) {
        globalTags[i] = globalTags[i].replace('#', '');
        globalTags[i] = globalTags[i].replace(/\//g, '::');
        globalTags[i] = globalTags[i].replace(/\[\[(.*)\]\]/, '$1');
        globalTags[i] = globalTags[i].trim();
        globalTags[i] = globalTags[i].replace(/ /g, '-');
      }

      return globalTags;
    }

    return [];
  }
}
