<template>
  <v-dialog :model-value="visible" max-width="520" persistent>
    <v-card class="report">
      <div class="report__banner" :class="`is-${report.result}`">
        <v-icon :icon="resultIcon" size="30" />
        <span class="report__headline">{{ headline }}</span>
      </div>

      <v-card-text class="report__body">
        <!-- Rating movement is the whole point of the screen: it is the number
             the player actually came for, so it gets the largest type. -->
        <div class="report__rating">
          <span class="report__rating-from">{{ report.ratingBefore }}</span>
          <v-icon
            icon="mdi-arrow-right"
            size="18"
            class="report__rating-arrow"
          />
          <span class="report__rating-to">{{ report.ratingAfter }}</span>
          <span
            class="report__rating-delta"
            :class="report.ratingDelta >= 0 ? 'is-up' : 'is-down'"
          >
            {{ report.ratingDelta >= 0 ? '+' : '' }}{{ report.ratingDelta }}
          </span>
        </div>

        <!-- Split the movement in two. A player who has just been handed 100
             points for clearing a step deserves to see that it was not their
             play that earned them — otherwise the number teaches nothing. -->
        <p v-if="report.clearBonus > 0" class="report__note report__note--good">
          <v-icon icon="mdi-flag-checkered" size="14" start />
          {{ t('career.report.clearBonus', { n: report.clearBonus }) }}
        </p>

        <p v-if="!report.rated" class="report__note report__note--warn">
          <v-icon icon="mdi-alert-outline" size="14" start />
          {{ t('career.report.unratedNote') }}
        </p>
        <p
          v-else-if="report.damping < 1"
          class="report__note report__note--warn"
        >
          <v-icon icon="mdi-repeat" size="14" start />
          {{
            t('career.report.dampingNote', {
              percent: Math.round(report.damping * 100),
            })
          }}
        </p>

        <div class="report__stats">
          <div class="report__stat">
            <span class="report__stat-value">{{ report.moves }}</span>
            <span class="report__stat-label">{{
              t('career.report.moves')
            }}</span>
          </div>
          <div class="report__stat">
            <span class="report__stat-value">{{ durationText }}</span>
            <span class="report__stat-label">{{
              t('career.report.duration')
            }}</span>
          </div>
          <div class="report__stat">
            <span class="report__stat-value">{{ opponentRating }}</span>
            <span class="report__stat-label">{{
              t('career.report.opponentRating')
            }}</span>
          </div>
        </div>

        <div v-if="report.unlocked.length" class="report__achievements">
          <div class="report__section-title">
            {{ t('career.report.unlocked') }}
          </div>
          <v-chip
            v-for="id in report.unlocked"
            :key="id"
            size="small"
            color="amber"
            variant="flat"
            class="mr-1 mb-1"
          >
            <v-icon icon="mdi-trophy" size="13" start />
            {{ t(`career.achievements.${id}`) }}
          </v-chip>
        </div>

        <!-- Transparency about how the opponent was configured. The player
             asked for a fair ladder; showing the knobs is how they can tell
             they got one. -->
        <v-expansion-panels
          v-if="report.appliedOverrides.length"
          flat
          class="mt-3"
        >
          <v-expansion-panel>
            <v-expansion-panel-title class="report__expand-title">
              {{ t('career.report.opponentSetup') }}
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div
                v-for="o in report.appliedOverrides"
                :key="o.name"
                class="report__override"
              >
                <code>{{ o.name }}</code>
                <span>{{ o.value }}</span>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>

      <v-card-actions>
        <v-btn variant="text" @click="$emit('close')">
          {{ t('career.report.backToLadder') }}
        </v-btn>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="$emit('review')">
          {{ t('career.report.review') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { MatchReport } from '@/composables/useCareerMatch'
  import { opponentById } from '@/composables/useCareerOpponents'

  const props = defineProps<{
    visible: boolean
    report: MatchReport
  }>()

  defineEmits<{ (e: 'close'): void; (e: 'review'): void }>()

  const { t } = useI18n()

  const headline = computed(() => {
    const opp = opponentById(props.report.opponentId)
    const name = opp ? t(`career.opponents.${opp.id}.name`) : ''
    return t(`career.report.headline.${props.report.result}`, { name })
  })

  const resultIcon = computed(() => {
    switch (props.report.result) {
      case 'win':
        return 'mdi-trophy'
      case 'draw':
        return 'mdi-handshake'
      default:
        return 'mdi-emoticon-sad'
    }
  })

  const opponentRating = computed(
    () => opponentById(props.report.opponentId)?.rating ?? 0
  )

  const durationText = computed(() => {
    const total = Math.floor(props.report.durationMs / 1000)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${String(s).padStart(2, '0')}`
  })
</script>

<style scoped lang="scss">
  .report__banner {
    display: flex;
    align-items: center;
    gap: var(--sp-3, 12px);
    padding: var(--sp-4, 16px);
    color: #fff;
  }

  .report__banner.is-win {
    background: linear-gradient(120deg, #2e7d32, #43a047);
  }

  .report__banner.is-loss {
    background: linear-gradient(120deg, #c62828, #e53935);
  }

  .report__banner.is-draw {
    background: linear-gradient(120deg, #546e7a, #78909c);
  }

  .report__headline {
    font-size: 16px;
    font-weight: 600;
  }

  .report__rating {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2, 8px);
    justify-content: center;
    margin-bottom: var(--sp-3, 12px);
  }

  .report__rating-from {
    font-size: 20px;
    opacity: 0.55;
    font-variant-numeric: tabular-nums;
  }

  .report__rating-arrow {
    opacity: 0.4;
    align-self: center;
  }

  .report__rating-to {
    font-size: 30px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .report__rating-delta {
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .report__rating-delta.is-up {
    color: rgb(var(--v-theme-success));
  }

  .report__rating-delta.is-down {
    color: rgb(var(--v-theme-error));
  }

  .report__note {
    font-size: 12px;
    line-height: 1.5;
    margin: 0 0 var(--sp-2, 8px);
    display: flex;
    align-items: center;
    opacity: 0.8;
  }

  .report__note--warn {
    color: rgb(var(--v-theme-warning));
    opacity: 1;
  }

  .report__note--good {
    color: rgb(var(--v-theme-success));
    opacity: 1;
  }

  .report__stats {
    display: flex;
    justify-content: space-around;
    padding: var(--sp-3, 12px) 0;
    border-top: 1px solid rgb(var(--v-theme-on-surface) / 0.08);
    border-bottom: 1px solid rgb(var(--v-theme-on-surface) / 0.08);
  }

  .report__stat {
    text-align: center;
  }

  .report__stat-value {
    display: block;
    font-size: 17px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .report__stat-label {
    font-size: 11px;
    opacity: 0.55;
  }

  .report__section-title {
    font-size: 12px;
    font-weight: 600;
    opacity: 0.7;
    margin-bottom: 6px;
  }

  .report__achievements {
    margin-top: var(--sp-3, 12px);
  }

  .report__expand-title {
    font-size: 12px;
    min-height: 36px;
  }

  .report__override {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    padding: 2px 0;
    opacity: 0.8;
  }

  .report__override code {
    font-family: ui-monospace, monospace;
  }
</style>
