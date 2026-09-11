/**
 * Connection settings.
 *
 * Also the app's honesty screen: it reports whether the server is answering,
 * which interpreter is live (Claude or the deterministic rules engine), and
 * whether the agent is enabled or in dry-run. Dry-run in particular is
 * surfaced loudly, because otherwise a user taps "Run agent step", sees
 * nothing sent, and concludes the app is broken.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useHealth, useTools } from '@/api/queries';
import { DEFAULT_BASE_URL, useSettings } from '@/config/settings';
import type { RootStackParamList } from '@/navigation/types';
import { useTheme } from '@/theme';
import {
  AppText,
  Banner,
  Button,
  Card,
  Divider,
  LoadingState,
  Row,
  ScreenScroll,
  Stat,
  TextField,
} from '@/components/primitives';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { spacing, colors } = useTheme();
  const settings = useSettings();

  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [userId, setUserId] = useState(settings.userId);
  const [saved, setSaved] = useState(false);

  // Settings load asynchronously; adopt them once when they arrive.
  useEffect(() => {
    if (!settings.loaded) return;
    setBaseUrl((current) => (current === '' ? settings.baseUrl : current));
    setApiKey((current) => (current === '' ? settings.apiKey : current));
    setUserId((current) => (current === '' ? settings.userId : current));
  }, [settings.loaded, settings.baseUrl, settings.apiKey, settings.userId]);

  const health = useHealth(settings.configured);

  /**
   * `/health` sits OUTSIDE the server's API-key check, by design - a container
   * probe should not need a secret. So a healthy response says nothing about
   * whether the key is right, and reporting "Connected" from it alone let a
   * wrong key look fine until the first real request failed.
   *
   * `GET /api/tools` is the cheapest authenticated, read-only, side-effect-free
   * route on the server, so it is used purely as a credential probe.
   */
  const keyProbe = useTools();
  const keyRejected = keyProbe.isError && keyProbe.error.isUnauthorized;

  const dirty =
    baseUrl !== settings.baseUrl || apiKey !== settings.apiKey || userId !== settings.userId;

  // Never allowed to reject: this runs from a press handler, and an unhandled
  // rejection would surface as a red box instead of something the user can act
  // on. A storage failure leaves the fields as typed rather than claiming they
  // were saved.
  const onSave = async () => {
    try {
      await settings.save({ baseUrl, apiKey, userId });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // The tools query key is namespaced by base URL, not by key, so a changed
      // key has to be re-probed explicitly.
      await Promise.all([health.refetch(), keyProbe.refetch()]);
    } catch {
      setSaved(false);
    }
  };

  const userIdError =
    userId.trim() !== '' && !/^\d+$/.test(userId.trim())
      ? 'The server expects a numeric user id.'
      : null;

  return (
    <ScreenScroll>
      <Card>
        <AppText variant="title">Server</AppText>
        <AppText variant="body" muted>
          The address of the negotiation backend. On a physical device this must be your
          machine&apos;s LAN address, not localhost.
        </AppText>

        <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
          <TextField
            testID="settings-base-url"
            label="Server address"
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder={DEFAULT_BASE_URL}
            keyboardType="url"
            hint="For example http://192.168.1.10:3000"
          />
          <TextField
            testID="settings-api-key"
            label="API key"
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="x-api-key"
            secureTextEntry
            hint="Stored in the device keychain. Leave blank if the server runs with API_KEY unset."
          />
          <TextField
            testID="settings-user-id"
            label="Your buyer id"
            value={userId}
            onChangeText={setUserId}
            placeholder="1"
            keyboardType="numeric"
            error={userIdError}
            hint="Sent as x-user-id. Required to accept an offer, and checked against the requirement owner."
          />
        </View>

        <Row gap={spacing.sm} style={{ marginTop: spacing.sm }} wrap>
          <Button
            label={dirty ? 'Save and test' : 'Test connection'}
            onPress={() => { void onSave(); }}
            loading={health.isFetching}
          />
          {settings.configured ? (
            <Button
              label="Clear"
              variant="secondary"
              onPress={() => {
                void settings.clear();
                setBaseUrl('');
                setApiKey('');
                setUserId('');
              }}
            />
          ) : null}
        </Row>

        {saved ? <Banner tone="success" title="Settings saved" /> : null}
      </Card>

      {!settings.configured ? (
        <Banner
          tone="info"
          title="Not configured yet"
          message="Enter the server address above to get started."
        />
      ) : health.isLoading ? (
        <LoadingState label="Contacting the server…" />
      ) : health.isError ? (
        <Banner
          tone="danger"
          title="Cannot reach the server"
          message={health.error.message}
          action={{ label: 'Retry', onPress: () => void health.refetch() }}
        />
      ) : health.data ? (
        <Card>
          <Row justify="space-between">
            <AppText variant="title">Connected</AppText>
            <AppText variant="caption" muted>
              {health.data.env}
            </AppText>
          </Row>

          <Divider />

          <Row gap={spacing.xl} wrap>
            <Stat
              label="API key"
              value={keyRejected ? 'Rejected' : keyProbe.isSuccess ? 'Accepted' : 'Checking…'}
              tone={keyRejected ? 'danger' : keyProbe.isSuccess ? 'success' : undefined}
            />
            <Stat
              label="Interpreter"
              value={health.data.llm.model_backed ? 'Claude' : 'Rules engine'}
              tone={health.data.llm.model_backed ? 'accent' : 'neutral'}
              hint={health.data.llm.model ?? 'deterministic, no model'}
            />
            <Stat
              label="Agent"
              value={health.data.agent.enabled ? 'Enabled' : 'Disabled'}
              tone={health.data.agent.enabled ? 'success' : 'danger'}
            />
            <Stat label="Max rounds" value={String(health.data.agent.max_rounds)} />
          </Row>

          {keyRejected ? (
            <Banner
              tone="danger"
              title="The server rejected this API key"
              message="The server is reachable, but it refused the key. Everything except this screen will fail until it matches the server's API_KEY."
            />
          ) : null}

          {health.data.agent.dry_run ? (
            <Banner
              tone="warning"
              title="Dry-run mode is on"
              message="The agent will decide and record, but send nothing. Nothing you do here will reach a supplier until AGENT_DRY_RUN is turned off on the server."
            />
          ) : null}

          {!health.data.agent.enabled ? (
            <Banner
              tone="danger"
              title="The agent is switched off"
              message="AGENT_ENABLED is false on the server, so no messages will be sent."
            />
          ) : null}

          {!health.data.llm.model_backed ? (
            <AppText variant="caption" muted>
              No model key is configured, so the server is interpreting supplier messages with its
              deterministic rules engine. Decisions are identical either way — only the wording
              differs.
            </AppText>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <AppText variant="heading">About this app</AppText>
        <AppText variant="body" muted>
          The agent negotiates on your behalf and recommends what to do. It cannot accept an offer —
          that is your decision, on a screen only you can reach.
        </AppText>
        <Row gap={spacing.sm} wrap style={{ marginTop: spacing.xs }}>
          <Button
            label="View agent tools"
            variant="secondary"
            onPress={() => navigation.navigate('Tools')}
          />
          {settings.configured ? (
            <Button label="Go to requirements" variant="ghost" onPress={() => navigation.navigate('Home')} />
          ) : null}
        </Row>
        <AppText variant="caption" color={colors.textMuted}>
          Credentials are stored on this device only and are sent to the address above.
        </AppText>
      </Card>
    </ScreenScroll>
  );
}
