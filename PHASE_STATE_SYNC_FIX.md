# Phase state sync fix

The previous phase transition wrote `active_player_id: null` before writing the
actual first player. Realtime could publish that intermediate state and clobber
the local active player, leaving Movement with no active player.

The transition now writes `current_phase` and the correct first active player in
one update. Movement/Reaction resets no longer perform a competing state write
during that transition.

Also fixed an AI difficulty variable shadowing bug in `js/ai/opponent.js`.
