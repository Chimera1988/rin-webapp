# Rin 3.0.0 validation record

- Baseline: reconstruct 2.4.12.2 from supplied project files, then apply the v2.5.0 overlay. The baseline passed 397/397 Node tests.
- Complete Rin 3.0.0 Node suite: **430/430 passed** (`npm run check:node`).
- Syntax validation: 136 JavaScript files. JSON validation: 9 files. Build smoke: passed.
- Cognitive regression groups: graph stability, bounded activations, mixed affect, empathy, jealousy-trust moderation, physiology, relationship continuity, scene closure, question obligation, voice-only schema, associative retrieval, bounded plasticity, memory integrity, durability and duplicate-request handling.
- API integration: one model call for text, zero for deliberate silence, strict v3 voice schema, cached developer prefix, transport compatibility, reality validation, intent and commitment persistence, explicit-feedback learning.
- Browser end-to-end: **not passed / unavailable**. Chromium enterprise URLBlocklist blocked navigation in the test environment. Run on the deployed device to confirm UI, cache and delivery behaviour.

Node tests verify code and contracts, not the naturalness of live Luna responses; live behavioural acceptance remains necessary.
