import { Card, CardInterface } from 'src/entities/card';

export class Flashcard extends Card {
  constructor(flashcardProps: CardInterface) {
    super(flashcardProps);
    this.modelName = this.flags.isReversed ? `Obsidian-basic-reversed` : `Obsidian-basic`;
  }
}
