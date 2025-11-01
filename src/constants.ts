import dedent from 'dedent';
import { Settings } from './types/settings';

export const DEFAULT_SETTINGS: Settings = {
  initializedOnHosts: [],
  ankiConnectPermissions: [],
  includeSourceLink: false,
  flashcardsTag: 'card',
  inlineSeparator: '::',
  inlineSeparatorReversed: ':::',
  pathBasedDeckGlobal: true,
  deckNameGlobal: 'Default',
  applyFrontmatterTagsGlobal: false,
  headingContextModeGlobal: {
    separator: ' > ',
  },
  transferMediaFiles: true,
  defaultAnkiTag: 'Obsidian',
  ankiTagsToPreserve: ['leech'],
} as const;

// Related to Obsidian
export const STYLE_FILE_NAME = 'anki-card.css';
export const SCRIPTS_FOLDER_NAME = 'scripts';

// Related to Anki

export const SOURCE_DECK_EXTENSION = '-source';
export const ANKI_MEDIA_FOLDER_IMPORTS_PREFIX = '_obsidian-';

export const CARD_TEMPLATES = {
  basic: {
    Front: dedent`
      {{Front}}
      <p class="tags">{{Tags}}</p>
    `,
    Back: dedent`
      {{FrontSide}}

      <hr id="answer">

      {{Back}}
    `,
  },
  reversed: {
    Front: dedent`
      {{Back}}
      <p class="tags">{{Tags}}</p>
    `,
    Back: dedent`
      {{FrontSide}}

      <hr id="answer">

      {{Front}}
    `,
  },
  cloze: {
    Front: dedent`
      {{cloze:Text}}
    `,
    Back: dedent`
      {{cloze:Text}}

      <br>

      {{Extra}}
    `,
  },
  memo: {
    Front: dedent`
      {{Prompt}}
      <p class="tags">{{Tags}}</p>
    `,
    Back: dedent`
      {{FrontSide}}

      <hr id="answer">

      Memorzation review done.
    `,
  },
} as const;
