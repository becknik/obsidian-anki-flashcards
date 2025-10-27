import { Card, CardInterface } from 'src/entities/card';

export class Spacedcard extends Card {
  constructor(spacedcardProps: CardInterface) {
    super(spacedcardProps);
    this.modelName = `Obsidian-spaced`;
  }

  // public toAnkiCard() {
  //   // TODO: why is this empty? What about the Prompt field?
  //   const card: Pick<AnkiCard<Record<string, string>>, 'id'> = {};
  //   if (this.id) card['id'] = this.id;
  //
  //   return card;
  // }
}
