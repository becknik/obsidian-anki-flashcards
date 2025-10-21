# Contributing
Contributions via bug reports, bug fixes, are welcome.

If you have ideas about features to be implemented, please open an issue so we can discuss the best way to implement it.

## Getting Started

1. Clone this repository: `git clone https://github.com/becknik/flashcards-obsidian.git`
2. Run `npm install && npm run build`

### Using the `main` build

Copy the following elements from this repo into your vaults `.obsidian/plugins/flashcards-obsidian` directory:

- `app.js`
- `data.json`
- `manifest.json`

### Explorative Testing

This repos `./test/vault` directory can be opened in Obsidian to use a quick explorative test environment with the current build of the plugin linked into it.
This can be combined with `npm run dev` to manually adapt to changes.

> [!note]
> Don't forget to enable community plugins in the settings

> [!important]
> I'm hard-linking this repository into the `vault/.obsidian/plugins/flashcards-obsidian` directory for this to work.
> This has some merits:
>
> - The `hot-reload` plugin can't detect when this plugins `app.js` file has changed & reload it
> - The plugins settings must be manually edited in the `data.json` file
>
> I've added the "Reload app without saving" command on top of the command palette (`Ctrl+P`) to manually reloading the plugin for now
