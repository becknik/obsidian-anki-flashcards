import { CODE_DECK_EXTENSION, SOURCE_DECK_EXTENSION } from 'src/conf/constants';
import { Card, CardInterface } from 'src/entities/card';

export interface FlashcardFields {
  Front: string;
  Back: string;
  Source?: string;
  // TODO: What are they?
  0?: string;
  1?: string;
}

export interface FlashcardInterface extends CardInterface {
  fields: FlashcardFields;
}

export class Flashcard extends Card<FlashcardFields> {
  constructor(flashcardProps: FlashcardInterface) {
    super(flashcardProps);

    const {
      fields,
    } = flashcardProps;
    this.fields = fields;

    this.modelName = this.flags.isReversed ? `Obsidian-basic-reversed` : `Obsidian-basic`;
    if (fields['Source']) {
      this.modelName += SOURCE_DECK_EXTENSION;
    }
    if (this.flags.containsCode) {
      this.modelName += CODE_DECK_EXTENSION;
    }
  }

  public getCard(update = false): object {
    const card: any = {
      deckName: this.deckName,
      modelName: this.modelName,
      fields: this.fields,
      tags: this.tags,
    };

    if (update) {
      card['id'] = this.id;
    }

    return card;
  }

  public getMedias(): object[] {
    const medias: object[] = [];
    this.mediaBase64Encoded.forEach((data, index) => {
      medias.push({
        filename: this.mediaNames[index],
        data: data,
      });
    });

    return medias;
  }

  public toString = (): string => {
    return `Q: ${this.fields[0]}\nA: ${this.fields[1]}`;
  };

  public getIdFormat(): string {
    return '^' + this.id?.toString() + '\n';
  }
}
