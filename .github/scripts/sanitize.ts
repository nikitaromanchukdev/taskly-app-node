// Untrusted text → markdown that is safe to post. Agent summaries can be steered by the PR body,
// and file paths come from the PR, so neither may add HTML, pings, external links or images.

const MAX_SUMMARY = 3000;
const MAX_CELL = 300;
const ZWSP = '\u200b'; // zero-width space: breaks @mentions and #refs without visible change
// A code span: a run of backticks, its text, and a run of the same length (CommonMark). GitHub shows
// code literally, so HTML in it is inert and an escaped `<` would show as `&lt;`.
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;

export const truncate = (text: string, max: number) => (text.length > max ? text.slice(0, max) + '\n\n(truncated)' : text);

// Removes HTML from the text outside code spans.
const stripHtml = (text: string) =>
  text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[a-zA-Z!][^>]*>/g, '')
    .replace(/&#?\w+;/g, '')
    .replace(/</g, '&lt;');

function outsideCode(text: string, edit: (part: string) => string): string {
  let out = '';
  let last = 0;
  for (const span of text.matchAll(CODE_SPAN)) {
    out += edit(text.slice(last, span.index)) + span[0];
    last = span.index + span[0].length;
  }
  return out + edit(text.slice(last));
}

export function sanitize(text: string, repo: string, max = MAX_SUMMARY): string {
  const own = `https://github.com/${repo}/`;
  // Truncated first, so a cut cannot leave a code span open and its HTML outside it.
  // An escaped backtick opens no code span, so it must not hide HTML from stripHtml.
  return outsideCode(truncate(text, max).replace(/\\`/g, "'"), stripHtml)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^\s*\[[^\]]+\]:\s*\S.*$/gm, '')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/\[([^\]]*)\]\(\s*([^)\s]*)[^)]*\)/g, (_all, label, url) => (url.startsWith(own) ? `[${label}](${url})` : label))
    .replace(/https?:\/\/[^\s)>\]]+/g, (url) => (url.startsWith(own) ? url : '[link removed]'))
    .replace(/(^|[^\w`/])@(?=\w)/g, `$1@${ZWSP}`)
    .replace(/#(?=\d)/g, `#${ZWSP}`);
}

// One line of text that can sit in a table cell or list item.
export const cell = (text: string, repo: string) =>
  sanitize(text, repo, MAX_CELL).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

// Inline code, wrapped before sanitizing so its text stays literal. A backtick in the text would end it early.
export const code = (text: string, repo: string) => cell(`\`${text.replace(/`/g, "'")}\``, repo);
