// bot.ts reads the GitHub App's login from the repo variable and tells the Bot's pushes from a person's.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isBotActor } from '../workflow/bot.ts';

const BOT = 'taskly-test-agent[bot]';

describe('isBotActor', () => {
  it('matches the App bot and the legacy account', () => {
    assert.equal(isBotActor(BOT, BOT), true);
    assert.equal(isBotActor('github-actions[bot]', BOT), true);
  });

  it('does not match people, other bots or look-alikes', () => {
    for (const actor of ['alice', 'taskly-test-agent', 'dependabot[bot]', 'Taskly-Test-Agent[bot]', '', `${BOT} `]) assert.equal(isBotActor(actor, BOT), false, actor);
  });
});
