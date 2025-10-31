import { Card } from 'src/entities/card';

export type ACNotesInfoResult = {
  noteId: number;
  profile: string;
  modelName: string;
  tags: string[];
  fields: {
    Front: { value: string; order: number };
    Back: { value: string; order: number };
  };
  mod: number;
  cards: number[];
};

export type ACNotesInfo = ACNotesInfoResult & {
  deck: string;
};

export type ACCardsInfoResult = {
  answer: string;
  question: string;
  deckName: string;
  modelName: string;
  fieldOrder: number;
  fields: Record<string, { value: string; order: number }>;
  css: string;
  cardId: number;
  interval: number;
  note: number;
  ord: number;
  type: number;
  queue: number;
  due: number;
  reps: number;
  lapses: number;
  left: number;
};

export type CardDelta = {
  type: keyof CardUpdateFlags
  diff: string;
};

export type CardUpdateDelta = {
  generated: Card;
  anki: ACNotesInfo;
  updatesToApply: CardUpdateFlags;
};

export type CardUpdateFlags = {
  fields?: true;
  tags?: true;
  deck?: true;
  media?: true;
};
