import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, DecorationSet, ViewUpdate } from '@codemirror/view';
import { SETTINGS_SCOPED_KEYS, SETTINGS_SCOPED_TYPES } from './types/settings';
import { RegExps } from './regex';

const yamlStyles = {
  prop: Decoration.mark({ class: 'cm-prop' }),
  propAccepted: Decoration.mark({ class: 'cm-prop-accepted' }),
  string: Decoration.mark({ class: 'cm-string' }),
  stringAccepted: Decoration.mark({ class: 'cm-string-accepted' }),
  deckModification: Decoration.mark({ class: 'cm-deck-mod' }),
  boolean: Decoration.mark({ class: 'cm-bool' }),
  operator: Decoration.mark({ class: 'cm-operator' }),
  error: Decoration.mark({ class: 'cm-error' }),
} as const;

const DEBUG_YAML_PARSING = false;

function parseYAMLInComments(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();

  // Match %% blocks
  let match;

  while ((match = RegExps.applySyntaxHighlighting.exec(text)) !== null) {
    const blockCommentContent = match[1];
    const lines = blockCommentContent.split('\n');
    if (DEBUG_YAML_PARSING) console.debug('YAML block found:', lines);

    // Move behind starting `%%`
    let currentPos = match.index + 2;

    for (const line of lines) {
      if (line.trim() === '') {
        currentPos += line.length + 1;
        continue;
      }

      const kvMatch = line.match(RegExps.yamlKVLine) as RegExps.YamlKVMatch | null;

      if (kvMatch) {
        if (DEBUG_YAML_PARSING) console.debug('YAML KV line match:', kvMatch.groups);
        const { key, gap } = kvMatch.groups;
        const keyEnd = currentPos + key.length;

        builder.add(
          currentPos,
          keyEnd,
          Object.values(SETTINGS_SCOPED_KEYS as Record<string, string>).contains(key)
            ? yamlStyles.propAccepted
            : yamlStyles.prop,
        );
        builder.add(keyEnd, keyEnd + gap.length, yamlStyles.operator);

        addToBuilder(
          text,
          builder,
          keyEnd + gap.length,
          currentPos + kvMatch[0].length,
          kvMatch.groups,
        );

        currentPos += line.length + 1;
        continue;
      }

      const objectMatch = line.match(RegExps.yamlObject) as RegExps.YamlObjectMatch | null;

      if (objectMatch) {
        const { content } = objectMatch.groups;

        const openBrace = currentPos + objectMatch.index!;
        builder.add(openBrace, openBrace + 1, yamlStyles.operator);

        if (content) {
          let currentPosContent = openBrace + 1;
          const kvParis = content.split(',');

          kvParis
            .map(
              (s) => [s.match(RegExps.yamlKV('')) as RegExps.YamlKVMatch | null, s.length] as const,
            )
            .forEach(([kvMatch, length]) => {
              if (!kvMatch) return;

              if (DEBUG_YAML_PARSING) console.debug('YAML object KV match:', kvMatch.groups);
              const { key, gap } = kvMatch.groups;

              const keyStart = currentPosContent + kvMatch.index!;
              const keyEnd = keyStart + key.length;
              if (DEBUG_YAML_PARSING)
                console.debug('key: ', text.slice(keyStart, keyEnd), keyStart, keyEnd);
              builder.add(
                keyStart,
                keyEnd,
                Object.values(SETTINGS_SCOPED_KEYS as Record<string, string>).contains(key)
                  ? yamlStyles.propAccepted
                  : yamlStyles.prop,
              );
              builder.add(keyEnd, keyEnd + gap.length, yamlStyles.operator);

              currentPosContent += length + 1;

              addToBuilder(text, builder, keyEnd + gap.length, currentPos + length, kvMatch.groups);
            });
        }

        const closeBrace = currentPos + objectMatch[0].indexOf('}');
        builder.add(closeBrace, closeBrace + 1, yamlStyles.operator);

        currentPos += line.length + 1;
      }
    }
  }
  return builder.finish();
}

const addToBuilder = (
  text: string,
  builder: RangeSetBuilder<Decoration>,
  valueStart: number,
  valueEnd: number,
  groups: RegExps.YamlKVMatch['groups'],
) => {
  const { key, boolean, string } = groups;

  if (boolean) {
    if (DEBUG_YAML_PARSING)
      console.debug(
        'boolean:',
        text.slice(valueStart, boolean.length + valueStart),
        valueStart,
        boolean.length,
      );

    builder.add(valueStart, valueStart + boolean.length, yamlStyles.boolean);
  } else if (string) {
    // if (deckMod) {
    //   if (SETTINGS_SCOPED_KEYS.deck === key) {
    //     builder.add(valueStart, valueStart + deckMod.length, yamlStyles.deckModification);
    //   } else builder.add(valueStart, valueStart + deckMod.length, yamlStyles.stringAccepted);
    if (DEBUG_YAML_PARSING)
      console.debug(
        'string:',
        text.slice(valueStart, string.length + valueStart),
        valueStart,
        string.length,
      );

    const acceptedValues =
      key in SETTINGS_SCOPED_TYPES &&
      SETTINGS_SCOPED_TYPES[key as keyof typeof SETTINGS_SCOPED_KEYS]
        ?.split(' | ')
        .filter((v: string) => v.startsWith('"'))
        .map((v: string) => v.slice(1, -1).trim());

    if (key === SETTINGS_SCOPED_KEYS.deck) {
      const deckModificationMatch = string.trim().match(RegExps.ankiDeckModification);
      if (deckModificationMatch) {
        builder.add(
          valueStart,
          valueStart + deckModificationMatch[0].length,
          yamlStyles.deckModification,
        );
      } else {
        builder.add(valueStart, valueStart + string.length, yamlStyles.stringAccepted);
      }
    } else {
      builder.add(
        valueStart,
        valueStart + string.length,
        acceptedValues && acceptedValues.contains(string.trim())
          ? yamlStyles.stringAccepted
          : yamlStyles.string,
      );
    }

    builder.add(valueStart + string.length, valueEnd, yamlStyles.error);
  }
};

export const yamlCommentHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = parseYAMLInComments(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = parseYAMLInComments(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
