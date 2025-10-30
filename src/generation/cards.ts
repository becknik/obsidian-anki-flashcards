import {
    App,
    arrayBufferToBase64,
    FileSystemAdapter,
    parseFrontMatterEntry,
    parseFrontMatterTags,
    TFile
} from 'obsidian';
import * as SparkMD5 from 'spark-md5';
import { ACStoreMediaFile, Card, CardInterface } from 'src/entities/card';
import { Inlinecard } from 'src/entities/inlinecard';
import { showMessage } from 'src/utils';
import { ACNotesInfo, CardUpdateDelta } from './types';
import { Settings } from 'src/types/settings';
import { AnkiConnection } from './anki';
import { Parser } from './parser';

export class CardsProcessor {
  private app: App;
  private settings: Settings;

  private totalOffset: number;
  private file: string;

  constructor(app: App, settings: Settings) {
    this.app = app;
    this.settings = settings;
  }

  /**
   * Process the flashcards in file and sync them with Anki
   *
   * Precondition: AnkiConnect connection established
   */
  public async process(connection: AnkiConnection, file: TFile): Promise<void> {
    const fileContentsPromise = this.app.vault.read(file);

    // Determining deck name & creating it

    const fileCachedMetadata = this.app.metadataCache.getFileCache(file);
    // using negation due to possible undefined parent
    const isNoteNotInValutRoot = file.parent?.path !== '/';

    let deckName = this.settings.defaultDeck;
    if (fileCachedMetadata?.frontmatter) {
      const frontmatter = fileCachedMetadata.frontmatter;
      deckName = parseFrontMatterEntry(frontmatter, 'cards-deck');
    } else if (this.settings.pathBasedDeck && isNoteNotInValutRoot) {
      deckName = file.parent!.path.split('/').join('::');
    }

    await connection.createDeck(deckName);

    // Preparing the card parsing

    const fileContents = await fileContentsPromise;
    // TODO: isn't this a problematic way to do share state between methods?
    this.file = fileContents;

    const frontmatterTags = parseFrontMatterTags(fileCachedMetadata?.frontmatter);

    const parser = new Parser({
      file,
      fileContents,
      settings: this.settings,
      vaultName: this.app.vault.getName(),
      deckName,
      metadataCache: this.app.metadataCache,
      frontmatterTags,
    });

    const ankiIdTags = parser.getAnkiIDsTags();
    console.debug('Anki IDs found in the file', ankiIdTags);
    const ankiCardsPromise = ankiIdTags.length > 0 ? connection.getCards(ankiIdTags) : null;

    const generatedCardsPromise = await parser.generateFlashcards();

    // Determining the Delta to Anki & apply transformations via AnkiConnect

    const ankiCards = await ankiCardsPromise;
    console.debug('Anki cards fetched', ankiCards);

    const { create, update, ignore } = this.filterForCreateUpdateIgnore(
      ankiCards,
      generatedCardsPromise,
    );

    console.debug('Cards to create', create);
    console.debug('Cards to update', update);
    console.debug('Cards to ignore', ignore);

    // TODO: In a perfect world, we'd determine the delta of media in between Anki and the generated cards to clean up
    // behind our generated cards. Since AnkiConnect to my knowledge doesn't support listing media of a note, this is
    // currently not really feasible without parsing the media names from the fields, which only would work best effort
    // due to #6
    await this.storeMediaInCards(create, file.path);
    await this.storeMediaInCards(
      update.filter((u) => u.updatesToApply.media).map((u) => u.generated),
      file.path,
    );

    await this.insertCardsOnAnki(connection, create);
    await connection.updateCards(update, (msg) =>
      showMessage({
        type: 'info',
        message: msg,
      }),
    );

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

  private async storeMediaInCards(cards: Card[], noteFilePath: string) {
    for (const card of cards) {
      const cardMedia: CardInterface['media'] = {};

      for (const mediaLink of card.mediaLinks) {
        // TODO: handle 'other' media types
        if (mediaLink.type === 'other') continue;

        const mediaFile = this.app.metadataCache.getFirstLinkpathDest(
          // TODO: why would this be URI encoded?
          // decodeURIComponent(media),
          mediaLink.fileName,
          noteFilePath,
        );
        console.debug(`Resolved media file path "${mediaFile?.path}" for "${mediaLink.fileName}"`);
        if (!mediaFile) {
          showMessage({
            type: 'error',
            message: `Media file "${mediaLink}" could not be accessed from vault path "${noteFilePath.substring(0, 20)}".`,
          });
          continue;
        }

        let media: Partial<ACStoreMediaFile> = { filename: mediaFile.name };

        if (this.settings.transferMediaFiles) {
          const message = `Trying to read media from path "${mediaFile.path}"`;
          console.debug(message, card);

          let binaryMedia: ArrayBuffer;
          try {
            binaryMedia = await this.app.vault.readBinary(mediaFile);
          } catch (e) {
            showMessage({
              type: 'error',
              message: message + ' failed:' + e,
            });
            continue;
          }

          media = {
            ...media,
            type: 'data',
            data: arrayBufferToBase64(binaryMedia),
            skipHash: SparkMD5.ArrayBuffer.hash(binaryMedia),
          };
        } else {
          media = {
            ...media,
            type: 'path',
            path:
              (this.app.vault.adapter as FileSystemAdapter).getBasePath() + '/' + mediaFile.path,
            // I'm trusting AnkiConnect here to do the hashing on its side :)
          };
        }

        if (!cardMedia[mediaLink.type])
          cardMedia[mediaLink.type] = [media as Required<ACStoreMediaFile>];
        else cardMedia[mediaLink.type]!.push(media as Required<ACStoreMediaFile>);

        // AnkiConnect.storeMediaFile() got an unexpected keyword argument 'type'
        delete media.type;
      }

      if (Object.keys(cardMedia).length > 0) card.media = cardMedia;
      console.debug(
        `Generated media-diff for card "${card.id ?? card.fields.Front.substring(0, 20)}"`,
        card.media,
      );
    }
  }

  private async insertCardsOnAnki(connection: AnkiConnection, cardsToCreate: Card[]): Promise<number | undefined> {
    if (cardsToCreate.length === 0) return;

    const ids = await connection.addCards(cardsToCreate);

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
      const idFormatted = (isInline ? ' ' : '\n') + card.getIdFormatted();

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
    connection: AnkiConnection,
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
            connection.deleteCards(cards);
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

    const cardsToUpdate: CardUpdateDelta[] = [];
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
