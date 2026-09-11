/**
 * Opening a negotiation with one supplier.
 *
 * The backend has no seller directory - there is no GET /api/users - so the
 * only thing it accepts is a seller id. Rather than make the user retype ids,
 * the app keeps a local address book of suppliers it has used, which is
 * populated the first time an id works. The limitation is stated plainly; the
 * alternative would be inventing an endpoint.
 */

import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useHealth, useOpenNegotiation } from '@/api/queries';
import { forgetSeller, getKnownSellers, rememberSeller, type KnownSeller } from '@/storage/localIndex';
import type { RootStackParamList } from '@/navigation/types';
import { useTheme } from '@/theme';
import {
  AppText,
  Banner,
  Button,
  Card,
  Chip,
  Divider,
  Row,
  ScreenScroll,
  TextField,
} from '@/components/primitives';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'AddSupplier'>;

export function AddSupplierScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { requirementId } = params;
  const { colors, spacing } = useTheme();

  const health = useHealth();
  const open = useOpenNegotiation(requirementId);

  const [sellerId, setSellerId] = useState('');
  const [label, setLabel] = useState('');
  const [maxRounds, setMaxRounds] = useState('');
  const [known, setKnown] = useState<KnownSeller[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void getKnownSellers().then((sellers) => {
        if (active) setKnown(sellers);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const defaultRounds = health.data?.agent.max_rounds ?? 6;
  const roundsValue = maxRounds.trim() === '' ? null : Number(maxRounds.trim());

  const errors: Record<string, string | null> = {
    sellerId: !/^\d+$/.test(sellerId.trim()) ? 'A numeric supplier id is required.' : null,
    maxRounds:
      roundsValue !== null && (!Number.isInteger(roundsValue) || roundsValue < 1 || roundsValue > 20)
        ? 'Between 1 and 20.'
        : null,
  };
  const valid = Object.values(errors).every((value) => value === null);

  // `mutate` with callbacks, not `mutateAsync`: the server legitimately refuses
  // here (unknown seller, a user who is not a seller, a duplicate pair), and
  // that refusal must reach the banner below rather than becoming an unhandled
  // promise rejection.
  const onOpen = () => {
    if (!valid) return;

    open.mutate(
      {
        seller_id: sellerId.trim(),
        ...(roundsValue !== null ? { max_rounds: roundsValue } : {}),
      },
      {
        onSuccess: (negotiation) => {
          void rememberSeller({
            id: String(negotiation.seller_id),
            label: label.trim() || `Supplier #${negotiation.seller_id}`,
          }).catch(() => undefined);

          navigation.replace('Negotiation', {
            negotiationId: String(negotiation.id),
            requirementId,
          });
        },
      },
    );
  };

  return (
    <ScreenScroll>
      <Card>
        <AppText variant="title">Add a supplier</AppText>
        <AppText variant="body" muted>
          The agent will open an enquiry with them on the next step — nothing is sent by creating
          the negotiation itself.
        </AppText>

        <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
          <TextField
            testID="supplier-id"
            label="Supplier id"
            value={sellerId}
            onChangeText={setSellerId}
            keyboardType="numeric"
            placeholder="2"
            error={sellerId.length > 0 ? errors['sellerId'] : null}
            hint="The server has no supplier directory, so an id is required. Run npm run seed for ids 2, 3 and 4."
          />

          <TextField
            testID="supplier-label"
            label="Name for this supplier (optional)"
            value={label}
            onChangeText={setLabel}
            placeholder="Northline Electronics"
            autoCapitalize="words"
            hint="Remembered on this device so you do not have to recognise ids later."
          />

          <TextField
            testID="supplier-rounds"
            label="Maximum rounds (optional)"
            value={maxRounds}
            onChangeText={setMaxRounds}
            keyboardType="numeric"
            placeholder={String(defaultRounds)}
            error={errors['maxRounds']}
            hint={`How many messages the agent may send. The server default is ${defaultRounds}.`}
          />
        </View>

        {open.isError ? (
          <Banner tone="danger" title="Could not add this supplier" message={open.error.message} />
        ) : null}

        <Button
          label="Open negotiation"
          fullWidth
          onPress={onOpen}
          loading={open.isPending}
          disabled={!valid}
        />
      </Card>

      {known.length > 0 ? (
        <Card>
          <AppText variant="heading">Suppliers you have used</AppText>
          <AppText variant="caption" muted>
            Tap to fill in the id.
          </AppText>
          <Divider />
          <View style={{ gap: spacing.sm }}>
            {known.map((seller) => (
              <Row key={seller.id} justify="space-between" align="center">
                <Pressable
                  onPress={() => {
                    setSellerId(seller.id);
                    setLabel(seller.label);
                  }}
                  accessibilityRole="button"
                  style={{ flex: 1 }}
                >
                  <Row gap={spacing.sm}>
                    <Chip label={`#${seller.id}`} tone="info" />
                    <AppText variant="body">{seller.label}</AppText>
                  </Row>
                </Pressable>
                <Pressable
                  onPress={() => void forgetSeller(seller.id).then(setKnown)}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <AppText variant="caption" color={colors.textMuted}>
                    Remove
                  </AppText>
                </Pressable>
              </Row>
            ))}
          </View>
        </Card>
      ) : null}
    </ScreenScroll>
  );
}
