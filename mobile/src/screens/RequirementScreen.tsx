/**
 * The requirement board: every supplier on one requirement, side by side.
 *
 * This is where the buyer's two figures live, and the screen is explicit about
 * their different natures - the target is a goal, the maximum is a private
 * boundary that never reaches a supplier. Showing the ceiling here is safe and
 * useful; the server has no code path that would put it in an outbound message.
 */

import { RefreshControl, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  useNegotiations,
  useRecommendation,
  useRefreshRecommendation,
  useRequirement,
} from '@/api/queries';
import { isTerminalState } from '@/api/types';
import { NegotiationCard, RecommendationCard } from '@/components/domain';
import type { RootStackParamList } from '@/navigation/types';
import { useTheme } from '@/theme';
import {
  AppText,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  LoadingState,
  Row,
  ScreenScroll,
  Stat,
} from '@/components/primitives';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Requirement'>;

export function RequirementScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { requirementId } = params;
  const { colors, spacing } = useTheme();

  const requirement = useRequirement(requirementId);
  const negotiations = useNegotiations(requirementId);
  const recommendation = useRecommendation(requirementId);
  const refresh = useRefreshRecommendation(requirementId);

  if (requirement.isLoading) return <LoadingState label="Loading requirement…" />;

  if (requirement.isError || !requirement.data) {
    return (
      <ErrorState
        title="Could not load this requirement"
        message={requirement.error?.message}
        onRetry={() => void requirement.refetch()}
      />
    );
  }

  const data = requirement.data;
  const rows = negotiations.data ?? [];
  const live = rows.filter((row) => !isTerminalState(row.state));
  const acceptable =
    recommendation.data?.decision === 'accept' && recommendation.data.negotiation_id !== null;

  return (
    <ScreenScroll
      refreshControl={
        <RefreshControl
          refreshing={negotiations.isFetching && !negotiations.isLoading}
          onRefresh={() => {
            void requirement.refetch();
            void negotiations.refetch();
            void recommendation.refetch();
          }}
          tintColor={colors.primary}
        />
      }
    >
      {/* ---- The buyer's own numbers ------------------------------------- */}
      <Card>
        <AppText variant="title">{data.product}</AppText>
        <AppText variant="caption" muted>
          {data.quantity > 0 ? `${data.quantity} ${data.unit ?? 'units'}` : 'Quantity not stated'}
          {' · '}
          {data.price_basis === 'per_unit' ? 'priced per unit' : 'priced for the whole order'}
          {' · '}
          {data.status}
        </AppText>

        <Divider />

        <Row gap={spacing.xl} wrap>
          <Stat label="Your target" value={data.target_price.display} tone="success" />
          <Stat
            label="Your maximum"
            value={data.max_price.display}
            tone="warning"
            hint="Never shown to suppliers"
          />
        </Row>

        <AppText variant="caption" muted>
          The agent will never name a figure above the midpoint of this band, so your ceiling is
          never revealed as a price a supplier could simply accept.
        </AppText>
      </Card>

      {/* ---- What to do -------------------------------------------------- */}
      <RecommendationCard
        recommendation={recommendation.data ?? null}
        refreshing={refresh.isPending}
        onRefresh={() => refresh.mutate()}
      />

      {refresh.isError ? (
        <Banner
          tone="danger"
          title="Could not compute a recommendation"
          message={refresh.error.message}
        />
      ) : null}

      {acceptable && recommendation.data?.negotiation_id ? (
        <Button
          label={`Accept at ${recommendation.data.price?.display ?? 'the quoted price'}`}
          variant="success"
          fullWidth
          onPress={() =>
            navigation.navigate('Accept', {
              negotiationId: String(recommendation.data?.negotiation_id),
              requirementId,
            })
          }
          accessibilityHint="Opens a confirmation screen. Only you can accept an offer."
        />
      ) : null}

      {/* ---- The suppliers ----------------------------------------------- */}
      <View style={{ gap: spacing.md }}>
        <Row justify="space-between" align="center">
          <AppText variant="heading">
            Suppliers{rows.length > 0 ? ` (${rows.length})` : ''}
          </AppText>
          {live.length > 0 ? (
            <AppText variant="caption" muted>
              {live.length} still running
            </AppText>
          ) : null}
        </Row>

        {negotiations.isLoading ? (
          <LoadingState label="Loading suppliers…" />
        ) : negotiations.isError ? (
          <ErrorState
            title="Could not load suppliers"
            message={negotiations.error.message}
            onRetry={() => void negotiations.refetch()}
          />
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              title="No suppliers yet"
              message="Add a supplier and the agent will open an enquiry with them."
              action={{
                label: 'Add supplier',
                onPress: () => navigation.navigate('AddSupplier', { requirementId }),
              }}
            />
          </Card>
        ) : (
          rows.map((negotiation) => (
            <NegotiationCard
              key={String(negotiation.id)}
              negotiation={negotiation}
              requirement={data}
              onPress={() =>
                navigation.navigate('Negotiation', {
                  negotiationId: String(negotiation.id),
                  requirementId,
                })
              }
            />
          ))
        )}
      </View>

      {rows.length > 0 ? (
        <Button
          label="Add another supplier"
          variant="secondary"
          fullWidth
          onPress={() => navigation.navigate('AddSupplier', { requirementId })}
        />
      ) : null}
    </ScreenScroll>
  );
}
