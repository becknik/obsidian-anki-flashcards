import Icon from 'assets/icon.svg';
import {
  addIcon,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  Menu,
  normalizePath,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
} from 'obsidian';
import * as path from 'path';
import { DEFAULT_SETTINGS, SCRIPTS_FOLDER_NAME, STYLE_FILE_NAME } from 'src/constants';
import { AnkiConnection, AnkiConnectUnreachableError } from 'src/generation/anki';
import { CardsProcessor } from 'src/generation/cards';
import { CardDelta } from 'src/generation/types';
import { SettingsTab } from 'src/gui/settings-tab';
import { RegExps } from 'src/regex';
import { yamlCommentHighlighter } from 'src/syntax-highlighting';
import { Settings, SETTINGS_SCOPED_KEYS } from 'src/types/settings';
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
    void this.getAnkiConnection();

    this.addRibbonIcon(ICON_NAME, 'Generate flashcards', () => {
      const activeFile = this.app.workspace.getActiveFile();

      if (activeFile) void this.generateFlashcards(activeFile);
      else
        showMessage({ type: 'error', message: 'Open a file before trying to generate flashcards' });
    });

    this.addSettingTab(new SettingsTab(this.app, this));

    this.registerInterval(
      window.setInterval(() => {
        void this.getAnkiConnection('scheduled');
      }, 60 * 1000),
    );

    this.app.workspace.on('file-menu', (menu, file, source) =>
      this.onMenuOpenCallback(menu, file, source),
    );

    this.registerEditorExtension([yamlCommentHighlighter]);
    this.registerEditorSuggest(new CustomAutoComplete(this.app));
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

        showMessage({ type: 'error', message: (e as Error).message });
        this.statusBar.setText('❌ Anki connection failed');
      }
    }
    return connection;
  }

  private async getAnkiConnectionWithMessage() {
    let c;
    try {
      c = await this.getAnkiConnection();
    } catch (e) {
      console.error(e);
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
    const settingsData = (await this.loadData()) as Partial<Settings>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async onunload() {
    await this.saveData(this.settings);
  }

  // ---

  private addCommands() {
    this.addCommand({
      id: 'flashcard-check-anki-connection',
      name: 'Check connection to Anki',
      callback: () => {
        void this.getAnkiConnectionWithMessage();
      },
    });

    this.addCommand({
      id: 'flashcard-update-anki-models',
      name: 'Update Anki note models',
      callback: () => {
        void this.updateModels();
      },
    });

    this.addCommand({
      id: 'flashcard-generate-current-file',
      name: 'Generate from current file',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (checking) return Boolean(activeFile);

        void this.generateFlashcards(activeFile!);
      },
    });

    this.addCommand({
      id: 'flashcard-generate-current-file-diff',
      name: 'Generate diff from current file',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (checking) return Boolean(activeFile);

        void this.generateDeltas(activeFile!);
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
    await AnkiConnection.updateModels();

    showMessage({ type: 'success', message: 'Anki note models updated successfully' });
  }

  private async updateStaticAnkiConnectionModelFiles() {
    const configDir = this.app.vault.configDir;
    const folderPathScripts = path.join(
      configDir,
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

    const folderPathStyle = path.join(configDir, 'plugins', this.manifest.id, STYLE_FILE_NAME);
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
          message: `Error while processing file '${element.name}': ${(e as Error).message}`,
        });
      }
    } else if (element instanceof TFolder) {
      const fileGen = this.mdFileGenerator(element);
      for (const file of fileGen) {
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
      }
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
      const currentFileDetla = await this.cardsProcessor.diffCard(connection, element);
      results.push({
        file: element,
        deltas: currentFileDetla,
      });
    } else if (element instanceof TFolder) {
      const fileGen = this.mdFileGenerator(element);

      for (const file of fileGen) {
        const deltas = await this.cardsProcessor.diffCard(connection, file);
        if (deltas.length > 0) results.push({ file, deltas });
      }
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

  private async createDiffFile(file: TFile, deltas: CardDelta[]) {
    // weird edge case...
    if (deltas.length === 0) return;

    const parsed = path.parse(file.path);
    const newFileName = normalizePath(parsed.dir + '/' + parsed.name + '.diff.md');

    const oldDiff = this.app.vault.getAbstractFileByPath(newFileName);
    // eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file
    if (oldDiff) await this.app.vault.delete(oldDiff);

    return await this.app.vault.create(
      newFileName,
      deltas.reduce(
        (acc, delta) => {
          return (
            acc +
            (delta.createOrId === 'create'
              ? delta.createOrId
              : '[[' + file.path + '#^' + delta.createOrId + '|' + delta.createOrId + ']]') +
            (delta.createOrId === 'create' ? '' : ' - ' + delta.type) +
            '\n```diff\n' +
            delta.diff +
            '```\n'
          );
        },
        '# [[' + file.path + '|' + file.basename + ']]\n\n',
      ),
    );
  }
}

const SUGGESTIONS = Object.values(SETTINGS_SCOPED_KEYS).map((v) => v + ': ');
const DEBUG_AUTO_COMPLETE = false;

export class CustomAutoComplete extends EditorSuggest<string> {
  getSuggestions(context: EditorSuggestContext): string[] {
    const { query } = context;
    return SUGGESTIONS.filter((s) => s.toLowerCase().includes(query.toLowerCase()));
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const currentLine = editor.getLine(cursor.line);
    const currentWordRange = editor.wordAt(cursor);
    const currentLineCutoff = currentLine.slice(0, currentWordRange?.to.ch ?? cursor.ch);
    const currentWord = currentWordRange
      ? editor.getRange(currentWordRange.from, currentWordRange.to)
      : '';

    const prevLine = cursor.line > 0 ? editor.getLine(cursor.line - 1) : '';

    const mightBeInlineContext = prevLine.match(/^#+ +.+?$/);
    if (mightBeInlineContext) {
      const inlineMatch = currentLineCutoff.match(RegExps.autoCompleteTriggerObject);
      if (inlineMatch) {
        if (DEBUG_AUTO_COMPLETE)
          console.debug(
            'triggered inline:',
            inlineMatch[1],
            inlineMatch[2],
            inlineMatch[3],
            currentLineCutoff.slice(
              inlineMatch.index! + inlineMatch[1].length + inlineMatch[2].length,
              inlineMatch.index! + inlineMatch[0].length,
            ),
          );

        return {
          start: {
            line: cursor.line,
            ch: inlineMatch.index! + inlineMatch[1].length + inlineMatch[2].length,
          },
          end: {
            line: cursor.line,
            ch: inlineMatch.index! + inlineMatch[0].length,
          },
          query: currentWord,
        };
      }
    }

    const linesAroundToCheck = 3;
    const lowerBound = Math.max(1, cursor.line - linesAroundToCheck);
    for (let lineNum = lowerBound; lineNum <= cursor.line; ++lineNum) {
      if (
        editor.getLine(lineNum).startsWith('%%') &&
        editor.getLine(lineNum - 1).match(/^#+ +.+?$/)
      ) {
        const propStart = currentLineCutoff.match(RegExps.autoCompleteTrigger);

        const isInline = currentLine.match(/%%\s*/);
        return {
          start: {
            line: cursor.line,
            ch: isInline ? 2 : 0,
          },
          end: {
            line: cursor.line,
            ch: propStart ? propStart.index! + propStart[0].length : isInline? 2 : 0,
          },
          query: isInline ? '' : currentWord,
        };
      }
    }

    return null;
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.createEl('div', { text: value });
  }

  selectSuggestion(value: string): void {
    const active = this.context?.editor;
    if (active && this.context) {
      console.log('replaceRange', value, this.context.start, this.context.end);
      active.replaceRange(value, this.context.start, this.context.end);
    }
  }
}
