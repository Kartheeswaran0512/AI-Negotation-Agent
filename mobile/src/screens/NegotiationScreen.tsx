/**
 * The negotiation thread: the screen the product is really about.
 *
 * Three things it has to get right.
 *
 * A HOLD IS NOT AN ERROR. Most ticks send nothing - the supplier has not
 * replied, or has said nothing new, or the agent is in dry-run. The server
 * returns `action: 'hold'` with a reason, and this screen renders that reason
 * as a sentence. A UI that treats a hold as a failure would make a correct
 * agent look broken.
 *
 * POLLING, NOT PUSH. There is no realtime channel, so the thread polls while
 * the negotiation can still change and stops the moment it is terminal.
 *
 * THE SIMULATOR IS LABELLED. Posting a supplier reply is a developer affordance
 * standing in for email or a portal, so it is visually separated from the
 * agent's own controls rather than looking like a chat composer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  useMessages,
  useNegotiation,
  useRequirement,
  useSendSellerMessage,
  useTick,
} from '@/api/queries';
import { isTerminalState, type Message, type TickResult } from '@/api/types';
import { MessageBubble, StateChip } from '@/components/domain';
import type { RootStackParamList } from '@/navigation/types';
import { stateAppearance } from '@/theme/states';
import { useTheme } from '@/theme';
import { describeReason } from '@/utils/reasons';
import {
  AppText,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  LoadingState,
  ProgressBar,
  Row,
  Stat,
  TextField,
} from '@/components/primitives';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Negotiation'>;

export function NegotiationScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { negotiationId, requirementId } = params;
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  const negotiation = useNegotiation(negotiationId);
  const messages = useMessages(negotiationId);
  const requirement = useRequirement(requirementId ?? null);
  const tick = useTick(negotiationId, requirementId ?? null);
  const sendSeller = useSendSellerMessage(negotiationId, requirementId ?? null);

  const [lastTick, setLastTick] = useState<TickResult | null>(null);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replyPrice, setReplyPrice] = useState('');

  const listRef = useRef<FlatList<Message>>(null);
  const messageCount = messages.data?.length ?? 0;

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    if (messageCount === 0) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(timer);
  }, [messageCount]);

  // `mutate` with callbacks rather than `mutateAsync`: a rejected mutateAsync
  // inside a press handler becomes an unhandled promise rejection even though
  // the failure is already rendered from `tick.isError`. `mutate` never throws.
  const onTick = useCallback(() => {
    tick.mutate(undefined, { onSuccess: setLastTick });
  }, [tick]);

  const onSimulate = useCallback(() => {
    const body = replyBody.trim();
    if (!body) return;

    sendSeller.mutate(
      { body, ...(replyPrice.trim() ? { price: replyPrice.trim() } : {}) },
      {
        onSuccess: () => {
          setReplyBody('');
          setReplyPrice('');
          setSimulatorOpen(false);
        },
      },
    );
  }, [replyBody, replyPrice, sendSeller]);

  if (negotiation.isLoading) return <LoadingState label="Loading negotiation…" />;

  if (negotiation.isError || !negotiation.data) {
    return (
      <ErrorState
        title="Could not load this negotiation"
        message={negotiation.error?.message}
        onRetry={() => void negotiation.refetch()}
      />
    );
  }

  const data = negotiation.data;
  const appearance = stateAppearance(data.state);
  const terminal = isTerminalState(data.state);
  const currency = requirement.data?.currency ?? 'INR';
  const roundsLeft = Math.max(data.max_rounds - data.round, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        ref={listRef}
        data={messages.data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl }}
        onScrollToIndexFailed={() => undefined}
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, marginBottom: spacing.sm }}>
            {/* ---- Status header ---------------------------------------- */}
            <Card>
              <Row justify="space-between" align="flex-start">
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="heading">Supplier #{data.seller_id}</AppText>
                  <AppText variant="caption" muted>
                    Negotiation #{data.id}
                  </AppText>
                </View>
                <StateChip state={data.state} />
              </Row>

              <AppText variant="caption" muted>
                {appearance.hint}
              </AppText>

              <Divider />

              <Row gap={spacing.xl} wrap>
                <Stat
                  label="Supplier price"
                  value={data.supplier_price?.display ?? 'No quote yet'}
                />
                {requirement.data ? (
                  <Stat
                    label="Your target"
                    value={requirement.data.target_price.display}
                    tone="success"
                  />
                ) : null}
              </Row>

              <View style={{ gap: spacing.xs }}>
                <Row justify="space-between">
                  <AppText variant="caption" muted>
                    Rounds used
                  </AppText>
                  <AppText variant="caption" muted>
                    {data.round} of {data.max_rounds}
                    {!terminal ? ` · ${roundsLeft} left` : ''}
                  </AppText>
                </Row>
                <ProgressBar
                  value={data.round}
                  max={data.max_rounds}
                  tone={appearance.tone === 'neutral' ? 'info' : appearance.tone}
                />
              </View>

              <Pressable
                onPress={() => navigation.navigate('AuditTrail', { negotiationId, requirementId })}
                accessibilityRole="button"
              >
                <AppText variant="label" color={colors.primary}>
                  Why did the agent do that? →
                </AppText>
              </Pressable>
            </Card>

            {/* ---- What the last tick did ------------------------------- */}
            {lastTick ? <TickOutcome result={lastTick} onDismiss={() => setLastTick(null)} /> : null}

            {tick.isError ? (
              <Banner tone="danger" title="The agent step failed" message={tick.error.message} />
            ) : null}

            {data.state === 'ESCALATED' ? (
              <Banner
                tone="accent"
                title="This negotiation needs you"
                message="The agent stopped because a supplier message tried to instruct it. Nothing that message claimed was treated as a fact. Read the thread below and decide what to do."
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          messages.isLoading ? (
            <LoadingState label="Loading the thread…" />
          ) : (
            <EmptyState
              title="Nothing said yet"
              message="Run an agent step and it will open the enquiry with this supplier."
            />
          )
        }
        renderItem={({ item }) => <MessageBubble message={item} currency={currency} />}
      />

      {/* ---- Controls ------------------------------------------------------ */}
      {/*
        Padded by the safe-area inset: the app draws edge to edge, so without
        it the Android navigation bar covers these controls.
      */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
          padding: spacing.lg,
          paddingBottom: spacing.lg + insets.bottom,
          gap: spacing.md,
        }}
      >
        {simulatorOpen ? (
          <View style={{ gap: spacing.md }}>
            <Row justify="space-between" align="center">
              <AppText variant="label">Simulate a supplier reply</AppText>
              <Pressable onPress={() => setSimulatorOpen(false)} accessibilityRole="button">
                <AppText variant="label" color={colors.primary}>
                  Close
                </AppText>
              </Pressable>
            </Row>

            <AppText variant="caption" muted>
              Stands in for email or a supplier portal. Write prose — the server will read the price
              out of it and verify the figure actually appears in the text.
            </AppText>

            <TextField
              testID="simulator-body"
              label="Their message"
              value={replyBody}
              onChangeText={setReplyBody}
              placeholder="Our price is Rs 850 per unit."
              multiline
              autoCapitalize="sentences"
            />

            <TextField
              testID="simulator-price"
              label="Structured price (optional)"
              value={replyPrice}
              onChangeText={setReplyPrice}
              keyboardType="decimal-pad"
              placeholder="850"
              hint="Bypasses interpretation. Leave blank to exercise the reader and its fences."
            />

            {sendSeller.isError ? (
              <Banner
                tone="danger"
                title="Could not post that reply"
                message={sendSeller.error.message}
              />
            ) : null}

            <Button
              label="Post reply"
              fullWidth
              onPress={onSimulate}
              loading={sendSeller.isPending}
              disabled={replyBody.trim().length === 0}
            />
          </View>
        ) : (
          <Row gap={spacing.sm}>
            <View style={{ flex: 2 }}>
              <Button
                label={terminal ? 'Negotiation finished' : 'Run agent step'}
                fullWidth
                onPress={onTick}
                loading={tick.isPending}
                disabled={terminal}
                accessibilityHint="Asks the agent to consider this negotiation and act if it should."
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Reply as supplier"
                variant="secondary"
                fullWidth
                onPress={() => setSimulatorOpen(true)}
                disabled={terminal}
              />
            </View>
          </Row>
        )}

        {terminal ? (
          <AppText variant="caption" muted align="center">
            {appearance.hint}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/**
 * What the tick actually did, in one card.
 *
 * Split out because the five action kinds want visibly different treatment: a
 * counter is progress, a hold is a considered pause, an escalation is a stop.
 */
function TickOutcome({ result, onDismiss }: { result: TickResult; onDismiss: () => void }) {
  const { colors, spacing } = useTheme();

  const tone =
    result.action === 'escalate'
      ? 'accent'
      : result.action === 'end'
        ? 'warning'
        : result.action === 'hold'
          ? 'neutral'
          : 'success';

  const title =
    result.action === 'hold'
      ? 'The agent decided not to send anything'
      : result.action === 'open'
        ? 'Opening enquiry sent'
        : result.action === 'counter'
          ? 'Counter-offer sent'
          : result.action === 'end'
            ? 'Negotiation closed'
            : 'Handed to you';

  return (
    <Card>
      <Row justify="space-between" align="flex-start">
        <AppText variant="heading">{title}</AppText>
        <Pressable onPress={onDismiss} accessibilityRole="button" hitSlop={8}>
          <AppText variant="label" color={colors.textMuted}>
            Dismiss
          </AppText>
        </Pressable>
      </Row>

      <AppText variant="body" muted>
        {describeReason(result.reason)}
      </AppText>

      {result.message?.price ? (
        <Row gap={spacing.md} wrap>
          <Stat label="Offered" value={result.message.price.display} tone="info" />
          {result.generated_by ? (
            <Stat
              label="Wording"
              value={result.generated_by === 'llm' ? 'Model' : 'Template'}
              hint={
                result.generated_by === 'llm'
                  ? 'checked against an allow-list'
                  : 'deterministic, grounded by construction'
              }
            />
          ) : null}
        </Row>
      ) : null}

      {result.recommendation ? (
        <Banner
          tone={tone === 'neutral' ? 'info' : tone}
          title={`Recommendation: ${result.recommendation.decision}`}
          message={result.recommendation.summary ?? undefined}
        />
      ) : null}
    </Card>
  );
}
