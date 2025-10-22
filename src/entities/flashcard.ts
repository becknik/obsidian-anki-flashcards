import { CODE_DECK_EXTENSION, SOURCE_DECK_EXTENSION } from 'src/conf/constants';
import { Card, CardInterface } from 'src/entities/card';

export interface FlashcardFields {
  Front: string;
  Back: string;
  Source?: string;
}

export interface FlashcardInterface extends CardInterface {
  fields: FlashcardFields;
}

export class Flashcard extends Card<FlashcardFields> {
  constructor(flashcardProps: FlashcardInterface) {
    super(flashcardProps);

    const {
      fields,
    } = flashcardProps;
    this.fields = fields;

    this.modelName = this.flags.isReversed ? `Obsidian-basic-reversed` : `Obsidian-basic`;
    if (fields['Source']) {
      this.modelName += SOURCE_DECK_EXTENSION;
    }
    if (this.flags.containsCode) {
      this.modelName += CODE_DECK_EXTENSION;
    }
  }
}
