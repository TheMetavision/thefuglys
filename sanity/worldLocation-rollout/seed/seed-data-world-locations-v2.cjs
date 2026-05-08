/**
 * seed-data-world-locations-v2-fuglys.cjs
 * ------------------------------------------------------------------
 * Brand-specific seed data for The Fuglys.
 * Source: world-locations-bible-2026-04-27.md §5 (5 new locations).
 *
 * When dropped into the Fuglys Studio, rename to
 * `seed-data-world-locations-v2.cjs` (the script imports it without
 * the brand suffix).
 * ------------------------------------------------------------------
 */

module.exports = [
  // 5.1 The Watering Hole
  {
    slug: 'the-watering-hole',
    title: 'The Watering Hole',
    tagline: 'Where the day ends and the lies begin',
    order: 4,
    description: [
      "Bud's idea. Cletus was already distilling. Harlan had been a DJ. Bud had social-engineering instincts. The three claimed an empty pre-fab building at the camp's centre — once a laundromat, the dryer ports still visible in the walls — and turned it into a bar. Bud calls himself the manager. Cletus calls himself the supplier. Harlan calls himself the talent.",
      "Jebediah — the fallen bodyguard — is here every night. He drinks. He talks. Sometimes the talking turns into something worth recording, and Ellie Mae has been quietly noting it down for years.",
    ],
    sensoryDetail: [
      "Low-ceilinged, low-lit. Light comes from oil lamps and a single string of fairy lights Harlan scavenged from a Christmas display. The bar itself is a door laid flat across two oil drums. Every glass is mismatched. Music plays from a hand-cranked record player Harlan rebuilt — vinyl is the only audio format that survived in playable condition, and the Pits' record collection is, accidentally, mostly disco.",
    ],
    dramaticFunction: [
      "The social hub. The only place where the whole crew can plausibly be in one room without a pretext. Tonally warmer than anywhere else in the Pits.",
    ],
    conflicts: [
      "Bud's tab. Bud runs everyone's tab. Bud also runs Bud's tab.",
      "Harlan's setlist. Harlan thinks the camp needs to hear something other than disco. The camp disagrees.",
      "Outsiders at the bar. Hucklebob and other traders are sometimes allowed in. The Watering Hole is the only place strangers see how much the Pits has.",
      "Jebediah's ramblings. Heartbreaking and sometimes operationally useful.",
    ],
    storyHooks: [
      {
        title: 'The bottle on the back shelf',
        description: "There's a bottle Bud won't sell, won't pour, and won't explain. Multi-episode mystery.",
      },
      {
        title: "Harlan's open mic night",
        description: 'A disaster, played for laughs. Several characters reveal hidden talents. One reveals a hidden trauma.',
      },
      {
        title: 'The poker game',
        description: 'High-stakes game between Bud, Cletus, Festus, and Hucklebob. Bottle episode.',
      },
      {
        title: 'Closing time',
        description: "Big Ma, alone at the bar after everyone's gone home. Quietest episode of the season. Highest emotional payoff.",
      },
      {
        title: "Jebediah's truth",
        description: 'Drunk enough one night, he tells the whole bar what really happened to the people he was meant to protect.',
      },
    ],
    merchandisePotential: [
      'T-shirt: "THE WATERING HOLE — IF WE\'RE OPEN, YOU\'RE LATE"',
      'Coaster set: four mismatched designs to match the mismatched glasses',
      'Vinyl record: a real "Watering Hole compilation"',
      'Bar towel: with Bud\'s silhouette and the slogan "MANAGER (UNOFFICIAL)"',
    ],
  },

  // 5.2 Big Ma's Garden
  {
    slug: 'big-mas-garden',
    title: "Big Ma's Garden",
    tagline: 'Hope, growing in poisoned soil',
    order: 5,
    description: [
      "Wanda — the camp's wilderness and foraging expert — found the spot: a sheltered south-facing hollow on the lee side of the camp. Big Ma claimed it. Within a season it had tomatoes; within two, a chicken coop; within three, it had become a project everyone in the camp contributed to, even Bud (who steals tomatoes and replaces them with rocks).",
      "Wanda manages the foraging perimeter — the safe-to-eat plant zones expanding outward from the garden. The chickens (currently four — Henrietta, Stevie, Drumstick, and one Daisy refused to name on the basis that it was \"cursed\") provide eggs and, when necessary, dinner. Daisy doesn't know about the dinner part.",
    ],
    sensoryDetail: [
      "Quiet. The wind doesn't reach in here — the hollow shelters it. You can hear the chickens, the rustle of tomato leaves, occasional buzzing from bees Big Ma somehow keeps alive. The air smells wet in a way nowhere else at the Pits smells wet.",
      "The soil is dark — Big Ma feeds it with compost made from kitchen scraps, ash, and \"things I'm not going to tell you.\" There's a single sunflower at the centre that Big Ma planted the day Daisy was born and now towers over the rest of the garden.",
    ],
    dramaticFunction: [
      "The future. Where the Pits stops being about survival and starts being about continuity. The place characters go when they need to think, mourn, or be honest. The only place where the show drops its dark-comic guard.",
    ],
    conflicts: [
      "Wanda vs. Big Ma. Wanda thinks the garden could be bigger if they'd let her expand the foraging perimeter. Big Ma thinks the soil isn't ready. They argue. They love it.",
      'The Blight Hounds. Drawn by the chickens. The garden has been raided twice.',
      'Daisy and the chickens. Daisy names them. Big Ma kills them. Daisy is figuring this out.',
    ],
    storyHooks: [
      {
        title: "The plant that shouldn't grow",
        description: "Wanda brings back seeds from a salvaged greenhouse. One of them grows into something that's not on any chart. Is it food? Medicine? A weapon?",
      },
      {
        title: 'The bee episode',
        description: 'The bees are dying. Big Ma has to figure out why.',
      },
      {
        title: "Daisy's first kill",
        description: 'The cursed chicken, finally named "Lunch," ends up on the table. Daisy is the one who understands.',
      },
      {
        title: 'The funeral',
        description: "Big Ma plants something for somebody who's died. The whole camp turns up. Nobody speaks.",
      },
      {
        title: 'The Blight Hound raid',
        description: 'Wanda is in the garden when the pack comes through the perimeter. Survival episode.',
      },
    ],
    merchandisePotential: [
      'Seed packets: heirloom tomato variety, branded "Big Ma\'s Garden — Hope Grows"',
      "Tea towel: botanical illustration of the garden's sunflower",
      'Apron: "MA\'S GARDEN — TRESPASSERS FED TO THE CHICKENS"',
      'Children\'s book tie-in: "Daisy and the Cursed Chicken"',
    ],
  },

  // 5.3 The Chop Shop
  {
    slug: 'the-chop-shop',
    title: 'The Chop Shop',
    tagline: "If it had wheels, it'll have wheels again",
    order: 6,
    description: [
      "Festus is a blacksmith. Elmer is an engineer. Otis is the camp's mechanical tinkerer — his trailer beside the Chop Shop is packed with half-finished inventions. Billy Ray is the man who gets handed the broken things and is expected to make them work again. The four of them share a sprawling open-sided structure on the camp's western edge.",
      "Scrap — Trixie's son, the camp's young tech prodigy — apprentices here. He spends his days swapping between Otis's workbench and Elmer's blueprints. He's the one who'll inherit the Chop Shop when the older generation can't run it anymore.",
    ],
    sensoryDetail: [
      "Loud. Always loud. Hammering, welding, the bass thump of Elmer's salvaged generator. Sparks shower from the welding bay at intervals. The roof is open in the middle to let the heat out — and the rain in.",
      "Smells like hot metal, old grease, rubber, and Festus's body odour, which is its own ecosystem.",
    ],
    dramaticFunction: [
      "The body. Where the Pits' physical infrastructure is maintained. Also where the show's slapstick lives — Bud + Festus + a half-built truck is a guaranteed sequence.",
    ],
    conflicts: [
      'Festus vs. modernity. Festus thinks new ideas are suspect. Elmer and Otis think old ideas are suspect. They build great things together.',
      "Parts shortages. When Clyde's runs come back light, projects stall.",
      "Billy Ray's invisibility. Billy Ray does most of the actual work. Nobody notices.",
      "Scrap's apprenticeship. He's faster than the rest of them at picking things up. The older men have feelings about it.",
    ],
    storyHooks: [
      {
        title: 'The lawnmower',
        description: "Cletus's experimental vehicle is finally finished. Its first test run is a feature-length disaster.",
      },
      {
        title: 'The motorcycle',
        description: "Trixie wants her own bike. Festus says she's not ready. The episode where she proves him wrong.",
      },
      {
        title: "Elmer's blueprint",
        description: 'Elmer has been drawing something for months. When he finally shows it, it changes the camp.',
      },
      {
        title: 'Billy Ray gets credit',
        description: "For once. The whole camp throws a party for him. He hates it. It's beautiful.",
      },
      {
        title: "Scrap's first solo build",
        description: 'Otis steps back. The kid builds something on his own.',
      },
    ],
    merchandisePotential: [
      "Mechanic's overalls patch set: Festus's, Elmer's, Otis's, Billy Ray's signature patches",
      'Print: blueprint-style illustration of "The Lawnmower"',
      'Trucker cap: "CHOP SHOP — IF YOU CAN\'T FIX IT, IT WASN\'T BROKEN"',
      "Real branded multitool with Festus's anvil logo",
    ],
  },

  // 5.4 The Bone Yard
  {
    slug: 'the-bone-yard',
    title: 'The Bone Yard',
    tagline: "Where everything that's been is still useful",
    order: 7,
    description: [
      "A sprawling, sorted, weirdly organised graveyard of dead vehicles, dead appliances, dead infrastructure, and the occasional dead animal that Cletus is \"rendering down for parts.\" Clyde, the master scavenger, runs it. He has a system. Nobody else can find anything.",
      "The Bone Yard occupies the whole north end of the camp, separated from the living quarters by a chain-link fence Festus built. The fence isn't to keep things out. It's to stop Flame and Grimey — the camp's two youngest scavengers-in-training — from getting in.",
      "There are stories that Lurk's Shadow Bats roost in the deepest parts of the pile during the day. Clyde says he's never seen them. The way he says it isn't entirely convincing.",
    ],
    sensoryDetail: [
      "The smell shifts depending on what Clyde's recently brought back. Mostly: rust, old plastic, motor oil that's gone off, and underneath it all, the dry mineral smell of sand. The yard is sun-bleached.",
      "Sound is mostly silence punctuated by Clyde's muttering, the occasional clang as he repositions something, and — when the kids have got in — distant screaming followed by Big Ma's voice.",
    ],
    dramaticFunction: [
      "The memory of the world before. Every object in it had a previous life. The show's archaeology lives here.",
    ],
    conflicts: [
      'Clyde vs. everyone wanting things. Clyde knows where everything is. Other Fuglys want him to give it to them.',
      "The kids. Flame and Grimey will not stay out. They have found things they shouldn't have found.",
      "What's worth keeping. Periodically, the camp tries to consolidate the Bone Yard. Clyde always wins.",
      "The bats. If they are there. Which they aren't. According to Clyde.",
    ],
    storyHooks: [
      {
        title: 'The thing in the back',
        description: "Flame finds something at the bottom of the pile that predates the collapse and shouldn't exist. Season-long arc.",
      },
      {
        title: "Clyde's secret",
        description: 'Clyde knows what every object in the yard used to be. Why? Backstory episode.',
      },
      {
        title: 'The salvage run that goes wrong',
        description: "Clyde leads a team out to a new site. Scorch's Fever Foxes are already there.",
      },
      {
        title: "Grimey's first scavenge",
        description: 'Grimey is finally allowed to go on a small run. Coming-of-age. Big Ma cries.',
      },
      {
        title: 'The Shadow Bat nest, confirmed',
        description: 'The kids find it. Clyde has known all along.',
      },
    ],
    merchandisePotential: [
      'Print: cross-section illustration of the Bone Yard with labelled items',
      'Enamel pin set: iconic salvaged items (rotary phone, license plate, Walkman)',
      'Coffee table book: "The Bone Yard Catalogue" — illustrated guide',
      'Kids\' book tie-in: "Flame and Grimey\'s Big Find"',
    ],
  },

  // 5.5 The Lookout
  {
    slug: 'the-lookout',
    title: 'The Lookout',
    tagline: 'The view from the edge of everything',
    order: 8,
    description: [
      'Half a mile from the camp, on a rocky outcrop. Pre-collapse, it was a roadside scenic viewpoint — the concrete picnic tables and the rusted "VISTA POINT 0.2 MI" sign are still there. The Fuglys claimed it as a forward observation post in Year Two.',
      "Trixie uses it for scouting (along with Millie, when she's not on the Perimeter). Zeke uses it when he wants to be alone. Ellie Mae goes there to write — she keeps a notebook in a tin under one of the picnic tables, and she's been keeping it for nine years.",
      "Omen is sometimes seen at the Lookout — alone, watching the horizon, their crows circling low. They never speak when they're there. They leave before anyone can approach.",
    ],
    sensoryDetail: [
      'Wind. The kind of wind that has nothing to push against. The view is enormous: dust plains to the south, the dry riverbed to the east, the highway scar to the west, and on a clear morning the white shimmer of what used to be a lake to the north. At sunset the whole world is orange.',
      'The picnic tables are graffitied with names, dates, and the occasional message: "BUD WAS HERE." "FOR MARLENE." "I\'M COMING BACK."',
    ],
    dramaticFunction: [
      'The soul of the show. Whenever a character needs space, perspective, or honesty, they go here. By being outside the walls, it\'s also fundamentally vulnerable.',
    ],
    conflicts: [
      'Going alone. Dixie hates that the Lookout is unstaffed most of the time.',
      "Ellie Mae's notebook. What's in it? Different characters have different theories.",
      "Omen's silent visits. Why are they there? What are they waiting for?",
      "The graffiti. Each name is a story. Some of those stories aren't finished.",
    ],
    storyHooks: [
      {
        title: "Ellie Mae's notebook is found by an outsider",
        description: 'The notebook is taken. The crew has to get it back.',
      },
      {
        title: 'Zeke at the Lookout',
        description: "The episode that sits with Zeke for forty minutes while he doesn't speak. Almost a silent film.",
      },
      {
        title: "Omen's vigil",
        description: "Why have they been at the Lookout for three days? When somebody finally goes up to ask, they're already gone.",
      },
      {
        title: 'The funeral pyre',
        description: 'Somebody dies. The pyre is built at the Lookout. Series finale material.',
      },
      {
        title: "Millie's discovery",
        description: 'On a routine scout, Millie sees something on the far horizon. Something new. Something coming. Cliffhanger episode.',
      },
    ],
    merchandisePotential: [
      'Print: sunset over the Lookout, with the picnic table silhouetted. Painterly, gallery-quality.',
      "Notebook: replica of Ellie Mae's tin notebook, sold blank. Premium product.",
      'T-shirt: "BUD WAS HERE" — minimalist',
      'Postcard set: views from the Lookout in different seasons',
    ],
  },
]
