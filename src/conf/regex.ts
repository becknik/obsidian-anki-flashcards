import { Settings } from 'src/types/settings';

export class Regex {
  wikiImageLinks: RegExp;
  markdownImageLinks: RegExp;
  wikiAudioLinks: RegExp;
  obsidianCodeBlock: RegExp; // ```code block``
  codeBlock: RegExp;
  mathBlock: RegExp; // $$ latex $$
  mathInline: RegExp; // $ latex $
  cardsDeckLine: RegExp;
  globalTagsSplitter: RegExp;
  tagHierarchy: RegExp;

  singleClozeCurly: RegExp;
  singleClozeHighlight: RegExp;
  clozeHighlight: RegExp;

  embedBlock: RegExp;

  constructor(settings: Settings) {
    this.update(settings);
  }

  public update(settings: Settings) {

    // Supported images https://publish.obsidian.md/help/How+to/Embed+files
    this.wikiImageLinks = /!\[\[(.*\.(?:png|jpg|jpeg|gif|bmp|svg|tiff)).*?\]\]/gim;
    this.markdownImageLinks = /!\[\]\((.*\.(?:png|jpg|jpeg|gif|bmp|svg|tiff)).*?\)/gim;

    this.wikiAudioLinks = /!\[\[(.*\.(?:mp3|webm|wav|m4a|ogg|3gp|flac)).*?\]\]/gim;

    // https://regex101.com/r/eqnJeW/1
    this.obsidianCodeBlock = /(?:```(?:.*?\n?)+?```)(?:\n|$)/gim;

    this.codeBlock = /<code\b[^>]*>(.*?)<\/code>/gims;

    this.mathBlock = /(\$\$)(.*?)(\$\$)/gis;
    this.mathInline = /(\$)(.*?)(\$)/gi;

    this.cardsDeckLine = /cards-deck: [\p{L}]+/giu;

    // https://regex101.com/r/WxuFI2/1
    this.globalTagsSplitter = /\[\[(.*?)\]\]|#([\p{L}\d:\-_/]+)|([\p{L}\d:\-_/]+)/gimu;
    this.tagHierarchy = /\//gm;

    this.singleClozeCurly = /((?:{)(?:(\d):?)?(.+?)(?:}))/g;
    this.singleClozeHighlight = /((?:==)(.+?)(?:==))/g;

    // Matches any embedded block but the one with an used extension from the wikilinks
    this.embedBlock =
      /!\[\[(.*?)(?<!\.(?:png|jpg|jpeg|gif|bmp|svg|tiff|mp3|webm|wav|m4a|ogg|3gp|flac))\]\]/g;
  }
}
