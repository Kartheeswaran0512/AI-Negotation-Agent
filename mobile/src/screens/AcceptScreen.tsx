/**
 * Acceptance: the one irreversible action in the product.
 *
 * The agent has no path to this screen - no action kind, no tool, no decision
 * branch - and the server checks the caller's x-user-id against the
 * requirement's owner. The UI treats it accordingly: a deliberate confirmation
 * step, the total computed in integer minor units rather than parsed back out
 * of a rendered string, and an explicit statement that this is the buyer's
 * decision and not the agent's.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAcceptNegotiation, useNegotiation, useRequirement } from '@/api/queries';
import { useSettings } from '@/config/settings';
import type { RootStackParamList } from '@/navigation/types';
import { useTheme } from '@/theme';
import { formatMinor, multiplyMinor, percentAboveTarget } from '@/utils/money';
import {
  AppText,
  Banner,
  Button,
  Card,
  Divider,
  ErrorState,
  LoadingState,
  Row,
  ScreenScroll,
  Stat,
} from '@/components/primitives';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Accept'>;

export function AcceptScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { negotiationId, requirementId } = params;
  const { colors, spacing } = useTheme();
  const { userId } = useSettings();

  const negotiation = useNegotiation(negotiationId, false);
  const requirement = useRequirement(requirementId);
  const accept = useAcceptNegotiation(negotiationId, requirementId);

  const [confirmed, setConfirmed] = useState(false);

  if (negotiation.isLoading || requirement.isLoading) {
    return <LoadingState label="Loading the offer…" />;
  }

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
  const req = requirement.data;
  const price = data.supplier_price;

  if (accept.isSuccess) {
    return (
      <ScreenScroll>
        <Card>
          <AppText variant="title" color={colors.success}>
            Offer accepted
          </AppText>
          <AppText variant="body">
            Recorded at {price?.display ?? 'the quoted price'} per unit. The requirement is now
            closed.
          </AppText>
          <Divider />
          <AppText variant="caption" muted>
            {accept.data.body}
          </AppText>
          <Button
            label="Back to requirement"
            fullWidth
            onPress={() => navigation.navigate('Requirement', { requirementId })}
          />
        </Card>
      </ScreenScroll>
    );
  }

  if (!price) {
    return (
      <ScreenScroll>
        <Card>
          <AppText variant="title">Nothing to accept yet</AppText>
          <AppText variant="body" muted>
            This supplier has not quoted a price, so there is no offer to accept. Let the agent run
            another step, or wait for their reply.
          </AppText>
          <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
        </Card>
      </ScreenScroll>
    );
  }

  const quantity = req?.quantity ?? 0;
  const totalMinor = quantity > 0 ? multiplyMinor(price.minor, quantity) : null;
  const currency = req?.currency ?? 'INR';
  const gap = req ? percentAboveTarget(price.minor, req.target_price.minor) : null;
  const overMaximum = req ? price.minor > req.max_price.minor : false;
  const identityMissing = userId.trim() === '';

  return (
    <ScreenScroll>
      <Card>
        <AppText variant="caption" muted>
          You are about to accept
        </AppText>
        <AppText variant="display">{price.display}</AppText>
        <AppText variant="body" muted>
          per {req?.unit ? singular(req.unit) : 'unit'}
          {req ? ` · ${req.product}` : ''}
        </AppText>

        <Divider />

        <Row gap={spacing.xl} wrap>
          {quantity > 0 ? <Stat label="Quantity" value={`${quantity} ${req?.unit ?? 'units'}`} /> : null}
          {totalMinor !== null ? (
            <Stat label="Order total" value={formatMinor(totalMinor, currency)} tone="info" />
          ) : null}
          {req ? <Stat label="Your target" value={req.target_price.display} tone="success" /> : null}
          {gap !== null ? (
            <Stat
              label="vs target"
              value={gap > 0 ? `+${gap}%` : `${gap}%`}
              tone={gap > 0 ? 'warning' : 'success'}
            />
          ) : null}
        </Row>
      </Card>

      {overMaximum ? (
        <Banner
          tone="danger"
          title="This price is above your stated maximum"
          message="The agent would never have offered this. Accepting is still your decision, but check the figure carefully."
        />
      ) : null}

      {identityMissing ? (
        <Banner
          tone="warning"
          title="No buyer id set"
          message="The server needs your buyer id to check that you own this requirement. Add it in Settings."
          action={{ label: 'Open settings', onPress: () => navigation.navigate('Settings') }}
        />
      ) : null}

      <Card>
        <AppText variant="heading">This is your decision</AppText>
        <AppText variant="body" muted>
          The agent negotiated and recommended, but it cannot accept on your behalf — there is no
          action, tool or route by which it could. Accepting closes the requirement and records the
          agreement against your buyer id.
        </AppText>
      </Card>

      {accept.isError ? (
        <Banner
          tone="danger"
          title={accept.error.isConflict ? 'The server refused' : 'Could not accept'}
          message={accept.error.message}
        />
      ) : null}

      <View style={{ gap: spacing.md }}>
        {!confirmed ? (
          <Button
            label="Continue to confirm"
            variant="secondary"
            fullWidth
            onPress={() => setConfirmed(true)}
            disabled={identityMissing}
          />
        ) : (
          <Button
            label={`Accept at ${price.display}`}
            variant="success"
            fullWidth
            onPress={() => accept.mutate()}
            loading={accept.isPending}
            disabled={identityMissing}
            accessibilityHint="This cannot be undone."
          />
        )}

        <Button label="Cancel" variant="ghost" fullWidth onPress={() => navigation.goBack()} />
      </View>
    </ScreenScroll>
  );
}

/** "pieces" reads better as "piece" after a price. Mirrors the server. */
function singular(unit: string): string {
  const trimmed = unit.trim();
  if (/(ss)$/i.test(trimmed)) return trimmed;
  return /s$/i.test(trimmed) ? trimmed.slice(0, -1) : trimmed;
}
