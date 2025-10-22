import Icon from 'assets/icon.svg';
import { addIcon, Plugin, TFile } from 'obsidian';
import { SettingsTab } from 'src/gui/settings-tab';
import { Anki } from 'src/services/anki';
import { CardsService } from 'src/services/cards';
import { Settings } from 'src/types/settings';
import { showMessage } from 'src/utils';

const DEFAULT_SETTINGS: Settings = {
  contextAwareMode: true,
  sourceSupport: false,
  codeHighlightSupport: false,
  inlineID: false,
  contextSeparator: ' > ',
  deck: 'Default',
  folderBasedDeck: true,
  flashcardsTag: 'card',
  inlineSeparator: '::',
  inlineSeparatorReverse: ':::',
  defaultAnkiTag: 'Obsidian',
  ankiConnectPermission: false,
} as const;

export default class ObsidianFlashcard extends Plugin {
  private settings: Settings;
  private cardsService: CardsService;
  private anki: Anki;

  async onload() {
    addIcon('flashcards', Icon);
    const statusBar = this.addStatusBarItem();

    this.anki = new Anki();
    this.updateAnkiConnectionStatus(statusBar);

    await this.loadSettings();

    // TODO test when file did not insert flashcards, but one of them is in Anki already
    this.cardsService = new CardsService(this.app, this.settings);

    this.addCommand({
      id: 'flashcard-check-anki-connection',
      name: 'Check Connection to Anki',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (checking) return Boolean(activeFile);

        this.updateAnkiConnectionStatus(statusBar).then((isConnected) =>
          isConnected
            ? showMessage({ type: 'success', message: 'Anki is connected!' })
            : showMessage({ type: 'warning', message: "Couldn't connect to Anki" }),
        );

        return true;
      },
    });

    this.addCommand({
      id: 'flashcard-generate-current-file',
      name: 'Generate for current file',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (checking) return Boolean(activeFile);

        this.generateCards(activeFile!);

        return true;
      },
    });

    this.addRibbonIcon('flashcards', 'Generate flashcards', () => {
      const activeFile = this.app.workspace.getActiveFile();

      if (activeFile) this.generateCards(activeFile);
      else showMessage({ type: 'error', message: 'Open a file before' });
    });

    this.addSettingTab(new SettingsTab(this.app, this));

    this.registerInterval(
      window.setInterval(() => this.updateAnkiConnectionStatus(statusBar), 60 * 1000)
    );
  }

  onunload() {
    this.saveData(this.settings);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async generateCards(activeFile: TFile) {
    if (!(await this.isAnkiConnected())) {
      showMessage({ type: 'error', message: " Couldn't connect to Anki" });
      return;
    }

    console.debug(`Generating flashcards for file '${activeFile.name}'`);
    try {
      await this.cardsService.process(activeFile);
    } catch (e) {
      showMessage({
        type: 'error',
        message: `Error while processing file '${activeFile.name}': ${e.message}`,
      });
    }
  }

  private async updateAnkiConnectionStatus(statusBarItem: HTMLElement): Promise<boolean> {
    const isConnected = await this.isAnkiConnected();
    if (isConnected) statusBarItem.setText('Anki Active ⚡️');
    else statusBarItem.setText('Anki Connection Failed ❌');
    return isConnected;
  }

  private async isAnkiConnected(): Promise<boolean> {
    try {
      return await this.anki.ping();
    } catch (e) {
      console.error('Error while pinging Anki:', e);
      return false;
    }
  }
}
