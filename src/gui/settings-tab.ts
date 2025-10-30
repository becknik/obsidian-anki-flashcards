import FlashcardsPlugin from 'main';
import { App, PluginSettingTab, Setting } from 'obsidian';
import { hostname } from 'os';
import { DEFAULT_SETTINGS } from 'src/constants';
import { RegExps } from 'src/regex';
import { escapeRegExp, showMessage } from 'src/utils';

export class SettingsTab extends PluginSettingTab {
  plugin: FlashcardsPlugin;

  constructor(app: App, plugin: FlashcardsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl, plugin } = this;

    containerEl.empty();

    new Setting(containerEl).setName('Flashcard Settings').setHeading();

    const currentHostname = hostname();
    new Setting(containerEl)
      .setName('Grant AnkiConnect Permission')
      .setDesc(
        'Grant this plugin the permission to interact with AnkiConnect by having Anki open & AnkiConnect installed. This only needs to be done one time per device.',
      )
      .addButton((button) => {
        if (plugin.settings.ankiConnectPermissions.contains(currentHostname)) {
          button.setDisabled(true).setButtonText('Permission Granted');
          return;
        }

        button
          .setButtonText('Grant Permission')
          .setClass('mod-cta')
          .onClick(async () => {
            const { permission } = await this.plugin.authenticateWithAnki();
            if (permission === 'granted') {
              plugin.settings.ankiConnectPermissions = [
                ...plugin.settings.ankiConnectPermissions,
                currentHostname,
              ];
              plugin.saveData(plugin.settings);
              showMessage({ message: 'AnkiConnect permission granted!', type: 'success' });

              this.plugin.getAnkiConnection();
              this.display();
            } else {
              showMessage({ message: 'AnkiConnect permission not granted', type: 'error' });
            }
          });
      });

    if (!plugin.settings.ankiConnectPermissions.contains(currentHostname)) return;

    // ---

    new Setting(containerEl)
      .setName('Model Settings')
      .setHeading()
      .setDesc('Settings related to the Anki note models used');

    new Setting(containerEl)
      .setName('Include Source Links')
      .setDesc('Add source file references to every generated card')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeSourceLink).onChange((value) => {
          if (value) {
            // TODO: implement source link inclusion
            showMessage({
              message: 'Including source links currently is not supported.',
              type: 'error',
            });
          }

          plugin.settings.includeSourceLink = false;
          plugin.saveData(plugin.settings);
        }),
      );

    // ---

    new Setting(containerEl)
      .setName('Parsing Settings')
      .setHeading()
      .setDesc('Determine which note content is detected as a card');

    new Setting(containerEl)
      .setName('Flashcards Tag')
      .setDesc('The tag name to identify flashcards in notes (without the #-prefix)')
      .addText((text) => {
        text
          .setValue(plugin.settings.flashcardsTag)
          .setPlaceholder(DEFAULT_SETTINGS.flashcardsTag)
          .onChange((value) => {
            if (value.trim()) {
              plugin.settings.flashcardsTag = value.trim();
              plugin.saveData(plugin.settings);
            } else {
              showMessage({
                message: 'The flashcards tag cannot be empty',
                type: 'error',
              });
            }
          });
      });

    new Setting(containerEl)
      .setName('Inline Card Separator')
      .setDesc('The separator to identify inline cards in notes')
      .addText((text) => {
        text
          .setValue(plugin.settings.inlineSeparator)
          .setPlaceholder(DEFAULT_SETTINGS.inlineSeparator)
          .onChange((value) => {
            if (!value) {
              showMessage({
                message: 'The inline separator must be at least 1 character long',
                type: 'error',
              });
              return;
            }

            if (value.trim() === plugin.settings.inlineSeparatorReversed) {
              showMessage({
                message:
                  'The inline separator must be distinct from the separator for reversed inline cards',
                type: 'error',
              });
              return;
            }

            plugin.settings.inlineSeparator = escapeRegExp(value.trim());
            plugin.saveData(plugin.settings);
          });
      });

    new Setting(containerEl)
      .setName('Inline reverse card separator')
      .setDesc(
        'The separator to identify inline cards in notes that also generate a reversed flashcard (Q => A & A => Q)',
      )
      .addText((text) => {
        text
          .setValue(plugin.settings.inlineSeparatorReversed)
          .setPlaceholder(DEFAULT_SETTINGS.inlineSeparatorReversed)
          .onChange((value) => {
            if (!value) {
              showMessage({
                message:
                  'The separator for reversed inline cards must be at least 1 character long',
                type: 'error',
              });
              return;
            }

            if (value.trim() === plugin.settings.inlineSeparatorReversed) {
              showMessage({
                message:
                  'The reversed inline separator must be distinct from the "normal" separator for inline cards',
                type: 'error',
              });
              return;
            }

            plugin.settings.inlineSeparator = escapeRegExp(value.trim());
            plugin.saveData(plugin.settings);
          });
      });

    // ---

    new Setting(containerEl)
      .setName('Processing Settings')
      .setHeading()
      .setDesc('How the detected content is processed into cards');

    let descDefaultDeck =
      'The name of the default deck where the cards will be added when not specified';
    if (plugin.settings.pathBasedDeck)
      descDefaultDeck += " *and* when the note is placed in the vault's root folder";

    new Setting(containerEl)
      .setName('Default Deck')
      .setDesc(descDefaultDeck)
      .addText((text) => {
        text
          .setValue(plugin.settings.defaultDeck)
          .setPlaceholder(`${DEFAULT_SETTINGS.defaultDeck}::SubDeck`)
          .onChange((value) => {
            if (value.length && RegExps.ankiDeckName.test(value)) {
              plugin.settings.defaultDeck = value;
              plugin.saveData(plugin.settings);
            } else {
              showMessage({
                message: 'Invalid deck name',
                type: 'error',
              });
            }
          });
      });

    new Setting(containerEl)
      .setName('Folder-based Deck Name')
      .setDesc(
        "Place cards into decks based on the note folder structure (when no deck is specified in the note's frontmatter)",
      )
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.pathBasedDeck).onChange((value) => {
          plugin.settings.pathBasedDeck = value;
          plugin.saveData(plugin.settings);
          // Refresh the description of default deck setting
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('Include Heading Context')
      .setDesc('Add the ancestor headings to the question part of the card')
      .addToggle((toggle) =>
        toggle.setValue(!!plugin.settings.contextAwareMode).onChange((value) => {
          if (value) plugin.settings.contextAwareMode = DEFAULT_SETTINGS.contextAwareMode;
          else plugin.settings.contextAwareMode = false;
          plugin.saveData(plugin.settings);
        }),
      );

    // ---

    new Setting(containerEl).setName('Anki (Connect) Settings').setHeading();

    new Setting(containerEl)
      .setName('Default Anki Tag')
      .setDesc('This tag will be added to each generated card in Anki')
      .addText((text) => {
        text
          .setValue(plugin.settings.defaultAnkiTag)
          .setPlaceholder(DEFAULT_SETTINGS.defaultAnkiTag)
          .onChange((value) => {
            if (!value.trim()) {
              showMessage({
                message: 'The default Anki tag cannot be empty',
                type: 'error',
              });
              return;
            }
            plugin.settings.defaultAnkiTag = value.trim();
            plugin.saveData(plugin.settings);
          });
      });

    new Setting(containerEl)
      .setName('Transfer Media Files')
      .setDesc(
        "Transfer media files as encoded strings to AnkiConnect or just pass it the file paths to fetch. The first one might be necessary if Anki can't access the file path directly (e.g. due to an anti-virus).",
      )
      .addToggle((toggle) => {
        toggle.setValue(plugin.settings.transferMediaFiles).onChange((value) => {
          plugin.settings.transferMediaFiles = value;
          plugin.saveData(plugin.settings);
        });
      });
  }
}
