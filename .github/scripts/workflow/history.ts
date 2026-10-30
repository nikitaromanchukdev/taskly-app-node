// Run history of the Report comment. The comment is updated in place, so the earlier results would be lost.
// Each run keeps its own line in a machine-readable marker at the end of the comment, and the next run reads it back.
// The old comment body is text that anyone with comment-edit rights could have changed, so every field is validated.
import { STATUS_EMOJI } from './render.ts';
import { sanitize } from './sanitize.ts';
import type { StatusState } from './status.ts';

export type HistoryEntry = { sha: string; state: StatusState; text: string; run: string; at: string };

// The marker holds the current run first, then the earlier runs, newest first. The comment shows the earlier ones.
export const MAX_SHOWN = 10;
const MAX_STORED = MAX_SHOWN + 1;
const MAX_TEXT = 150;
const MAX_MARKER_JSON = 20000;
const STATES: ReadonlySet<string> = new Set<StatusState>(['success', 'failure']);
const SHA = /^[0-9a-f]{7,40}$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
// Only the last line counts, so text earlier in the comment cannot pose as the marker.
const MARKER = /\n<!-- pr-test-engineer:history (\[[^\n]*\]) -->\s*$/;

// One line of status text. Running it again changes nothing, so a text read back stays as it was written.
const cleanText = (text: string, repo: string) => sanitize(text, repo, MAX_TEXT).replace(/\s*\n\s*/g, ' ');

const runPattern = (repo: string) => {
  const escaped = `https://github.com/${repo}/actions/runs/`.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`^${escaped}\\d+(/attempts/\\d+)?$`);
};

// One entry from untrusted JSON, or undefined when any field is not exactly what a run writes.
function validEntry(raw: unknown, repo: string): HistoryEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { sha, state, text, run, at } = raw as Record<string, unknown>;
  if (typeof sha !== 'string' || !SHA.test(sha)) return undefined;
  if (typeof state !== 'string' || !STATES.has(state)) return undefined;
  if (typeof text !== 'string' || typeof run !== 'string' || !runPattern(repo).test(run)) return undefined;
  if (typeof at !== 'string' || !AT.test(at)) return undefined;
  return { sha, state: state as StatusState, text: cleanText(text, repo), run, at };
}

// The entries a comment body holds, current run first. Anything unreadable gives no entries; a bad entry is dropped.
export function parseHistory(body: string | undefined, repo: string): HistoryEntry[] {
  const json = body?.match(MARKER)?.[1];
  if (!json || json.length > MAX_MARKER_JSON) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_STORED)
    .map((item) => validEntry(item, repo))
    .filter((entry): entry is HistoryEntry => entry !== undefined);
}

// The new list: this run first, then the earlier ones. A re-run of the same commit with the same status
// replaces the previous line instead of adding a duplicate.
export function mergeHistory(previous: readonly HistoryEntry[], current: HistoryEntry): HistoryEntry[] {
  const [last, ...older] = previous;
  const kept = last && last.sha === current.sha && last.state === current.state ? older : previous;
  return [current, ...kept].slice(0, MAX_STORED);
}

export function entryOf(context: { analyzed_sha: string; run_url: string }, status: { state: StatusState; description: string }, now: Date, repo: string): HistoryEntry {
  return { sha: context.analyzed_sha, state: status.state, text: cleanText(status.description, repo), run: context.run_url, at: now.toISOString() };
}

const line = (entry: HistoryEntry, repo: string) =>
  `- [\`${entry.sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${entry.sha}) · ${STATUS_EMOJI[entry.state]} ${entry.state}: ${entry.text} · [run](${entry.run}) · ${entry.at.slice(0, 16).replace('T', ' ')} UTC`;

// The end of the Report comment: the earlier runs, collapsed, and the marker. The JSON escapes `<` and `>` so it cannot close the HTML comment.
export function renderHistory(entries: readonly HistoryEntry[], repo: string): string {
  const earlier = entries.slice(1, MAX_SHOWN + 1);
  const json = JSON.stringify(entries).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const section = earlier.length
    ? ['', '<details><summary>Previous runs</summary>', '', ...earlier.map((entry) => line(entry, repo)), '', '</details>']
    : [];
  return [...section, `<!-- pr-test-engineer:history ${json} -->`].join('\n');
}
