import { CODE_DECK_EXTENSION, SOURCE_DECK_EXTENSION } from 'src/conf/constants';
import { Card, CardInterface } from 'src/entities/card';


export class Clozecard extends Card {
  constructor(clozecardProps: CardInterface) {
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
}
