# spatial-AI

**Neighborhood** is a single-page three.js app that visualizes a neighborhood
semantic model. The model has streets, zoned lots, houses, shops, parks, trees,
and residents who walk the streets between home and work.

- `MODEL.md`: the entities, attributes, rules and actions
- `js/model.js`: the model and rule checks (no rendering)
- `js/main.js`: three.js scene, picking, toolbar and inspector
- `css/style.css`: UI styling

## Run

ES modules need to be served over HTTP, so opening the file directly won't work:

```sh
npx http-server .   # or: python3 -m http.server
```

Then open `http://localhost:8080` (or port 8000 for Python). three.js loads from the jsDelivr CDN.

## Use

- Toolbar (keys `1`–`8`): Select, Street, House, Shop, Park, Tree, Rezone, Demolish
- Hovering a cell shows whether the current tool is allowed there (green or red marker), and the status bar names the rule that blocks it.
- Select a building to add or remove floors, add residents or move them out, or plant trees.
- `Ctrl+Z` undoes; **Reset** reloads the example. Drag to orbit, scroll to zoom, right-drag to pan.
