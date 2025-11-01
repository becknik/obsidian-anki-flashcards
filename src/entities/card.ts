import { SOURCE_DECK_EXTENSION } from 'src/constants';
import { MediaLinkImmediate } from 'src/generation/parser';
import { ACNotesInfo, CardUpdateFlags } from 'src/generation/types';
import { arraysEqual } from 'src/utils';

type MD5 = string;
// Not sure about the `fields: ('Back' | 'Front')[]` prop since I'm already handling the media inclusion...
// https://git.sr.ht/~foosoft/anki-connect#codeaddnotecode
export type ACStoreMediaFile = {
  filename: string;
  skipHash?: MD5;
  // Without this property the API call won't work and just return the error: 'fields'
  fields: string[];
  // The `type` property has to be removed before sending to AnkiConnect
} & (
  | {
      type: 'data';
      data: string;
    }
  | {
      type: 'path';
      path: string;
    }
  | {
      type: 'url';
      url: string;
    }
);

interface Flags {
  /**
   * Back => Front as well to default Front => Back
   * */
  isReversed: boolean;
  // containsCode: boolean;
}

export type DefaultAnkiFields = { Front: string; Back: string; Source?: string };

export interface CardInterface<T extends Record<string, string> = DefaultAnkiFields> {
  id: number | null;
  idBackup?: number;
  deckName: string | null;
  modelName?: string;
  fields: T;

  initialOffset: number;
  endOffset: number;

  tags: string[];
  // TODO: why is this there?
  oldTags?: string[];

  mediaLinks: MediaLinkImmediate[];
  media?: {
    picture?: ACStoreMediaFile[];
    audio?: ACStoreMediaFile[];
    video?: ACStoreMediaFile[];
  };

  flags: Flags;
}

export type AnkiCard<T extends Record<string, string>> = Pick<
  CardInterface,
  'deckName' | 'modelName' | 'tags'
> & {
  id?: number;
  fields: T;
  audio?: ACStoreMediaFile[];
  video?: ACStoreMediaFile[];
  picture?: ACStoreMediaFile[];
};

// just don't know how to prevent the type mismatch errors in the subclasses...
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class Card<T extends Record<string, string | any> = DefaultAnkiFields> {
  id;
  idBackup: CardInterface['idBackup'];
  deckName;
  modelName;
  fields: T;
  initialOffset;
  endOffset;
  tags;
  oldTags: CardInterface['oldTags'];
  mediaLinks;
  media: CardInterface['media'];
  flags: Flags;

  constructor(cardProperties: CardInterface<T>) {
    const {
      id,
      deckName,
      fields,
      initialOffset,
      endOffset,
      tags,
      mediaLinks,
      // TODO: why has this a default value?
      modelName = '',
      flags,
    } = cardProperties;

    this.id = id;
    this.deckName = deckName;
    this.modelName = modelName;
    this.fields = fields;

    this.initialOffset = initialOffset;
    this.endOffset = endOffset;

    this.tags = tags;
    this.mediaLinks = mediaLinks;
    this.flags = flags;

    if (fields['Source']) {
      this.modelName += SOURCE_DECK_EXTENSION;
    }
  }

  getIdFormatted() {
    if (!this.id) throw new Error('Card ID is null, cannot format it.');
    return '^' + this.id.toString();
  }

  toAnkiCard() {
    const ankiCard: AnkiCard<T> = {
      deckName: this.deckName,
      modelName: this.modelName,
      fields: this.fields,
      tags: this.tags,
      ...this.media,
    };

    if (this.id) ankiCard['id'] = this.id;
    return ankiCard;
  }

  /**
   * What should be identical to consider a card & Anki card to match?
   * - fields
   * - tags
   *
   * What would hint a change of the card on Anki-side?
   * - modelName
   * - tags
   **/
  matches(ankiCard: ACNotesInfo): false | CardUpdateFlags {
    const changed: CardUpdateFlags = {};

    const keysInGeneratedAndAnki = new Set<string>([
      ...Object.keys(this.fields),
      ...Object.keys(ankiCard.fields),
    ]);

    for (const key of keysInGeneratedAndAnki) {
      const ankiValue = ankiCard.fields[key as keyof typeof ankiCard.fields]?.value;
      const generatedValue = this.fields[key as keyof typeof this.fields];

      if (ankiValue !== generatedValue) {
        changed.fields = true;
        console.debug(
          'Field differs for key ' + key + ':',
          'Anki field: "' + ankiValue + '"',
          'Generated field: "' + generatedValue + '"',
        );
        break;
      }
    }

    // TODO: find a way to determine the media delta
    if (this.mediaLinks.length !== 0) {
      console.debug('Media links present in generated card, assuming media changed.');
      changed.media = true;
    }

    // TODO: are there characters not allowed in Deck names
    // quick fix since Anki deck names seem to not be case-agnostic
    const isDeckMatching = ankiCard.deck.toLowerCase() === this.deckName?.toLowerCase();
    if (!isDeckMatching) {
      changed.deck = true;
      console.debug('Decks differ (generated, Anki):', this.deckName, ankiCard.deck);
    }

    const areTagsSame = arraysEqual(ankiCard.tags.toSorted(), this.tags.toSorted());
    if (!areTagsSame) {
      console.debug('Tags differ (generated, Anki):', this.tags, ankiCard.tags);
      changed.tags = true;
    }

    return Object.keys(changed).length > 0 ? changed : false;
  }
}
