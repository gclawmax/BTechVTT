# AI Player Database Model

The AI opponent is a game participant, not a Supabase Auth user.

Required `btech_players` fields:

- `user_id`: nullable UUID; NULL for AI players.
- `is_ai`: boolean; `true` for AI players, `false` for human players.

The VTT no longer uses a fake UUID such as `__ai_opponent__`.

## Supabase setup

Run the project's two supplied SQL migrations in their intended order before testing **Play vs AI**.
The JavaScript assumes the resulting schema exposes `is_ai` and permits `user_id` to be NULL for AI seats.

## Expected records

Human:
```text
user_id = <real auth UUID>
is_ai   = false
```

AI:
```text
user_id = NULL
is_ai   = true
```

This keeps authentication identity separate from game-agent identity.
