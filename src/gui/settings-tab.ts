import FlashcardsPlugin from 'main';
import { App, PluginSettingTab, Setting } from 'obsidian';
import { hostname } from 'os';
import { DEFAULT_SETTINGS, FLASHCARDS_TAG_SUFFIXES } from 'src/constants';
import { RegExps } from 'src/regex';
import { SETTINGS_FRONTMATTER_KEYS } from 'src/types/settings';
import { escapeRegExp, showMessage } from 'src/utils';

const descriptionPermission = createFragment();
descriptionPermission.append(
  'Grant this plugin the permission to interact with AnkiConnect by opening Anki, installing the ',
  createEl('a', { href: 'https://ankiweb.net/shared/info/2055492159', text: 'AnkiConnect add-on' }),
  ' and pressing the "Grant Permission" button.',
  createEl('br'),
  'This only needs to be done one time per device & vault.',
);

const descriptionParsingSettings = createFragment();
descriptionParsingSettings.append(
  'Determine which note content is detected as a card.',
  createEl('br'),
  'For some examples, take a look at the ',
  createEl('a', {
    href: 'https://github.com/becknik/flashcards-obsidian/wiki/Parsing',
    text: 'GitHub wiki',
  }),
);

const descriptionFlashcardTag = createFragment();
descriptionFlashcardTag.append(
  'The base tag name to identify flashcards in notes (without the #-prefix).',
  createEl('br'),
  'This tag can be modified in the following ways to change the flashcard type to be created:',
  createEl('ul', '', (ul) => {
    FLASHCARDS_TAG_SUFFIXES.forEach((suffix) =>
      ul.append(createEl('li', '', (li) => li.append(createEl('code', { text: suffix })))),
    );
  }),
);

const descriptionProcessingSettings = createFragment();
descriptionProcessingSettings.append(
  'How the detected content is processed into cards.',
  createEl('br'),
  createEl('br'),
  'Elements with the `Frontmatter` tag can be set per note in its frontmatter with the following tags:',
  createEl('ul', '', (ul) => {
    Object.values(SETTINGS_FRONTMATTER_KEYS).forEach((key) =>
      ul.append(createEl('li', '', (li) => li.append(createEl('code', { text: key })))),
    );
  }),
);

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
      .setName('Grant AnkiConnect permission')
      .setDesc(descriptionPermission)
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
      .setName('Anki Model')
      .setHeading()
      .setDesc('Settings related to the Anki note models used');

    new Setting(containerEl)
      .setName('Include source links')
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
      .setName('Card Parsing')
      .setHeading()
      .setDesc(descriptionParsingSettings);

    new Setting(containerEl)
      .setName('Flashcards tag')
      .setDesc(descriptionFlashcardTag)
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
      .setName('Inline card separator')
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
      .setName('Card Processing')
      .setHeading()
      .setDesc(descriptionProcessingSettings);

    let descDefaultDeck =
      'The name of the default deck where the cards will be added when not specified';
    if (plugin.settings.pathBasedDeckGlobal)
      descDefaultDeck += " *and* when the note is placed in the vault's root folder";

    new Setting(containerEl)
      .setName('Default deck')
      .setClass('frontmatter')
      .setDesc(descDefaultDeck)
      .addText((text) => {
        text
          .setValue(plugin.settings.deckNameGlobal)
          .setPlaceholder(`${DEFAULT_SETTINGS.deckNameGlobal}::SubDeck`)
          .onChange((value) => {
            if (value.length && RegExps.ankiDeckName.test(value)) {
              plugin.settings.deckNameGlobal = value;
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
      .setName('Folder-based deck name')
      .setClass('frontmatter')
      .setDesc(
        "Place cards into decks based on the note folder structure (when no deck is specified in the note's frontmatter)",
      )
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.pathBasedDeckGlobal).onChange((value) => {
          plugin.settings.pathBasedDeckGlobal = value;
          plugin.saveData(plugin.settings);
          // Refresh the description of default deck setting
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('Insert frontmatter tags in cards')
      .setClass('frontmatter')
      .setDesc(
        'Insert the elements from the `tag` frontmattere property into each card of the note',
      )
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.applyFrontmatterTagsGlobal).onChange((value) => {
          plugin.settings.applyFrontmatterTagsGlobal = value;
          plugin.saveData(plugin.settings);
        }),
      );

    new Setting(containerEl)
      .setName('Insert heading context tags in cards')
      .setClass('frontmatter')
      .setDesc('Insert the tags from ancestor context headings into cards. This works without including the actual context in the question.')
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.applyHeadingContextTagsGlobal).onChange((value) => {
          plugin.settings.applyHeadingContextTagsGlobal = value;
          plugin.saveData(plugin.settings);
        }),
      );

    new Setting(containerEl)
      .setName('Include heading context')
      .setClass('frontmatter')
      .setDesc('Add the ancestor headings to the question part of the card')
      .addToggle((toggle) =>
        toggle.setValue(!!plugin.settings.headingContextModeGlobal).onChange((value) => {
          if (value)
            plugin.settings.headingContextModeGlobal = DEFAULT_SETTINGS.headingContextModeGlobal;
          else plugin.settings.headingContextModeGlobal = false;
          plugin.saveData(plugin.settings);

          this.display();
        }),
      );

    if (plugin.settings.headingContextModeGlobal) {
      new Setting(containerEl)
        .setName('Heading context separator')
        .setDesc('Separator to be added in between tow heading contexts')
        .addText((text) =>
          text
            .setValue((plugin.settings.headingContextModeGlobal as { separator: string }).separator)
            .onChange((value) => {
              (plugin.settings.headingContextModeGlobal as { separator: string }).separator = value;
              plugin.saveData(plugin.settings);
            }),
        );
    }

    // ---

    new Setting(containerEl).setName('Anki (Connect)').setHeading();

    new Setting(containerEl)
      .setName('Default Anki tag')
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
      .setName('Tags to preserve in Anki')
      .setDesc("These comma-separated tags won't be removed from Anki notes when updating them")
      .addText((text) => {
        text
          .setValue(plugin.settings.ankiTagsToPreserve.join(', '))
          .setPlaceholder([DEFAULT_SETTINGS.ankiTagsToPreserve, 'example'].join(', '))
          .onChange((value) => {
            if (!value.trim()) {
              showMessage({
                message: 'The default Anki tag cannot be empty',
                type: 'error',
              });
              return;
            }

            plugin.settings.ankiTagsToPreserve = value.trim().split(/,\s*/);
            plugin.saveData(plugin.settings);
          });
      });

    new Setting(containerEl)
      .setName('Transfer media files')
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
