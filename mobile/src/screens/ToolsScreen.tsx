/**
 * The agent's capability surface, read from GET /api/tools.
 *
 * Worth a screen because the interesting fact about this list is what is not
 * on it. The server returns its own note saying there is deliberately no
 * accept_deal tool, and this screen shows that note verbatim rather than
 * paraphrasing it - "what can this agent do?" should have a short, complete,
 * checkable answer.
 *
 * Read-only: invoking a tool from here would be a second, unguarded way to
 * make the agent act, and the app already has a guarded one.
 */

import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { useTools } from '@/api/queries';
import { useSettings } from '@/config/settings';
import { useTheme } from '@/theme';
import {
  AppText,
  Banner,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  LoadingState,
  Row,
  ScreenScroll,
} from '@/components/primitives';

export function ToolsScreen() {
  const { colors, spacing, radius } = useTheme();
  const { configured } = useSettings();
  const tools = useTools();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!configured) {
    return <EmptyState title="Not connected" message="Set the server address in Settings first." />;
  }

  if (tools.isLoading) return <LoadingState label="Loading the tool surface…" />;

  if (tools.isError) {
    return (
      <ErrorState
        title="Could not load the tools"
        message={tools.error.message}
        onRetry={() => void tools.refetch()}
      />
    );
  }

  const data = tools.data;

  return (
    <ScreenScroll
      refreshControl={
        <RefreshControl
          refreshing={tools.isFetching && !tools.isLoading}
          onRefresh={() => void tools.refetch()}
          tintColor={colors.primary}
        />
      }
    >
      <Banner tone="accent" title="What the agent can do" message={data?.note} />

      {(data?.tools ?? []).map((tool) => {
        const open = expanded === tool.name;
        return (
          <Card key={tool.name}>
            <Pressable
              onPress={() => setExpanded(open ? null : tool.name)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
            >
              <Row justify="space-between" align="flex-start">
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <AppText variant="heading">{tool.name}</AppText>
                  <AppText variant="body" muted>
                    {tool.description}
                  </AppText>
                </View>
                <AppText variant="label" color={colors.primary}>
                  {open ? 'Hide' : 'Schema'}
                </AppText>
              </Row>
            </Pressable>

            {open ? (
              <>
                <Divider />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: radius.sm,
                    padding: spacing.md,
                  }}
                >
                  <AppText variant="mono" muted selectable>
                    {JSON.stringify(tool.input_schema, null, 2)}
                  </AppText>
                </ScrollView>
              </>
            ) : null}
          </Card>
        );
      })}

      <Card>
        <AppText variant="heading">Why this list matters</AppText>
        <AppText variant="body" muted>
          Every effect the agent can have on the world is one of these tools. There is no tool that
          accepts a deal, under any name, and the server refuses to start if one is ever added —
          so &quot;the agent cannot commit you&quot; is a property of the code rather than a rule
          somebody has to remember.
        </AppText>
      </Card>
    </ScreenScroll>
  );
}
