/**
 * The agent's reasoning, as recorded by the server.
 *
 * Every tick writes an agent_runs row, including the ones that did nothing, so
 * this list is complete rather than a highlight reel. That makes it long, so
 * there is a filter for hiding the quiet ticks - off by default, because the
 * holds are exactly what shows the agent declining to chase, declining to
 * re-answer, and declining to invent a price.
 */

import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';

import { useRequirement, useRuns } from '@/api/queries';
import { AgentRunRow } from '@/components/domain';
import type { RootStackParamList } from '@/navigation/types';
import { useTheme } from '@/theme';
import { isQuietAction } from '@/utils/reasons';
import {
  AppText,
  Banner,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Row,
  Stat,
} from '@/components/primitives';

type Route = RouteProp<RootStackParamList, 'AuditTrail'>;

export function AuditTrailScreen() {
  const { params } = useRoute<Route>();
  const { negotiationId, requirementId } = params;
  const { colors, spacing } = useTheme();

  const runs = useRuns(negotiationId);
  const requirement = useRequirement(requirementId ?? null);
  const [hideQuiet, setHideQuiet] = useState(false);

  const all = useMemo(() => [...(runs.data ?? [])].reverse(), [runs.data]);
  const visible = hideQuiet ? all.filter((run) => !isQuietAction(run.action)) : all;

  const stats = useMemo(() => {
    const source = runs.data ?? [];
    return {
      total: source.length,
      sent: source.filter((run) => run.action === 'open' || run.action === 'counter').length,
      fellBack: source.filter((run) => run.fell_back).length,
      rejected: source.filter((run) => run.grounded === false).length,
    };
  }, [runs.data]);

  if (runs.isLoading) return <LoadingState label="Loading the audit trail…" />;

  if (runs.isError) {
    return (
      <ErrorState
        title="Could not load the audit trail"
        message={runs.error.message}
        onRetry={() => void runs.refetch()}
      />
    );
  }

  const currency = requirement.data?.currency ?? 'INR';

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      data={visible}
      keyExtractor={(run) => String(run.id)}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      refreshControl={
        <RefreshControl
          refreshing={runs.isFetching && !runs.isLoading}
          onRefresh={() => void runs.refetch()}
          tintColor={colors.primary}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          <Card>
            <AppText variant="heading">Every decision, including the quiet ones</AppText>
            <AppText variant="caption" muted>
              The server records a row for each agent step even when it sends nothing, so this is
              the complete history rather than a summary.
            </AppText>

            <Row gap={spacing.lg} wrap style={{ marginTop: spacing.xs }}>
              <Stat label="Steps" value={String(stats.total)} />
              <Stat label="Messages sent" value={String(stats.sent)} tone="info" />
              <Stat
                label="Fell back"
                value={String(stats.fellBack)}
                tone={stats.fellBack > 0 ? 'warning' : undefined}
                hint="model unusable"
              />
              <Stat
                label="Wording rejected"
                value={String(stats.rejected)}
                tone={stats.rejected > 0 ? 'danger' : undefined}
                hint="stray number"
              />
            </Row>
          </Card>

          {stats.rejected > 0 ? (
            <Banner
              tone="warning"
              title="A generated message was discarded"
              message="The model produced wording containing a number it was not authorised to state, so the deterministic template was sent instead."
            />
          ) : null}

          <Row justify="space-between" align="center">
            <AppText variant="caption" muted>
              Newest first
            </AppText>
            <Pressable onPress={() => setHideQuiet((current) => !current)} accessibilityRole="button">
              <AppText variant="label" color={colors.primary}>
                {hideQuiet ? 'Show all steps' : 'Hide steps that sent nothing'}
              </AppText>
            </Pressable>
          </Row>
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          title={hideQuiet ? 'No steps sent a message' : 'No agent activity yet'}
          message={
            hideQuiet
              ? 'Every step so far considered the negotiation and correctly decided to say nothing.'
              : 'Run an agent step on the negotiation and its reasoning will appear here.'
          }
        />
      }
      renderItem={({ item }) => <AgentRunRow run={item} currency={currency} />}
    />
  );
}
