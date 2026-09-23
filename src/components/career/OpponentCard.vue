<template>
  <v-card
    class="opponent-card"
    :class="{
      'is-locked': !unlocked,
      'is-cleared': cleared,
      'is-boss': opponent.boss,
    }"
    variant="flat"
    @click="unlocked && $emit('play')"
  >
    <div class="opponent-card__head">
      <div class="opponent-card__avatar" :style="avatarStyle">
        <span v-if="!unlocked" class="opponent-card__lock">
          <v-icon icon="mdi-lock" size="18" />
        </span>
        <span v-else>{{ initial }}</span>
      </div>

      <div class="opponent-card__ident">
        <div class="opponent-card__name">
          {{ t(`career.opponents.${opponent.id}.name`) }}
          <v-icon
            v-if="opponent.boss"
            icon="mdi-crown"
            size="14"
            color="amber"
            class="ml-1"
          />
        </div>
        <div class="opponent-card__title">
          {{ t(`career.opponents.${opponent.id}.title`) }}
        </div>
      </div>

      <div class="opponent-card__rating">
        <span class="opponent-card__rating-value">{{ opponent.rating }}</span>
        <span class="opponent-card__rating-label">{{
          t('career.rating')
        }}</span>
      </div>
    </div>

    <p v-if="unlocked" class="opponent-card__bio">
      {{ t(`career.opponents.${opponent.id}.bio`) }}
    </p>
    <p v-else class="opponent-card__bio opponent-card__bio--locked">
      {{ lockHint }}
    </p>

    <div class="opponent-card__foot">
      <div class="opponent-card__record">
        <v-chip v-if="progress && progress.games > 0" size="x-small" label>
          {{ progress.wins }}–{{ progress.draws }}–{{ progress.losses }}
        </v-chip>
        <v-chip
          v-if="cleared"
          size="x-small"
          label
          color="success"
          variant="flat"
        >
          <v-icon icon="mdi-check" size="12" start />
          {{ t('career.cleared') }}
        </v-chip>
        <span class="opponent-card__style-hint">
          {{ t('career.tierLabel', { tier: opponent.tier }) }}
        </span>
      </div>

      <v-btn
        v-if="unlocked"
        size="small"
        color="primary"
        variant="flat"
        class="opponent-card__cta"
        @click.stop="$emit('play')"
      >
        {{ cleared ? t('career.rematch') : t('career.challenge') }}
      </v-btn>
    </div>
  </v-card>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { CareerOpponent } from '@/composables/useCareerOpponents'
  import type { OpponentProgress } from '@/composables/useCareer'

  const props = defineProps<{
    opponent: CareerOpponent
    unlocked: boolean
    progress?: OpponentProgress
    /** Rating needed to unlock, shown as a hint when locked. */
    lockHint?: string
  }>()

  defineEmits<{ (e: 'play'): void }>()

  const { t } = useI18n()

  const cleared = computed(() => (props.progress?.wins ?? 0) > 0)

  const initial = computed(() =>
    t(`career.opponents.${props.opponent.id}.name`).trim().charAt(0)
  )

  /**
   * No opponent artwork ships with the app, and inventing placeholder images
   * would look worse than a clean monogram. The hue is derived from the tier so
   * each card is distinguishable at a glance without being random.
   */
  const avatarStyle = computed(() => {
    const hue = (props.opponent.tier * 29 + 18) % 360
    return {
      background: `linear-gradient(140deg, hsl(${hue} 42% 62%), hsl(${
        (hue + 38) % 360
      } 46% 46%))`,
    }
  })
</script>

<style scoped lang="scss">
  .opponent-card {
    padding: var(--sp-3, 12px);
    border-radius: 14px;
    background: rgb(var(--c-surface));
    border: 1px solid rgb(var(--c-border, 0 0 0 / 0.08));
    cursor: pointer;
    transition:
      transform 0.16s ease,
      box-shadow 0.16s ease;
  }

  .opponent-card:hover:not(.is-locked) {
    transform: translateY(-2px);
    box-shadow: var(--sh-3, 0 6px 18px rgb(0 0 0 / 0.12));
  }

  .opponent-card.is-locked {
    opacity: 0.55;
    cursor: default;
  }

  .opponent-card.is-cleared {
    border-color: rgb(var(--v-theme-success) / 0.45);
  }

  .opponent-card.is-boss {
    border-color: rgb(255 193 7 / 0.6);
    background:
      linear-gradient(180deg, rgb(255 193 7 / 0.08), transparent),
      rgb(var(--c-surface));
  }

  .opponent-card__head {
    display: flex;
    align-items: center;
    gap: var(--sp-3, 12px);
  }

  .opponent-card__avatar {
    position: relative;
    width: 46px;
    height: 46px;
    flex: 0 0 46px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-weight: 700;
    font-size: 20px;
    user-select: none;
  }

  .opponent-card__lock {
    display: flex;
  }

  .opponent-card__ident {
    flex: 1;
    min-width: 0;
  }

  .opponent-card__name {
    font-weight: 600;
    font-size: 15px;
    line-height: 1.3;
    display: flex;
    align-items: center;
  }

  .opponent-card__title {
    font-size: 12px;
    opacity: 0.66;
    margin-top: 1px;
  }

  .opponent-card__rating {
    text-align: right;
    flex: 0 0 auto;
  }

  .opponent-card__rating-value {
    display: block;
    font-weight: 700;
    font-size: 17px;
    font-variant-numeric: tabular-nums;
  }

  .opponent-card__rating-label {
    font-size: 10px;
    opacity: 0.5;
    letter-spacing: 0.04em;
  }

  .opponent-card__bio {
    margin: var(--sp-2, 8px) 0 0;
    font-size: 12.5px;
    line-height: 1.5;
    opacity: 0.78;
  }

  .opponent-card__bio--locked {
    font-style: italic;
    opacity: 0.6;
  }

  .opponent-card__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2, 8px);
    margin-top: var(--sp-3, 12px);
  }

  .opponent-card__record {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .opponent-card__style-hint {
    font-size: 11px;
    opacity: 0.5;
  }

  .opponent-card__cta {
    text-transform: none;
  }
</style>
