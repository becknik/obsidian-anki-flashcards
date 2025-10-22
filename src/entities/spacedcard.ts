import { CODE_DECK_EXTENSION, SOURCE_DECK_EXTENSION } from 'src/conf/constants';
import { Card, CardInterface } from 'src/entities/card';

export class Spacedcard extends Card {
  fields;

  constructor(spacedcardProps: CardInterface) {
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

  // public toAnkiCard() {
  //   // TODO: why is this empty? What about the Prompt field?
  //   const card: Pick<AnkiCard<Record<string, string>>, 'id'> = {};
  //   if (this.id) card['id'] = this.id;
  //
  //   return card;
  // }
}
