/**
 * The requirement list.
 *
 * The backend has no "list my requirements" route, so this screen is built on
 * a local index of ids this device has created or been told about, each one
 * fetched with GET /api/requirements/:id. That limitation is stated in the UI
 * rather than hidden, and the screen offers an explicit "track an existing
 * requirement by id" action so a requirement made elsewhere can still be
 * opened.
 */

import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueries } from '@tanstack/react-query';

import { getRequirement } from '@/api/endpoints';
import { queryKeys } from '@/api/queries';
import { ApiError } from '@/api/client';
import type { Requirement } from '@/api/types';
import { useCredentials, useSettings } from '@/config/settings';
import { forgetRequirementId, getRequirementIds, rememberRequirementId } from '@/storage/localIndex';
import type { RootStackParamList } from '@/navigation/types';
import { useTheme } from '@/theme';
import {
  AppText,
  Banner,
  Button,
  Card,
  EmptyState,
  LoadingState,
  Row,
  TextField,
} from '@/components/primitives';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const credentials = useCredentials();
  const { configured } = useSettings();

  const [ids, setIds] = useState<string[]>([]);
  const [indexLoaded, setIndexLoaded] = useState(false);
  const [trackingId, setTrackingId] = useState('');
  const [showTracker, setShowTracker] = useState(false);

  // Re-read on focus so a requirement created on the next screen appears here.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void getRequirementIds().then((stored) => {
        if (!active) return;
        setIds(stored);
        setIndexLoaded(true);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.requirement(credentials.baseUrl, id),
      queryFn: ({ signal }: { signal: AbortSignal }) => getRequirement(credentials, id, signal),
      enabled: configured,
      retry: false,
    })),
  });

  const loading = configured && indexLoaded && results.some((result) => result.isLoading);
  const refreshing = results.some((result) => result.isFetching && !result.isLoading);

  const rows = ids
    .map((id, index) => ({ id, result: results[index] }))
    .filter((entry) => entry.result !== undefined);

  const missing = rows.filter(
    (entry) => entry.result?.error instanceof ApiError && entry.result.error.isNotFound,
  );

  const onTrack = async () => {
    const trimmed = trackingId.trim();
    if (!trimmed) return;
    const next = await rememberRequirementId(trimmed);
    setIds(next);
    setTrackingId('');
    setShowTracker(false);
  };

  const onForget = async (id: string) => {
    const next = await forgetRequirementId(id);
    setIds(next);
  };

  if (!configured) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <EmptyState
          title="Connect to your server"
          message="Set the backend address before creating a requirement."
          action={{ label: 'Open settings', onPress: () => navigation.navigate('Settings') }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={rows}
        keyExtractor={(entry) => entry.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => results.forEach((result) => void result.refetch())}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            <Row justify="space-between" align="center">
              <AppText variant="caption" muted>
                Tracked on this device
              </AppText>
              <Pressable
                onPress={() => setShowTracker((current) => !current)}
                accessibilityRole="button"
              >
                <AppText variant="label" color={colors.primary}>
                  {showTracker ? 'Cancel' : 'Track by id'}
                </AppText>
              </Pressable>
            </Row>

            {showTracker ? (
              <Card>
                <AppText variant="caption" muted>
                  The server has no endpoint that lists requirements, so this app remembers the ones
                  it created. Enter an id to track one made elsewhere.
                </AppText>
                <TextField
                  label="Requirement id"
                  value={trackingId}
                  onChangeText={setTrackingId}
                  keyboardType="numeric"
                  placeholder="1"
                />
                <Button label="Track" onPress={() => { void onTrack(); }} />
              </Card>
            ) : null}

            {missing.length > 0 ? (
              <Banner
                tone="warning"
                title={`${missing.length} tracked id${missing.length === 1 ? '' : 's'} not found`}
                message="They may belong to a different server. Swipe them away below or change the server address."
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <LoadingState label="Loading requirements…" />
          ) : (
            <EmptyState
              title="No requirements yet"
              message="Tell the agent what you need to buy, and it will start negotiating with suppliers."
              action={{
                label: 'New requirement',
                onPress: () => navigation.navigate('NewRequirement'),
              }}
            />
          )
        }
        renderItem={({ item }) => {
          const result = item.result;
          if (!result) return null;

          if (result.isLoading) {
            return (
              <Card>
                <AppText variant="body" muted>
                  Loading requirement #{item.id}…
                </AppText>
              </Card>
            );
          }

          if (result.isError || !result.data) {
            const error = result.error;
            const message =
              error instanceof ApiError ? error.message : 'Could not load this requirement.';
            return (
              <Card>
                <AppText variant="heading">Requirement #{item.id}</AppText>
                <AppText variant="caption" color={colors.danger}>
                  {message}
                </AppText>
                <Row gap={spacing.sm} wrap>
                  <Button label="Retry" variant="secondary" onPress={() => void result.refetch()} />
                  <Button label="Stop tracking" variant="ghost" onPress={() => { void onForget(item.id); }} />
                </Row>
              </Card>
            );
          }

          return (
            <RequirementRow
              requirement={result.data}
              onPress={() =>
                navigation.navigate('Requirement', { requirementId: String(result.data.id) })
              }
            />
          );
        }}
      />

      {/*
        The app draws edge to edge (app.json sets edgeToEdgeEnabled), so the
        Android navigation bar sits on top of anything pinned to the bottom.
        Offsetting by the safe-area inset is what stops this button being half
        hidden behind the system bar on a device with on-screen navigation.
      */}
      <View
        style={{
          position: 'absolute',
          left: spacing.lg,
          right: spacing.lg,
          bottom: spacing.xl + insets.bottom,
        }}
      >
        <Button
          label="New requirement"
          fullWidth
          onPress={() => navigation.navigate('NewRequirement')}
        />
      </View>
    </View>
  );
}

function RequirementRow({
  requirement,
  onPress,
}: {
  requirement: Requirement;
  onPress: () => void;
}) {
  const { spacing } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Requirement for ${requirement.product}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <Card>
        <Row justify="space-between" align="flex-start">
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="heading">{requirement.product}</AppText>
            <AppText variant="caption" muted>
              {requirement.quantity > 0
                ? `${requirement.quantity} ${requirement.unit ?? 'units'}`
                : 'Quantity not stated'}
              {' · #'}
              {requirement.id}
            </AppText>
          </View>
        </Row>

        <Row gap={spacing.xl} wrap>
          <View style={{ gap: 2 }}>
            <AppText variant="caption" muted>
              Target
            </AppText>
            <AppText variant="heading">{requirement.target_price.display}</AppText>
          </View>
          <View style={{ gap: 2 }}>
            <AppText variant="caption" muted>
              Status
            </AppText>
            <AppText variant="heading">{requirement.status}</AppText>
          </View>
        </Row>
      </Card>
    </Pressable>
  );
}
