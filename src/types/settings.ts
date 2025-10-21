// TODO: document settings like folderBasedDeck & add them to settings-tab...
export interface Settings {
  contextAwareMode: boolean;
  sourceSupport: boolean;
  codeHighlightSupport: boolean;
  // TODO: remove this setting - inline cards are always created with inline IDs...
  inlineID: boolean;
  contextSeparator: string;
  deck: string;
  folderBasedDeck: boolean;
  flashcardsTag: string;
  inlineSeparator: string;
  inlineSeparatorReverse: string;
  defaultAnkiTag: string;
  ankiConnectPermission: boolean;
}
