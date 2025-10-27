import dedent from 'dedent';

export const DEFAULT_SETTINGS = {
  initializedOnHosts: [],
  ankiConnectPermission: [],
  includeSourceLink: false,
  flashcardsTag: 'card',
  inlineSeparator: '::',
  inlineSeparatorReversed: ':::',
  contextAwareMode: {
    separator: ' > ',
  },
  pathBasedDeck: true,
  defaultDeck: 'Default',
  transferMediaFiles: true,
  defaultAnkiTag: 'Obsidian',
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
