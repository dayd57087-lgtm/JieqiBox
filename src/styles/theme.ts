/**
 * Vuetify theme palettes.
 *
 * These are the *same* colours as `tokens.scss` — kept in a separate file only
 * because Vuetify needs literal values at runtime (it parses them into
 * `--v-theme-*` RGB channels), while our CSS layer wants composable channels.
 *
 * When you change a colour, change it in BOTH places. The mapping is 1:1:
 *   primary   -> --c-primary        background -> --c-bg
 *   error     -> --c-danger         surface    -> --c-surface
 *   accent    -> --c-accent         outline    -> --c-outline
 */

export const LIGHT_THEME_COLORS = {
  primary: '#14665C',
  secondary: '#5A6B66',
  accent: '#B4761F',
  error: '#B3392F',
  info: '#2A6F97',
  success: '#3F7D45',
  warning: '#B4761F',
  background: '#F2F0EB',
  surface: '#FFFFFF',
  'surface-bright': '#FFFFFF',
  'surface-light': '#F9F8F5',
  'surface-variant': '#E7E3DB',
  'on-surface-variant': '#6B675F',
  'on-background': '#1C1B1A',
  'on-surface': '#1C1B1A',
  outline: '#CDC7BC',
  button: '#FFFFFF',
}

export const DARK_THEME_COLORS = {
  primary: '#4FA894',
  secondary: '#8FA39D',
  accent: '#D9A441',
  error: '#E06B5F',
  info: '#5FA8D3',
  success: '#6BAF73',
  warning: '#D9A441',
  background: '#121417',
  surface: '#1A1D21',
  'surface-bright': '#292D33',
  'surface-light': '#20242A',
  'surface-variant': '#262A30',
  'on-surface-variant': '#9DA3AB',
  'on-background': '#E8E6E1',
  'on-surface': '#E8E6E1',
  outline: '#3E444C',
  button: '#1A1A1A',
}
