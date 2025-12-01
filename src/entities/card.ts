import { ACNotesInfo, ACStoreMediaFile, CardUpdateFlags } from 'src/types/anki-connect';
import { AnkiCard, AnkiFields, MediaLinkImmediate } from 'src/types/card';
import { arraysEqual } from 'src/utils';

export interface CardInterface<T extends Record<string, string> = AnkiFields> {
  id: number | null;
  idBackup?: number;
  deckName: string;
  modelName: string;
  fields: T;

  initialOffset: number;
  endOffset: number;

  tags: string[];

  mediaLinks: MediaLinkImmediate[];
  media?: {
    picture?: ACStoreMediaFile[];
    audio?: ACStoreMediaFile[];
    video?: ACStoreMediaFile[];
  };

  /**
   * Back => Front as well to default Front => Back
   */
  isReversed: boolean;
}

// just don't know how to prevent the type mismatch errors in the subclasses...
export abstract class Card<T extends Record<string, string> = AnkiFields> {
  id;
  idBackup: CardInterface['idBackup'];
  deckName;
  modelName;
  fields: T;
  initialOffset;
  endOffset;
  tags;
  mediaLinks;
  media: CardInterface['media'];
  isReversed;

  constructor(cardProperties: CardInterface<T>) {
    const {
      id,
      deckName,
      fields,
      initialOffset,
      endOffset,
      tags,
      mediaLinks,
      modelName,
      isReversed,
    } = cardProperties;

    this.id = id;
    this.deckName = deckName;
    this.modelName = modelName;
    this.fields = fields;

    this.initialOffset = initialOffset;
    this.endOffset = endOffset;

    this.tags = tags;
    this.mediaLinks = mediaLinks;
    this.isReversed = isReversed;
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

    if (this.modelName !== ankiCard.modelName) {
      console.debug('Model names differ (generated, Anki):', this.modelName, ankiCard.modelName);
      changed.model = true;
    }

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
