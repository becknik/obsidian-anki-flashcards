import { CardInterface } from 'src/entities/card';
import { ACStoreMediaFile } from './anki-connect';

export type AnkiFields = { Front: string; Back: string; Source?: string };
export type SourceFieldContext = {
  vaultName: string;
  filePath: string;
  noteId?: number;
};

/**
 * To be transform into AnkiConnect media objects
 * https://git.sr.ht/~foosoft/anki-connect#codeaddnotecode
 */
export type MediaLinkImmediate = {
  fileName: string;
  type: 'picture' | 'audio' | 'video' | 'other';
};

export type AnkiCard<T extends Record<string, string>> = Pick<
  CardInterface,
  'deckName' | 'modelName' | 'tags'
> & {
  id?: number;
  fields: T;
  audio?: ACStoreMediaFile[];
  video?: ACStoreMediaFile[];
  picture?: ACStoreMediaFile[];
};
