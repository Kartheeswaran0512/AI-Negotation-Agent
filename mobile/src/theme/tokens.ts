/**
 * Design tokens.
 *
 * One palette, defined light-first and mirrored for dark, so a colour is never
 * hard-coded in a component. The app follows the device appearance setting.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 28, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '700' },
  heading: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '400' },
  mono: { fontSize: 13, fontWeight: '500' },
} as const;

export interface Palette {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryText: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  danger: string;
  dangerSurface: string;
  info: string;
  infoSurface: string;
  accent: string;
  accentSurface: string;
  bubbleAgent: string;
  bubbleAgentText: string;
  bubbleSeller: string;
  bubbleSellerText: string;
  bubbleBuyer: string;
  bubbleBuyerText: string;
}

export const lightPalette: Palette = {
  background: '#F5F6F8',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  border: '#E2E5EA',
  text: '#11161C',
  textMuted: '#5C6672',
  textInverse: '#FFFFFF',
  primary: '#1F6FEB',
  primaryText: '#FFFFFF',
  success: '#12805C',
  successSurface: '#E4F5EE',
  warning: '#9A6400',
  warningSurface: '#FBF0DC',
  danger: '#C0392B',
  dangerSurface: '#FBE9E7',
  info: '#1F6FEB',
  infoSurface: '#E7F0FE',
  accent: '#6B4FBB',
  accentSurface: '#EFEAFA',
  bubbleAgent: '#1F6FEB',
  bubbleAgentText: '#FFFFFF',
  bubbleSeller: '#FFFFFF',
  bubbleSellerText: '#11161C',
  bubbleBuyer: '#12805C',
  bubbleBuyerText: '#FFFFFF',
};

export const darkPalette: Palette = {
  background: '#0B0F14',
  surface: '#141A21',
  surfaceRaised: '#1B222B',
  border: '#28313C',
  text: '#E8ECF1',
  textMuted: '#94A1B0',
  textInverse: '#0B0F14',
  primary: '#4C8DFF',
  primaryText: '#08111F',
  success: '#3DD68C',
  successSurface: '#12291F',
  warning: '#E5A93C',
  warningSurface: '#2C2213',
  danger: '#FF6B5E',
  dangerSurface: '#2E1614',
  info: '#4C8DFF',
  infoSurface: '#111E31',
  accent: '#A98CF5',
  accentSurface: '#1D1830',
  bubbleAgent: '#2C6BD6',
  bubbleAgentText: '#FFFFFF',
  bubbleSeller: '#1B222B',
  bubbleSellerText: '#E8ECF1',
  bubbleBuyer: '#1C6E51',
  bubbleBuyerText: '#FFFFFF',
};
