// TODO: document settings like folderBasedDeck & add them to settings-tab...
export interface Settings {
  /**
   * Hosts on which the plugin's initialization procedure has been completed
   */
  initializedOnHosts: {
    vaultName: string;
    hostName: string;
    pluginVersion: string;
  }[];
  /**
   * Hosts on which the client is authorized to access AnkiConnect
   */
  ankiConnectPermissions: string[];

  // # Model settings
  // TODO: implement inclusion of source link
  includeSourceLink: false;

  // # Parsing settings
  flashcardsTag: string;
  inlineSeparator: string;
  inlineSeparatorReversed: string;

  // ## Processing settings
  // Elements ending with "Global" can be overridden per Obsidian note via frontmatter
  deckNameGlobal: string;
  pathBasedDeckGlobal: boolean;
  applyFrontmatterTagsGlobal: boolean;
  applyHeadingContextTagsGlobal: boolean;
  headingContextModeGlobal:
    | false
    | {
        separator: string;
      };

  // # AnkiConnect settings
  transferMediaFiles: boolean;

  // ## Anki settings
  defaultAnkiTag: string;
  ankiTagsToPreserve: string[];
}

export type SettingsFrontmatter = {
  'cards-deck'?: string;
  'cards-path-based'?: boolean;
  'cards-tags'?: 'frontmatter' | string[] | false;
  'cards-context'?: 'headings' | 'tags' | boolean;
};

export const SETTINGS_FRONTMATTER_TYPES = {
  deck: 'string',
  pathBased: 'boolean',
  tagsSetting: '"frontmatter" | string[] | false',
  contextSetting: '"headings" | "tags" | boolean',
} as const;

export const SETTINGS_FRONTMATTER_KEYS = {
  deck: 'cards-deck',
  pathBased: 'cards-path-based',
  tagsSetting: 'cards-tags',
  contextSetting: 'cards-context',
} as const;

// ---

export type SettingsScoped = {
  deck?: string;
  apply?: 'heading' | 'tags' | true; // "all-tags"
  ignore?: 'heading' | 'tags' | true;  // "all-tags"
};

export const SETTINGS_SCOPED_TYPES: Record<(keyof typeof SETTINGS_SCOPED_KEYS), string> = {
  'deck': 'string | deck-modification',
  'apply': '"heading" | "tags" | true',
  'ignore': '"heading" | "tags" | true',
} as const;

export const SETTINGS_SCOPED_KEYS = {
  deck: 'deck',
  apply: 'apply',
  ignore: 'ignore',
} as const;
