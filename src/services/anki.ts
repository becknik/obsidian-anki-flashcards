import {
  CODE_DECK_EXTENSION,
  CODE_SCRIPT,
  HIGHLIGHT_CSS_BASE64,
  HIGHLIGHTJS_BASE64,
  HIHGLIGHTJS_INIT_BASE64,
  SOURCE_DECK_EXTENSION,
  SOURCE_FIELD,
} from 'src/conf/constants';
import { Card } from 'src/entities/card';

import * as templates from './cards/templates';
import { ACCardsInfoResult, ACNotesInfo, ACNotesInfoResult, CardUpdateDelta } from './types';

interface ModelParams {
  modelName: string;
  inOrderFields: string[];
  css: string;
  isCloze: boolean;
  cardTemplates: { Name: string; Front: string; Back: string }[];
}

interface Model {
  action: string;
  params: ModelParams;
}

export class Anki {
  public async createModels(sourceSupport: boolean, codeHighlightSupport: boolean) {
    let models = this.getModels(sourceSupport, false);
    if (codeHighlightSupport) {
      models = models.concat(this.getModels(sourceSupport, true));
    }

    return this.invoke('multi', 6, { actions: models });
  }

  public async createDeck(deckName: string): Promise<any> {
    return this.invoke('createDeck', 6, { deck: deckName });
  }

  public async storeMediaFiles(cards: Card[]) {
    const actions: any[] = [];

    for (const card of cards) {
      for (const media of card.getMedias()) {
        actions.push({
          action: 'storeMediaFile',
          params: media,
        });
      }
    }

    if (actions) {
      return this.invoke('multi', 6, { actions: actions });
    } else {
      return {};
    }
  }

  public async storeCodeHighlightMedias() {
    const fileExists = await this.invoke('retrieveMediaFile', 6, {
      filename: '_highlightInit.js',
    });

    if (!fileExists) {
      const highlightjs = {
        action: 'storeMediaFile',
        params: {
          filename: '_highlight.js',
          data: HIGHLIGHTJS_BASE64,
        },
      };
      const highlightjsInit = {
        action: 'storeMediaFile',
        params: {
          filename: '_highlightInit.js',
          data: HIHGLIGHTJS_INIT_BASE64,
        },
      };
      const highlightjcss = {
        action: 'storeMediaFile',
        params: {
          filename: '_highlight.css',
          data: HIGHLIGHT_CSS_BASE64,
        },
      };
      return this.invoke('multi', 6, {
        actions: [highlightjs, highlightjsInit, highlightjcss],
      });
    }
  }

  public async addCards(cards: Card[]): Promise<number[]> {
    const notes: any = [];

    cards.forEach((card) => notes.push(card.getCard(false)));

    return this.invoke('addNotes', 6, {
      notes: notes,
    });
  }

  /**
   * Given the new cards with an optional deck name, it updates all the cards on Anki.
   *
   * Be aware of https://github.com/FooSoft/anki-connect/issues/82. If the Browse pane is opened on Anki,
   * the update does not change all the cards.
   * @param cardDeltas the new cards.
   * @param deckName the new deck name.
   */
  public async updateCards(cardDeltas: CardUpdateDelta[], sendStats: (msg: string) => void) {
    const updateActions: { action: string; version: 6; params: unknown }[] = [];

    for (const { updatesToApply, generated, anki } of cardDeltas) {
      const { fields, tags, deck } = updatesToApply;
      if (!(fields || tags || deck))
        throw Error('Neither fields, tags nor deck should be updated on delta for ' + generated.id);

      if (tags && !fields) {
        // NOTE: Had to handle this special case due to the following string from `updateNote` docs:
        // The note must have the fields property in order to update the optional audio, video, or picture objects.
        updateActions.push({
          action: 'updateNoteTags',
          version: 6,
          params: {
            note: generated.id,
            tags: generated.tags,
          },
        });
      } else if (fields) {
        updateActions.push({
          action: 'updateNote',
          version: 6,
          params: {
            note: {
              id: generated.id,
              fields: generated.fields,
              tags: tags ? generated.tags : undefined,
            },
          },
        });
      }

      if (deck) {
        updateActions.push({
          action: 'changeDeck',
          version: 6,
          params: {
            cards: anki.cards,
            deck: generated.deckName,
          },
        });
      }
    }
    const updatePromise = this.invoke<{ result: string | null; error: string | null }>('multi', 6, {
      actions: updateActions,
    });
    console.debug('updateActions', updateActions);

    const updateActionStats = updateActions.reduce(
      (acc, action) => {
        if (action.action === 'changeDeck') ++acc.updates;
        else ++acc.moves;
        return acc;
      },
      { moves: 0, updates: 0 },
    );
    sendStats(
      `Executing ${updateActionStats.updates} updates and ${updateActionStats.moves} moves`,
    );

    return updatePromise;
  }

  public async changeDeck(ids: number[], deckName: string) {
    return await this.invoke('changeDeck', 6, {
      cards: ids,
      deck: deckName,
    });
  }

  public async cardsInfo(ids: number[]) {
    return await this.invoke<Record<string, string>[]>('cardsInfo', 6, { cards: ids });
  }

  public async getCards(ids: number[]) {
    const notesInfos = await this.invoke<ACNotesInfoResult[]>('notesInfo', 6, { notes: ids });

    const cardIdAggregate = notesInfos.map((note) => note.cards[0]);
    const cardsInfo = await this.invoke<ACCardsInfoResult[]>('cardsInfo', 6, {
      cards: cardIdAggregate,
    });

    const notesInfoWithDeck: ACNotesInfo[] = notesInfos.map((note) => {
      const notesCardInfo = cardsInfo.find((cardInfo) => cardInfo.note === note.noteId)!;
      return {
        ...note,
        deck: notesCardInfo.deckName,
      };
    });
    console.log(notesInfoWithDeck);

    return notesInfoWithDeck;
  }

  public async deleteCards(ids: number[]) {
    return this.invoke('deleteNotes', 6, { notes: ids });
  }

  public async ping(): Promise<boolean> {
    return (await this.invoke('version', 6)) === 6;
  }

  private mergeTags(oldTags: string[], newTags: string[], cardId: number) {
    const actions = [];

    // Find tags to Add
    for (const tag of newTags) {
      const index = oldTags.indexOf(tag);
      if (index > -1) {
        oldTags.splice(index, 1);
      } else {
        actions.push({
          action: 'addTags',
          params: {
            notes: [cardId],
            tags: tag,
          },
        });
      }
    }

    // All Tags to delete
    for (const tag of oldTags) {
      actions.push({
        action: 'removeTags',
        params: {
          notes: [cardId],
          tags: tag,
        },
      });
    }

    return actions;
  }

  private async invoke<T>(action: string, version = 6, params = {}): Promise<T> {
    const response = await fetch('http://127.0.0.1:8765', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version, params }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error(`Failed to invoke AnkiConnect method: ${response.status}`);

    const data: { result: T; error: string | null } = await response.json();

    if (data.error) throw new Error(data.error);
    return data.result;
  }

  private getModels(sourceSupport: boolean, codeHighlightSupport: boolean): Model[] {
    const sourceExtension = sourceSupport ? SOURCE_DECK_EXTENSION : '';
    const sourceFieldContent = sourceSupport ? SOURCE_FIELD : '';
    const codeExtension = codeHighlightSupport ? CODE_DECK_EXTENSION : '';
    const codeScriptContent = codeHighlightSupport ? CODE_SCRIPT : '';

    const css = templates.formatStyle();
    const front = templates.formatBasicFront(codeScriptContent);
    const back = templates.formatBasicBack(sourceFieldContent);
    const frontReversed = templates.formatReversedFront(codeScriptContent);
    const backReversed = templates.formatReversedBack(sourceFieldContent);
    const clozeFront = templates.formatClozeFront(codeScriptContent);
    const clozeBack = templates.formatClozeBack(sourceFieldContent, codeScriptContent);
    const prompt = templates.formatPromptFront(codeScriptContent);
    const promptBack = templates.formatPromptBack(sourceFieldContent);

    const makeModel = ({
      name,
      fields,
      templates,
      isCloze = false,
    }: {
      name: string;
      fields: string[];
      templates: { name: string; front: string; back: string }[];
      isCloze?: boolean;
    }): Model => {
      if (sourceSupport) {
        fields.push('Source');
      }

      return {
        action: 'createModel',
        params: {
          modelName: `Obsidian-${name}${sourceExtension}${codeExtension}`,
          inOrderFields: fields,
          isCloze,
          css,
          cardTemplates: templates.map((t) => ({
            Name: t.name,
            Front: t.front,
            Back: t.back,
          })),
        },
      };
    };

    const basic = makeModel({
      name: 'basic',
      fields: ['Front', 'Back'],
      templates: [{ name: 'Front / Back', front, back }],
    });
    const reversed = makeModel({
      name: 'basic-reversed',
      fields: ['Front', 'Back'],
      templates: [
        { name: 'Front / Back', front, back },
        { name: 'Back / Front', front: frontReversed, back: backReversed },
      ],
    });
    const cloze = makeModel({
      name: 'cloze',
      fields: ['Text', 'Extra'],
      isCloze: true,
      templates: [{ name: 'Cloze', front: clozeFront, back: clozeBack }],
    });
    const spaced = makeModel({
      name: 'spaced',
      fields: ['Prompt'],
      templates: [{ name: 'Spaced', front: prompt, back: promptBack }],
    });

    return [basic, reversed, cloze, spaced];
  }

  public async requestPermission() {
    return this.invoke<{ permission: 'granted' | 'denied' }>('requestPermission', 6);
  }
}
