# Targeting Computers and electronic warfare

`SQL/90_targeting_computers_and_c3_networks.sql` extends the maintained
simultaneous Weapon Attack resolver. The client preview and the server use the
same range and modifier decisions.

## Targeting Computers

- An operational Targeting Computer gives eligible direct-fire energy and
  ballistic weapons a -1 to-hit modifier.
- The player may replace that modifier with a +3 aimed-shot modifier for one
  selected non-head location. After a successful weapon attack, a separate 2D6
  location roll of 6–8 strikes the chosen location; otherwise the normal hit
  table is rolled.
- Missile weapons, TAG, Narc and AMS do not receive the modifier. Pulse weapons,
  rapid-fire attacks and LB-X cluster fire cannot make aimed shots. LB-X
  cluster fire receives no Targeting Computer modifier.
- A critical hit to any occupied Targeting Computer slot disables the system.

## C3 and C3i

- A direct-fire attacker uses the closest connected network member with line
  of sight to determine the range bracket.
- The firing unit still supplies line of sight, firing arc, terrain modifiers,
  physical maximum range and physical minimum-range penalties.
- Standard skirmishes automatically connect compatible equipment on the same
  force, up to 12 standard C3 units or 6 C3i units. Standard C3 requires an
  operational master; C3i does not.
- A critical hit that disables the relevant equipment removes that unit from
  the network.

## ECM and probes

- Hostile ECM affects its own hex and every hex within six hexes. A C3 link is
  interrupted when an endpoint or the traced connection crosses that field.
- The same traced-field test suppresses Artemis IV and Narc guidance.
- Ordinary ECM does not disable a Targeting Computer or TAG.
- Active Probes report their operational or ECM-affected status. Their normal
  hidden-unit detection has no effect until hidden units are implemented.
- ECCM switching is outside the current Total Warfare rules scope and is not
  simulated by this migration.
