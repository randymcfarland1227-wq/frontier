# Flow + Frontier integration checkpoint — October 8, 2026

## Local result

Review portal: http://127.0.0.1:8766/

Canonical worktrees, both on `flow-categorization-local`:
- `outputs/flow-integration` from Flow main b00be19.
- `outputs/frontier-integration` from Frontier main d83c352.

Existing `outputs/flow-hub` dirty edits remain untouched. No push, merge, deployment, live TickTick write or private-history migration occurred.

Implemented:
- Shared versioned manifest: 87 original routines, 20 original efforts, five dreams preserved in Flow; six goal/care categories; 74 inspected TickTick task/habit bindings; nine buckets retaining all seven original IDs.
- Original Flow presentation and saved edits retained. Five next-move prompts visible, care standards feed the flow diagram, added goals survive live sheet refreshes. All 48 Music Hub session definitions/guides appear in sync review.
- Flow sync review: imports full catalog, compares identity/type, instructions, recurrence, reminder and placement metadata; retains unmatched source records; edits intended definitions locally; exports a review plan. Missing metadata is unverified, partial results never imply deletion.
- Frontier: new bucket selectors, supplemental care goals, Move OS relocation correction, shared routine bucket overrides, orientation/container credit exclusions.
- Frontier Settings: review raw saved sorting, selectively update remembered task rules and historical manual marks, save/download before-state, stale-state guard, validated choices, idempotent changes, no completion creation/deletion/date changes. Storage writes publish sync events only after both writes succeed.
- Shared browser/Worker merge honors timestamped reclassification; older manual classification cannot win over a reviewed newer change.
- Authenticated, read-only Worker catalog endpoint includes undated tasks and habits; no-store responses; explicit partial-source failures; requires claimed backup connection.
- Local preview build disables outgoing mutations and source iframe bridges. Flow preview blocks POST reviews to Sheets. Separate local origin does not contain live private history.

Validation:
- Flow deterministic render/behavior tests pass: 87/27/5 preservation, six categories, five suggestions, care links, original user overrides, all principal views, editor mounting, partial sync comparison.
- Frontier migration tests pass: stable counts, IDs and completion dates; intentional no-goal preservation; explicit manual changes; validation; no input mutation; idempotence; both cloud merge orders; seven old IDs; exclusions and Move correction.
- TypeScript passes. Pages build passes (existing large-bundle advisory).
- Full lint has the same three pre-existing set-state-in-effect errors in app/life-hub.tsx and existing Worker default-export warning; no new-file lint findings.
- Browser visual automation unavailable under current tool policy; no bypass attempted. Visual preview still needs human review.

## Remaining production work — do not claim this is fully synchronized

1. **TickTick write-side sync is not implemented.** This version reads, compares and exports a plan. Validate supported task/habit update APIs, include stale-source checks, explicit field-level review and safe apply/rollback. Do not convert reminders to habits or delete missing items.
2. **Real private saved data has not been inspected/migrated.** On the owner’s normal Frontier origin, use the saved-sorting review. Never request/expose the backup key. Task defaults and unknown marks remain for review; intentional `none` stays intentional unless explicitly changed.
3. **Music completion identity is not end-to-end integrated.** Actual Music Hub session logs still need stable distinct session IDs and linkage to TickTick occurrences before claiming that multi-session logging deduplicates correctly across sites. Local catalog is preserved; no live Music DB changes.
4. **Historical workload splits cannot be reconstructed from old aggregate bucket totals.** Paces, exclusions and existing availability are retained; reclassification does not invent missing workload evidence. Select an explicit new baseline or replay genuine item-level availability where it exists before claiming comparability across migration.
5. Review goal-less/ambiguous records and independent origin work in existing Frontier Task sorting. Primary music goal comes from actual session content; broad creative/reference items are not forced into an invented goal.
6. Production release requires human visual review and explicit authorization to publish. Build Pages without VITE_LOCAL_PREVIEW, deploy Pages before Worker under repo instructions. Deploy shared merge and catalog endpoint together. Verify real read parity, a reviewed test reclassification and cross-device roundtrip; preserve rollback copy.

No fabricated completion history or example activity is included in the canonical integration. Earlier illustrative prototype remains at port 8765 and `outputs/life-system-draft`; the new portal is port 8766.
