# ☢️ Rise of Nukes

A small, browser-based tribute to *Rise of Nations*. Gather resources, advance through 5 ages, grow your borders with new cities, build an army, capture your friends' cities, and when diplomacy fails, nuke them.

It runs entirely in the browser. You don't need a server: host it free on GitHub Pages, and players connect to each other directly (peer-to-peer).

## Play

1. Open the game page.
2. One person clicks **Host game** and shares the 5-letter room code, or the invite link.
3. Everyone else types the code and clicks **Join game**.
4. In the lobby, pick a nation, colour and team. Same team = allies. The host picks the settings and clicks **Start game**.

**Practice alone** starts a game with just you. Use it to learn the controls or try things out. Set *Start age: Atomic* and *Start resources: Insane* to go straight to the nukes.

### Basics

| | |
|---|---|
| **Gather** | Citizens build farms (near a city), woodcutter's camps (next to forest), mines (on grey metal rocks) and, from the Industrial Age, oil wells (on black oil pools). Right-click a building with citizens to work there. 5 workers per building. |
| **Ages** | Ancient → Classical → Gunpowder → Industrial → Atomic. Advance at a city. Units upgrade automatically: spearmen become riflemen, horsemen become tanks, catapults become rocket artillery. |
| **Tech** | The Library researches better gathering, Civics (more population and cities), attack and armour upgrades, and the Manhattan Project. |
| **Territory** | Cities claim land. You can only build inside your borders. Enemy territory slowly damages your units. More cities = more land. City limit goes up with each age. |
| **Army** | Infantry beats cavalry, ranged beats infantry, cavalry beats ranged and siege, siege wrecks buildings. Towers and cities shoot back. |
| **Conquest** | Bring a city to 0 HP with soldiers nearby to capture it. Lose all your cities and you're out. Last team standing wins. |
| **Nukes** | Atomic Age → research **Manhattan Project** at a Library → build a **Missile Silo** → build a nuke → **Launch** and click a target anywhere. Everyone gets a warning and a countdown. Missile Defense gives a 50% chance to shoot down nukes aimed at your land. |
| **Doomsday Clock** | Every nuke moves the clock. When it reaches the limit set in the lobby, everybody loses. |
| **Veterans** | Units that get kills earn ranks (★ at 3 kills, ★★ at 7, ★★★ at 15). Each rank gives +15% attack and HP. |
| **Day and night** | A full day lasts 6 minutes. At night, windows light up. You can turn this off in the settings. |

### Nations

Like in *Rise of Nations*, everyone plays the same game, but each nation has a few special things. Pick one in the lobby, or pick **Random**. Two players can pick the same nation.

| | 🇩🇪 Germany | 🇹🇼 Taiwan | 🇵🇭 Philippines | 🇵🇰 Pakistan |
|---|---|---|---|---|
| **National power** | Buildings +30% health. Units train 20% faster. | Library techs cost 25% less and finish 30% faster. Cities make twice the free food and wood. | Citizens build 50% faster. +10 population per city. Cows give double food. | Farms make 20% more food. Half damage in enemy territory. |
| **Unique units** | Landsknecht (Gunpowder infantry): melee, giant sword, hits everyone nearby. Leopard tanks (Industrial, Atomic): tougher and faster. | Bubble Tea Gunners (Industrial, Atomic ranged): fire tapioca pearls 33% faster. | Mactan Warriors (Ancient, Classical infantry): +30% attack, +10% speed. | Jingle Truck Artillery (Industrial, Atomic siege): tougher, faster, bigger blast, bells. |
| **Signature unit** | 🎺 Oompah Band (Classical+, Barracks): doesn't fight, but nearby units attack 25% faster. Becomes a techno DJ in the Atomic Age. | 🛵 Scooter Swarm (Industrial+, Stable): three fast scooters per order. | 🚐 Battle Jeepney (Industrial+, Stable): shoots from the windows and heals your units nearby. | 🏏 Fast Bowler (Ancient+, Barracks): throws cricket balls. Longest range of any soldier. |
| **National tech** | Autobahn: +40% speed inside your borders. | 7-Eleven on Every Corner: units heal inside your borders. | Karaoke Night: enemies in your land are 25% slower and take double territory damage. | Cornered Tigers: units do 50% more damage below half health. |

Cities get local names, and so do most soldiers. Selecting a nation unit shows what makes it special.

### Silly stuff

This is on by default. The host can switch it off in the lobby ("Silly stuff: Off").

- **Cows** wander the map. Kill them for food. If a cow walks into nuclear fallout, it becomes a **mutant cow** that attacks everyone.
- **Supply crates** appear. Touch one with any unit to open it. You might get resources, free soldiers, a free tech, more cows… or a single sad potato.
- **Random events** happen every few minutes: a plague of frogs (farms work at half speed), a cow stampede, happy hour (everyone moves faster), a tax audit, an economic boom, a supply drop, or a **meteor** (you get a warning circle first, so move your stuff).
- **Units talk back.** Every unit has a name. Click the same unit too many times and it will complain.
- **Taunts.** Type a number from 1 to 29 in chat and everyone's browser says it out loud. Try 11, 14 and 22.
- **Awards** at the end of the game, like *Most Likely to Start World War 3* and *Steak Enthusiast*.

### Sound and display

Click **⚙️ Sound & display** on the main menu, or 🔊 in the game, to change the volume, the music, the spoken voices, and the day/night cycle. The settings are saved in your browser. The music is made on the fly and gets more intense when fighting starts.

### Controls

| Key / mouse | Action |
|---|---|
| Left-click / drag | Select / box select |
| Double-click | Select all of that type on screen |
| Right-click | Move, attack, work, or set a rally point for buildings |
| Arrow keys, screen edge, middle-drag, minimap | Scroll |
| Mouse wheel | Zoom |
| Letters shown on buttons | Build, train or research (Shift+click a train button = 5 units) |
| A / S | Attack-move / Stop |
| H | Jump to your cities |
| . | Next idle citizen |
| Ctrl+1–9, 1–9 | Make / select control group (press twice to jump there) |
| Space | Jump to the last alert |
| Enter | Chat |
| M | Mute sound |
| Esc | Cancel / menu |

## Put it on GitHub Pages

1. Create a new repository on GitHub, for example `rise-of-nukes`.
2. Push this folder to it:
   ```bash
   git remote add origin https://github.com/<you>/rise-of-nukes.git
   git push -u origin main
   ```
3. On GitHub, open the repository's **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
4. After a minute the game will be at `https://<you>.github.io/rise-of-nukes/`.

There is no build step. The files are served as they are.

## How the multiplayer works

- The host's browser is the hub. Other players connect to it over WebRTC using [PeerJS](https://peerjs.com/). PeerJS's free public server is only used to introduce the browsers to each other. Game traffic goes directly between players.
- The game uses *lockstep*. Every browser runs the exact same simulation. Players only send their commands ("move these units there"). Every 50 ms the host bundles the commands into a "turn" and sends it to everyone. This uses very little bandwidth.
- Every 5 seconds each player sends a checksum of their game state. If one ever differs, the host sends that player a full copy of the game to fix it.
- If a player drops out, they can rejoin with the **same code and the same name**.

**Limits to know about**

- **The host must keep their tab open.** If the host leaves, the game ends. A background tab is fine.
- Some strict networks (some office, school or mobile networks) block direct connections. If one player can't join, try a different person as host. If it keeps happening, a TURN relay server can be added in `js/net.js` (`iceServers`).
- Up to 8 players. It's built and tested with 4 in mind.
- Anyone could cheat from the browser console. It's a game for friends.

## Develop

```bash
npm run serve      # serves on http://localhost:8080 (needs Python 3)
npm test           # runs the headless simulation tests (needs Node 18+)
```

Any static file server works. Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.

### Code layout

| File | What it does |
|---|---|
| `js/sim/data.js` | **All the game numbers**: units, buildings, techs, costs, ages. Start here to change balance. |
| `js/sim/sim.js` | The deterministic game simulation (units, combat, territory, nukes). |
| `js/sim/nations.js` | **The four nations**: powers, unique units, signature units and national techs. Start here to change or add a nation. |
| `js/sim/extras.js` | Silly stuff: cows, mutant cows, crates, meteors and random events. Also deterministic. |
| `js/sim/map.js` | Random map generator. |
| `js/sim/path.js` | A* path finding. |
| `js/session.js` | Lobby and lockstep game loop. |
| `js/net.js` | PeerJS networking. |
| `js/render.js` | Canvas drawing: terrain, units, particles, day and night. |
| `js/sprites.js` | Draws the building pictures for each age (in code, no image files). |
| `js/sfx.js` | Sound effects, music and spoken voices. All made in code with Web Audio, no sound files. |
| `js/flags.js` | Draws the national flags (flag emojis don't show on Windows). |
| `js/flavor.js` | Unit names, voice lines, taunts and end-of-game awards. |
| `js/game.js` | Input, HUD and alerts. |
| `js/main.js` | Menu and lobby screens. |

**Important rule:** code under `js/sim/` must stay deterministic. Don't use `Math.random`, `Date`, `Math.sin`/`cos`/`atan2`/`hypot`/`pow`, or anything else that could give different results in different browsers. Use `+ - * /`, `Math.sqrt`, `Math.floor`, and the seeded RNG in `rng.js`. Otherwise players go out of sync. `npm test` checks that two copies of the game stay identical.

## Ideas for next steps

- AI opponents, so the group can play against bots together
- Aircraft (fighters and bombers), and ships
- Shift-queued orders, formations
- Wonders and more nations with bonuses
- More silly events (suggestions welcome)

---

Uses [PeerJS](https://github.com/peers/peerjs) (MIT), bundled in `js/vendor/`.
