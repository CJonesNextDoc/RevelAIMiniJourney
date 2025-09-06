Example workflows and trigger payloads for manual testing and demos.

- `examples/journeys/example_journey.json` — a sample journey with MESSAGE, DELAY, and CONDITION nodes (HOOS/KOOS demo).
- `examples/triggers/example_trigger_hip.json` — example trigger payload that sets `context.condition = "hip_replacement"`.
- `examples/triggers/example_trigger_knee.json` — example trigger payload that sets `context.condition = "knee_replacement"`.

Usage
- To load a journey manually:
  - `const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'examples/journeys/example_journey.json'), 'utf8'))`
- To POST a trigger to the running server (once app is running):
  - `curl -X POST -H "Content-Type: application/json" --data @examples/triggers/example_trigger_hip.json http://localhost:3000/journeys/<journeyId>/trigger`

These files are intended for developer testing and documentation; commit them to git.
