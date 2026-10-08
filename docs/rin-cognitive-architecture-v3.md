# Rin 3.0.0 — Cognitive Dynamics Architecture

## Architectural change

Rin 3.0 replaces the **production** v2 policy-prompt / Luna decision / turn-stabilizer sequence. The old Rin Mind v2 code is retained in the repository for historical tests, but `api/chat.js` does not import or invoke it as a behavioral decision owner.

### Production flow

```
Authenticated client
  └── current diary + daily rhythm + canon-grounded environment
        └── /api/chat
              ├── Perception: conversation-brain; continuity; current referents
              ├── Observations: affective emotion, context, sleep, relationship,
              │                active intent, commitments, callback events
              ├── Integrity: canonical lore, reality boundary, sticker assets
              ├── Associative activation: concept cues ↔ personal symbols
              ├── Cognitive dynamics: persistent learned weights + simultaneous
              │       propagation, excitation, inhibition, decay/settling
              ├── Behavioral state: graded tendencies, not prose directives
              ├── **ONE TurnPlan**: response/silence, depth, question,
              │       interpersonal stance, intent, explicit commitments,
              │       gesture and symbol decisions
              ├── Luna: **ONLY** text realization with fixed JSON schema
              ├── Conformance: text safety, explicit question, schema,
              │       reality and forbidden speech-act checks
              ├── Delivery: existing delivery plan and sticker resolver
              └── State transition: discrete commitments, callbacks,
                      emotional snapshot + cognitive plasticity
        └── client atomic commit: state + cognitive weights + inner life
              └── messenger scheduler, online/read receipts, voice/UI
```

A single LLM call is used when response text is required. **True silence makes no model call.** Model content cannot submit an alternate `TurnDecision`, new intent transition, or new sticker. The server ignores any action/intent fields in a model response: the structured output only accepts text segments.

## Separate causal roles

| Component | Input | Authority |
|---|---|---|
| World/daily rhythm | Real time, validated weather, routine and sleep | Factual observations only |
| Perception | Text, references, recent dialog | Semantic signals only |
| Affective classification | Context and previous emotion | Emotion observations, with v2 direct mood/relationship modifications suppressed for the graph path |
| Canon/reality boundary | Server canonical files, known facts | Hard truth constraints |
| Associative memory | Personal symbols, scene, emotion, stored association weights | Memory activation only |
| Cognitive graph | Observations, stable values and learned links | Tendencies only |
| TurnPlan | Tendencies, explicit obligations and resource constraints | **Only final behavioral decision owner** |
| Luna | Personality, dialog, TurnPlan, facts | Word choice and text content only |
| Validator | Generated text + immutable plan | Reject/fallback, never redesign the act |
| Experience reducer | New observable feedback, prior persisted state | Bounded learning; no mood fabricated from model text |
| Existing delivery | Server delivery plan | Timing, presentation, exact sticker assets |

The old `drive-state`, `behavior-state`, `relational-constancy`, and other v2 domain modules may still calculate **input observations**. They are *not* used as post-graph policy owners and their natural-language guidance is not included in the v3 voice prompt.

## Recurrent cognitive network

- `lib/cognition/v3/cognitive-dynamics.js`: declared nodes/weighted edges, causal factors (sleep, attachment, jealousy, trust, autonomy, values, goal drive), synchronous repeated propagation until convergence/budget.
- All nodes are bounded to `[0,1]`. Observed inputs are strongly anchored to external evidence, while action tendencies are influenced by multiple paths.
- Contextual moderation: `trust` inhibits the `jealousy → withdraw` connection without erasing jealousy. Strong attachment can coexist with anger, fatigue and an honest need for quiet.
- Stable self-concept (`honesty`, `loyalty`, `respect`, `autonomy`, `selfRespect`) is not learnable through ad hoc chat feedback.
- The weights are **designed simulation parameters**, not a learned biological brain model or a claim of sentience.

## Memory and plasticity

`public/lib/cognitive-state-contract.js` is shared server/client. Persistent cognitive schema: `rin-cognitive-state-v3`. Diary schema advances from **9 to 10** without erasing conversations, facts, relationship history, shared moments, or existing messages. Stored structure includes:

```
{
  schema: "rin-cognitive-state-v3",
  revision,
  traits,
  learnedWeights,
  associativeWeights,
  history,
  lastTurn
}
```

Only allow-listed links learn; all plasticity increments are small and clamp to `[-.16,+.16]`. Symbol association deltas clamp to `[-.12,+.12]`. Explicit user feedback only is eligible for updates, and is attributed to the previous Rin turn through its `turnId`. No future, unobserved emotional reward is invented. Duplicate request IDs cannot apply the same reducer twice. Unexpected/malformed persisted data is normalized and cannot rewrite traits.

Associative retrieval activates private symbols through both direct mentions and neighbouring emotional/context concepts. Repetition pressure prevents compulsive reuse. Actual symbol expression is controlled by the TurnPlan, not by mentioning a keyword.

## Intent and commitment lifecycle

Current persistent intents and future callbacks remain in the existing discrete state-transition system. A scene-ending silence does not cancel relationship contact or an active maintenance intent. An explicit farewell can close a live scene intent. Newly negotiated *explicit* agreements can be established as structured scene commitments by the TurnPlan. The reducer remains the sole persistence writer.

The model may not manufacture an unplanned formal promise. The voice prompt forbids it and the server checks obvious unauthorized promise speech acts; this validation is a guard, not proof of complete natural-language semantic compliance.

## Delivery and timing

The v2.5 work on message management, read receipts, human timing, sleep continuity, weather grounding and error diagnostics is retained. Response latency still includes transport and optional messenger read/composition simulation. Server-side cognitive dynamics is deterministic and incurs no additional paid model request.

## Debug trace

API `cognition.cognitiveDynamics` exposes graph convergence, selected state indicators, full behavioral tendency map, strongest causal links, activated associations, selected TurnPlan, and plasticity changes. Client debug includes a compact `cognitive v3:` record after state commit. This trace is a **mechanistic explanation of the implemented simulation**, not an assertion that the model had conscious thoughts.

## Tests and scope

`npm run check:node` runs syntax, JSON, Node regression tests and build smoke. `npm run e2e:browser` is separate and cannot be claimed passing when Chromium policy blocks navigation. New tests cover conflicting sleep/affection, distress/closure, jealousy/trust, explicit question/silence, long-form requests, persistent intent, negotiated commitment, personal associations, prompt/plan separation, reality guard, migration, duplicate commits and observable feedback plasticity.

### Limitations

- Link coefficients are handcrafted and require calibration with real dialogues; tests establish architectural consistency, not human psychological validity.
- Natural language generation may still make stylistic or subtle semantic errors. No static validator can prove perfect fidelity to a TurnPlan's *meaning*.
- Explicit agreement detection is intentionally conservative; not every conversational promise is automatically promoted to persistent obligation.
- Browser E2E/live sessions are required to confirm device-specific delivery, build-cache and interaction behaviour after deployment.
