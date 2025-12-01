import { Card, CardInterface } from 'src/entities/card';

export class Inlinecard extends Card {
  constructor(clozecardProps: Omit<CardInterface, 'modelName'>) {
    super({
      ...clozecardProps,
      modelName: clozecardProps.isReversed ? 'Obsidian-basic-and-reversed' : 'Obsidian-basic',
    });
  }
}
