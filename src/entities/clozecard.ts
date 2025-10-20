import { CODE_DECK_EXTENSION, SOURCE_DECK_EXTENSION } from 'src/conf/constants';
import { Card, CardInterface } from 'src/entities/card';


export class Clozecard extends Card {
  constructor(clozecardProps: CardInterface & { fields: Record<string, string> }) {
    super(clozecardProps);
    const {
      fields,
      flags: { containsCode },
    } = clozecardProps;

    this.modelName = `Obsidian-cloze`;
    if (fields['Source']) {
      this.modelName += SOURCE_DECK_EXTENSION;
    }
    if (containsCode) {
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
    return `Cloze: ${this.fields[0]}`;
  };

  public getIdFormat(): string {
    return '\n^' + this.id?.toString();
  }
}
