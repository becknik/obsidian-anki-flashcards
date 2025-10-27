import { Card, CardInterface } from 'src/entities/card';

export class Inlinecard extends Card {
  constructor(inlinecardProps: CardInterface) {
    super(inlinecardProps); // ! CHANGE []

    const { fields, } = inlinecardProps;

    this.modelName = this.flags.isReversed ? `Obsidian-basic-reversed` : `Obsidian-basic`;
  }
}
