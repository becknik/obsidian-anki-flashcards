import { Card, CardInterface } from 'src/entities/card';

export class Clozecard extends Card {
  constructor(clozecardProps: Omit<CardInterface, 'modelName'>) {
    super({ ...clozecardProps, modelName: 'Obsidian-cloze' });
  }
}
