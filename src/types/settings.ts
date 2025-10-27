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
  contextAwareMode:
    | false
    | {
        separator: string;
      };
  pathBasedDeck: boolean;
  defaultDeck: string;

  // # AnkiConnect settings
  transferMediaFiles: boolean;

  // ## Anki settings
  defaultAnkiTag: string;
}
