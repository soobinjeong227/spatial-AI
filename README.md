# spatial-AI

**Neighborhood** is a single-page three.js app (vanilla JS) that visualizes the
**HUMAN / STREET / STREET_FURNITURE** semantic model. Two crossing streets have
sidewalks, crosswalks, traffic signals, cars and street furniture. Autonomous
humans walk between destinations and MOVE, TURN, STOP, AVOID and REROUTE
according to the model's rules.

- `MODEL.md`: how each entity, attribute, relationship, rule and action maps to the app
- `js/world.js`: simulation (navigation grid, A* routing, agents, traffic)
- `js/main.js`: three.js rendering, picking, toolbar and inspector
- `css/style.css`: UI styling

## Run

```sh
npx http-server .   # or: python3 -m http.server
```

Open the printed URL. ES modules need HTTP, so `file://` won't work. three.js loads from the jsDelivr CDN.

## Use

- **Human actions** (on the selected human): MOVE `M`, TURN ⟲ `Q`, TURN ⟳ `E`, STOP `S`, AVOID `A`, REROUTE `R`. A manual action switches that human's autopilot off; turn it back on in the inspector.
- **Tools:**
  - Select `1`: click a human, furniture or street to inspect and edit it.
  - Set goal `2`
  - Place furniture `3`: pick the type from the dropdown; it can only go on a sidewalk.
  - Add human `4`
- **Street inspector:** width, surface_condition, traffic_direction, crosswalk_presence
- **Furniture inspector:** type, size, obstacle_status
- **View:** Traversable overlay `O`, Routes `P`, Pause `Space`, Reset
- Drag to orbit, scroll to zoom, right-drag to pan.
