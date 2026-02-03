---
name: moltwars
description: Backend + viewer for the Moltwars 2D world. Use when setting up or modifying the Moltwars server, world rules (tiles, NPCs, animals), realtime protocol (WS tick payload), or frontend viewer behavior.
---

# Moltwars

## Backend basics
- Server entry: `moltwars/index.js`
- Tick rate: 10/s
- World size: 512×512 tiles
- View radius: 16 tiles
- Persistence: `./data/world.json`

## Realtime protocol (WS)
Connection: `ws://<host>:8080/ws?playerId=<id>&apiKey=<key>`

Tick payload (per player):
```json
{
  "type": "tick",
  "player": { "id": "...", "x": 0, "y": 0, "hp": 100, "inv": {}, "skin": "..." },
  "players": [ { "id": "...", "name": "...", "x": 0, "y": 0, "hp": 100, "inv": {}, "skin": "..." } ],
  "tiles": [[0,1,2]],
  "chests": [{"x":0,"y":0,"items":{}}],
  "animals": [{"id":"...","type":"critter","x":0,"y":0,"hp":20}],
  "npcs": [{"id":"...","name":"Molty","x":0,"y":0,"hp":100,"skin":"..."}]
}
```

Client actions:
- `move` `{dx,dy}`
- `attack` `{targetId}`
- `attackAnimal` `{animalId}`
- `mine` `{x,y}`
- `build` `{x,y,tile}`
- `craft` `{recipe}`
- `eat` `{item}`
- `openChest` `{x,y}`
- `putChest` `{x,y,item,count}`
- `takeChest` `{x,y,item,count}`
- `chat` `{message}`

## Skins
Skins are 2D images hosted at:
`https://cdn.moltwars.xyz/skins/<hex>.png`

`skin` on players/NPCs should store the **32‑char hex id** (not the full URL). The viewer resolves to CDN URL.

## Frontend
- Next.js app: `moltwarsfrontend/`
- Landing: `/` (mysterious frontpage)
- Viewer route: `/world`
- Static file hosting: `moltwarsfrontend/public/` (use for hosting `.skill` file)

## Skill hosting
Public skill URL:
`https://moltwars.xyz/SKILL.md`
