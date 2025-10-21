# Flashcards

[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/reuseman/flashcards-obsidian?style=for-the-badge&sort=semver)](https://github.com/reuseman/flashcards-obsidian/releases/latest)
![GitHub All Releases](https://img.shields.io/github/downloads/reuseman/flashcards-obsidian/total?style=for-the-badge)

![logo](logo.png)
Anki integration for [Obsidian](https://obsidian.md/).

## Features

🗃️ Simple flashcards with **#card**
🎴 Reversed flashcards with **#card-reverse** or **#card/reverse**
<!-- 📅 Spaced-only cards with **#card-spaced** or **#card/spaced**   -->
✍️ Inline style with **Question::Answer**
✍️ Inline style reversed with **Question:::Answer**
<!-- 📃 Cloze with **==Highlight==** or **{Curly brackets}** or  **{2:Cloze}**    -->
🧠 **Context-aware** mode
🏷️ Global and local **tags**

🔢 Support for **LaTeX**
🖼️ Support for **images**
🎤 Support for **audios**
🔗 Support for **Obsidian URI**
⚓ Support for **reference to note**
📟 Support for **code syntax highlight**

For other features check the [wiki](https://github.com/reuseman/flashcards-obsidian/wiki).

## How it works?

The following is a demo where the three main operations are shown:

1. **Insertion** of cards;
2. **Update** of cards;
3. **Deletion** of cards.

![Demo image](docs/demo.gif)

## How to use it?

The wiki explains in detail [how to use it](https://github.com/reuseman/flashcards-obsidian/wiki).

## How to install

> [!important]
> Since this is a fork, it currently isn't officially build or pushed to the official Obsidian plugins repository.
> While I'm figuring things out, have a look at the [Contributing.md](./docs/CONTRIBUTING.md) to build the plugin manually & then come back to follow the instructions starting from step 2.

1. [Install](obsidian://show-plugin?id=flashcards-obsidian) this plugin on Obsidian:

   - Open Settings > Community plugins
   - Make sure Safe mode is off
   - Click Browse community plugins
   - Search for "**Flashcards**"
   - Click Install
   - Once installed, close the community plugins window and activate the newly installed plugin

2. Install [AnkiConnect](https://ankiweb.net/shared/info/2055492159) on Anki
   - Tools > Add-ons -> Get Add-ons...
   - Paste the code **2055492159** > Ok
   - Double-click the AnkiConnect entry & replace the `webCorsOriginList` entry with the following in the config:

```json
    "webCorsOriginList": [
        "http://localhost",
        "app://obsidian.md"
    ]
```

3. Open the settings of this plugin, and while Anki is opened press "**Grant Permission**"

## Contributing

Contributions via bug reports, bug fixes, are welcome. If you have ideas about features to be implemented, please open an issue so we can discuss the best way to implement it. For more details check [Contributing.md](docs/CONTRIBUTING.md)

## References

- [Obsidian Markdown Syntax](https://help.obsidian.md/syntax)
- [Anki Connect API Reference](https://git.sr.ht/~foosoft/anki-connect)

