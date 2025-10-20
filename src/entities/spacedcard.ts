import { CODE_DECK_EXTENSION, SOURCE_DECK_EXTENSION } from 'src/conf/constants';
import { Card, CardInterface } from 'src/entities/card';

export interface SpacedcardFields {
  Prompt: string;
  Source?: string;
  // TODO: What are they?
  0?: string;
}

interface SpacedcardInterface extends CardInterface {
  fields: SpacedcardFields;
}

export class Spacedcard extends Card<SpacedcardFields> {
  fields;

  constructor(spacedcardProps: SpacedcardInterface) {
    super(spacedcardProps);
    const { fields } = spacedcardProps;
    this.fields = fields;

    this.modelName = `Obsidian-spaced`;
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
    return `Prompt: ${this.fields[0]}`;
  };

  public getIdFormat(): string {
    return '^' + this.id?.toString() + '\n';
  }
}
