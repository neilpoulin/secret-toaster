# Secret Toaster Legacy Parity Spec (v0)

This document captures canonical gameplay behavior extracted from the legacy Java implementation in `SecretToaster_legacy`.

Primary source files:
- `SecretToaster_legacy/Secret Toaster/src/game/Board.java`
- `SecretToaster_legacy/Secret Toaster/src/game/Game.java`
- `SecretToaster_legacy/Secret Toaster/src/game/Battle.java`
- `SecretToaster_legacy/Secret Toaster/src/game/Hex.java`
- `SecretToaster_legacy/Secret Toaster/src/game/Player.java`

## Governance

- If docs and code conflict, legacy Java code wins unless an explicit decision record overrides it.
- Domain tests in `packages/domain/test` are the executable source-of-truth for parity assertions.
- Unknown or ambiguous behavior is called out as `Open Question`.

## Board Topology

- Grid dimensions: `10 x 11` (110 hexes total).
- Keep hex IDs: `23, 26, 52, 58, 83, 86`.
- Castle hex ID: `55`.
- Default hex type starts as `BLANK`.
- All neighbor hexes adjacent to any `KEEP` or `CASTLE` are forced to `LAND`.
- Additional forced `LAND` hexes: `35, 46, 75, 63, 43, 66`.
- Neighbor model: six-direction adjacency with odd/even row offset behavior.

Implementation note: parity code uses the same neighbor ordering as legacy Java.

## Player Start State

When a player joins the board:
- Player receives one knight at a random free keep.
- Keep is owned by the player.
- Neighboring hexes of that keep are also assigned to player ownership.
- Starting troops:
  - keep receives `player.unassignedTroops` (legacy default 100)
  - neighboring claimed hexes get 0 troops for that player.

## Order System

- Players can hold up to 3 numbered orders per round (1..3).
- Adding an order with an existing order number overwrites that order.
- Overwriting order `n` removes orders after `n`.
- Order projection updates knight projected positions from that order onward.

Order execution semantics in `Game.issueNextOrder()`:
- Random player selected each step.
- If selected player has no orders, step recurses by finishing logic.
- Otherwise first order in player queue executes.
- Supported types observed: `move`, `fortify`, `promote`.

Executable validation baseline now implemented in `packages/domain/src/order-validation.ts`:
- order number must be `1..3`
- order owner and knight must match
- knight must be alive
- `from` must match projected knight position for that order number
- `move`/`attack` destination must be neighboring hex and troops must be positive and available
- `fortify` and `promote` currently require `to === from`
- `promote` requires at least `100` troops on source hex
- `attack` currently requires destination owner to be enemy

## Round Lifecycle

- Round starts at `0`.
- `setReady(player, true)` marks player ready.
- If every player is ready, round resolves.
- Resolution continues issuing orders until no players have orders.
- Then:
  - round increments by 1
  - all players set `ready = false`
  - each knight projected positions reset to current location.

## Economy / Unit Constants

- Fortify value: `200` (`Game.fortifyValue_`).
- Troops required to raise knight: `100` (`Hex.troopsToKnight`).
- Promote behavior deducts `troopsToKnight` from hex if enough troops exist.

## Battle Resolution

Battle flow in `Battle.fight()`:
- While both attacker and defender have troops on target hex:
  - each side rolls d6 (`1..6`)
  - add alliance bonus to each roll
  - loser loses 1 troop on that hex
- Tie behavior: defender wins ties (`defenderRoll >= attackerRoll` means attacker loses).
- Alliance bonus formula: number of members in player's alliance.
- Winner becomes hex owner.
- All losing-side knights on that hex are removed and marked dead.

Executable baseline implementation now exists in:
- `packages/domain/src/battle-resolver.ts`
- `packages/domain/test/battle-resolver.spec.ts`

## Messaging / Alliances (Observed)

- Message visibility depends on message type:
  - `GLOBAL`: visible to all
  - `ALLIANCE`: visible only to members of sender alliance
  - direct/player message: visible to included players
- Alliance operations include create/join/rename.

## Open Questions

- Victory condition checks are not yet fully extracted into executable parity fixtures.
- Legacy has trust-based request parameters; modern rewrite will preserve gameplay semantics but replace auth model.
- Exact constraints on move legality beyond neighbor selection and UI behavior need deeper extraction from JS + servlet interactions.
- Whether `fortify` and `promote` should strictly require `to === from` server-side (legacy servlet accepted any payload; UI implied same-hex behavior).

## Next Steps

1. Encode this spec into domain fixtures and tests (`SEC-9`, `SEC-10`, `SEC-11`, `SEC-12`).
2. Expand parity vectors for full command-validation edge cases.
3. Add explicit decision records when intentionally diverging from legacy behavior.
