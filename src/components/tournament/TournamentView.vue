<template>
  <div v-if="visible" class="tournament">
    <header class="tournament__bar">
      <button class="tournament__back" @click="emit('close')">
        <v-icon icon="mdi-chevron-left" size="20" />
        <span>{{ t('tournament.backToBoard') }}</span>
      </button>
      <h1 class="tournament__heading">{{ t('tournament.title') }}</h1>
      <button
        class="tournament__icon-btn"
        :title="t('tournament.export')"
        :disabled="!selected"
        @click="onExport"
      >
        <v-icon icon="mdi-download" size="18" />
      </button>
    </header>

    <div class="tournament__scroll">
      <!-- Create ------------------------------------------------------- -->
      <section class="card">
        <button class="card__toggle" @click="showCreate = !showCreate">
          <v-icon
            :icon="showCreate ? 'mdi-chevron-down' : 'mdi-chevron-right'"
            size="18"
          />
          <span>{{ t('tournament.create') }}</span>
        </button>

        <div v-if="showCreate" class="form">
          <label class="field">
            <span>{{ t('tournament.name') }}</span>
            <input
              v-model="form.name"
              type="text"
              :placeholder="t('tournament.namePlaceholder')"
            />
          </label>

          <label class="field">
            <span>{{ t('tournament.format') }}</span>
            <select v-model="form.format">
              <option value="gauntlet">
                {{ t('tournament.formatGauntlet') }}
              </option>
              <option value="roundRobin">
                {{ t('tournament.formatRoundRobin') }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>{{ t('tournament.timeControl') }}</span>
            <select v-model="form.timeControl">
              <option value="movetime">{{ t('tournament.tcMovetime') }}</option>
              <option value="nodes">{{ t('tournament.tcNodes') }}</option>
              <option value="depth">{{ t('tournament.tcDepth') }}</option>
            </select>
          </label>

          <label class="field">
            <span>{{ t('tournament.timeValue') }}</span>
            <input v-model.number="form.timeValue" type="number" min="1" />
          </label>

          <label class="field">
            <span>{{ t('tournament.gamesPerPairing') }}</span>
            <input
              v-model.number="form.gamesPerPairing"
              type="number"
              min="2"
              step="2"
            />
          </label>

          <label class="field">
            <span>{{ t('tournament.seed') }}</span>
            <input v-model.number="form.seed" type="number" min="0" />
            <small>{{ t('tournament.seedHint') }}</small>
          </label>

          <div class="field field--wide">
            <span>{{ t('tournament.enginePick') }}</span>
            <p v-if="engines.length === 0" class="muted">
              {{ t('tournament.noEngines') }}
            </p>
            <ul v-else class="picker">
              <li v-for="engine in engines" :key="engine.id">
                <label class="picker__item">
                  <input
                    type="checkbox"
                    :value="engine.id"
                    :checked="picked.includes(engine.id)"
                    @change="toggleEngine(engine.id)"
                  />
                  <span>{{ engine.name }}</span>
                </label>
              </li>
            </ul>
            <small>{{ t('tournament.orderHint') }}</small>
          </div>

          <div class="form__actions">
            <button
              class="btn btn--primary"
              :disabled="busy || !canCreate"
              @click="onCreate"
            >
              {{ t('tournament.createRun') }}
            </button>
            <span v-if="createBlockedReason" class="muted">
              {{ createBlockedReason }}
            </span>
            <span v-if="notice" class="notice">{{ notice }}</span>
          </div>
        </div>
      </section>

      <!-- Run ---------------------------------------------------------- -->
      <section v-if="tournaments.length" class="card">
        <div class="row">
          <select v-model.number="selectedId" class="select" @change="onSelect">
            <option v-for="item in tournaments" :key="item.id" :value="item.id">
              {{ item.name }} · {{ item.gamesDone }}/{{ item.gamesTotal }}
            </option>
          </select>
          <button
            v-if="!isRunning"
            class="btn btn--primary"
            :disabled="!selected || selected.gamesDone >= selected.gamesTotal"
            @click="onStart"
          >
            {{
              selected && selected.gamesDone > 0
                ? t('tournament.resume')
                : t('tournament.start')
            }}
          </button>
          <template v-else>
            <button class="btn" @click="onPause">
              {{ t('tournament.pause') }}
            </button>
            <button class="btn" @click="onAbandon">
              {{ t('tournament.abandon') }}
            </button>
          </template>
          <template v-if="!confirmingDelete">
            <button
              class="btn btn--danger"
              :disabled="!selected"
              @click="onDelete"
            >
              {{ t('tournament.delete') }}
            </button>
          </template>
          <template v-else>
            <span class="notice">{{ t('tournament.confirmDelete') }}</span>
            <button class="btn btn--danger" @click="onDeleteConfirmed">
              {{ t('tournament.deleteYes') }}
            </button>
            <button class="btn" @click="confirmingDelete = false">
              {{ t('tournament.deleteNo') }}
            </button>
          </template>
        </div>

        <template v-if="selected">
          <progress
            class="bar"
            :value="selected.gamesDone + selected.gamesVoid"
            :max="Math.max(selected.gamesTotal, 1)"
          ></progress>
          <p class="muted">
            {{
              t('tournament.progress', {
                done: selected.gamesDone,
                void: selected.gamesVoid,
                total: selected.gamesTotal,
                status: t(`tournament.status.${selected.status}`),
              })
            }}
            <template v-if="selected.seed">
              ·
              {{ t('tournament.seedShort', { seed: selected.seed }) }}</template
            >
          </p>
          <p v-if="isRunning" class="live">{{ gameLabel }} — {{ plyLabel }}</p>
          <p v-if="lastError" class="error">{{ lastError }}</p>
        </template>
      </section>

      <!-- Standings ---------------------------------------------------- -->
      <section v-if="standings.length" class="card">
        <h2>{{ t('tournament.standings') }}</h2>
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>{{ t('tournament.engine') }}</th>
              <th>{{ t('tournament.gamesShort') }}</th>
              <th>{{ t('tournament.winsShort') }}</th>
              <th>{{ t('tournament.drawsShort') }}</th>
              <th>{{ t('tournament.lossesShort') }}</th>
              <th>{{ t('tournament.score') }}</th>
              <th>{{ t('tournament.rating') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in standings" :key="row.entryId">
              <td>{{ index + 1 }}</td>
              <td>
                {{ row.name }}
                <small v-if="row.provisional" class="muted">
                  {{ t('tournament.provisional') }}
                </small>
              </td>
              <td>{{ row.games }}</td>
              <td>{{ row.wins }}</td>
              <td>{{ row.draws }}</td>
              <td>{{ row.losses }}</td>
              <td>{{ (row.scoreRate * 100).toFixed(1) }}%</td>
              <td>{{ Math.round(row.rating) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Games -------------------------------------------------------- -->
      <section v-if="games.length" class="card">
        <h2>{{ t('tournament.games') }}</h2>
        <table class="table table--compact">
          <thead>
            <tr>
              <th>{{ t('tournament.pair') }}</th>
              <th>{{ t('tournament.red') }}</th>
              <th>{{ t('tournament.black') }}</th>
              <th>{{ t('tournament.result') }}</th>
              <th>{{ t('tournament.reason') }}</th>
              <th>{{ t('tournament.moves') }}</th>
              <th>{{ t('tournament.seedShort', { seed: '' }) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="game in games" :key="game.id">
              <td>{{ game.pairIndex + 1 }}.{{ game.gameIndex + 1 }}</td>
              <td>{{ nameOf(game.redEntry) }}</td>
              <td>{{ nameOf(game.blackEntry) }}</td>
              <td>{{ resultLabel(game.result) }}</td>
              <td>{{ game.reason ?? '—' }}</td>
              <td>{{ game.moves ?? '—' }}</td>
              <td>{{ game.seed }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="runLog.length" class="card">
        <h2>{{ t('tournament.log') }}</h2>
        <pre class="log">{{ runLog.join('\n') }}</pre>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useTournament } from '@/composables/useTournament'
  import {
    abandonTournament,
    pauseTournament,
    startTournament,
    useTournamentRunner,
  } from '@/composables/useTournamentRunner'
  import {
    useConfigManager,
    type ManagedEngine,
  } from '@/composables/useConfigManager'
  import type {
    Standing,
    TournamentConfig,
    TournamentDetail,
    TournamentGameRecord,
    TournamentSummary,
  } from '@/types/tournament'

  const props = defineProps<{ visible: boolean }>()
  const emit = defineEmits<{ (e: 'close'): void }>()

  const { t } = useI18n()
  const api = useTournament()
  const { getEngines } = useConfigManager()
  const { phase, gameLabel, plyLabel, runLog, lastError } =
    useTournamentRunner()
  /** The runner owns the phase; the buttons only ever ask what it is. */
  const isRunning = computed(() => phase.value === 'running')

  const tournaments = ref<TournamentSummary[]>([])
  const selectedId = ref<number | null>(null)
  const detail = ref<TournamentDetail | null>(null)
  const standings = ref<Standing[]>([])
  const games = ref<TournamentGameRecord[]>([])
  /**
   * Read the engine list rather than snapshot it.
   *
   * `useConfigManager` keeps `configData` in a module-level ref and the config
   * file is parsed asynchronously, which means this overlay mounts against an
   * empty engine list. Copying that list into a local `ref` at mount time froze
   * the emptiness in place — the picker said "no engines configured" in an app
   * that had three. A computed subscribes to the ref instead, so the list
   * appears the moment the config arrives.
   */
  const engines = computed<ManagedEngine[]>(() => getEngines())
  const picked = ref<string[]>([])
  const busy = ref(false)
  const notice = ref('')
  const showCreate = ref(true)

  const form = ref({
    name: '',
    format: 'gauntlet' as TournamentConfig['format'],
    timeControl: 'movetime' as TournamentConfig['timeControl'],
    timeValue: 1000,
    gamesPerPairing: 2,
    seed: 0,
  })

  const selected = computed(
    () => tournaments.value.find(item => item.id === selectedId.value) ?? null
  )

  const canCreate = computed(() => picked.value.length >= 2)

  /**
   * Why the create button is off, in words.
   *
   * A disabled button that does not say what it is waiting for is how this bug
   * survived a device test: the click did nothing, and nothing on screen said
   * the schedule wanted a third engine.
   */
  const createBlockedReason = computed(() => {
    if (picked.value.length === 0) return t('tournament.pickTwo')
    if (picked.value.length === 1) return t('tournament.pickOneMore')
    return ''
  })

  const nameOf = (entryId: number) =>
    detail.value?.entrants.find(entry => entry.id === entryId)?.name ??
    `#${entryId}`

  const resultLabel = (result: TournamentGameRecord['result']) => {
    if (result === 'red') return t('tournament.redWins')
    if (result === 'black') return t('tournament.blackWins')
    if (result === 'draw') return t('tournament.draw')
    return '—'
  }

  function toggleEngine(id: string) {
    const index = picked.value.indexOf(id)
    if (index === -1) picked.value.push(id)
    else picked.value.splice(index, 1)
  }

  async function refreshList() {
    tournaments.value = await api.list()
  }

  async function refreshDetail() {
    if (selectedId.value === null) {
      detail.value = null
      standings.value = []
      games.value = []
      return
    }
    detail.value = await api.get(selectedId.value)
    standings.value = await api.standings(selectedId.value)
    games.value = await api.games(selectedId.value)
  }

  async function refreshAll() {
    await refreshList()
    await refreshDetail()
  }

  function onSelect() {
    confirmingDelete.value = false
    void refreshDetail()
  }

  async function onCreate() {
    if (!canCreate.value) return
    busy.value = true
    notice.value = ''
    try {
      // The selection order *is* the schedule: for a gauntlet the first pick is
      // the challenger, and the rest are its opponents.
      const chosen = picked.value
        .map(id => engines.value.find(engine => engine.id === id))
        .filter((engine): engine is ManagedEngine => !!engine)

      const config: TournamentConfig = {
        name: form.value.name || t('tournament.defaultName'),
        format: form.value.format,
        timeControl: form.value.timeControl,
        timeValue: Math.max(1, form.value.timeValue),
        gamesPerPairing: Math.max(2, form.value.gamesPerPairing),
        // Seed 0 means "let Rust pick a stable one"; it is stored either way, so
        // the tournament stays replayable.
        ...(form.value.seed ? { seed: form.value.seed } : {}),
        entries: chosen.map(engine => ({
          name: engine.name,
          path: engine.path,
          args: engine.args ?? '',
        })),
      }

      const created = await api.create(config)
      await refreshAll()
      selectedId.value = created.id
      await refreshDetail()
      showCreate.value = false
      notice.value = t('tournament.created', { total: created.gamesTotal })
    } catch (error) {
      notice.value = String(error)
    } finally {
      busy.value = false
    }
  }

  function onStart() {
    if (selectedId.value === null) return
    startTournament(selectedId.value)
    startPolling()
  }

  function onPause() {
    pauseTournament()
  }

  function onAbandon() {
    if (selectedId.value === null) return
    abandonTournament(selectedId.value)
  }

  /** Second step armed; cleared by cancelling or by finishing a delete. */
  const confirmingDelete = ref(false)

  function onDelete() {
    if (selectedId.value === null) return
    confirmingDelete.value = true
  }

  async function onDeleteConfirmed() {
    confirmingDelete.value = false
    if (selectedId.value === null) return
    await api.remove(selectedId.value)
    selectedId.value = null
    await refreshAll()
  }

  async function onExport() {
    if (selectedId.value === null) return
    const payload = await api.exportAll(selectedId.value)
    try {
      await navigator.clipboard.writeText(payload)
      notice.value = t('tournament.exportCopied')
    } catch {
      notice.value = t('tournament.exportFailed')
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null

  function startPolling() {
    if (timer) return
    // The runner writes one row per game, so the screen has nothing to stream —
    // it re-reads the tables the same way it will after a restart. Polling only
    // while a run is live keeps a finished league from hitting SQLite forever.
    timer = setInterval(async () => {
      if (!props.visible) return
      await refreshAll()
      if (!useTournamentRunner().isRunning() && timer) {
        clearInterval(timer)
        timer = null
      }
    }, 2000)
  }

  onMounted(async () => {
    await refreshList()
    if (tournaments.value.length) {
      selectedId.value = tournaments.value[0].id
      await refreshDetail()
    }
    startPolling()
  })

  onUnmounted(() => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  })
</script>

<style lang="scss" scoped>
  .tournament {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    background: rgb(var(--c-bg));
    color: rgb(var(--c-text));
  }

  .tournament__bar {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3);
    border-bottom: 1px solid rgb(var(--c-border, 128 128 128) / 0.25);
  }

  .tournament__heading {
    flex: 1;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .tournament__back,
  .tournament__icon-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
  }

  .tournament__scroll {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-3);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .card {
    border: 1px solid rgb(var(--c-border, 128 128 128) / 0.25);
    border-radius: 10px;
    padding: var(--sp-3);
  }

  .card__toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: inherit;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }

  .form {
    margin-top: var(--sp-3);
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--sp-2);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
  }

  .field--wide {
    grid-column: 1 / -1;
  }

  .field input,
  .field select,
  .select {
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid rgb(var(--c-border, 128 128 128) / 0.4);
    background: transparent;
    color: inherit;
  }

  .picker {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .picker__item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid rgb(var(--c-border, 128 128 128) / 0.3);
    border-radius: 999px;
  }

  .form__actions,
  .row {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
  }

  .btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid rgb(var(--c-border, 128 128 128) / 0.4);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .btn--primary {
    background: rgb(var(--c-primary, 63 81 181));
    border-color: transparent;
    color: #fff;
  }

  .btn--danger {
    border-color: rgb(var(--c-error, 198 40 40) / 0.6);
    color: rgb(var(--c-error, 198 40 40));
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .bar {
    width: 100%;
    height: 8px;
    margin-top: var(--sp-2);
  }

  .table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    margin-top: var(--sp-2);
  }

  .table th,
  .table td {
    text-align: left;
    padding: 4px 6px;
    border-bottom: 1px solid rgb(var(--c-border, 128 128 128) / 0.2);
  }

  .table--compact {
    font-size: 0.78rem;
  }

  .muted {
    opacity: 0.65;
    font-size: 0.78rem;
  }

  .live {
    margin-top: 4px;
    font-variant-numeric: tabular-nums;
  }

  .notice,
  .error {
    color: rgb(var(--c-error, 198 40 40));
    font-size: 0.8rem;
  }

  .log {
    max-height: 220px;
    overflow: auto;
    font-size: 0.75rem;
    white-space: pre-wrap;
    margin-top: var(--sp-2);
  }
</style>
