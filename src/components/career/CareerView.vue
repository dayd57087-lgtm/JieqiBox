<template>
  <div v-if="visible" class="career">
    <header class="career__bar">
      <button class="career__back" @click="$emit('close')">
        <v-icon icon="mdi-chevron-left" size="20" />
        <span>{{ t('career.backToBoard') }}</span>
      </button>
      <h1 class="career__heading">{{ t('career.title') }}</h1>
      <button
        class="career__icon-btn"
        :title="t('career.exportSave')"
        @click="$emit('export')"
      >
        <v-icon icon="mdi-download" size="18" />
      </button>
    </header>

    <div class="career__scroll">
      <!-- Profile ------------------------------------------------------- -->
      <section class="profile">
        <div class="profile__avatar" @click="editOpen = true">
          <span>{{ avatarInitial }}</span>
          <span class="profile__avatar-edit">
            <v-icon icon="mdi-pencil" size="12" />
          </span>
        </div>

        <div class="profile__ident">
          <div class="profile__nick">
            {{ profile?.nickname || t('career.defaultNickname') }}
            <span v-if="profile?.title" class="profile__badge">
              {{ profile.title }}
            </span>
          </div>
          <div class="profile__rank">
            {{ t(`career.rank.${rankKey}`) }}
            <span
              v-if="profile && profile.gamesPlayed > 0"
              class="profile__sev"
            >
              · {{ profile.gamesPlayed }} {{ t('career.games') }}
            </span>
          </div>
        </div>

        <div class="profile__rating">
          <span class="profile__rating-value">{{
            profile?.rating ?? '—'
          }}</span>
          <span v-if="peakShown" class="profile__rating-peak">
            {{ t('career.peak') }} {{ profile?.peakRating }}
          </span>
        </div>
      </section>

      <v-progress-linear
        :model-value="Math.round(progress * 100)"
        height="6"
        rounded
        color="primary"
        class="career__rankbar"
      />

      <section class="facts">
        <div class="facts__item">
          <span class="facts__value">{{ winRateText }}</span>
          <span class="facts__label">{{ t('career.winRate') }}</span>
        </div>
        <div class="facts__item">
          <span class="facts__value">
            {{ profile?.wins ?? 0 }}·{{ profile?.draws ?? 0 }}·{{
              profile?.losses ?? 0
            }}
          </span>
          <span class="facts__label">{{ t('career.record') }}</span>
        </div>
        <div class="facts__item">
          <span class="facts__value">{{ profile?.currentStreak ?? 0 }}</span>
          <span class="facts__label">{{ t('career.streak') }}</span>
        </div>
        <div class="facts__item">
          <span class="facts__value">{{ profile?.bestStreak ?? 0 }}</span>
          <span class="facts__label">{{ t('career.bestStreak') }}</span>
        </div>
      </section>

      <!-- Rating curve -------------------------------------------------- -->
      <section v-if="curve.length > 1" class="curve">
        <div class="curve__title">{{ t('career.ratingTrend') }}</div>
        <svg class="curve__svg" viewBox="0 0 300 64" preserveAspectRatio="none">
          <polyline
            class="curve__line"
            :points="curvePoints"
            fill="none"
            vector-effect="non-scaling-stroke"
          />
          <circle
            v-if="curve.length"
            class="curve__dot"
            :cx="lastPoint.x"
            :cy="lastPoint.y"
            r="3"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <div class="curve__range">
          <span>{{ curveMin }}</span>
          <span>{{ curveMax }}</span>
        </div>
      </section>

      <!-- Tabs ---------------------------------------------------------- -->
      <v-tabs v-model="tab" density="comfortable" class="career__tabs">
        <v-tab value="ladder">{{ t('career.tabLadder') }}</v-tab>
        <v-tab value="history">{{ t('career.tabHistory') }}</v-tab>
        <v-tab value="rules">{{ t('career.tabHowItWorks') }}</v-tab>
      </v-tabs>

      <!-- Ladder -------------------------------------------------------- -->
      <div v-if="tab === 'ladder'" class="ladder">
        <p class="ladder__intro">{{ t('career.ladderIntro') }}</p>
        <OpponentCard
          v-for="entry in ladder"
          :key="entry.id"
          :opponent="entry.opponent"
          :unlocked="entry.unlocked"
          :progress="entry.progress"
          :lock-hint="entry.lockHint"
          @play="onPlay(entry)"
        />
      </div>

      <!-- History ------------------------------------------------------- -->
      <div v-else-if="tab === 'history'" class="history">
        <p v-if="!games.length" class="history__empty">
          {{ t('career.noGames') }}
        </p>
        <div v-for="game in games" :key="game.id" class="history__row">
          <span class="history__result" :class="`is-${game.result}`">
            {{ t(`career.result.${game.result}`) }}
          </span>
          <div class="history__ident">
            <div class="history__opponent">
              {{ t(`career.opponents.${game.opponentId}.name`) }}
            </div>
            <div class="history__meta">
              {{ formatDate(game.createdAt) }} ·
              {{ t('career.movesCount', { n: game.moves }) }}
              <template v-if="game.fenSeed !== null">
                · {{ t('career.seedShort', { seed: game.fenSeed }) }}
              </template>
            </div>
          </div>
          <span
            class="history__delta"
            :class="game.ratingDelta >= 0 ? 'is-up' : 'is-down'"
          >
            {{ game.ratingDelta >= 0 ? '+' : '' }}{{ game.ratingDelta }}
          </span>
        </div>
      </div>

      <!-- How it works -------------------------------------------------- -->
      <div v-else class="rules">
        <h3>{{ t('career.howItWorks.ratingTitle') }}</h3>
        <p>{{ t('career.howItWorks.ratingBody') }}</p>

        <h3>{{ t('career.howItWorks.difficultyTitle') }}</h3>
        <p>{{ t('career.howItWorks.difficultyBody') }}</p>

        <h3>{{ t('career.howItWorks.fairnessTitle') }}</h3>
        <p>{{ t('career.howItWorks.fairnessBody') }}</p>

        <h3>{{ t('career.howItWorks.seedTitle') }}</h3>
        <p>{{ t('career.howItWorks.seedBody') }}</p>

        <v-divider class="my-4" />

        <v-btn
          variant="text"
          color="error"
          size="small"
          @click="resetOpen = true"
        >
          {{ t('career.resetSave') }}
        </v-btn>
      </div>
    </div>

    <!-- Profile editor ------------------------------------------------- -->
    <v-dialog v-model="editOpen" max-width="420">
      <v-card>
        <v-card-title class="text-body-1">
          {{ t('career.editProfile') }}
        </v-card-title>
        <v-card-text>
          <v-text-field
            v-model="draftNickname"
            :label="t('career.nickname')"
            maxlength="24"
            density="comfortable"
            variant="outlined"
          />
          <v-text-field
            v-model="draftTitle"
            :label="t('career.customTitle')"
            :hint="t('career.customTitleHint')"
            maxlength="12"
            density="comfortable"
            variant="outlined"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editOpen = false">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn color="primary" variant="flat" @click="saveProfile">
            {{ t('common.confirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Reset confirmation -------------------------------------------- -->
    <v-dialog v-model="resetOpen" max-width="420">
      <v-card>
        <v-card-title class="text-body-1">
          {{ t('career.resetSave') }}
        </v-card-title>
        <v-card-text>{{ t('career.resetConfirm') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="resetOpen = false">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn color="error" variant="flat" @click="doReset">
            {{ t('common.confirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import OpponentCard from './OpponentCard.vue'
  import {
    useCareer,
    type GameSummary,
    type OpponentProgress,
  } from '@/composables/useCareer'
  import {
    CAREER_OPPONENTS,
    clearedTierFromProgress,
    isOpponentUnlocked,
    type CareerOpponent,
  } from '@/composables/useCareerOpponents'

  const props = defineProps<{ visible: boolean }>()

  const emit = defineEmits<{
    (e: 'close'): void
    (e: 'play', opponent: CareerOpponent): void
    (e: 'export'): void
  }>()

  const { t } = useI18n()
  const career = useCareer()

  const tab = ref<'ladder' | 'history' | 'rules'>('ladder')
  const editOpen = ref(false)
  const resetOpen = ref(false)
  const draftNickname = ref('')
  const draftTitle = ref('')
  const games = ref<GameSummary[]>([])

  const profile = career.profile
  const stats = career.stats
  const rankKey = career.rankKey
  const progress = career.progress

  const avatarInitial = computed(() => {
    const nick = profile.value?.nickname?.trim()
    return nick ? nick.charAt(0) : '棋'
  })

  const peakShown = computed(
    () => (profile.value?.peakRating ?? 0) > (profile.value?.rating ?? 0)
  )

  const winRateText = computed(() => {
    const p = profile.value
    if (!p || p.gamesPlayed === 0) return '—'
    return `${Math.round((p.wins / p.gamesPlayed) * 100)}%`
  })

  const clearedTier = computed(() =>
    clearedTierFromProgress(stats.value?.opponents ?? [])
  )

  interface LadderEntry {
    id: string
    tier: number
    rating: number
    boss?: boolean
    unlocked: boolean
    progress: OpponentProgress | undefined
    /** Shown in place of the bio while the card is locked. */
    lockHint: string
    /** The full opponent, handed to the match layer when the card is played. */
    opponent: CareerOpponent
  }

  /**
   * The ladder as rendered. Unlock state is derived, never stored: the store
   * owns wins and losses, and the gating rule lives in useCareerOpponents so
   * there is exactly one place to change it.
   */
  const ladder = computed<LadderEntry[]>(() => {
    const rating = profile.value?.rating ?? 1200
    const progressList = stats.value?.opponents ?? []
    return CAREER_OPPONENTS.map(opponent => {
      const unlocked = isOpponentUnlocked(opponent, clearedTier.value, rating)
      const prev = CAREER_OPPONENTS.find(o => o.tier === opponent.tier - 1)
      return {
        id: opponent.id,
        tier: opponent.tier,
        rating: opponent.rating,
        boss: opponent.boss,
        unlocked,
        progress: progressList.find(p => p.opponentId === opponent.id),
        lockHint: prev
          ? t('career.lockHintBeat', {
              name: t(`career.opponents.${prev.id}.name`),
            })
          : t('career.lockHintRating', { rating: opponent.rating - 150 }),
        opponent,
      }
    })
  })

  const onPlay = (entry: LadderEntry) => {
    emit('play', entry.opponent)
  }

  /* ---------- rating curve ----------
   * A hand-rolled polyline rather than a chart library: the whole thing is one
   * number per game, and pulling in a charting dependency for it would cost
   * more than it draws. */
  const curve = computed(() => stats.value?.ratingHistory ?? [])

  const curveBounds = computed(() => {
    const values = curve.value.map(p => p.rating)
    if (!values.length) return { min: 0, max: 0 }
    return { min: Math.min(...values), max: Math.max(...values) }
  })

  const curveMin = computed(() => curveBounds.value.min)
  const curveMax = computed(() => curveBounds.value.max)

  const curvePoints = computed(() => {
    const points = curve.value
    if (points.length < 2) return ''
    const { min, max } = curveBounds.value
    const span = Math.max(1, max - min)
    const w = 300
    const h = 64
    const pad = 6
    return points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * (w - pad * 2) + pad
        const y = h - pad - ((p.rating - min) / span) * (h - pad * 2)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  })

  const lastPoint = computed(() => {
    const points = curve.value
    const { min, max } = curveBounds.value
    const span = Math.max(1, max - min)
    const last = points[points.length - 1]
    return {
      x: 300 - 6,
      y: last ? 64 - 6 - ((last.rating - min) / span) * (64 - 12) : 32,
    }
  })

  const formatDate = (ms: number) => {
    const d = new Date(ms)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const loadAll = async () => {
    await career.loadProfile()
    await career.loadStats()
    games.value = await career.listGames(50, 0)
    draftNickname.value = career.profile.value?.nickname ?? ''
    draftTitle.value = career.profile.value?.title ?? ''
  }

  // Refresh on open rather than on mount: the view is a long-lived overlay,
  // and stale numbers here would be the most visible possible bug.
  watch(
    () => props.visible,
    visible => {
      if (visible) loadAll()
    },
    { immediate: true }
  )

  const saveProfile = async () => {
    await career.updateProfile({
      nickname: draftNickname.value,
      title: draftTitle.value,
    })
    editOpen.value = false
  }

  const doReset = async () => {
    resetOpen.value = false
    await career.resetCareer()
    await loadAll()
  }
</script>

<style scoped lang="scss">
  .career {
    position: fixed;
    inset: 0;
    z-index: 1500;
    display: flex;
    flex-direction: column;
    background: rgb(var(--c-bg, 248 248 248));
    color: rgb(var(--v-theme-on-surface));
  }

  .career__bar {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    padding: 10px var(--sp-3, 12px);
    border-bottom: 1px solid rgb(var(--v-theme-on-surface) / 0.08);
    background: rgb(var(--c-surface));
  }

  .career__back,
  .career__icon-btn {
    display: flex;
    align-items: center;
    gap: 2px;
    border: none;
    background: none;
    color: inherit;
    font-size: 13px;
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
  }

  .career__back:hover,
  .career__icon-btn:hover {
    background: rgb(var(--v-theme-on-surface) / 0.06);
  }

  .career__heading {
    flex: 1;
    text-align: center;
    font-size: 15px;
    font-weight: 600;
    margin: 0;
  }

  .career__scroll {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-3, 12px) var(--sp-3, 12px) 48px;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  /* Profile ---------------------------------------------------------- */
  .profile {
    display: flex;
    align-items: center;
    gap: var(--sp-3, 12px);
  }

  .profile__avatar {
    position: relative;
    width: 54px;
    height: 54px;
    flex: 0 0 54px;
    border-radius: 50%;
    background: linear-gradient(140deg, #7e57c2, #3f51b5);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 700;
    cursor: pointer;
  }

  .profile__avatar-edit {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgb(var(--c-surface));
    color: rgb(var(--v-theme-on-surface));
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgb(var(--v-theme-on-surface) / 0.15);
  }

  .profile__ident {
    flex: 1;
    min-width: 0;
  }

  .profile__nick {
    font-size: 17px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .profile__badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 6px;
    background: rgb(255 193 7 / 0.22);
    color: rgb(150 110 0);
  }

  .profile__rank {
    font-size: 12.5px;
    opacity: 0.7;
    margin-top: 2px;
  }

  .profile__sev {
    opacity: 0.7;
  }

  .profile__rating {
    text-align: right;
  }

  .profile__rating-value {
    display: block;
    font-size: 26px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .profile__rating-peak {
    font-size: 10px;
    opacity: 0.55;
  }

  .career__rankbar {
    margin: var(--sp-3, 12px) 0;
  }

  /* Facts ------------------------------------------------------------ */
  .facts {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--sp-2, 8px);
  }

  .facts__item {
    text-align: center;
    padding: var(--sp-2, 8px) 2px;
    border-radius: 10px;
    background: rgb(var(--c-surface));
    border: 1px solid rgb(var(--v-theme-on-surface) / 0.06);
    overflow: hidden;
  }

  .facts__value {
    display: block;
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .facts__label {
    font-size: 10px;
    opacity: 0.55;
  }

  /* Curve ------------------------------------------------------------ */
  .curve {
    margin-top: var(--sp-3, 12px);
    padding: var(--sp-3, 12px);
    border-radius: 12px;
    background: rgb(var(--c-surface));
    border: 1px solid rgb(var(--v-theme-on-surface) / 0.06);
  }

  .curve__title {
    font-size: 12px;
    font-weight: 600;
    opacity: 0.7;
    margin-bottom: 6px;
  }

  .curve__svg {
    width: 100%;
    height: 64px;
    display: block;
  }

  .curve__line {
    stroke: rgb(var(--v-theme-primary));
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .curve__dot {
    fill: rgb(var(--v-theme-primary));
  }

  .curve__range {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    opacity: 0.45;
  }

  /* Tabs ------------------------------------------------------------- */
  .career__tabs {
    margin: var(--sp-3, 12px) 0 var(--sp-2, 8px);
  }

  /* Ladder ----------------------------------------------------------- */
  .ladder {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2, 8px);
  }

  .ladder__intro,
  .rules p {
    font-size: 12.5px;
    line-height: 1.6;
    opacity: 0.72;
    margin: 0 0 var(--sp-2, 8px);
  }

  /* History ---------------------------------------------------------- */
  .history__row {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    padding: 9px 0;
    border-bottom: 1px solid rgb(var(--v-theme-on-surface) / 0.07);
  }

  .history__result {
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
  }

  .history__result.is-win {
    background: #43a047;
  }

  .history__result.is-loss {
    background: #e53935;
  }

  .history__result.is-draw {
    background: #78909c;
  }

  .history__ident {
    flex: 1;
    min-width: 0;
  }

  .history__opponent {
    font-size: 13.5px;
    font-weight: 500;
  }

  .history__meta {
    font-size: 11px;
    opacity: 0.55;
  }

  .history__delta {
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .history__delta.is-up {
    color: rgb(var(--v-theme-success));
  }

  .history__delta.is-down {
    color: rgb(var(--v-theme-error));
  }

  .history__empty {
    font-size: 13px;
    opacity: 0.6;
    text-align: center;
    padding: 32px 0;
  }

  /* Rules ------------------------------------------------------------ */
  .rules h3 {
    font-size: 13.5px;
    font-weight: 600;
    margin: var(--sp-3, 12px) 0 4px;
  }

  @media (min-width: 769px) {
    .career__scroll {
      padding-left: var(--sp-5, 24px);
      padding-right: var(--sp-5, 24px);
    }
  }
</style>
