# Weathered advanced terrain

`weathered-frontier` exercises the additional BattleMech terrain supported by
the client and `SQL/87_weathered_advanced_terrain.sql`.

| Terrain | Extra MP | Authoritative effect |
| --- | ---: | --- |
| Ice | +1 | Ground entry requires a Piloting Skill Roll. |
| Deep snow | +1 | Slows BattleMech ground movement. |
| Mud | +1 | Slows BattleMech ground movement. |
| Sand | 0 | No additional BattleMech MP cost. |
| Swamp | +1 | Ground entry requires a Piloting Skill Roll. |
| Bridge | 0 | Stable level crossing over printed water. |
| Magma crust | 0 | Adds 2 heat in transit and 5 heat when occupied after Movement. A 1D6 crust check breaches on 6 during ground movement or 4+ on a jump landing; a breach damages both legs and leaves liquid magma. |
| Liquid magma | — | Impassable in the supported BattleMech movement and displacement slice. |

Jumping ignores intervening terrain costs. It must still use a legal landing
hex, and magma crust makes its own landing check.
