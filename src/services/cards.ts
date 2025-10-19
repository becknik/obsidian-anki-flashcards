import { App, FileSystemAdapter, FrontMatterCache, parseFrontMatterEntry, TFile } from 'obsidian';
import { Regex } from 'src/conf/regex';
import { Card } from 'src/entities/card';
import { Inlinecard } from 'src/entities/inlinecard';
import { Anki } from 'src/services/anki';
import { Parser } from 'src/services/parser';
import { Settings } from 'src/types/settings';
import { arrayBufferToBase64 } from 'src/utils';
import { FlashcardProcessingLog } from './types';

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
      globalTags = this.parseGlobalTags(this.file);
      // TODO with empty check that does not call ankiCards line
      const ankiBlocks = this.parser.getAnkiIDsBlocks(this.file);
      const ankiCards = ankiBlocks
        ? await this.anki.getCards(this.getAnkiIDs(ankiBlocks))
        : undefined;

      const cards: Card[] = this.parser.generateFlashcards(
        this.file,
        deckName,
        vaultName,
        filePath,
        globalTags
      );
      const [cardsToCreate, cardsToUpdate, cardsNotInAnki] = this.filterByUpdate(ankiCards, cards);
      const cardIds: number[] = this.getCardsIds(ankiCards, cards);
      const cardsToDelete: number[] = this.parser.getCardsToDelete(this.file);

      console.info('Flashcards: Cards to create');
      console.info(cardsToCreate);
      console.info('Flashcards: Cards to update');
      console.info(cardsToUpdate);
      console.info('Flashcards: Cards to delete');
      console.info(cardsToDelete);
      if (cardsNotInAnki) {
        console.info('Flashcards: Cards not in Anki (maybe deleted)');
        for (const card of cardsNotInAnki) {
          this.notifications.push({
            type: 'error',
            message: `Card with ID ${card.id} is not in Anki!`,
          });
        }
      }
      console.info(cardsNotInAnki);

      this.insertMedias(cards, sourcePath);
      await this.deleteCardsOnAnki(cardsToDelete, ankiBlocks);
      await this.updateCardsOnAnki(cardsToUpdate);
      await this.insertCardsOnAnki(cardsToCreate, frontmatter, deckName);

      // Update decks if needed
      const deckNeedToBeChanged = await this.deckNeedToBeChanged(cardIds, deckName);
      if (deckNeedToBeChanged) {
        try {
          this.anki.changeDeck(cardIds, deckName);
          this.notifications.push({
            type: 'info',
            message: 'Cards moved in new deck',
          });
        } catch (e) {
          console.error('❌ error', e);
          throw Error('Could not update deck the file.');
        }
      }

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
            sourcePath
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

  private async insertCardsOnAnki(
    cardsToCreate: Card[],
    frontmatter: FrontMatterCache,
    deckName: string
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
      cardsTotal += card.reversed ? 2 : 1;
      if (card.id !== null) {
        cardsInserted += card.reversed ? 2 : 1;
      } else {
        this.notifications.push({
          type: 'error',
          message: `Could not add '${card.initialContent}'`,
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
      if (card.id !== null && !card.inserted) {
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

  private async updateCardsOnAnki(cards: Card[]): Promise<number | undefined> {
    if (cards.length) {
      try {
        this.anki.updateCards(cards);
        this.notifications.push({
          type: 'success',
          message: `Updated ${cards.length}/${cards.length} cards`,
        });
      } catch (e) {
        console.error('❌ error', e);
        throw Error('Could not update cards on Anki');
      }

      return cards.length;
    }
  }

  public async deleteCardsOnAnki(
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

  private getAnkiIDs(blocks: RegExpMatchArray[]): number[] {
    const IDs: number[] = [];
    for (const b of blocks) {
      IDs.push(Number(b[1]));
    }

    return IDs;
  }

  public filterByUpdate(ankiCards: any, generatedCards: Card[]) {
    let cardsToCreate: Card[] = [];
    const cardsToUpdate: Card[] = [];
    const cardsNotInAnki: Card[] = [];

    if (ankiCards) {
      for (const flashcard of generatedCards) {
        // Inserted means that anki blocks are available, that means that the card should
        // 	(the user can always delete it) be in Anki
        let ankiCard = undefined;
        if (flashcard.inserted) {
          ankiCard = ankiCards.filter((card: any) => Number(card.noteId) === flashcard.id)[0];
          if (!ankiCard) {
            cardsNotInAnki.push(flashcard);
          } else if (!flashcard.match(ankiCard)) {
            flashcard.oldTags = ankiCard.tags;
            cardsToUpdate.push(flashcard);
          }
        } else {
          cardsToCreate.push(flashcard);
        }
      }
    } else {
      cardsToCreate = [...generatedCards];
    }

    return [cardsToCreate, cardsToUpdate, cardsNotInAnki];
  }

  public async deckNeedToBeChanged(cardsIds: number[], deckName: string) {
    const cardsInfo = await this.anki.cardsInfo(cardsIds);
    console.log('Flashcards: Cards info');
    console.log(cardsInfo);
    if (cardsInfo.length !== 0) {
      return cardsInfo[0].deckName !== deckName;
    }

    return false;
  }

  public getCardsIds(ankiCards: any, generatedCards: Card[]): number[] {
    let ids: number[] = [];

    if (ankiCards) {
      for (const flashcard of generatedCards) {
        let ankiCard = undefined;
        if (flashcard.inserted) {
          ankiCard = ankiCards.filter((card: any) => Number(card.noteId) === flashcard.id)[0];
          if (ankiCard) {
            ids = ids.concat(ankiCard.cards);
          }
        }
      }
    }

    return ids;
  }

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
