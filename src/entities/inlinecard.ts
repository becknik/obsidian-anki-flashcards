import { CODE_DECK_EXTENSION, SOURCE_DECK_EXTENSION } from 'src/conf/constants';
import { Card, CardInterface } from 'src/entities/card';

export class Inlinecard extends Card {
  constructor(inlinecardProps: CardInterface) {
    super(inlinecardProps); // ! CHANGE []

    const { fields, } = inlinecardProps;

    this.modelName = this.flags.isReversed ? `Obsidian-basic-reversed` : `Obsidian-basic`;
    if (fields['Source']) {
      this.modelName += SOURCE_DECK_EXTENSION;
    }
    if (this.flags.containsCode) {
      this.modelName += CODE_DECK_EXTENSION;
    }
  }
}
