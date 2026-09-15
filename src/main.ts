import { createApp } from 'vue'
import App from './App.vue'

// Import Vuetify
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import '@mdi/font/css/materialdesignicons.css' // Import MDI icon styles

// Import i18n
import i18n from './i18n'
import { usePanelManager } from './composables/usePanelManager'

// Design system — must load after `vuetify/styles` so our token layer and
// component defaults win over Vuetify's stock MD3 values.
import './styles/tokens.scss'
import './styles/base.scss'
import { LIGHT_THEME_COLORS, DARK_THEME_COLORS } from './styles/theme'

const vuetify = createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi', // Set default icon set to mdi
  },
  // Add theme configuration for dark mode support
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: LIGHT_THEME_COLORS,
      },
      dark: {
        dark: true,
        colors: DARK_THEME_COLORS,
      },
    },
  },
})

const app = createApp(App)

// Initialize i18n
app.use(i18n)

// Initialize Vuetify
app.use(vuetify)

// Initialize panel manager
const panelManager = usePanelManager()
panelManager.initialize()

// Mount the app
app.mount('#app')
