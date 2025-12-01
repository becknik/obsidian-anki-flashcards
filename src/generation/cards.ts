import { createTwoFilesPatch, diffArrays } from 'diff';
import { App, arrayBufferToBase64, FileSystemAdapter, TFile } from 'obsidian';
import * as SparkMD5 from 'spark-md5';
import { Card, CardInterface } from 'src/entities/card';
import { Inlinecard } from 'src/entities/inlinecard';
import { RegExps } from 'src/regex';
import { ACNotesInfo, ACStoreMediaFile, CardDelta, CardUpdateDelta } from 'src/types/anki-connect';
import { Settings } from 'src/types/settings';
import { showMessage } from 'src/utils';
import { AnkiConnection } from './anki';
import { Parser } from './parser';

export class CardsProcessor {
  private app: App;
  private settings: Settings;

  constructor(app: App, settings: Settings) {
    this.app = app;
    this.settings = settings;
  }

  public async diffCard(connection: AnkiConnection, file: TFile) {
    const deltas: CardDelta[] = [];
    await this.process(connection, file, false, deltas);
    return deltas;
  }

  /**
   * Process the flashcards in file and sync them with Anki
   *
   * Precondition: AnkiConnect connection established
   */
  public async process(
    connection: AnkiConnection,
    file: TFile,
    isFileActive: boolean = false,
    deltas?: CardDelta[],
  ): Promise<{ created: number; updated: number; ignored: number } | void> {
    const fileContentsPromise = this.app.vault.read(file);

    const fileContents = await fileContentsPromise;
    const parser = new Parser({
      file,
      fileContents,
      settings: this.settings,
      vaultName: this.app.vault.getName(),
      metadataCache: this.app.metadataCache,
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

    if (deltas) {
      this.processDeltas(deltas, update, create);
      return;
    }

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
    await connection.updateCards(update);

    // Write back changed file content

    if (create.length || update.length) {
      try {
        if (isFileActive) {
          // this is advised by Obsidian since it is supposed to be faster
          await this.app.vault.modify(file, this.writeAnkiBlocks(fileContents, create));
        } else {
          await this.app.vault.process(file, (data) => this.writeAnkiBlocks(data, create));
        }
      } catch (e) {
        console.error('❌ error', e);
        throw Error('Could not update the file.');
      }

      return { created: create.length, updated: update.length, ignored: ignore.length };
    } else {
      showMessage({
        type: 'info',
        message: 'Nothing to do. Everything is up to date',
      });
    }
  }

  private processDeltas(deltas: CardDelta[], updates: CardUpdateDelta[], creates: Card[]) {
    updates.forEach(({ updatesToApply, generated, anki }) => {
      if (updatesToApply.fields) {
        deltas.push({
          createOrId: generated.id!,
          type: 'fields',
          diff: createTwoFilesPatch(
            'anki',
            'generated',
            JSON.stringify(
              Object.entries(anki.fields).reduce(
                (acc, [k, v]) => {
                  acc[k] = v.value;
                  return acc;
                },
                {} as Record<string, string>,
              ),
              null,
              2,
            ),
            JSON.stringify(generated.fields, null, 2),
          ),
        });
      }

      if (updatesToApply.tags) {
        deltas.push({
          createOrId: generated.id!,
          type: 'tags',
          diff: createTwoFilesPatch(
            'anki',
            'generated',
            JSON.stringify(anki.tags, null, 2),
            JSON.stringify(generated.tags, null, 2),
          ),
        });
      }

      if (updatesToApply.deck) {
        deltas.push({
          createOrId: generated.id!,
          type: 'deck',
          diff: createTwoFilesPatch('anki', 'generated', anki.deck, generated.deckName),
        });
      }

      if (updatesToApply.model) {
        deltas.push({
          createOrId: generated.id!,
          type: 'model',
          diff: createTwoFilesPatch('anki', 'generated', anki.modelName, generated.modelName),
        });
      }
    });

    creates.forEach((card) => {
      deltas.push({
        createOrId: 'create',
        type: 'fields',
        diff: createTwoFilesPatch(
          'none',
          'generated',
          '',
          JSON.stringify(card.toAnkiCard(), null, 2),
        ),
      });
    });
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
            message: `Media file "${mediaLink.fileName}" could not be accessed from vault path "${noteFilePath.substring(0, 20)}".`,
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
              message: message + ' failed: ' + e,
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

  private async insertCardsOnAnki(connection: AnkiConnection, cardsToCreate: Card[]) {
    if (cardsToCreate.length === 0) return;

    const ids = await connection.addCardsAndDecks(cardsToCreate);

    let cardsInserted = 0;
    cardsToCreate.map((card, idx) => {
      // TODO: how can id possibly be null here? Previous implementation had this check...
      card.id = ids[idx];
      cardsInserted += card.isReversed ? 2 : 1;
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
  private writeAnkiBlocks(fileContents: string, cardsToCreate: Card[]) {
    let fileContentsUpdated = fileContents;
    for (const card of cardsToCreate.toReversed()) {
      const isInline = card instanceof Inlinecard;
      const idFormatted = (isInline ? ' ' : '\n') + card.getIdFormatted();

      // shift old id tags behind the newly added one, even though the new tag isn't detected as valid Markdown in the editor...
      // Chose this  since it is easiest to parse the most likely working id with a regex as the first one
      let idTagShift = 0;
      if (card.idBackup) idTagShift += 14 + 1; // #('^' + ID) = 14; #(\n|  ) = 1 (second ' ' is added above for new id tags to have space)

      let removeSepAndNewlineOffset = 0;
      // remove multi-line card separator and potential prefix-whitespace chars if present
      if (!isInline && fileContents.substring(card.endOffset - 4, card.endOffset) === '%%%%') {
        const matches = fileContentsUpdated
          .substring(card.initialOffset, card.endOffset)
          // The '%%%%' separator might be misplaced after a series of whitespace characters in extreme cases
          // Also, since the %%%% might be placed in the next line, it introduces a additional newline character which is removed with this
          .match(/\s*%%%%/g)!;
        removeSepAndNewlineOffset = matches.last()!.length ?? 4;

        fileContentsUpdated =
          fileContentsUpdated.substring(0, card.endOffset - removeSepAndNewlineOffset) +
          fileContentsUpdated.substring(card.endOffset, fileContentsUpdated.length);
      } else if (
        isInline &&
        // not sure why -1 is needed here, but it works...
        fileContents.substring(card.endOffset - 2, card.endOffset) === '%%'
      ) {
        const matches = fileContentsUpdated
          .substring(card.initialOffset, card.endOffset)
          .match(RegExps.scopedSettings)! as unknown as RegExps.ScopedSettingsMatch;
        removeSepAndNewlineOffset = matches[0].length + 1; // account for \n
      } else {
        // place id before tailing newlines and other whitespace characters. two should be the max allowed by the regexps
        if (fileContents[card.endOffset - idTagShift - 1].match(/\s/)) idTagShift += 1;
        if (fileContents[card.endOffset - idTagShift - 1].match(/\s/)) idTagShift += 1;
      }

      fileContentsUpdated =
        fileContentsUpdated.substring(0, card.endOffset - removeSepAndNewlineOffset - idTagShift) +
        idFormatted +
        fileContentsUpdated.substring(
          card.endOffset - removeSepAndNewlineOffset - idTagShift,
          fileContentsUpdated.length + 1,
        );
    }

    return fileContentsUpdated;
  }

  public filterForCreateUpdateIgnore(ankiCards: ACNotesInfo[] | null, generatedCards: Card[]) {
    const cardsToCreate: Card[] = [...generatedCards];
    if (!ankiCards) {
      return { create: cardsToCreate, update: [], ignore: [] };
    }

    const cardsToUpdate: CardUpdateDelta[] = [];
    const cardsToIgnore: Card[] = [];

    for (const cardGenerated of generatedCards) {
      const shouldBePresentInAnki = cardGenerated.id !== null;
      if (!shouldBePresentInAnki) continue;

      const ankiCard = ankiCards.filter((c) => c.noteId === cardGenerated.id)[0];
      if (!ankiCard) {
        showMessage(
          {
            type: 'warning',
            message: `Card with ID tag "${cardGenerated.id}" will be re-created with a new ID`,
          },
          'long',
        );
        continue;
      }

      cardsToCreate.remove(cardGenerated);
      const hasCardChanged = cardGenerated.matches(ankiCard);

      // not updating  the card if the only change is tags to preserve were added on Anki side
      if (hasCardChanged && hasCardChanged.tags) {
        const diff = diffArrays(cardGenerated.tags.toSorted(), ankiCard.tags.toSorted());
        for (const part of diff) {
          if (part.added && this.settings.ankiTagsToPreserve.contains(part.value[0])) {
            cardGenerated.tags.push(...part.value);
          }
        }

        const secondLook = diffArrays(cardGenerated.tags.toSorted(), ankiCard.tags.toSorted());
        if (secondLook.length === 1 && !secondLook[0].added && !secondLook[0].removed) {
          hasCardChanged.tags = undefined;
          if (!hasCardChanged.fields && !hasCardChanged.media && !hasCardChanged.deck) {
            continue;
          }
        }
      }

      if (hasCardChanged) {
        cardsToUpdate.push({
          generated: cardGenerated,
          anki: ankiCard,
          updatesToApply: hasCardChanged,
        });
      } else {
        cardsToIgnore.push(cardGenerated);
      }
    }

    return { create: cardsToCreate, update: cardsToUpdate, ignore: cardsToIgnore };
  }
}
