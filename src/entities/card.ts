import { ACNotesInfo, ACStoreMediaFile, CardUpdateFlags } from 'src/types/anki-connect';
import { AnkiCard, AnkiFields, MediaLinkImmediate, SourceFieldContext } from 'src/types/card';
import { arraysEqual } from 'src/utils';

export interface CardInterface<T extends AnkiFields = AnkiFields> {
  id: number | null;
  idBackup?: number;
  deckName: string;
  modelName: string;

  fields: T;
  sourceFieldContext?: SourceFieldContext;

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
export abstract class Card<T extends AnkiFields = AnkiFields> {
  id;
  idBackup: CardInterface['idBackup'];
  deckName;
  modelName;
  fields: T;
  sourceFieldContext: CardInterface['sourceFieldContext'];
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
      sourceFieldContext,
      initialOffset,
      endOffset,
      tags,
      mediaLinks,
      modelName,
      isReversed,
    } = cardProperties;

    this.id = id;
    this.deckName = deckName;
    this.modelName = modelName + (sourceFieldContext ? '-source' : '');
    this.fields = fields;
    this.sourceFieldContext = sourceFieldContext;

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

  toAnkiCard(exclude?: 'exclude-media') {
    const fields = { ...this.fields };

    // construct Source field if context is available
    if (this.sourceFieldContext) {
      const vaultName = this.sourceFieldContext.vaultName;
      const filePathEncoded = this.sourceFieldContext.filePath;

      let source = `obsidian://open?vault=${vaultName}&file=${filePathEncoded}`;
      if (this.sourceFieldContext.noteId) {
        source += `#^${this.sourceFieldContext.noteId}`;
      }

      const fileWithEnding =
        this.sourceFieldContext.filePath.split('/').pop() || this.sourceFieldContext.filePath;
      const fileName = encodeURIComponent(fileWithEnding.split('.').slice(0, -1).join('.'));
      fields.Source = `<a href='${encodeURIComponent(source)}'>${fileName}</a>`;
    }

    let ankiCard: AnkiCard<T> = {
      deckName: this.deckName,
      modelName: this.modelName,
      fields: fields,
      tags: this.tags,
    };

    if (!exclude || exclude !== 'exclude-media') {
      ankiCard = {
        ...ankiCard,
        ...this.media,
      };
    }

    if (this.id) ankiCard['id'] = this.id;
    return ankiCard;
  }

  /*
   * Checks if this generated card differs from the given Anki card.
   **/
  matches(ankiCard: ACNotesInfo): false | CardUpdateFlags {
    const changed: CardUpdateFlags = {};

    if (this.modelName !== ankiCard.modelName) {
      console.debug('Model names differ (generated, Anki):', this.modelName, ankiCard.modelName);
      changed.model = true;
    }

    const toAnkiCard = this.toAnkiCard();

    const keysInGeneratedAndAnki = new Set<string>([
      ...Object.keys(toAnkiCard.fields),
      ...Object.keys(ankiCard.fields),
    ]);

    for (const key of keysInGeneratedAndAnki) {
      const ankiValue = ankiCard.fields[key as keyof typeof ankiCard.fields]?.value;
      const generatedValue = toAnkiCard.fields[key as keyof typeof this.fields];

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
