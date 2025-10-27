import { Card, CardInterface } from 'src/entities/card';


export class Clozecard extends Card {
  constructor(clozecardProps: CardInterface) {
    super(clozecardProps);
    this.modelName = `Obsidian-cloze`;
  }
}
