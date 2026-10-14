<script setup lang="ts">
import { computed } from 'vue'
import { User, Ban, FlaskConical, Bug, Pencil, CircleHelp } from '@lucide/vue'
import type { TicketInfo } from '../../types/index'

// ─── 6.13+ ticket badges ───
// The facts a ticket tree carries that the v4/v6 layouts do not: its ref,
// whether it is a spike or a bug, its proposed risk, whether it needs a
// human step, and whether it is blocked or still needs refining.

const props = defineProps<{
  ticket: TicketInfo
  /** "card" trims to what fits a kanban card; "full" shows everything. */
  size?: 'card' | 'full'
}>()

const full = computed(() => props.size !== 'card')

const RISK_COLOR: Record<string, string> = {
  high: '--blocked',
  medium: '--active',
  low: '--todo',
}

const riskVar = computed(() => RISK_COLOR[props.ticket.risk ?? ''] ?? '--todo')
const isBlocked = computed(() => props.ticket.status === 'blocked' || !!props.ticket.blockedAt)
</script>

<template>
  <span class="ticket-badges">
    <!-- Reference: the handle every BMAD command and commit message uses -->
    <span class="tb tb-ref" title="Ticket reference">{{ ticket.ref }}</span>

    <!-- Type: stories are the default and stay unlabelled -->
    <span v-if="ticket.type === 'spike'" class="tb tb-type" title="Spike">
      <FlaskConical :size="11" :stroke-width="2" />
      <template v-if="full">spike</template>
    </span>
    <span v-else-if="ticket.type === 'bug'" class="tb tb-type tb-bug" title="Bug">
      <Bug :size="11" :stroke-width="2" />
      <template v-if="full">bug</template>
    </span>

    <!-- Proposed risk -->
    <span
      v-if="ticket.risk"
      class="tb tb-risk"
      :style="{ color: `var(${riskVar})`, borderColor: `var(${riskVar})` }"
      :title="`Proposed risk: ${ticket.risk}`"
    >{{ full ? `${ticket.risk} risk` : ticket.risk }}</span>

    <!-- Needs a human in the loop -->
    <span v-if="ticket.hitl" class="tb tb-hitl" title="Needs a human step">
      <User :size="11" :stroke-width="2" />
      <template v-if="full">hitl</template>
    </span>

    <!-- Blocked, with the reason on hover -->
    <span
      v-if="isBlocked"
      class="tb tb-blocked"
      :title="ticket.blockedReason || 'Blocked'"
    >
      <Ban :size="11" :stroke-width="2" />
      blocked
    </span>

    <!-- Needs refining before a build can start -->
    <span v-if="ticket.refine && !ticket.refined" class="tb tb-refine" title="Needs refining before it starts">
      <Pencil :size="11" :stroke-width="2" />
      <template v-if="full">refine</template>
    </span>

    <!-- An open question the ticket must settle first -->
    <span v-if="ticket.unknown" class="tb tb-unknown" :title="ticket.unknown">
      <CircleHelp :size="11" :stroke-width="2" />
      <template v-if="full">open question</template>
    </span>

    <!-- A pulled leaf file that disagrees with its entry -->
    <span
      v-if="full && ticket.drift?.length"
      class="tb tb-blocked"
      :title="`The leaf file and its tickets.toml entry disagree on: ${ticket.drift.join(', ')}`"
    >drift</span>

    <span v-if="full && ticket.assignee" class="tb tb-assignee" title="Assignee">{{ ticket.assignee }}</span>
  </span>
</template>

<style scoped>
.ticket-badges {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}

.tb {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.65rem;
  font-weight: 600;
  line-height: 1;
  padding: 0.16rem 0.34rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  white-space: nowrap;
}

.tb-ref {
  font-family: var(--font-mono);
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-dim);
}

.tb-type { color: var(--review); border-color: var(--review); background: var(--review-bg); }
.tb-bug { color: var(--blocked); border-color: var(--blocked); background: var(--blocked-bg); }
.tb-risk { background: transparent; }
.tb-hitl { color: var(--hitl); border-color: var(--hitl); background: var(--hitl-bg); }
.tb-blocked { color: var(--blocked); border-color: var(--blocked); background: var(--blocked-bg); }
.tb-refine { color: var(--active); border-color: var(--active); background: var(--active-bg); }
.tb-unknown { color: var(--active); border-color: var(--active); background: var(--active-bg); }
.tb-assignee { color: var(--text-1); }
</style>
