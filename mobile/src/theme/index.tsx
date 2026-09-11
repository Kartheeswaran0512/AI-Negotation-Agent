/**
 * Theme access.
 *
 * A hook rather than a context provider: the palette is derived purely from the
 * device colour scheme, so there is no state to hold and nothing to re-wire.
 */

import { useColorScheme } from 'react-native';

import { darkPalette, lightPalette, radius, spacing, typography, type Palette } from './tokens';

export { radius, spacing, typography };
export type { Palette };

export interface Theme {
  colors: Palette;
  dark: boolean;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
}

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  return {
    colors: dark ? darkPalette : lightPalette,
    dark,
    spacing,
    radius,
    typography,
  };
}
