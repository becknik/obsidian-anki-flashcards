import Icon from 'assets/icon.svg';
import { addIcon, Plugin, TFile } from 'obsidian';
import * as path from 'path';
import { DEFAULT_SETTINGS, SCRIPTS_FOLDER_NAME, STYLE_FILE_NAME } from 'src/constants';
import { AnkiConnection, AnkiConnectUnreachableError } from 'src/generation/anki';
import { CardsProcessor } from 'src/generation/cards';
import { SettingsTab } from 'src/gui/settings-tab';
import { Settings } from 'src/types/settings';
import { showMessage } from 'src/utils';

const ICON_NAME = 'flashcards';

export default class FlashcardsPlugin extends Plugin {
  public settings: Settings;

  private statusBar: HTMLElement;
  private cardsProcessor: CardsProcessor;

  /**
   * Flag to avoid periodic connection attempts when AnkiConnect is not set up yet
   */
  private ankiConnectNotSetup: boolean = false;

  async onload() {
    console.debug('Loading Flashcards Plugin in version', this.manifest.version);

    await this.loadSettings();
    this.cardsProcessor = new CardsProcessor(this.app, this.settings);
    this.addCommands();

    addIcon(ICON_NAME, Icon);
    this.statusBar = this.addStatusBarItem();
    this.getAnkiConnection();

    this.addRibbonIcon(ICON_NAME, 'Generate Flashcards', () => {
      const activeFile = this.app.workspace.getActiveFile();

      if (activeFile) this.generateCards(activeFile);
      else
        showMessage({ type: 'error', message: 'Open a file before trying to generate flashcards' });
    });

    this.addSettingTab(new SettingsTab(this.app, this));

    this.registerInterval(
      window.setInterval(async () => this.getAnkiConnection('scheduled'), 60 * 1000),
    );
  }

  public async getAnkiConnection(execution?: 'scheduled') {
    if (execution === 'scheduled' && this.ankiConnectNotSetup) return null;

    if (!AnkiConnection.scriptContents || !AnkiConnection.cssContent) {
      await this.updateStaticAnkiConnectionModelFiles();
    }

    let connection: AnkiConnection | null = null;
    try {
      connection = await AnkiConnection.create(
        this.settings,
        this.app.vault.getName(),
        this.manifest.version,
        (settings: Settings) => this.saveData(settings),
      );
      this.statusBar.setText('⚡️ Anki Active');
    } catch (e) {
      if (e instanceof AnkiConnectUnreachableError) {
        this.statusBar.setText('❌ Anki Unreachable');
      } else {
        this.ankiConnectNotSetup = true;

        showMessage({ type: 'error', message: e.message });
        this.statusBar.setText('❌ Anki Connection Failed');
      }
    }
    return connection;
  }

  public async authenticateWithAnki() {
    return await AnkiConnection.requestPermission();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async onunload() {
    await this.saveData(this.settings);
  }

  // ---

  private addCommands() {
    this.addCommand({
      id: 'flashcard-check-anki-connection',
      name: 'Check Connection to Anki',
      checkCallback: (checking: boolean) => {
        if (checking) return true;

        this.getAnkiConnection().then((connection) => {
          if (connection)
            showMessage({ type: 'success', message: 'Successfully connected to Anki' });
        });
      },
    });

    this.addCommand({
      id: 'flashcard-update-anki-models',
      name: 'Update Anki Note Models',
      checkCallback: (checking: boolean) => {
        if (checking) return true;

        this.updateModels();
      },
    });

    this.addCommand({
      id: 'flashcard-generate-current-file',
      name: 'Generate Flashcards from Current File',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (checking) return Boolean(activeFile);

        this.generateCards(activeFile!);
      },
    });
  }

  // Methods used by commands

  private async generateCards(activeFile: TFile) {
    const connection = await this.getAnkiConnection();

    if (!connection) {
      showMessage({ type: 'error', message: " Couldn't connect to Anki" });
      return;
    }

    try {
      await this.cardsProcessor.process(connection, activeFile);
    } catch (e) {
      showMessage({
        type: 'error',
        message: `Error while processing file '${activeFile.name}': ${e.message}`,
      });
    }
  }

  private async updateModels() {
    const connection = await this.getAnkiConnection();

    if (!connection) {
      showMessage({ type: 'error', message: " Couldn't connect to Anki" });
      return;
    }

    await this.updateStaticAnkiConnectionModelFiles();
    AnkiConnection.updateModels();

    showMessage({ type: 'success', message: 'Anki note models updated successfully' });
  }

  private async updateStaticAnkiConnectionModelFiles() {
    const folderPathScripts = path.join(
      '.obsidian',
      'plugins',
      this.manifest.id,
      SCRIPTS_FOLDER_NAME,
    );
    const filePathsScripts = await this.app.vault.adapter.list(folderPathScripts);
    const filesContentScripts = filePathsScripts.files.map(async (filePath) => {
      const content = await this.app.vault.adapter.read(filePath);
      return content;
    });

    const folderPathStyle = path.join('.obsidian', 'plugins', this.manifest.id, STYLE_FILE_NAME);
    const fileContentStyle = await this.app.vault.adapter.read(folderPathStyle);

    AnkiConnection.cssContent = fileContentStyle;
    AnkiConnection.scriptContents = await Promise.all(filesContentScripts);
  }
}
