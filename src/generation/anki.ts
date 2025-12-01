import { Card } from 'src/entities/card';

import dedent from 'dedent';
import { requestUrl } from 'obsidian';
import { hostname } from 'os';
import { CARD_TEMPLATES } from 'src/constants';
import {
  ACCardsInfoResult,
  ACNotesInfo,
  ACNotesInfoResult,
  ACStoreMediaFile,
  CardUpdateDelta,
} from 'src/types/anki-connect';
import { Settings } from 'src/types/settings';
import { showMessage } from 'src/utils';

interface ModelParams {
  modelName: string;
  inOrderFields: string[];
  css: string;
  isCloze?: true;
  cardTemplates: { Name: string; Front: string; Back: string }[];
}

interface Model {
  action: string;
  params: ModelParams;
}

export class AnkiConnectUnreachableError extends Error {
  constructor(
    message: string = 'AnkiConnect is not available. Please make sure Anki is running and AnkiConnect is installed.',
  ) {
    super(message);
    this.name = 'AnkiConnectUnreachableError';
  }
}

export class AnkiConnection {
  // Really bad pattern, but can't think of a better way to use those attributes in the static model init & the non-static updating methods
  // TODO: find better pattern with static & non-static attributes
  public static cssContent: string | null = null;
  public static scriptContents: string[] | null = null;

  private decksCreatedCache = new Set<string>();

  // factory pattern since constructor cannot be async...
  private constructor() {}

  /**
   * Invariants:
   * - AnkiConnect permission has been granted for the current host
   * - AnkiConnect is reachable
   * - Models have been created for the current host, vault and plugin version
   */
  static async create(
    settings: Settings,
    vaultName: string,
    pluginVersion: string,
    saveSettingsCallback: (settings: Settings) => Promise<void>,
  ): Promise<AnkiConnection> {
    const currentHost = hostname();

    const permission = settings.ankiConnectPermissions.some((host) => host === currentHost);
    if (!permission)
      throw new Error(
        'AnkiConnect permission not yet granted. Please allow this plugin to connect to it from the settings.',
      );

    const isConnected = await AnkiConnection.invoke('version', {}, 'checkConnection');
    if (!isConnected) throw new AnkiConnectUnreachableError();

    const initIndex = settings.initializedOnHosts.findIndex(
      (initInfo) => initInfo.hostName === currentHost,
    );
    if (
      initIndex === -1 ||
      settings.initializedOnHosts[initIndex].pluginVersion !== pluginVersion ||
      settings.initializedOnHosts[initIndex].vaultName !== vaultName
    ) {
      await AnkiConnection.initialize();

      const initInfo = {
        vaultName,
        hostName: currentHost,
        pluginVersion,
      };
      if (initIndex === -1) settings.initializedOnHosts.push(initInfo);
      else settings.initializedOnHosts[initIndex] = initInfo;

      await saveSettingsCallback(settings);
    }

    return new AnkiConnection();
  }

  private static async initialize() {
    console.debug('Initializing AnkiConnection...');
    await AnkiConnection.createModels();
    await AnkiConnection.updateModels();
  }

  public static async createModels() {
    const models = AnkiConnection.getModels();
    return AnkiConnection.invoke('multi', { actions: models });
  }

  public static async updateModels() {
    const modelsForCreation = AnkiConnection.getModels();

    const updateStylingActions = modelsForCreation.map((model) => {
      const {
        params: { modelName, css },
      } = model;

      // https://git.sr.ht/~foosoft/anki-connect#codeupdatemodelstylingcode
      return {
        action: 'updateModelStyling',
        params: {
          model: {
            name: modelName,
            css,
          },
        },
      };
    });

    const updateTemplateActions = modelsForCreation.flatMap((model) => {
      const {
        params: { modelName, cardTemplates },
      } = model;
      const templates = cardTemplates.map(({ Name, ...other }) => ({
        [Name]: other,
      }));

      // https://git.sr.ht/~foosoft/anki-connect#codeupdatemodeltemplatescode
      return templates.map((template) => ({
        action: 'updateModelTemplates',
        params: {
          model: {
            name: modelName,
            templates: template,
          },
        },
      }));
    });
    await AnkiConnection.invoke('multi', {
      actions: [...updateTemplateActions, ...updateStylingActions],
    });
  }

  public async storeMedia(mediaFile: ACStoreMediaFile) {
    return AnkiConnection.invoke<string>('storeMediaFile', mediaFile);
  }

  public async addCardsAndDecks(cards: Card[]) {
    const ankiNoteProperties = await Promise.all(
      cards.map(async (card) => {
        // Lost Anki cards will be re-created with a new ID
        if (card.id) {
          card.idBackup = card.id;
          card.id = null;
        }

        // not making this static since decks might be deleted during static lifetime
        if (!this.decksCreatedCache.has(card.deckName)) {
          await this.createDeck(card.deckName);
          this.decksCreatedCache.add(card.deckName);
        }

        return card.toAnkiCard();
      }),
    );

    return AnkiConnection.invoke<number[]>(
      'addNotes',
      {
        notes: ankiNoteProperties,
      },
      'throwMultiErrors',
    );
  }

  private async createDeck(deckName: string) {
    return AnkiConnection.invoke('createDeck', { deck: deckName });
  }

  /**
   * Given the new cards with an optional deck name, it updates all the cards on Anki.
   *
   * Be aware of https://github.com/FooSoft/anki-connect/issues/82. If the Browse pane is opened on Anki,
   * the update does not change all the cards.
   * @param cardDeltas the new cards.
   * @param deckName the new deck name.
   */
  public async updateCards(cardDeltas: CardUpdateDelta[]) {
    if (cardDeltas.length === 0) return;

    const updateActions: {
      action: 'updateNoteModel' | 'updateNote' | 'changeDeck' | 'updateNoteFields';
      params: unknown;
    }[] = [];

    const updateStats = { moves: 0, updates: 0, mediaUpdates: 0, modelChanges: 0 };

    for (const { updatesToApply, generated, anki } of cardDeltas) {
      if (!Object.values(updatesToApply).some((v) => !!v))
        throw Error('Neither fields, tags nor deck should be updated on delta for ' + generated.id);

      updateStats.updates += updatesToApply.fields || updatesToApply.tags ? 1 : 0;
      updateStats.moves += updatesToApply.deck ? 1 : 0;
      updateStats.mediaUpdates += updatesToApply.media ? 1 : 0;
      updateStats.modelChanges += updatesToApply.model ? 1 : 0;

      const updates = { ...updatesToApply };
      if (updates.model) {
        updates.fields = updates.tags = updates.model = false;
        updateActions.push({
          action: 'updateNoteModel',
          params: {
            note: {
              id: generated.id,
              modelName: generated.modelName,
              fields: generated.fields,
              tags: generated.tags,
            },
          },
        });
      }

      if (updates.media && !updates.fields) {
        updates.media = false;
        // updateNote docs:
        // The note must have the fields property in order to update the optional audio, video, or picture objects.
        updateActions.push({
          action: 'updateNoteFields',
          params: {
            note: {
              id: generated.id,
              fields: generated.fields,
              ...generated.media,
            },
          },
        });
      }
      if (updates.tags || updates.fields) {
        updates.tags = updates.fields = false;
        updateActions.push({
          action: 'updateNote',
          params: {
            note: generated.toAnkiCard(),
          },
        });
      }

      if (updates.deck) {
        updates.deck = false;
        updateActions.push({
          action: 'changeDeck',
          params: {
            cards: anki.cards,
            deck: generated.deckName,
          },
        });
      }

      if (Object.values(updates).some((v) => !!v))
        throw Error("Something that should have been updated wasn't for: " + generated.id);
    }
    const updatePromise = AnkiConnection.invoke<{ result: string | null; error: string | null }>(
      'multi',
      {
        actions: updateActions,
      },
      'throwMultiErrors',
    );
    console.debug('updateActions', updateActions);

    if (Object.values(updateStats).some((n) => n > 0))
      showMessage({
        type: 'info',
        message: dedent`
          Executing:
          · Updates: ${updateStats.updates}
          · Media Updates: ${updateStats.mediaUpdates}
          · Deck Moves: ${updateStats.moves}
          · Model Changes: ${updateStats.modelChanges}
      `,
      });

    return updatePromise;
  }

  public async changeDeck(ids: number[], deckName: string) {
    return await AnkiConnection.invoke('changeDeck', {
      cards: ids,
      deck: deckName,
    });
  }

  public async cardsInfo(ids: number[]) {
    return await AnkiConnection.invoke<Record<string, string>[]>('cardsInfo', { cards: ids });
  }

  public async getCards(ids: number[]) {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    const notesInfosMaybe = await AnkiConnection.invoke<(ACNotesInfoResult | {})[]>('notesInfo', {
      notes: ids,
    });
    console.debug('Notes fetched from Anki:', notesInfosMaybe);
    const notesInfos = notesInfosMaybe.filter((note, i): note is ACNotesInfoResult => {
      if (Object.keys(note).length === 0) {
        showMessage(
          { type: 'warning', message: `Note with ID tag "${ids[i]}" not found in Anki` },
          'long',
        );
        return false;
      }
      return true;
    });

    const cardIdAggregate = notesInfos.map((note) => note.cards[0]);
    const cardsInfo = await AnkiConnection.invoke<ACCardsInfoResult[]>('cardsInfo', {
      cards: cardIdAggregate,
    });

    const notesInfoWithDeck: ACNotesInfo[] = notesInfos.map((note) => {
      const notesCardInfo = cardsInfo.find((cardInfo) => cardInfo.note === note.noteId)!;
      return {
        ...note,
        deck: notesCardInfo.deckName,
      };
    });
    console.debug('Notes fetched from Anki with deck annotation:', notesInfoWithDeck);

    return notesInfoWithDeck;
  }

  public async deleteCards(ids: number[]) {
    return AnkiConnection.invoke('deleteNotes', { notes: ids });
  }

  private static async invoke<T>(
    action: string,
    params?: unknown,
    mode: 'throwMultiErrors' | 'checkConnection' | false = false,
  ): Promise<T> {
    if (mode !== 'checkConnection') console.debug(`Anki Connect "${action}" with params:`, params);

    let response;
    try {
      response = await requestUrl({
        url: 'http://127.0.0.1:8765',
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({ action, version: 6, params }),
      });
    } catch (e) {
      console.error('AnkiConnect is not reachable:', e);
      throw new AnkiConnectUnreachableError();
    }

    const data = (await response.json) as { result: T; error: string | null };

    if (mode === 'checkConnection')
      return (data.error === null && data.result === 6) as unknown as T;

    if (data.error) {
      showMessage({ type: 'error', message: `AnkiConnect error: ${data.error}` }, 'really-long');
      throw new Error(data.error);
    } else if (Array.isArray(data.result)) {
      const multiParams = params as { actions?: { action: string; params: T }[] };

      data.result.forEach((multiItem: { result: T; error: string | null } | null, i) => {
        if (multiItem?.error) {
          if (mode === 'throwMultiErrors') {
            showMessage(
              {
                type: 'error',
                message: `AnkiConnect multi-error on index ${i} - ${JSON.stringify(multiParams.actions?.[i])}: ${multiItem.error}`,
              },
              'really-long',
            );
            throw new Error(multiItem.error);
          } else {
            console.warn('AnkiConnect multi-error:', multiItem.error);
          }
        }
      });
    }
    return data.result;
  }

  /**
   * NOTE: Precondations: AnkiConnection.cssContent and AnkiConnection.scriptContents are initialized
   */
  private static getModels(): Model[] {
    // const sourceExtension = sourceSupport ? SOURCE_DECK_EXTENSION : '';
    // const sourceFieldContent = sourceSupport ? '<br><br>\r\n<small>Source: {{Source}}</small>' : '';

    if (AnkiConnection.scriptContents === null || AnkiConnection.cssContent === null) {
      throw new Error(
        'AnkiConnection static model files not initialized. This is a precondition for this method',
      );
    }

    const scriptBlock = AnkiConnection.scriptContents
      .map((script) => `<script>\n${script.trimEnd()}\n</script>`)
      .join('\n');

    const makeModel = ({
      name,
      fields,
      cardTemplates,
      isCloze,
    }: {
      name: keyof typeof CARD_TEMPLATES | 'basic-and-reversed';
      fields: string[];
      cardTemplates: { Name: string; Front: string; Back: string }[];
      isCloze?: true;
    }) => {
      return {
        action: 'createModel',
        params: {
          modelName: `Obsidian-${name}`,
          inOrderFields: fields,
          isCloze,
          css: (AnkiConnection.cssContent!).trimEnd(),
          cardTemplates: cardTemplates.map((template) => ({
            Name: template.Name,
            Front: template.Front + '\n\n' + scriptBlock,
            Back: template.Back,
          })),
        },
      } satisfies Model;
    };

    const basic = makeModel({
      name: 'basic',
      fields: ['Front', 'Back'],
      cardTemplates: [{ Name: 'Front / Back', ...CARD_TEMPLATES['basic'] }],
    });
    const reversed = makeModel({
      name: 'basic-and-reversed',
      fields: ['Front', 'Back'],
      cardTemplates: [
        { Name: 'Front / Back', ...CARD_TEMPLATES['basic'] },
        { Name: 'Back / Front', ...CARD_TEMPLATES['reversed'] },
      ],
    });
    const cloze = makeModel({
      name: 'cloze',
      fields: ['Text', 'Extra'],
      isCloze: true,
      cardTemplates: [{ Name: 'Cloze', ...CARD_TEMPLATES['cloze'] }],
    });
    const spaced = makeModel({
      name: 'memo',
      fields: ['Prompt'],
      cardTemplates: [{ Name: 'Memo', ...CARD_TEMPLATES['memo'] }],
    });

    return [basic, reversed, cloze, spaced];
  }

  public static async requestPermission() {
    return AnkiConnection.invoke<{ permission: 'granted' | 'denied' }>('requestPermission');
  }
}
