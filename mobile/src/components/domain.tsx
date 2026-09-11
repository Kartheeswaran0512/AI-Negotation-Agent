/**
 * Components that know about negotiations.
 *
 * The primitives in ./primitives.tsx know about padding; these know about the
 * backend's vocabulary - states, verdicts, holds, groundedness. Keeping that
 * knowledge in components rather than screens is what stops the same state
 * being rendered two different ways on two different screens.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import type {
  AgentRun,
  Message,
  Negotiation,
  Recommendation,
  Requirement,
} from '@/api/types';
import { decisionTone, stateAppearance, toneColors } from '@/theme/states';
import { useTheme } from '@/theme';
import { displayMoney, formatMinor, percentAboveTarget } from '@/utils/money';
import {
  describeAction,
  describeDecision,
  describeRationale,
  describeReason,
  describeVerdict,
} from '@/utils/reasons';
import { AppText, Card, Chip, Divider, ProgressBar, Row, Stat } from './primitives';

/* -------------------------------------------------------------------------- */

export function StateChip({ state }: { state: Negotiation['state'] }) {
  const appearance = stateAppearance(state);
  return <Chip label={appearance.label} tone={appearance.tone} />;
}

/* -------------------------------------------------------------------------- */

/**
 * One supplier's row on the requirement board.
 *
 * Shows the two numbers that matter - where the supplier is, and how far that
 * is from the target - plus how much of the round budget has been spent.
 */
export function NegotiationCard({
  negotiation,
  requirement,
  sellerLabel,
  onPress,
}: {
  negotiation: Negotiation;
  requirement: Requirement | undefined;
  sellerLabel?: string;
  onPress: () => void;
}) {
  const { colors, spacing } = useTheme();
  const appearance = stateAppearance(negotiation.state);

  const targetMinor = requirement?.target_price.minor ?? 0;
  const supplierMinor = negotiation.supplier_price?.minor ?? null;
  const gap =
    supplierMinor !== null && targetMinor > 0 ? percentAboveTarget(supplierMinor, targetMinor) : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Supplier ${sellerLabel ?? negotiation.seller_id}, ${appearance.label}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <Card>
        <Row justify="space-between" align="flex-start">
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="heading">{sellerLabel ?? `Supplier #${negotiation.seller_id}`}</AppText>
            <AppText variant="caption" muted>
              Negotiation #{negotiation.id}
            </AppText>
          </View>
          <StateChip state={negotiation.state} />
        </Row>

        <Row gap={spacing.xl} wrap>
          <Stat
            label="Supplier price"
            value={displayMoney(negotiation.supplier_price, 'No quote yet')}
            tone={supplierMinor === null ? undefined : gap !== null && gap <= 0 ? 'success' : undefined}
          />
          {gap !== null ? (
            <Stat
              label="vs your target"
              value={gap > 0 ? `+${gap}%` : `${gap}%`}
              tone={gap > 0 ? 'warning' : 'success'}
            />
          ) : null}
        </Row>

        <View style={{ gap: spacing.xs }}>
          <Row justify="space-between">
            <AppText variant="caption" muted>
              Rounds used
            </AppText>
            <AppText variant="caption" muted>
              {negotiation.round} of {negotiation.max_rounds}
            </AppText>
          </Row>
          <ProgressBar
            value={negotiation.round}
            max={negotiation.max_rounds}
            tone={appearance.tone === 'neutral' ? 'info' : appearance.tone}
          />
        </View>

        {negotiation.outcome ? (
          <AppText variant="caption" color={colors.textMuted}>
            Outcome: {negotiation.outcome.replace(/_/g, ' ')}
          </AppText>
        ) : null}
      </Card>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A message in the thread.
 *
 * The `generated_by` badge is deliberately visible: whether a sentence came
 * from a deterministic template or from the model is exactly the kind of thing
 * a buyer should be able to see at a glance, and it is the clearest evidence
 * that the model writes words rather than choosing prices.
 */
export function MessageBubble({ message, currency }: { message: Message; currency: string }) {
  const { colors, radius, spacing } = useTheme();
  const isAgent = message.author === 'agent';
  const isBuyer = message.author === 'buyer';
  const mine = isAgent || isBuyer;

  const background = isAgent
    ? colors.bubbleAgent
    : isBuyer
      ? colors.bubbleBuyer
      : colors.bubbleSeller;
  const foreground = isAgent
    ? colors.bubbleAgentText
    : isBuyer
      ? colors.bubbleBuyerText
      : colors.bubbleSellerText;

  const who = isAgent ? 'Agent' : isBuyer ? 'You' : message.author === 'seller' ? 'Supplier' : 'System';

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: spacing.xs }}>
      <Row gap={spacing.xs}>
        <AppText variant="caption" muted>
          {who}
        </AppText>
        {message.generated_by ? (
          <AppText variant="caption" muted>
            · {message.generated_by === 'llm' ? 'model-worded' : 'template'}
          </AppText>
        ) : null}
      </Row>

      <View
        style={{
          backgroundColor: background,
          borderRadius: radius.lg,
          borderTopRightRadius: mine ? radius.sm : radius.lg,
          borderTopLeftRadius: mine ? radius.lg : radius.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          maxWidth: '88%',
          borderWidth: mine ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.border,
          gap: spacing.xs,
        }}
      >
        <AppText variant="body" color={foreground} selectable>
          {message.body}
        </AppText>
        {message.price ? (
          <AppText variant="label" color={foreground}>
            {message.price.display} per unit
          </AppText>
        ) : null}
      </View>

      <AppText variant="caption" muted>
        {formatTimestamp(message.created_at)}
        {currency && message.price ? ` · ${currency}` : ''}
      </AppText>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The recommendation card.
 *
 * Always shows the server's own note that this is advice, not a purchase - the
 * one sentence that describes this system's limit, and not something the UI
 * should paraphrase away.
 */
export function RecommendationCard({
  recommendation,
  onRefresh,
  refreshing = false,
}: {
  recommendation: Recommendation | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { colors, spacing } = useTheme();

  if (!recommendation) {
    return (
      <Card>
        <AppText variant="heading">No recommendation yet</AppText>
        <AppText variant="body" muted>
          A recommendation is produced when a negotiation finishes, or you can compute one now.
        </AppText>
        {onRefresh ? (
          <Pressable onPress={onRefresh} disabled={refreshing} accessibilityRole="button">
            <AppText variant="label" color={colors.primary}>
              {refreshing ? 'Computing…' : 'Compute recommendation'}
            </AppText>
          </Pressable>
        ) : null}
      </Card>
    );
  }

  const tone = decisionTone(recommendation.decision);
  const { foreground } = toneColors(tone, colors);

  return (
    <Card>
      <Row justify="space-between" align="flex-start">
        <View style={{ gap: 2, flex: 1 }}>
          <AppText variant="caption" muted>
            Recommendation
          </AppText>
          <AppText variant="title" color={foreground}>
            {describeDecision(recommendation.decision)}
          </AppText>
        </View>
        {recommendation.price ? (
          <Stat label="Best price" value={recommendation.price.display} tone={tone} />
        ) : null}
      </Row>

      <AppText variant="body">{recommendation.summary ?? describeRationale(recommendation.rationale)}</AppText>

      {recommendation.summary ? (
        <AppText variant="caption" muted>
          {describeRationale(recommendation.rationale)}
        </AppText>
      ) : null}

      <Divider />

      <AppText variant="caption" muted>
        {recommendation.note}
      </AppText>

      {onRefresh ? (
        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          style={{ paddingTop: spacing.xs }}
        >
          <AppText variant="label" color={colors.primary}>
            {refreshing ? 'Recomputing…' : 'Recompute'}
          </AppText>
        </Pressable>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One row of the audit trail.
 *
 * This is the screen that makes the agent legible, so it errs towards showing
 * more: the verdict it reached, whether the model's wording was accepted, and
 * - most importantly - anything the verification layer threw away.
 */
export function AgentRunRow({ run, currency }: { run: AgentRun; currency: string }) {
  const { colors, spacing } = useTheme();
  const detail = run.detail ?? {};
  const dropped = detail.droppedByVerification ?? [];

  const tone =
    run.action === 'escalate'
      ? 'accent'
      : run.action === 'end'
        ? 'warning'
        : run.action === 'hold'
          ? 'neutral'
          : 'info';

  return (
    <Card>
      <Row justify="space-between" align="flex-start">
        <Chip label={describeAction(run.action)} tone={tone} />
        <AppText variant="caption" muted>
          {formatTimestamp(run.created_at)}
        </AppText>
      </Row>

      <AppText variant="body">{describeReason(run.reason)}</AppText>

      <Row gap={spacing.md} wrap>
        <AppText variant="caption" muted>
          {run.state_before} → {run.state_after}
        </AppText>
        {run.counter_price ? (
          <AppText variant="caption" color={colors.primary}>
            Offered {run.counter_price.display}
          </AppText>
        ) : null}
      </Row>

      {detail.verdict ? (
        <AppText variant="caption" muted>
          Supplier position: {describeVerdict(detail.verdict)}
          {detail.sellerPriceMinor
            ? ` (${formatMinor(detail.sellerPriceMinor, currency)})`
            : ''}
        </AppText>
      ) : null}

      {detail.sellerAskedOurBudget ? (
        <AppText variant="caption" muted>
          The supplier asked what you will pay, so your target was disclosed.
        </AppText>
      ) : null}

      {dropped.length > 0 ? (
        <View
          style={{
            backgroundColor: colors.warningSurface,
            borderRadius: 8,
            padding: spacing.sm,
            marginTop: spacing.xs,
          }}
        >
          <AppText variant="caption" color={colors.warning}>
            Verification discarded {dropped.join(', ')} — the model reported a value that does not
            appear in the supplier&apos;s own message.
          </AppText>
        </View>
      ) : null}

      {detail.injection ? (
        <View
          style={{
            backgroundColor: colors.accentSurface,
            borderRadius: 8,
            padding: spacing.sm,
            marginTop: spacing.xs,
          }}
        >
          <AppText variant="caption" color={colors.accent}>
            The supplier message tried to instruct the agent. It was never interpreted, and nothing
            it claimed became a fact.
          </AppText>
        </View>
      ) : null}

      <Divider />

      <Row gap={spacing.md} wrap>
        <AppText variant="caption" muted>
          {run.llm_provider ?? 'no interpreter'}
          {run.llm_model ? ` · ${run.llm_model}` : ''}
        </AppText>
        {run.grounded !== null ? (
          <AppText
            variant="caption"
            color={run.grounded ? colors.success : colors.danger}
          >
            {run.grounded ? 'wording grounded' : 'wording rejected'}
          </AppText>
        ) : null}
        {run.fell_back ? (
          <AppText variant="caption" muted>
            fell back
          </AppText>
        ) : null}
        {run.latency_ms !== null ? (
          <AppText variant="caption" muted>
            {run.latency_ms}ms
          </AppText>
        ) : null}
      </Row>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/** A timestamp the user can read, degrading to the raw value if unparseable. */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
