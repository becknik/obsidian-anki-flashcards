# Obsidian Flashcards

[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/becknik/flashcards-obsidian?style=for-the-badge&sort=semver)](https://github.com/reuseman/flashcards-obsidian/releases/latest)
![GitHub All Releases](https://img.shields.io/github/downloads/becknik/flashcards-obsidian/total?style=for-the-badge)

![logo](logo.png)
Anki integration for [Obsidian](https://obsidian.md/).

> [!important]
> This plugin has been overhauled from the core up for improvements in code structure & performance.
> Some features of the unmaintained v1 version by [reuseman](https://github.com/reuseman/flashcards-obsidian) aren't re-implemented yet.
> I'm hoping that the rework might have lowered the burden to contribute, so feel free to do so :)
>
> The allowed content of the flashcards has changed. For more information take a look at the [wiki page](https://github.com/becknik/flashcards-obsidian/wiki/Parsing).
> The diff generation feature might help with the migration.
>
> Here's the list of currently missing features:
>
> - Spaced Cards (**#card-spaced** or **#card/spaced**)
> - Cloze Cards
> - Source Links from Anki Notes to Obsidian
> - Deletion of cards from Obsidian
>
> Re-implementing them is planned for the [2.0 release milestone](https://github.com/becknik/flashcards-obsidian/milestone/1)

## Features

- 🗃️ Simple flashcards with **#card**
- 🎴 Reversed flashcards with **#card-reverse** or **#card/reverse**
- ✍️ Inline style with **Question :: Answer**
- ✍️ Inline style reversed with **Question ::: Answer**
- 🧠 **Heading context inclusion**
- 🏷️ Global and local **tags**
- 🔢 Support for all common Markdown elements, including **code highlighting** with [shiki](https://github.com/shikijs/shiki)
- ⚙️ **Per-note customization** of settings in frontmatter
- 🛣️ **Deck path modification** in Obsidian comments on a heading level
  - 🔗 Inspired by UNIX paths: `/` = `::`, `<<` = `../`, `::` at start extends the current deck's path, just like `./`
- 🔄 Anki card to note **diff generation** in `<name>.diff.md` files
- 📁 **Context menu entries** to process all notes in a directory tree

Have a look at the plugin settings, [the test vault](./test/vault/) or the [wiki](https://github.com/becknik/flashcards-obsidian/wiki) for further information.

## How it works?

The following is a demo where the three main operations are shown:

1. **Insertion** of cards;
2. **Update** of cards;
3. ~~**Deletion** of cards.~~

![Demo image](docs/demo.gif)

## How to install

1. [Install](obsidian://show-plugin?id=flashcards-obsidian) this plugin in Obsidian:

   - Open Settings > Community plugins
   - Make sure Safe mode is off
   - Click Browse community plugins
   - Search for "**Flashcards**"
   - Click Install
   - Once installed, close the community plugins window and activate the newly installed plugin

2. Install [AnkiConnect](https://ankiweb.net/shared/info/2055492159) on Anki
   - Tools > Add-ons -> Get Add-ons...
   - Paste the code **2055492159** > Ok

3. Open the settings of this plugin and - while Anki is opened - press "**Grant Permission**"

## Contributing

Contributions via bug reports, bug fixes, are welcome. If you have ideas about features to be implemented, please open an issue so we can discuss the best way to implement it. For more details check [Contributing.md](docs/CONTRIBUTING.md)

## Documentation References

- [Obsidian Markdown Syntax](https://help.obsidian.md/syntax)
- [Anki Connect API Reference](https://git.sr.ht/~foosoft/anki-connect)
- [Obsidian Plugin API](https://docs.obsidian.md/Home)
