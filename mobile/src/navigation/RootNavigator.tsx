/**
 * The navigation stack.
 *
 * One native stack, no tabs: the app is a drill-down from requirement to
 * supplier to thread, and a tab bar would flatten a hierarchy that is genuinely
 * nested.
 *
 * The initial route depends on whether a server address has been saved, which
 * is why this component waits for the settings load rather than rendering Home
 * and letting every query fail.
 */

import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useSettings } from '@/config/settings';
import { useTheme } from '@/theme';
import { AcceptScreen } from '@/screens/AcceptScreen';
import { AddSupplierScreen } from '@/screens/AddSupplierScreen';
import { AuditTrailScreen } from '@/screens/AuditTrailScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { NegotiationScreen } from '@/screens/NegotiationScreen';
import { NewRequirementScreen } from '@/screens/NewRequirementScreen';
import { RequirementScreen } from '@/screens/RequirementScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { ToolsScreen } from '@/screens/ToolsScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** A plain text header action, styled from the palette rather than the OS. */
function HeaderTextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={12}>
      <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function RootNavigator() {
  const { colors, dark } = useTheme();
  const { loaded, configured } = useSettings();

  const navigationTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  if (!loaded) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName={configured ? 'Home' : 'Settings'}
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        {/*
          Home needs a route back to Connection. Once a server is saved the
          initial route becomes Home, and without this header action the
          settings screen - and the Tools screen it links to - are unreachable,
          so a wrong API key or buyer id could not be corrected from inside the
          app.
        */}
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={({ navigation }) => ({
            title: 'Requirements',
            headerRight: () => (
              <HeaderTextButton
                label="Connection"
                onPress={() => navigation.navigate('Settings')}
              />
            ),
          })}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Connection' }}
        />
        <Stack.Screen
          name="NewRequirement"
          component={NewRequirementScreen}
          options={{ title: 'New requirement' }}
        />
        <Stack.Screen
          name="Requirement"
          component={RequirementScreen}
          options={{ title: 'Requirement' }}
        />
        <Stack.Screen
          name="AddSupplier"
          component={AddSupplierScreen}
          options={{ title: 'Add supplier' }}
        />
        <Stack.Screen
          name="Negotiation"
          component={NegotiationScreen}
          options={{ title: 'Negotiation' }}
        />
        <Stack.Screen
          name="AuditTrail"
          component={AuditTrailScreen}
          options={{ title: 'Agent reasoning' }}
        />
        <Stack.Screen
          name="Accept"
          component={AcceptScreen}
          options={{ title: 'Accept offer', presentation: 'modal' }}
        />
        <Stack.Screen name="Tools" component={ToolsScreen} options={{ title: 'Agent tools' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
