import { Card, CardInterface } from 'src/entities/card';

export class Inlinecard extends Card {
  constructor(inlinecardProps: CardInterface) {
    super(inlinecardProps);

    this.modelName = this.flags.isReversed ? `Obsidian-basic-reversed` : `Obsidian-basic`;
  }
}
