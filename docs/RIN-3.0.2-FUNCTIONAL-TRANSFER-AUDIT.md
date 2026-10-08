# Rin 3.0.2 — functional transfer audit (v2.5 → v3)

**Baseline**: installed `2026-10-08-rin-v3-cognitive-ownership-cleanup` (GitHub main blob `api/chat.js` SHA `09e0d6f75b1dd47a3fa634d1839d974aa19b9139`).
**Legacy feature source**: `lib/cognition/rin-mind.js`, `behavior-state.js`, `turn-decision.js`, `emotional-state.js`, `kernel-state.js`, canonical profile. The legacy prompt is a feature inventory, NOT an execution dependency.
**Migration rule**: move each behavior to observations / graph / single TurnPlan / Luna realization / deterministic persistence, **never reactivate a second behavior owner**.

| Former capability | New owner | Check / note |
|---|---|---|
| Full character, imperfection, loyalty, values, independence and romantic nuance | `v3/realization.js` canonical profile; cognitive graph for action tendencies | `cognitive-v3-functional-parity.test.js` canonical profile test |
| Voice/style principles, dialogue examples, rare emoji and no mirroring | Luna's speech contract informed by observed emoji rhythm | Emoji observation test. No hard post-generation emoji scrub; quality requires live observation |
| Vocative economy: proper name, pet name repetition and recent use | `turn-observations.js` snapshot → speech contract | Vocative test |
| Semantic frame: aligned, misunderstood, repair, uncertain | `turn-observations.js` → `TurnPlan` / trace | Frame tests |
| Explicit selected reply's referent | Existing `kernelState.replyTarget` → Luna prompt, plus visual quote only when needed | Reply target test |
| Semantic scene motifs (15 former codes) | `turn-plan.js` internal semantic selection | Motif catalogue, classification, repetition tests |
| Avoid looping the same playful metaphor | Motif novelty observation → TurnPlan beat choice + voice guidance | Repetition test |
| Everyday-life continuity: reading, weather, work, past outings, plans | `v3/life-continuity.js` | False music cue test, existing reading/walk tests |
| Mixed/secondary emotions and emotional momentum | Observed emotional state + expanded realization payload | Prompt emotional context; cognitive graph remains owner of behavioral tendencies |
| Drowsiness, sleep, interrupted sleep, energy, need for quiet | `innerLife` factual transport → graph → TurnPlan depth/contact → Luna context | Sleep test |
| True weekends / rare exceptional weekend work | `daily_rhythm.js` factual state → realization context; no artificial weekend work prompts | Weekend test |
| Persistent achievement vs maintenance intent and state transitions | Graph → `TurnPlan` → existing deterministic `buildDecisionStateTransition` reducer | Existing cognitive and persistence tests |
| Follow-up attention grounded in specific user detail | `kernelState.reciprocity` observation → TurnPlan question permission and anchor → Luna | Reciprocal-question test |
| Explicit agreements and seven post-establishment actions | `turn-plan.js` evidence → `TurnPlan.commitment` → existing commitment reducer | Establish, honor, renegotiate, compromise, insist, release, fulfill and evidenced break; an unsupported allegation is not a verified breach. Tests |
| User future commitments and potential natural callbacks | `kernelState.openLoops` → `TurnPlan.callback` and grounded verbal context | Callback tests. No mechanical reminder quota |
| Private associative symbols (none/subtle/explicit/evolve), including direct recall | Associative graph → `TurnPlan` → Luna | Direct recall / repetition tests |
| Emotional gestures / exact sticker assets / sticker-only | Graph + existing resource availability → `TurnPlan.delivery` → catalog selector | Sticker-only and semantic-history tests |
| Chat rhythm (single vs intentional split), response-depth budget | Graph, recent message rhythm → one `TurnPlan` | Existing TurnPlan / delivery tests |
| True scene ending and eventual silence | Read-only `sceneClosure` → `TurnPlan`; safeguard for direct questions/distress | Rest-farewell test; existing silence tests |
| Weather, time, public world facts, canon and proof of past events | Existing reality/epistemic boundary and factual validators | Existing weather, life guard and API tests |
| Long-term cognition, associative plasticity, deduped state commit | Existing v3 cognition state reducer / client storage | Existing persistence and idempotency tests |
| Presence, message grouping, quote UI, read receipts, human delivery timing | Existing client + delivery planner | No ownership change; previous contract tests retained |
| Transport diagnostics (`Load failed`) | Existing `http_client.js` | Network root cause needs Safari and platform logs, not a cognitive rule |

### Runtime exclusivity

- `api/chat.js` does **not** run `buildRinMindPrompt`, `buildBehaviorState`, `buildDriveState`, `stabilizeTurn` or former personality directors.
- Observational helpers may be used for *perception*, not to decide text/contact/intent/delivery. The single decision owner is `buildCognitiveTurnPlan`.
- Existing commitment and memory reducers perform deterministic persistence, not a second psychological policy pass.
- `Luna` produces text segments only; the JSON schema excludes action decisions.
- A sticker-only decision skips the Luna call.

### Validation and remaining uncertainty

`npm run check:node` (syntax + JSON + unit/contract/regression + build smoke) **475/475 PASS** locally. Dedicated migration tests: **25/25 PASS**. This is source/contract coverage, **not** proof of human-level naturalness or parity of every stochastic Luna output. Browser E2E and deployed live behavior must be rechecked separately. Existing diary/cognitive-state records are retained; no reset required.

### Release condition for future architecture changes

Keep this audit as a regression inventory. A replacement of an old capability is complete only when: (1) old action authority is disconnected, (2) an explicit owner in v3 receives all required facts, (3) the user-facing action and state persistence are tested, and (4) a realistic multi-turn scenario is observed. A passing old baseline test alone does not establish parity.
