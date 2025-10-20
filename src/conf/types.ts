/**
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec#return_value
 * Returned returned by `matchAll` method
 **/
type RegExpMatchAllReturn = ReturnType<RegExp['exec']>;

export type RegExpGeneratedCards = (RegExpMatchAllReturn & {
  groups: {
    headingLevel?: string;
    heading: string;
    tags: string;
    content: string;
    id?: string;
  };
} )[];
