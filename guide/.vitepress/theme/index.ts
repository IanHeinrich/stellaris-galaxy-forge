import { h } from 'vue'
import DefaultTheme, { VPButton } from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Annotated from './components/Annotated.vue'
import GuideVersion from './components/GuideVersion.vue'
import HomeSearch from './components/HomeSearch.vue'
import NotFound from './components/NotFound.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-after': () => h(HomeSearch),
      'not-found': () => h(NotFound)
    }),
  enhanceApp({ app }) {
    app.component('Annotated', Annotated)
    app.component('GuideVersion', GuideVersion)
    app.component('VPButton', VPButton)
  }
} satisfies Theme
