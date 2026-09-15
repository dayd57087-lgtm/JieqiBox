<template>
  <v-dialog v-model="isOpen" max-width="420px">
    <v-card>
      <v-card-title class="lang__title">
        {{ $t('languages.current') }}
      </v-card-title>
      <v-divider />
      <v-list density="comfortable">
        <v-list-item
          v-for="(name, code) in LANGUAGES"
          :key="code"
          :active="locale === code"
          :lang="String(code)"
          :title="name"
          @click="choose(String(code))"
        />
      </v-list>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
  /**
   * Language picker.
   *
   * Was an inline submenu inside the toolbar; it now lives here so both the
   * drawer and any future surface can open the same dialog.
   */
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useConfigManager } from '@/composables/useConfigManager'

  const isOpen = defineModel<boolean>({ default: false })

  const { t, locale } = useI18n()
  const configManager = useConfigManager()

  const LANGUAGES = computed(() => ({
    zh_cn: t('languages.zh_cn'),
    zh_tw: t('languages.zh_tw'),
    en: t('languages.en'),
    vi: t('languages.vi'),
    ja: t('languages.ja'),
    ko: t('languages.ko'),
    ru: t('languages.ru'),
    de: t('languages.de'),
    fr: t('languages.fr'),
    es: t('languages.es'),
    th: t('languages.th'),
    ms: t('languages.ms'),
  }))

  const choose = async (code: string) => {
    locale.value = code
    isOpen.value = false
    try {
      await configManager.updateLocale(code)
    } catch (e) {
      console.warn('Failed to persist locale:', e)
    }
  }
</script>

<style scoped lang="scss">
  .lang__title {
    font-size: var(--fs-md);
    font-weight: var(--fw-semibold);
    padding: var(--sp-4);
  }
</style>
