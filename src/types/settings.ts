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

export const SETTINGS_FRONTMATTER_KEYS = {
  deckName: 'cards-deck',
  pathBasedDeck: 'cards-path-based',
  applyFrontmatterTags: 'cards-apply-tags',
  headingContextMode: 'cards-context',
} as const;

export type SettingsScoped = {
  deck?: string;
  'apply-context-tags'?: true;
};
