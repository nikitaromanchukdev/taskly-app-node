// The GitHub App that writes for the PR workflow (ADR 0004, ADR 0005): its bot login, from the repo variable TEST_AGENT_BOT_LOGIN.
// The login is "<app-slug>[bot]". Scripts use it to tell the Bot's own pushes from a person's and to find the Bot's own comments.
import { die } from '../lib/cli.ts';

export const BOT_LOGIN_VARIABLE = 'TEST_AGENT_BOT_LOGIN';
// The account the Bot commit came from before the App. Its pushes still start nothing.
export const LEGACY_BOT_LOGIN = 'github-actions[bot]';
const BOT_LOGIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\[bot\]$/;

// The login in env.BOT_LOGIN (set from the repo variable), or a stop with the fix.
export function botLoginFrom(env: Record<string, string | undefined>, script: string): string {
  const login = env.BOT_LOGIN?.trim() ?? '';
  if (!login) return die(script, `${BOT_LOGIN_VARIABLE} is not set. Run scripts/setup-github.sh config to register the GitHub App (ADR 0005).`);
  if (!BOT_LOGIN_PATTERN.test(login)) return die(script, `${BOT_LOGIN_VARIABLE} must look like "<app-slug>[bot]", got ${JSON.stringify(login)}`);
  return login;
}

// Pushes by the Bot start no run: the App's login, or the legacy account.
export function isBotActor(actor: string, botLogin: string): boolean {
  return actor === botLogin || actor === LEGACY_BOT_LOGIN;
}
