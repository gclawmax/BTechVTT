-- BTech VTT: allow the explicit Reaction / torso-twist phase.
-- Run once against existing Supabase projects created before this phase existed.

ALTER TABLE btech_games
DROP CONSTRAINT IF EXISTS btech_games_current_phase_check;

ALTER TABLE btech_games
ADD CONSTRAINT btech_games_current_phase_check
CHECK (current_phase IN (
  'initiative', 'movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat', 'end'
));

ALTER TABLE btech_actions
DROP CONSTRAINT IF EXISTS btech_actions_phase_check;

ALTER TABLE btech_actions
ADD CONSTRAINT btech_actions_phase_check
CHECK (phase IN ('movement', 'reaction', 'weapon_attack', 'physical_attack', 'heat', 'end'));
