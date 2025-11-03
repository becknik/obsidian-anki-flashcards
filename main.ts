import Icon from 'assets/icon.svg';
import { addIcon, Menu, normalizePath, Plugin, TAbstractFile, TFile, TFolder } from 'obsidian';
import * as path from 'path';
import { DEFAULT_SETTINGS, SCRIPTS_FOLDER_NAME, STYLE_FILE_NAME } from 'src/constants';
import { AnkiConnection, AnkiConnectUnreachableError } from 'src/generation/anki';
import { CardsProcessor } from 'src/generation/cards';
import { CardDelta } from 'src/generation/types';
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
  private requiredFilesNotPresent: boolean = false;

  async onload() {
    console.debug('Loading Flashcards Plugin in version', this.manifest.version);

    await this.loadSettings();
    this.cardsProcessor = new CardsProcessor(this.app, this.settings);
    this.addCommands();

    addIcon(ICON_NAME, Icon);
    this.statusBar = this.addStatusBarItem();
    this.getAnkiConnection();

    this.addRibbonIcon(ICON_NAME, 'Generate flashcards', () => {
      const activeFile = this.app.workspace.getActiveFile();

      if (activeFile) this.generateFlashcards(activeFile);
      else
        showMessage({ type: 'error', message: 'Open a file before trying to generate flashcards' });
    });

    this.addSettingTab(new SettingsTab(this.app, this));

    this.registerInterval(
      window.setInterval(async () => this.getAnkiConnection('scheduled'), 60 * 1000),
    );

    this.app.workspace.on('file-menu', (menu, file, source) =>
      this.onMenuOpenCallback(menu, file, source),
    );
  }

  public async getAnkiConnection(execution?: 'scheduled') {
    if ((execution === 'scheduled' && this.ankiConnectNotSetup) || this.requiredFilesNotPresent)
      return null;

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
      this.statusBar.setText('⚡️ Anki active');
    } catch (e) {
      if (e instanceof AnkiConnectUnreachableError) {
        this.statusBar.setText('❌ Anki unreachable');
      } else {
        this.ankiConnectNotSetup = true;

        showMessage({ type: 'error', message: e.message });
        this.statusBar.setText('❌ Anki connection failed');
      }
    }
    return connection;
  }

  private getAnkiConnectionWithMessage() {
    let c;
    try {
      c = this.getAnkiConnection();
    } catch (e) {
      console.error(e)
      showMessage({ type: 'error', message: "Couldn't connect to Anki" });
      return false;
    }
    if (!c) {
      showMessage({ type: 'error', message: "Couldn't connect to Anki" });
      return false;
    }
    return c;
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
      name: 'Check connection to Anki',
      callback: () => {
        this.getAnkiConnection().then((connection) => {
          if (connection)
            showMessage({ type: 'success', message: 'Successfully connected to Anki' });
        });
      },
    });

    this.addCommand({
      id: 'flashcard-update-anki-models',
      name: 'Update Anki note models',
      callback: () => {
        this.updateModels();
      },
    });

    this.addCommand({
      id: 'flashcard-generate-current-file',
      name: 'Generate from current file',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (checking) return Boolean(activeFile);

        this.generateFlashcards(activeFile!);
      },
    });

    this.addCommand({
      id: 'flashcard-generate-current-file-diff',
      name: 'Generate diff from current file',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (checking) return Boolean(activeFile);

        this.generateDeltas(activeFile!);
      },
    });
  }

  private onMenuOpenCallback(menu: Menu, element: TAbstractFile, _source: string) {
    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle('Generate flashcards delta')
        .setIcon(ICON_NAME)
        .onClick(() => this.generateDeltas(element));
    });
    menu.addItem((item) => {
      item
        .setTitle('Generate flashcards')
        .setIcon(ICON_NAME)
        .onClick(() => this.generateFlashcards(element));
    });
  }

  // Methods used by commands

  private async updateModels() {
    const connection = await this.getAnkiConnectionWithMessage();
    if (!connection) return;

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
    if (filePathsScripts.files.length === 0) {
      this.requiredFilesNotPresent = true;
      showMessage({
        type: 'warning',
        message: `Dictionary "${SCRIPTS_FOLDER_NAME}" is missing or has no content`,
      });
    }
    const filesContentScripts = filePathsScripts.files.map(async (filePath) => {
      const content = await this.app.vault.adapter.read(filePath);
      return content;
    });

    const folderPathStyle = path.join('.obsidian', 'plugins', this.manifest.id, STYLE_FILE_NAME);
    let fileContentStyle;
    try {
      fileContentStyle = await this.app.vault.adapter.read(folderPathStyle);
    } catch (e) {
      console.error(`Error reading style file at "${folderPathStyle}":`, e);

      this.requiredFilesNotPresent = true;
      showMessage({
        type: 'error',
        message: `Note styling file "${STYLE_FILE_NAME}" is missing`,
      });
    }

    AnkiConnection.cssContent = fileContentStyle ?? null;
    AnkiConnection.scriptContents = await Promise.all(filesContentScripts);
  }

  private async generateFlashcards(element: TAbstractFile) {
    const connection = await this.getAnkiConnectionWithMessage();
    if (!connection) return;

    let filesProcessed = 0;
    const stats = {
      created: 0,
      updated: 0,
      ignored: 0,
    };

    if (element instanceof TFile) {
      try {
        await this.cardsProcessor.process(connection, element, true);
        filesProcessed = 1;
      } catch (e) {
        showMessage({
          type: 'error',
          message: `Error while processing file '${element.name}': ${e.message}`,
        });
      }
    } else if (element instanceof TFolder) {
      await this.processWithConcurrency(this.mdFileGenerator(element), connection, async (file) => {
        try {
          const result = await this.cardsProcessor.process(connection, file);
          ++filesProcessed;

          if (result) {
            const { created, updated, ignored } = result;
            stats.created += created;
            stats.updated += updated;
            stats.ignored += ignored;
          }
        } catch (e) {
          console.error(`Failed to process file "${file.path}":`, e);
        }
      });
    } else {
      throw new Error(`Element "${element.path}" is neither a file nor a folder`);
    }

    showMessage(
      {
        type: 'success',
        message: `Successfully processed ${filesProcessed} file(s)`,
      },
      'long',
    );
    if (Object.values(stats).some((v) => v > 0)) {
      showMessage(
        {
          type: 'info',
          message: `Cards created: ${stats.created}, updated: ${stats.updated}, passed: ${stats.ignored}`,
        },
        'long',
      );
    }
  }

  private async generateDeltas(element: TAbstractFile) {
    const connection = await this.getAnkiConnectionWithMessage();
    if (!connection) return;

    const results: Array<{ file: TFile; deltas: CardDelta[] }> = [];

    if (element instanceof TFile) {
      results.push({
        file: element,
        deltas: await this.cardsProcessor.diffCard(connection, element),
      });
    } else if (element instanceof TFolder) {
      await this.processWithConcurrency(
        this.mdFileGenerator(element),
        connection,
        async (file, deltas) => {
          if (deltas.length > 0) results.push({ file, deltas });
        },
      );
    } else {
      throw new Error(`Element "${element.path}" is neither a file nor a folder`);
    }

    if (results.length === 0) {
      showMessage(
        {
          type: 'info',
          message: 'No differences found in any files',
        },
        'long',
      );
      return;
    }

    const adjustedFiles = await Promise.all(
      results.map(({ file, deltas }) => this.createDiffFile(file, deltas)),
    );
    const adjustedCount = adjustedFiles.reduce((acc, file) => (acc += Number(!!file)), 0);
    if (adjustedCount === 0) {
      showMessage(
        {
          type: 'info',
          message: 'No difference found',
        },
        'long',
      );
      return;
    }

    showMessage(
      {
        type: 'success',
        message: `Delta files created for ${adjustedCount ?? 0} file(s)`,
      },
      'long',
    );
  }

  private *mdFileGenerator(folder: TFolder): Generator<TFile> {
    for (const child of folder.children) {
      if (child instanceof TFile) {
        if (child.extension !== 'md') continue;
        yield child;
      } else if (child instanceof TFolder) {
        yield* this.mdFileGenerator(child);
      }
    }
  }

  private async processWithConcurrency(
    fileGen: Generator<TFile>,
    connection: AnkiConnection,
    onResult: (file: TFile, deltas: CardDelta[]) => Promise<void>,
    concurrency: number = 5,
  ) {
    const workers = Array.from({ length: concurrency }, () =>
      (async () => {
        for (const file of fileGen) {
          const deltas = await this.cardsProcessor.diffCard(connection, file);
          await onResult(file, deltas);
        }
      })(),
    );

    await Promise.all(workers);
  }

  private async createDiffFile(file: TFile, deltas: CardDelta[]) {
    // weird edge case...
    if (deltas.length === 0) return;

    const parsed = path.parse(file.path);
    const newFileName = normalizePath(parsed.dir + '/' + parsed.name + '.diff.md');
    const oldDiff = this.app.vault.getAbstractFileByPath(newFileName) as TFile;
    if (file) await this.app.vault.delete(oldDiff);

    return await this.app.vault.create(
      newFileName,
      deltas.reduce(
        (acc, delta) => {
          return (
            acc +
            delta.createOrId +
            (delta.createOrId === 'create' ? '' : ' - ' + delta.type) +
            '\n```diff\n' +
            delta.diff +
            '```\n'
          );
        },
        '# ' + file.path + '\n\n',
      ),
    );
  }
}
