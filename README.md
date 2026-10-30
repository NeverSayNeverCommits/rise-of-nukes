# ☢️ Rise of Nukes

A small, browser-based tribute to *Rise of Nations*. Gather resources, advance through 5 ages, grow your borders with new cities, build an army, capture your friends' cities, and when diplomacy fails, nuke them.

It runs entirely in the browser. You don't need a server: host it free on GitHub Pages, and players connect to each other directly (peer-to-peer).

## Play

1. Open the game page.
2. One person clicks **Host game** and shares the 5-letter room code, or the invite link.
3. Everyone else types the code and clicks **Join game**.
4. In the lobby, pick a nation, colour and team. Same team = allies. The host picks the settings and clicks **Start game**.

**Play vs computer** starts a game against one Normal bot. Add more bots or change them in the lobby. Set *Start age: Atomic* and *Start resources: Insane* to go straight to the nukes.

**Bots.** The host can add bots at Easy, Normal or Hard. Put your friends on your team and the bots on another for a co-op game, or mix them in however you like. Bots use the same rules and the same commands as people, and they run on the host's computer.

**Lobby settings** include map size, start resources, start age, the Doomsday limit, fog, silly stuff, **wonders** (on or off) and **game speed** (1×, 1.25×, 1.5× or 2×). The host can also change the speed during the game with the ⏩ button.

### Basics

| | |
|---|---|
| **Gather** | Citizens build farms (near a city), woodcutter's camps (next to forest), mines (on grey metal rocks) and, from the Industrial Age, oil wells (on black oil pools). Right-click a building with citizens to work there. 5 workers per building to start with. |
| **Upgrades** | Select a farm, camp, mine or oil well and press **⬆️ Upgrade** (U). Each upgrade gives +20% gathering speed and room for 1 more worker. You get one upgrade per age, up to level 4 in the Atomic Age (+80%, 9 workers). Upgrades also need the matching Commerce tech (see below). A gold badge shows the level. This is the main way to get more out of your limited metal and oil spots. |
| **Gather limit** | Like the commerce cap in *Rise of Nations*: each resource has a limit on how much workers can bring in per second (food 14, wood 12, metal 8, oil 6). Anything over it is lost. The small bar next to each resource shows how close you are, and turns orange with a ⚠ at the limit. Commerce techs, Markets and the Golden Cow raise it. Free income, like city food and crates, doesn't count. |
| **Science and Commerce** | Two tech lines at the Library tie everything together. **Science** (Writing, Mathematics, Scientific Method, Computers): each age needs the matching Science tech, and research gets faster. **Commerce** (Barter, Coinage, Banking, Stock Market, Globalisation): raises all gather limits, makes market prices better, and each building upgrade level needs the matching Commerce tech. Many other techs also need a step from another line, so you can't rush only one thing. |
| **Market** | Press K with a citizen (Classical Age). Each Market raises all gather limits by 10%. Select it to buy a resource with whichever one you have the most of (Shift = 5 times). |
| **Ages** | Ancient → Classical → Gunpowder → Industrial → Atomic. Advance at a city, once you have the Science tech for that age. Units upgrade automatically: spearmen become riflemen, horsemen become tanks, catapults become rocket artillery. |
| **Tech** | The Library researches better gathering, Civics (more population and cities), attack and armour upgrades, and the Manhattan Project. Each resource has three gathering techs, and the later ones are bigger: Fertiliser, Chainsaws, Cracking Towers (Industrial), Strip Mining and Fracking (Atomic). The Library only shows the next tech in each chain. |
| **Territory** | Cities claim land. You can only build inside your borders. Enemy territory slowly damages your units. More cities = more land. City limit goes up with each age. |
| **Army** | Infantry beats cavalry, ranged beats infantry, cavalry beats ranged and siege, siege wrecks buildings. Towers and cities shoot back. |
| **Air force** | From the Industrial Age, build an **Airfield** (P). **Fighters** (F) hunt enemy planes and can shoot at ground units. **Bombers** (B) fly to a target, drop a big load of bombs (great against buildings), then fly back to the nearest airfield or city to reload, and go again. Planes fly over forests, water and mountains. In the Atomic Age they become jet fighters and stealth bombers. |
| **Anti-air** | The Arms Factory (the old Siege Workshop) builds **Flak Cannons** (Q), which only shoot planes and are very good at it. Riflemen and other gun-armed foot soldiers (Gunpowder Age and later), towers, cities and fighters can also hit planes. Tanks, cavalry, siege and citizens can't. Towers become Flak Bunkers in the Industrial Age. |
| **Conquest** | Bring a city to 0 HP with soldiers nearby to capture it. Lose all your cities and you're out. Last team standing wins. |
| **Wonders** | Select a citizen and press J. There is only one of each in the whole game, so race your friends for them. They show on the minimap as gold stars, and if one is destroyed, its bonus is gone. See the list below. |
| **Moon Rocket** | The other way to win. Needs the Atomic Age and Globalisation. When it is finished, a 4 minute countdown starts and everyone sees it. If the rocket survives, your team wins. |
| **Nukes** | Atomic Age → research **Manhattan Project** at a Library → build a **Missile Silo** → build a nuke → **Launch** and click a target anywhere. Everyone gets a warning and a countdown. Missile Defense gives a 50% chance to shoot down nukes aimed at your land. |
| **Doomsday Clock** | Every nuke moves the clock. When it reaches the limit set in the lobby, everybody loses. As it gets close, the sky turns red and ash starts to fall. |
| **Veterans** | Units that get kills earn ranks (★ at 3 kills, ★★ at 7, ★★★ at 15). Each rank gives +15% attack and HP. |
| **Day and night** | A full day lasts 6 minutes. At night, windows light up. You can turn this off in the settings. |

### Nations

Like in *Rise of Nations*, everyone plays the same game, but each nation has a few special things. Pick one in the lobby, or pick **Random**. Two players can pick the same nation.

| | 🇩🇪 Germany | 🇹🇼 Taiwan | 🇵🇭 Philippines | 🇵🇰 Pakistan |
|---|---|---|---|---|
| **National power** | Buildings +30% health. Units train 20% faster. Mines +15% metal. | Library techs cost 15% less and finish 25% faster. Cities make 50% more free food and wood. | Citizens build 50% faster. +10 population per city. Cows give double food. Farms +10% food, camps +15% wood. | Farms make 20% more food. Half damage in enemy territory. |
| **Unique units** | Landsknecht (Gunpowder infantry): melee, giant sword, hits everyone nearby. Leopard tanks (Industrial, Atomic): tougher and faster. | Bubble Tea Gunners (Industrial, Atomic ranged): fire tapioca pearls 18% faster. | Mactan Warriors (Ancient, Classical infantry): +30% attack, +10% speed. | Jingle Truck Artillery (Industrial, Atomic siege): tougher, faster, bigger blast, bells. |
| **Signature unit** | 🎺 Oompah Band (Classical+, Barracks): doesn't fight, but nearby units attack 25% faster. Becomes a techno DJ in the Atomic Age. | 🛵 Scooter Swarm (Industrial+, Stable): three fast scooters per order. | 🚐 Battle Jeepney (Industrial+, Stable): shoots from the windows and heals your units nearby. | 🏏 Fast Bowler (Ancient+, Barracks): throws cricket balls. Longest range of any soldier. |
| **National tech** | Autobahn: +40% speed inside your borders. | 7-Eleven on Every Corner: units heal inside your borders. | Karaoke Night: enemies in your land are 25% slower and take double territory damage. | Cornered Tigers: units do 50% more damage below half health. |

Cities get local names, and so do most soldiers. Selecting a nation unit shows what makes it special.

### Wonders

| Wonder | From | What it does |
|---|---|---|
| 🔺 Great Pyramid | Classical | +10 population per city |
| 🏟️ Colosseum | Classical | Soldiers train 20% faster and start as veterans (★) |
| 🗿 Terracotta Army | Gunpowder | A free soldier every 30 seconds, while you have room |
| 🐮 Golden Cow | Gunpowder | Gather limits +25%, and +2 of every resource per second |
| 📡 Great Radio Tower | Industrial | You and your allies see the whole map |
| 🛰️ Orbital Laser | Atomic, needs Computers | Burn a circle of enemies anywhere, every 90 seconds. Doesn't move the Doomsday Clock |
| 🚀 Moon Rocket | Atomic, needs Globalisation | Win the game, if it survives 4 minutes |

### Playing with friends

- **Mark a spot:** press Z over the map, or Alt+click the map or minimap. Your allies see a marker, hear a sound and can press Space to jump there.
- **Team chat:** start a message with `/t`, like `/t attack the north city`.
- **Send resources:** open the menu (☰). Next to each ally there are buttons to send them 100 of a resource.
- **Pause:** anyone can pause for everyone, with ⏸ or F8.
- **If someone drops out:** a bot takes over their side after 45 seconds, and they get it back when they rejoin.
- **Play again:** at the end, the host clicks 🔁 and everyone goes back to the lobby together.
- **Medals:** small goals, like 3 cities or a ★★★ soldier. Earning one tells everyone in chat, and your medals are listed on the end screen with graphs of everyone's score and army.

### Silly stuff

This is on by default. The host can switch it off in the lobby ("Silly stuff: Off").

- **Cows** wander the map and moo in a random spoken voice (this uses the *Spoken voices* setting). Kill them for food. If a cow walks into nuclear fallout, it becomes a **mutant cow** that attacks everyone.
- **Supply crates** appear. Touch one with any unit to open it. You might get resources, free soldiers, a free tech, more cows… or a single sad potato.
- **Random events** happen every few minutes: a plague of frogs (farms work at half speed), a cow stampede, happy hour (everyone moves faster), a tax audit, an economic boom, a supply drop, or a **meteor** (you get a warning circle first, so move your stuff).
- **Units talk back.** Every unit has a name. Click the same unit too many times and it will complain.
- **Taunts.** Press Enter or click 📣 to see the list of taunts. Click one and everyone's browser says it out loud, or click its 🔊 to hear it yourself first. Typing in the chat box narrows the list, and typing a number from 1 to 29 still works.
- **Awards** at the end of the game, like *Most Likely to Start World War 3* and *Steak Enthusiast*.

### Sound and display

Click **⚙️ Sound & display** on the main menu, or 🔊 in the game, to change the volume, the music, the spoken voices, the day/night cycle and how the mouse scrolls the map. The settings are saved in your browser. The music is made on the fly and gets more intense when fighting starts.

**Scrolling in a browser window.** In a normal (not fullscreen) browser window you can't push the mouse past the top of the page, because the tabs are in the way. So by default, if the mouse leaves the window past an edge, the map keeps scrolling that way until the mouse comes back. You can turn this off in the settings. Fullscreen (⛶ or F9) also fixes it.

### Controls

| Key / mouse | Action |
|---|---|
| Left-click / drag | Select / box select |
| Double-click | Select all of that type on screen |
| Right-click | Move, attack, work, or set a rally point for buildings |
| Shift+right-click, Shift+A | Add a stop to the route |
| Arrow keys, screen edge, middle-drag, minimap | Scroll |
| Mouse wheel | Zoom. Or scroll the map: pick *Mouse wheel: Scrolls the map* in ⚙️ settings (then Shift+wheel = sideways, Ctrl+wheel = zoom). Trackpads can pan with two fingers. |
| ⛶ or F9 | Fullscreen. Then screen-edge scrolling works on all four sides. |
| Letters shown on buttons | Build, train or research (Shift+click a train button = 5 units) |
| A / S | Attack-move / Stop |
| J | Wonders (with a citizen selected) |
| Ctrl+A / , | Select the whole army / next idle soldiers |
| Z or Alt+click | Mark a spot for your allies |
| F8 or Pause | Pause for everyone |
| H | Jump to your cities |
| . | Next idle citizen |
| Ctrl+1–9, 1–9 | Make / select control group (press twice to jump there) |
| Space | Jump to the last alert |
| Enter | Chat (start with `/t` for team only) |
| M | Mute sound (with citizens selected, M builds a mine) |
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
- If a player drops out, they can rejoin with the **same code and the same name**. A bot keeps their side going after 45 seconds, until they are back.
- Game speed changes the length of a turn on everyone's computer at once. The game stays in step at any speed.

**Limits to know about**

- **The host must keep their tab open.** If the host leaves, the game ends. A background tab is fine.
- Some strict networks (some office, school or mobile networks) block direct connections. If one player can't join, try a different person as host. If it keeps happening, a TURN relay server can be added in `js/net.js` (`iceServers`).
- Up to 8 players. It's built and tested with 4 in mind.
- Performance: the game was tested with 800 units on the map, including 200 planes. The simulation takes about 2.5 ms of the 50 ms it has per turn. Drawing a plane costs about as much as drawing two foot soldiers, so big air forces are fine on any normal laptop.
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
| `js/bot.js` | The computer players. Runs on the host only and sends normal commands, so it can use `Math.random` and doesn't affect sync. |
| `js/session.js` | Lobby and lockstep game loop, pause, speed, pings. |
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

- Ships
- Formations
- More nations and wonders
- More silly events (suggestions welcome)

---

Uses [PeerJS](https://github.com/peers/peerjs) (MIT), bundled in `js/vendor/`.
