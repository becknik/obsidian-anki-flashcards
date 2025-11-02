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

## Features

- 🗃️ Simple flashcards with **#card**
- 🎴 Reversed flashcards with **#card-reverse** or **#card/reverse**
- ✍️ Inline style with **Question::Answer**
- ✍️ Inline style reversed with **Question:::Answer**
- 🧠 **Heading Context Inclusion**
- 🏷️ Global and local **tags**
- 🔢 Support for all common Markdown elements
- ⚙️ Application of some settings per-note
- 🛣️ Deck path modification in Obsidian comments on a heading level
  - 🔗 Inspired by UNIX paths: `/` = `::`, `<<` = `../`, `::` at start extends the current deck's path (= `./`)
- 📁 Context menu entries to process all contents of a directory
- 🔄 Diff generation

Have a look at the plugin settings or [wiki](https://github.com/becknik/flashcards-obsidian/wiki) for further information.

## How it works?

The following is a demo where the three main operations are shown:

1. **Insertion** of cards;
2. **Update** of cards;
3. **Deletion** of cards.

![Demo image](docs/demo.gif)

## How to install

> [!important]
> I had to patch AnkiConnect for the addition of media files. Currently the AnkiConnect maintainer won't respond to my inquiry to merge it...
<details>
<summary>AnkiConnect Media Patch</summary>

```patch
From 19add4ef3f372373e62a2fc1f18ac11cbce56926 Mon Sep 17 00:00:00 2001
From: becknik <becknik@pm.me>
Date: Mon, 27 Oct 2025 00:09:40 +0100
Subject: [PATCH] Enable adding media to a note without necessarily appending
 it to fields

More control over the placement of the media might be required when
adding or updating a note with some media
---

 README.md          | 7 ++-----
 plugin/**init**.py | 4 ++--
 2 files changed, 4 insertions(+), 7 deletions(-)

diff --git a/README.md b/README.md
index 9ffe4b3..3203391 100644
--- a/README.md
+++ b/README.md
@@ -3542,12 +3542,12 @@ #### `addNote`
     Anki-Connect can download audio, video, and picture files and embed them in newly created notes. The corresponding `audio`, `video`, and `picture` note members are
     optional and can be omitted. If you choose to include any of them, they should contain a single object or an array of objects
     with the mandatory `filename` field and one of `data`, `path` or `url`. Refer to the documentation of `storeMediaFile` for an explanation of these fields.
     The `skipHash` field can be optionally provided to skip the inclusion of files with an MD5 hash that matches the provided value.
     This is useful for avoiding the saving of error pages and stub files.

- The `fields` member is a list of fields that should play audio or video, or show a picture when the card is displayed in
- Anki. The `allowDuplicate` member inside `options` group can be set to true to enable adding duplicate cards.
- The `fields` member is a list of field names to which the inserted media should be appended to. It can be omitted if this isn't required.
- The `allowDuplicate` member inside `options` group can be set to true to enable adding duplicate cards.
     Normally duplicate cards can not be added and trigger exception.

     The `duplicateScope` member inside `options` can be used to specify the scope for which duplicates are checked.
     A value of `"deck"` will only check for duplicates in the target deck; any other value will check the entire collection.

@@ -3602,13 +3602,10 @@ #### `addNote`
                 }],
                 "picture": [{
                     "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/A_black_cat_named_Tilly.jpg/220px-A_black_cat_named_Tilly.jpg",
                     "filename": "black_cat.jpg",
                     "skipHash": "8d6e4646dfae812bf39651b59d7429ce",

-                    "fields": [
-                        "Back"
-                    ]
                 }]
             }
         }
     }

     ```

diff --git a/plugin/**init**.py b/plugin/**init**.py
index 0487be..6f210d1 100755
--- a/plugin/**init**.py
+++ b/plugin/**init**.py
@@ -774,20 +774,20 @@ def addMedia(self, ankiNote, mediaObjectOrList, mediaType):
             mediaList = mediaObjectOrList
         else:
             mediaList = [mediaObjectOrList]

         for media in mediaList:

-            if media is not None and len(media['fields']) > 0:
-            if media is not None:
                 try:
                     mediaFilename = self.storeMediaFile(media['filename'],
                                                         data=media.get('data'),
                                                         path=media.get('path'),
                                                         url=media.get('url'),
                                                         skipHash=media.get('skipHash'),
                                                         deleteExisting=media.get('deleteExisting'))

-                    if mediaFilename is not None:
-                    if mediaFilename is not None and hasattr(media, 'fields'):
                         for field in media['fields']:
                             if field in ankiNote:
                                 if mediaType is util.MediaType.Picture:
                                     ankiNote[field] += u'<img src="{}">'.format(mediaFilename)
                                 elif mediaType is util.MediaType.Audio or mediaType is util.MediaType.Video:

--
2.50.1

```
</details>

1. [Install](obsidian://show-plugin?id=flashcards-obsidian) this plugin on Obsidian:

   - Open Settings > Community plugins
   - Make sure Safe mode is off
   - Click Browse community plugins
   - Search for "**Flashcards V2**"
   - Click Install
   - Once installed, close the community plugins window and activate the newly installed plugin

2. Install [AnkiConnect](https://ankiweb.net/shared/info/2055492159) on Anki
   - Tools > Add-ons -> Get Add-ons...
   - Paste the code **2055492159** > Ok

3. Open the settings of this plugin and - while Anki is opened - press "**Grant Permission**"

## Contributing

Contributions via bug reports, bug fixes, are welcome. If you have ideas about features to be implemented, please open an issue so we can discuss the best way to implement it. For more details check [Contributing.md](docs/CONTRIBUTING.md)

## References

- [Obsidian Markdown Syntax](https://help.obsidian.md/syntax)
- [Anki Connect API Reference](https://git.sr.ht/~foosoft/anki-connect)
- [Obsidian Plugin API](https://docs.obsidian.md/Home)
