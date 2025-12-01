import { Card } from 'src/entities/card';

type MD5 = string;

// Not sure about the `fields: ('Back' | 'Front')[]` prop since I'm already handling the media inclusion...
// https://git.sr.ht/~foosoft/anki-connect#codeaddnotecode
export type ACStoreMediaFile = {
  filename: string;
  skipHash?: MD5;
  // Without this property the API call won't work and just return the error: 'fields'
  fields: string[];
  // The `type` property has to be removed before sending to AnkiConnect
} & (
  | {
      type: 'data';
      data: string;
    }
  | {
      type: 'path';
      path: string;
    }
  | {
      type: 'url';
      url: string;
    }
);

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
  createOrId: number | 'create';
  type: keyof CardUpdateFlags;
  diff: string;
};

export type CardUpdateDelta = {
  generated: Card;
  anki: ACNotesInfo;
  updatesToApply: CardUpdateFlags;
};

export type CardUpdateFlags = {
  fields?: boolean;
  tags?: boolean;
  deck?: boolean;
  media?: boolean;
  model?: boolean;
};
