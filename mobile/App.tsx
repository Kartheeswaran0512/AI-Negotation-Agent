/**
 * Application root: providers, and nothing else.
 *
 * The query client is created once with defaults chosen for a phone on a
 * possibly-poor network - a short stale time so returning to a screen shows
 * fresh data, and no automatic refetch on window focus, which on mobile fires
 * far more often than a user expects.
 */

import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SettingsProvider } from '@/config/settings';
import { RootNavigator } from '@/navigation/RootNavigator';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 3000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export default function App() {
  // Held in state so a fast refresh does not throw away every cache.
  const [queryClient] = useState(createQueryClient);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <StatusBar style="auto" />
          <RootNavigator />
        </SettingsProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
