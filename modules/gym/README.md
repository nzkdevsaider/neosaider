# Gym

Example Neosaider module for keeping a workout log. Neo uses it when you tell it you have trained or ask what you have done lately.

## Tools

Neo sees these tools prefixed with the module id (`gym_log_workout`, `gym_list_workouts`).

| Tool            | What it does                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log_workout`   | Records a workout: `activity` (for example running, squats, yoga), `minutes` (positive integer) and optional `notes`. Returns the stored workout. |
| `list_workouts` | Lists workouts from the last `days` days (default 7), newest first.                                                                               |

Both tools answer with JSON text: `{ id, activity, minutes, notes, loggedAt }` per workout.

## Configuration

None. The module takes no configuration at install time.

## Data

Workouts are stored in `gym.db`, a SQLite database (WAL mode) inside the module's data directory (`/data` in the container, the `neosaider-module-gym` volume). Updating the module keeps the volume; uninstalling it deletes the volume and the whole history unless you ask to keep the data.

## Permissions

Isolated network: only the harness can talk to it and it makes no outbound connections.

## Development

| File                                               | Content                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`neosaider.module.json`](./neosaider.module.json) | Manifest: id `gym`, image `neosaider/module-gym:0.1.0`, port `8080`, data `/data`.   |
| [`src/gym.ts`](./src/gym.ts)                       | `openGymDatabase`, `registerGymTools` and the `gymModule` definition.                |
| [`src/server.ts`](./src/server.ts)                 | Entry point: `startModule(gymModule)`.                                               |
| [`src/gym.test.ts`](./src/gym.test.ts)             | Logs and lists a workout through `MCPAdapter`, and checks `/manifest` and `/readme`. |

```sh
pnpm --filter @neosaider/module-gym build
pnpm --filter @neosaider/module-gym test
NEOSAIDER_DATA_DIR=./data PORT=3102 pnpm --filter @neosaider/module-gym start
docker compose --profile modules build module-gym
```

`pnpm --filter @neosaider/core test:docker` installs this module in real Docker and removes it. The guide to building modules is in [Creating a module](../../packages/module-sdk/docs/CREATING-A-MODULE.md).
