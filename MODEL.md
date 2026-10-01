# Neighborhood — semantic model

The app in `index.html` visualizes this model. The model logic lives in
`js/model.js` and does not depend on the renderer; `js/main.js` draws it with
three.js and wires up the toolbar.

## Entities

| Entity | Attributes | Notes |
| --- | --- | --- |
| **Neighborhood** | `name`, `size` (grid is `size × size` cells) | Root. Owns every cell, structure and resident. |
| **Cell** | `x`, `z`, `kind` (`lot` \| `street`), `zone` | One square of the grid. |
| **Street** | a cell with `kind = street` | Connected street cells make the road network. |
| **Lot** | a cell with `kind = lot`, `zone` (`residential` \| `commercial` \| `green`), `structureId` | A parcel. Holds at most one structure. |
| **House** | `id`, `x`, `z`, `floors` (1–3), `color` | Residential building. |
| **Shop** | `id`, `x`, `z`, `floors` (1–3), `color`, `kind` (café, grocer, …) | Commercial building that provides jobs. |
| **Park** | `id`, `x`, `z`, `trees` (0–4) | Green space. |
| **Tree** | slot inside a park | Counted by `Park.trees`. |
| **Resident** | `id`, `name`, `color`, `homeId` → House, `workId` → Shop or none | Walks the streets between home and work. |

## Rules

1. **One structure per lot.** A structure can only go on an empty lot. Streets cannot hold structures.
2. **Zoning.** Houses need a `residential` lot, shops a `commercial` lot and parks a `green` lot.
3. **Street access.** A structure's lot must touch a street on one of its four sides.
4. **Access is protected.** You can't remove a street cell if that would leave a neighboring structure with no street access.
5. **Rezoning** only works on an empty lot. It cycles through residential → commercial → green.
6. **Floors.** Houses and shops have 1–3 floors.
7. **Housing capacity.** A house holds `2 × floors` residents. You can't remove a floor if that would push residents out.
8. **Every resident has a home.** When a house is demolished, its residents move into the nearest house with room. If no house has room, they leave the neighborhood.
9. **Jobs.** A shop offers `3 × floors` jobs.
10. **Commuting.** A resident can only work at a shop that the street network connects to their home. Unemployed residents take the nearest reachable job with an opening. When a route breaks or a shop closes or shrinks, the affected workers lose those jobs and look for new ones.
11. **Trees** can only be planted in a park, at most 4 per park.

## Actions (toolbar)

| Tool | Action | Rules checked |
| --- | --- | --- |
| Select | Inspect a cell. The inspector can add or remove floors, add residents or move them out, and plant trees. | 6, 7, 11 |
| Street | Turn an empty lot into a street | 1 |
| House / Shop / Park | Build on a lot | 1, 2, 3 |
| Tree | Plant a tree in a park | 11 |
| Rezone | Cycle the zone of an empty lot | 5 |
| Demolish | Remove a structure, or a street cell | 4, 8, 10 |
| Undo / Reset | Restore the previous state, or reload the example neighborhood | — |

Every action is checked before it runs. The hover marker turns red when an
action isn't allowed, and the status bar says which rule blocks it.
