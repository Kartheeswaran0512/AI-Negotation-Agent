import { maySend, idempotencyKey, REFUSAL, OPENING_SUFFIX } from '../../src/domain/guard.js';
import { STATE } from '../../src/domain/machine.js';

const allowed = {
  status: STATE.EVALUATING,
  round: 2,
  maxRounds: 6,
  inReplyToMessageId: 11,
  answeredMessageId: 9,
  enabled: true,
  dryRun: false,
  sentToday: 0,
  dailyLimit: 100,
};

describe('send guard', () => {
  test('allows a fresh reply to a new supplier message', () => {
    expect(maySend(allowed)).toEqual({ allowed: true, reason: null });
  });

  test('refuses when the agent is switched off', () => {
    expect(maySend({ ...allowed, enabled: false }).reason).toBe(REFUSAL.AGENT_DISABLED);
  });

  test('refuses in every terminal state', () => {
    for (const status of [STATE.TARGET_MET, STATE.ROUNDS_SPENT, STATE.DECLINED, STATE.ESCALATED]) {
      expect(maySend({ ...allowed, status }).reason).toBe(REFUSAL.TERMINAL);
    }
  });

  test('refuses once the rounds are spent, at the boundary', () => {
    expect(maySend({ ...allowed, round: 5, maxRounds: 6 }).allowed).toBe(true);
    expect(maySend({ ...allowed, round: 6, maxRounds: 6 }).reason).toBe(REFUSAL.ROUNDS_SPENT);
    expect(maySend({ ...allowed, round: 7, maxRounds: 6 }).reason).toBe(REFUSAL.ROUNDS_SPENT);
  });

  test('REFUSES ANSWERING THE SAME SUPPLIER MESSAGE TWICE', () => {
    expect(maySend({ ...allowed, inReplyToMessageId: 11, answeredMessageId: 11 }).reason).toBe(
      REFUSAL.ALREADY_ANSWERED,
    );
    // Identity, not type: a string id and a numeric id are the same message.
    expect(maySend({ ...allowed, inReplyToMessageId: '11', answeredMessageId: 11 }).reason).toBe(
      REFUSAL.ALREADY_ANSWERED,
    );
  });

  test('the opener answers nothing, so the already-answered rule cannot fire on it', () => {
    expect(
      maySend({ ...allowed, status: STATE.DRAFT, round: 0, inReplyToMessageId: null, answeredMessageId: null })
        .allowed,
    ).toBe(true);
  });

  test('refuses at the daily send limit', () => {
    expect(maySend({ ...allowed, sentToday: 100, dailyLimit: 100 }).reason).toBe(REFUSAL.SEND_LIMIT);
  });

  test('dry run refuses last, so the real reason is never masked', () => {
    expect(maySend({ ...allowed, dryRun: true }).reason).toBe(REFUSAL.DRY_RUN);
    // A terminal negotiation in dry run reports terminal, not dry_run.
    expect(maySend({ ...allowed, dryRun: true, status: STATE.DECLINED }).reason).toBe(REFUSAL.TERMINAL);
  });

  test('the idempotency key identifies one reply to one message', () => {
    expect(idempotencyKey({ negotiationId: 7, inReplyToMessageId: 11 })).toBe('neg:7:reply:11');
    expect(idempotencyKey({ negotiationId: 7, inReplyToMessageId: null })).toBe(
      `neg:7:reply:${OPENING_SUFFIX}`,
    );
    expect(idempotencyKey({ negotiationId: 7 })).toBe(`neg:7:reply:${OPENING_SUFFIX}`);

    // Different messages, different keys. Same message, same key.
    expect(idempotencyKey({ negotiationId: 7, inReplyToMessageId: 11 })).not.toBe(
      idempotencyKey({ negotiationId: 7, inReplyToMessageId: 12 }),
    );
    expect(idempotencyKey({ negotiationId: 7, inReplyToMessageId: 11 })).toBe(
      idempotencyKey({ negotiationId: 7, inReplyToMessageId: '11' }),
    );
  });
});
