import FlashcardsPlugin from 'main';
import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
import { hostname } from 'os';
import { DEFAULT_SETTINGS, FLASHCARDS_TAG_SUFFIXES } from 'src/constants';
import { RegExps } from 'src/regex';
import {
  SETTINGS_FRONTMATTER_KEYS,
  SETTINGS_FRONTMATTER_TYPES,
  SETTINGS_SCOPED_KEYS,
  SETTINGS_SCOPED_TYPES,
} from 'src/types/settings';
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

    const descriptionPermission = createFragment();
    descriptionPermission.append(
      'Grant this plugin the permission to interact with AnkiConnect by opening Anki, installing the ',
      createEl('a', {
        href: 'https://ankiweb.net/shared/info/2055492159',
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        text: 'AnkiConnect add-on',
      }),
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

    const descriptionProcessingSettingsAdvanced = createFragment();
    descriptionProcessingSettingsAdvanced.append(
      createEl('summary', {
        text: 'Advanced',
      }),
      'Elements with the "Frontmatter" tag can be overwritten on a per-note basis in its frontmatter with the following properties & values:',
      createEl('ul', '', (ul) => {
        Object.entries(SETTINGS_FRONTMATTER_KEYS).forEach(([key, value]) =>
          ul.append(
            createEl('li', '', (li) =>
              li.append(
                createEl('code', {
                  text:
                    value +
                    ': ' +
                    SETTINGS_FRONTMATTER_TYPES[key as keyof typeof SETTINGS_FRONTMATTER_TYPES],
                }),
              ),
            ),
          ),
        );
      }),
      createEl('br'),
      'Additionally, the following options can be appled to the heading context level by creating a comment block (',
      createEl('code', {
        text: '%%%%',
      }),
      ') with the following yaml properties in the next line:',
      createEl('ul', '', (ul) => {
        Object.entries(SETTINGS_SCOPED_KEYS).forEach(([key, value]) =>
          ul.append(
            createEl('li', '', (li) =>
              li.append(
                createEl('code', {
                  text:
                    value + ': ' + SETTINGS_SCOPED_TYPES[key as keyof typeof SETTINGS_SCOPED_TYPES],
                }),
              ),
            ),
          ),
        );
      }),
      createEl('br'),
      'The same can be done after inline cards with the following available properties:',
      createEl('ul', '', (ul) => {
        ul.append(
          createEl('li', '', (li) =>
            li.append(
              createEl('code', {
                // eslint-disable-next-line obsidianmd/ui/sentence-case
                text: 'swap: true',
              }),
            ),
          ),
        );
      }),
      createEl('br'),
      'For more information and examples, check out the ',
      createEl('a', {
        href: 'https://github.com/becknik/obsidian-anki-flashcards/wiki/Features#processing-settings',
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        text: 'wiki section',
      }),
      '.',
    );

    const descriptionProcessingSettings = createFragment();
    descriptionProcessingSettings.append(
      'How the detected content is processed into cards.',
      createEl('br'),
      createEl('br'),
      createEl('details', '', (details) => {
        details.appendChild(descriptionProcessingSettingsAdvanced);
      }),
    );

    // eslint-disable-next-line obsidianmd/settings-tab/no-problematic-settings-headings, obsidianmd/ui/sentence-case
    new Setting(containerEl).setName('Anki Flashcards').setHeading();

    const currentHostname = hostname();
    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setName('Grant AnkiConnect permission')
      .setDesc(descriptionPermission)
      .addButton((button) => {
        if (plugin.settings.ankiConnectPermissions.contains(currentHostname)) {
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          button.setDisabled(true).setButtonText('Permission Granted');
          return;
        }

        button
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setButtonText('Grant Permission')
          .setClass('mod-cta')
          .onClick(async () => {
            const { permission } = await this.plugin.authenticateWithAnki();
            if (permission === 'granted') {
              plugin.settings.ankiConnectPermissions = [
                ...plugin.settings.ankiConnectPermissions,
                currentHostname,
              ];
              await plugin.saveData(plugin.settings);
              showMessage({ message: 'AnkiConnect permission granted!', type: 'success' });

              await this.plugin.getAnkiConnection();
              this.display();
            } else {
              showMessage({ message: 'AnkiConnect permission not granted', type: 'error' });
            }
          });
      });

    if (!plugin.settings.ankiConnectPermissions.contains(currentHostname)) return;

    // ---

    new Setting(containerEl)
      .setName('Anki model')
      .setHeading()
      .setDesc('Settings related to the Anki note models used');

    new Setting(containerEl)
      .setName('Include source links')
      .setDesc('Add source file references to every generated card')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeSourceLink).onChange(async (value) => {
          if (value) {
            new ConfirmRerunOnRootModal(
              this.app,
              async (result) => {
                if (result) {
                  plugin.settings.includeSourceLink = true;
                  await plugin.saveData(plugin.settings);

                  // TODO: for some reason, the toggle flips to false again after the processing is affirmed
                  await this.plugin.generateFlashcardsForWholeVault();
                }
              },
              () => {
                toggle.setValue(false);
              },
            ).open();
          } else {
            plugin.settings.includeSourceLink = false;
            await plugin.saveData(plugin.settings);
          }
        }),
      );

    // ---

    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case
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
          .onChange(async (value) => {
            if (value.trim()) {
              plugin.settings.flashcardsTag = value.trim();
              await plugin.saveData(plugin.settings);
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
          .onChange(async (value) => {
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
            await plugin.saveData(plugin.settings);
          });
      });

    new Setting(containerEl)
      .setName('Inline reverse card separator')
      .setDesc(
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        'The separator to identify inline cards in notes that also generate a reversed flashcard (Q => A & A => Q)',
      )
      .addText((text) => {
        text
          .setValue(plugin.settings.inlineSeparatorReversed)
          .setPlaceholder(DEFAULT_SETTINGS.inlineSeparatorReversed)
          .onChange(async (value) => {
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
            await plugin.saveData(plugin.settings);
          });
      });

    // ---

    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case
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
          .onChange(async (value) => {
            if (value.length && RegExps.ankiDeckName.test(value)) {
              plugin.settings.deckNameGlobal = value;
              await plugin.saveData(plugin.settings);
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
        toggle.setValue(plugin.settings.pathBasedDeckGlobal).onChange(async (value) => {
          plugin.settings.pathBasedDeckGlobal = value;
          await plugin.saveData(plugin.settings);
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
        toggle.setValue(plugin.settings.applyFrontmatterTagsGlobal).onChange(async (value) => {
          plugin.settings.applyFrontmatterTagsGlobal = value;
          await plugin.saveData(plugin.settings);
        }),
      );

    new Setting(containerEl)
      .setName('Insert heading context tags in cards')
      .setClass('frontmatter')
      .setDesc(
        'Insert the tags from ancestor context headings into cards. This works without including the actual context in the question.',
      )
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.applyHeadingContextTagsGlobal).onChange(async (value) => {
          plugin.settings.applyHeadingContextTagsGlobal = value;
          await plugin.saveData(plugin.settings);
        }),
      );

    new Setting(containerEl)
      .setName('Include heading context')
      .setClass('frontmatter')
      .setDesc('Add the ancestor headings to the question part of the card')
      .addToggle((toggle) =>
        toggle.setValue(!!plugin.settings.headingContextModeGlobal).onChange(async (value) => {
          if (value)
            plugin.settings.headingContextModeGlobal = DEFAULT_SETTINGS.headingContextModeGlobal;
          else plugin.settings.headingContextModeGlobal = false;
          await plugin.saveData(plugin.settings);

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
            .onChange(async (value) => {
              (plugin.settings.headingContextModeGlobal as { separator: string }).separator = value;
              await plugin.saveData(plugin.settings);
            }),
        );
    }

    // ---

    // eslint-disable-next-line obsidianmd/ui/sentence-case
    new Setting(containerEl).setName('Anki (Connect)').setHeading();

    new Setting(containerEl)
      .setName('Default Anki tag')
      .setDesc('This tag will be added to each generated card in Anki')
      .addText((text) => {
        text
          .setValue(plugin.settings.defaultAnkiTag)
          .setPlaceholder(DEFAULT_SETTINGS.defaultAnkiTag)
          .onChange(async (value) => {
            if (!value.trim()) {
              showMessage({
                message: 'The default Anki tag cannot be empty',
                type: 'error',
              });
              return;
            }
            plugin.settings.defaultAnkiTag = value.trim();
            await plugin.saveData(plugin.settings);
          });
      });

    new Setting(containerEl)
      .setName('Tags to preserve in Anki')
      .setDesc("These comma-separated tags won't be removed from Anki notes when updating them")
      .addText((text) => {
        text
          .setValue(plugin.settings.ankiTagsToPreserve.join(', '))
          .setPlaceholder([DEFAULT_SETTINGS.ankiTagsToPreserve, 'example'].join(', '))
          .onChange(async (value) => {
            if (!value.trim()) {
              showMessage({
                message: 'The default Anki tag cannot be empty',
                type: 'error',
              });
              return;
            }

            plugin.settings.ankiTagsToPreserve = value.trim().split(/,\s*/);
            await plugin.saveData(plugin.settings);
          });
      });

    new Setting(containerEl)
      .setName('Transfer media files')
      .setDesc(
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        "Transfer media files as encoded strings to AnkiConnect or just pass it the file paths to fetch. The first one might be necessary if Anki can't access the file path directly (e.g. due to an anti-virus).",
      )
      .addToggle((toggle) => {
        toggle.setValue(plugin.settings.transferMediaFiles).onChange(async (value) => {
          plugin.settings.transferMediaFiles = value;
          await plugin.saveData(plugin.settings);
        });
      });
  }
}

export class ConfirmRerunOnRootModal extends Modal {
  constructor(app: App, onSubmit: (result: boolean) => Promise<void>, onClose: () => void) {
    super(app);

    this.setTitle('Execute on whole vault?');
    this.setContent(
      'Toggling this setting requires re-processing all notes in the vault for a consistent result. Do you want to proceed?',
    );

    // this doesn't seem to exist: this.setCloseCallback()
    let closeCallbackExecuted = false;
    this.onClose = () => {
      // Prevent infinite recursion
      if (closeCallbackExecuted) return;

      onClose();
      closeCallbackExecuted = true;
      this.close();
    }

    new Setting(this.contentEl).addButton((btn) =>
      btn
        .setButtonText('Proceed')
        .setCta()
        .onClick(async () => {
          this.close();
          await onSubmit(true);
        }),
    );
  }
}
