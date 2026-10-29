// sanitize.ts turns untrusted agent text and PR file paths into markdown that is safe to post.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cell, code, sanitize } from '../sanitize.ts';

const REPO = 'owner/repo';
const ZWSP = '​';
const clean = (text: string) => sanitize(text, REPO);

describe('sanitize', () => {
  it('removes HTML tags and comments', () => {
    assert.equal(clean('a <img src=x onerror=alert(1)> b <!-- hidden --> c <details>d</details>'), 'a  b  c d');
  });

  it('escapes a stray < so no tag can form', () => {
    assert.equal(clean('1 < 2'), '1 &lt; 2');
  });

  it('removes HTML entities, which could spell a tag', () => {
    assert.equal(clean('&lt;script&gt; &#60;'), 'script ');
  });

  it('breaks @mentions so nobody is pinged', () => {
    assert.equal(clean('cc @octocat'), `cc @${ZWSP}octocat`);
  });

  it('leaves an email address alone', () => {
    assert.equal(clean('dev@example.com'), 'dev@example.com');
  });

  it('breaks #refs so no issue or PR is linked', () => {
    assert.equal(clean('fixes #12'), `fixes #${ZWSP}12`);
  });

  it('removes images, wherever they point', () => {
    assert.equal(clean(`a ![x](https://github.com/${REPO}/x.png) b`), 'a  b');
  });

  it('keeps a link into the repo', () => {
    const link = `[ADR](https://github.com/${REPO}/blob/main/docs/adr.md)`;
    assert.equal(clean(link), link);
  });

  it('keeps only the label of a link outside the repo', () => {
    assert.equal(clean('see [docs](https://evil.example/x)'), 'see docs');
  });

  it('keeps only the label of a link to a repo whose name starts the same', () => {
    assert.equal(clean(`[x](https://github.com/${REPO}-fork/y)`), 'x');
  });

  it('replaces a bare URL outside the repo', () => {
    assert.equal(clean('go to https://evil.example/x now'), 'go to [link removed] now');
  });

  it('removes reference-style link definitions and keeps the label of their uses', () => {
    assert.equal(clean('see [docs][1]\n[1]: https://evil.example').trim(), 'see docs');
  });

  it('keeps HTML inside a code span literal', () => {
    assert.equal(clean('use `<b>` here'), 'use `<b>` here');
  });

  it('does not let escaped backticks hide HTML from the tag filter', () => {
    assert.doesNotMatch(clean('\\`<img src=x>\\`'), /<img/);
  });

  it('truncates long text before it is filtered, and says so', () => {
    const result = clean('a'.repeat(3001));
    assert.equal(result, 'a'.repeat(3000) + '\n\n(truncated)');
  });

  it('cannot leave a code span open across the cut, so HTML after it is still filtered', () => {
    const result = sanitize('`' + 'a'.repeat(20) + '` <img src=x>', REPO, 10);
    assert.doesNotMatch(result, /<img/);
  });
});

describe('cell', () => {
  it('keeps the text on one line and escapes the table pipe', () => {
    assert.equal(cell('a | b\n\nc', REPO), 'a \\| b c');
  });

  it('caps the text at 300 characters', () => {
    assert.ok(cell('a'.repeat(400), REPO).startsWith('a'.repeat(300) + ' (truncated)'));
  });
});

describe('code', () => {
  it('wraps a path as inline code, so HTML in it stays literal', () => {
    assert.equal(code('src/<b>.ts', REPO), '`src/<b>.ts`');
  });

  it('turns a backtick in the text into a quote, so it cannot close the code span early', () => {
    assert.equal(code('a`<img>`b', REPO), "`a'<img>'b`");
  });
});
