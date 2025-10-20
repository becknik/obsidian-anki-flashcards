import { CODE_DECK_EXTENSION } from 'src/conf/constants';
import { ACNotesInfo, ACNotesInfoResult } from 'src/services/types';
import { arraysEqual } from 'src/utils';

type ChangedInCard = { fieldNumber?: true; fields?: true; tags?: true; decks?: true };

interface Flags {
  presentInAnki: boolean;
  isReversed: boolean;
  containsCode: boolean;
}

export interface CardInterface {
  id: number | null;
  deckName: string | null;
  modelName?: string;
  frontContent: string;

  initialOffset: number;
  endOffset: number;

  tags: string[];
  // TODO: why is this there?
  oldTags?: string[];

  mediaNames: string[];
  mediaBase64Encoded?: string[];

  flags: Flags;
}

// just don't know how to prevent the type mismatch errors in the subclasses...
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class Card<T extends Record<string, string | any> = any> {
  id;
  deckName;
  modelName;
  frontContent;
  fields: T;
  initialOffset;
  endOffset;
  tags;
  mediaNames;
  mediaBase64Encoded;
  flags: Flags;

  constructor(cardProperties: CardInterface & { fields: T }) {
    const {
      id,
      deckName,
      frontContent,
      fields,
      initialOffset,
      endOffset,
      tags = [],
      mediaNames,
      mediaBase64Encoded = [],
      oldTags = [],
      modelName = '',
      flags,
    } = cardProperties;

    this.id = id;
    this.deckName = deckName;
    this.modelName = modelName;
    this.frontContent = frontContent;
    this.fields = fields;

    this.initialOffset = initialOffset;
    this.endOffset = endOffset;

    this.tags = tags;

    this.mediaNames = mediaNames;
    this.mediaBase64Encoded = mediaBase64Encoded;

    this.flags = flags;
  }

  abstract toString(): string;
  abstract getCard(update: boolean): object;
  abstract getMedias(): object[];
  abstract getIdFormat(): string;

  /**
   * What should be identical to consider a card & Anki card to match?
   * - fields
   * - tags
   *
   * What would hint a change of the card on Anki-side?
   * - modelName changed
   * - #fields changed
   **/
  matches(ankiCard: ACNotesInfo): false | ChangedInCard {
    const changed: ChangedInCard = {};

    const ankiFields = Object.entries(ankiCard.fields);
    // TODO: Card type switch => gracefully try to update the identical fields
    if (ankiFields.length !== Object.entries(this.fields).length) {
      console.info('TODO: Cards fields was modified in Anki:', this.fields, ankiFields);
      changed.fieldNumber = true;
    }

    console.debug('ankiFields', ankiFields, 'this.fields', this.fields);
    for (const [key, value] of ankiFields) {
      // TODO: what about value.order?
      console.debug('"' + value.value + '"', '"' + this.fields[key] + '"');
      if (value.value !== this.fields[key]) {
        changed.fields = true;
        break;
      }
    }

    const doDecksMatch = ankiCard.deck === this.deckName;
    if (!doDecksMatch) changed.decks = true;

    const areTagsSame = arraysEqual(ankiCard.tags, this.tags);
    if (!areTagsSame) {
      console.debug('Tags differ:', this.tags, ankiCard.tags)
      changed.tags = true;
    }

    return Object.keys(changed).length > 0 ? changed : false;
  }

  getCodeDeckNameExtension() {
    return this.flags.containsCode ? CODE_DECK_EXTENSION : '';
  }
}
