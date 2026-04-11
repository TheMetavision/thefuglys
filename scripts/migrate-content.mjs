#!/usr/bin/env node

/**
 * The Fuglys — Content Migration Script
 * 
 * Populates Sanity CMS (project: ngx60q2x) with:
 * - 32 characters from the existing site
 * - Episode placeholders from the media page
 * - Blog post placeholders from Wasteland Whispers
 * - Site settings
 * - Merch categories
 * 
 * Usage:
 *   1. Copy .env.example to .env and fill in SANITY_API_TOKEN
 *   2. Run: npm run migrate
 */

import { createClient } from '@sanity/client';
import { config } from 'dotenv';
config();

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID || 'ngx60q2x',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ─── Characters ───────────────────────────────────────────────
const characters = [
  { name: "Luna", age: "13", role: "THE HEART", characterType: "main", bio: "Luna is the heart of the group, with a kind and curious spirit that balances the chaos around her. She's a dreamer who loves collecting shiny trinkets and piecing together stories from the broken remnants of the trailer park.", traits: ["Empathetic", "Perceptive", "Quietly Brave"], quote: "People keep calling this place a dump. I think they mean home.", sortOrder: 1, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/luna-mxBMLvzD5vHZM6jl.jpeg" },
  { name: "Flint", age: "14", role: "THE BRAINS", characterType: "main", bio: "Lanky, wiry, and always up to no good, Flint is the self-proclaimed brains of the operation. Despite his scrawny appearance, he's surprisingly resourceful and has an uncanny ability to turn junk into something useful—or dangerous.", traits: ["Overconfident", "Resourceful", "Surprisingly Useful"], quote: "Technically, none of that was my fault. Technically.", sortOrder: 2, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/flint-A3QOv0BzLPURXbJl.jpeg" },
  { name: "Axel", age: "9", role: "THE HURRICANE", characterType: "main", bio: "Flint's younger brother, Axel, is a pint-sized troublemaker with a wild imagination. Small but scrappy and armed with a slingshot and a fierce attitude, Axel is always ready for a fight—though he's usually the first to run.", traits: ["Fearless", "Chaotic", "Impossible to Stop"], quote: "I pressed the button. Something happened. We move on.", sortOrder: 3, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/axel-m5KLqVPN9aUGlLB3.jpeg" },
  { name: "Big Ma", age: "62", role: "THE MATRIARCH", characterType: "main", bio: "The matriarch of the group, Big Ma is a no-nonsense medic with a heart of gold. She learned traditional medicine from her grandmother and combines this knowledge with scavenged supplies to patch up injuries and cure illnesses.", traits: ["Unshakeable", "Sharp-Tongued", "Fiercely Protective"], quote: "I've stitched up worse. Usually caused by Bud.", sortOrder: 4, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/big-ma-YanqXr74V0UO8DOV.jpeg" },
  { name: "Billy Ray", age: "52", role: "THE HANDYMAN", characterType: "main", bio: "Billy Ray is the dependable counterbalance to his brother Bud's chaos. Quiet and steady, Billy Ray often finds himself cleaning up after Bud's antics. He has a strong sense of responsibility and takes on the role of the group's handyman.", traits: ["Steady", "Patient", "Quietly Heroic"], quote: "I don't ask questions. I just fix what Bud breaks.", sortOrder: 5, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/billy-ray-dJo5Mjl1XDFGbDnX.jpeg" },
  { name: "Bud", age: "48", role: "THE CHAOS AGENT", characterType: "main", bio: "The wildcard of the group, a chaotic whirlwind with a knack for storytelling and getting into trouble. With his wild hair, missing teeth, and a perpetual grin, he's hard to take seriously—but his charm often gets him out of sticky situations.", traits: ["Unpredictable", "Magnetic", "Magnificent Disaster"], quote: "I ain't saying it was a good idea. I'm saying it was MY idea, and that counts for something.", sortOrder: 6, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/bud-m7V56r2n7DHM1J2g.jpeg" },
  { name: "Blister", age: null, role: "CREATURE", characterType: "antagonist", bio: "A grotesque, mutant possum that haunts the trailer park. Its blistered, oozing skin and toxic breath make it a walking biohazard, and its hiss is enough to send even the bravest running.", traits: [], quote: null, sortOrder: 7, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/blister-mnlqD12avLuGLW5W.jpeg" },
  { name: "Bristleback", age: null, role: "CREATURE", characterType: "antagonist", bio: "Leader of the Razor Boars, mutated wild pigs with thick, armored hides covered in sharp, metallic bristles. They charge with reckless abandon, their glowing orange eyes locked onto their target.", traits: [], quote: null, sortOrder: 8, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/bristleback-YanqXr74o0Hlv9Ly.jpeg" },
  { name: "Clyde", age: "38", role: "SCAVENGER", characterType: "supporting", bio: "The group's master scavenger with an uncanny ability to find valuable items in the most unlikely places. Growing up in the wasteland, Clyde developed a keen eye for salvage and a knack for squeezing through tight spaces.", traits: [], quote: null, sortOrder: 9, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/clyde-dJo5Mjl1y5i4Nn4Q.jpeg" },
  { name: "Cletus", age: "47", role: "FUEL CHEMIST", characterType: "supporting", bio: "Once a renowned moonshiner, Cletus now applies his chemistry skills to produce fuel for the group's vehicles. His workshop is a chaotic mess of barrels, pipes, and bubbling concoctions, where he's constantly experimenting with new formulas.", traits: [], quote: null, sortOrder: 10, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/cletus-AQEDON35k7CpGW1R.jpeg" },
  { name: "Daisy", age: "7", role: "THE OPTIMIST", characterType: "supporting", bio: "A beacon of optimism in the group, with an innate ability to find beauty in even the most desolate landscapes. Her bright outlook stems from a belief that hope can be found anywhere, a lesson she learned from her late parents.", traits: [], quote: null, sortOrder: 11, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/daisy-dWxB7XnNONHNLE03.jpeg" },
  { name: "Dixie", age: "36", role: "SHARPSHOOTER", characterType: "supporting", bio: "A sharp-shooter with a reputation for never missing her mark, Dixie keeps the group safe from raiders and other threats. Her collection of modified weapons is both impressive and intimidating, and she takes pride in maintaining her arsenal.", traits: [], quote: null, sortOrder: 12, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/dixie-d957JRMb0Vf46N5o.jpeg" },
  { name: "Elmer", age: "65", role: "THE ENGINEER", characterType: "supporting", bio: "A wise elder in the group, Elmer offers invaluable knowledge of the old world. Having worked as an engineer before the apocalypse, he uses his expertise to design tools and repairs that keep the group functioning.", traits: [], quote: null, sortOrder: 13, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/elmer-mxBMLvzqgOS2y83q.jpeg" },
  { name: "Ellie Mae", age: "40", role: "THE HISTORIAN", characterType: "supporting", bio: "The group's historian, dedicated to preserving their stories for future generations. She keeps meticulous journals that document the group's adventures, struggles, and triumphs.", traits: [], quote: null, sortOrder: 14, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/ellie-mae-mp8qZaMxKys1LZj3.jpeg" },
  { name: "Festus", age: "53", role: "BLACKSMITH", characterType: "supporting", bio: "The group's blacksmith, with hands hardened by years of forging. He can create tools, weapons, and armor out of scrap metal, and his workshop is the heartbeat of the camp's defense.", traits: [], quote: null, sortOrder: 15, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/festus-YD0BV1r2JpHRx29e.jpeg" },
  { name: "Flame", age: "6", role: "THE TROUBLEMAKER", characterType: "supporting", bio: "A sweet but mischievous 6-year-old with a knack for getting into trouble. Flame has a sparkle in her eyes and is always curious and full of energy, with trouble never far away.", traits: [], quote: null, sortOrder: 16, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/flame-YbNqQobKQwFbeZno.jpeg" },
  { name: "Grimey", age: "4", role: "THE EXPLORER", characterType: "supporting", bio: "A grubby, curious 4-year-old with a knack for sneaking into places he shouldn't be. Always covered in dirt and carrying random trinkets he's scavenged, Grimey loves to explore tunnels and tight spaces, often finding hidden treasures—or trouble.", traits: [], quote: null, sortOrder: 17, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/grimey-mP42aqZjWnfyyK5G.jpeg" },
  { name: "Harlan", age: "29", role: "THE DJ", characterType: "supporting", bio: "A wild-eyed, eccentric 29-year-old with a chaotic energy that's impossible to ignore. Before the apocalypse, Harlan was a DJ in the desert rave scene, spinning beats under neon lights and living for the thrill of the moment.", traits: [], quote: null, sortOrder: 18, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/harlan-YrDqen3jyktR6pVZ.jpeg" },
  { name: "Hucklebob", age: "45", role: "THE TRADER", characterType: "supporting", bio: "A simple and dim-witted trader who often stumbles his way through deals with a goofy grin and a carefree attitude. Hucklebob might not always understand what is going on, but his laid-back nature and accidental charm somehow keep him out of real trouble.", traits: [], quote: null, sortOrder: 19, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/hucklebob-A85EWoDJx7cWN20L.jpeg" },
  { name: "Jebediah", age: "56", role: "THE BODYGUARD", characterType: "supporting", bio: "Once a formidable bodyguard, 56-year-old Jebediah is now a shadow of his former self, weighed down by years of regret and an unhealthy penchant for moonshine. Often found nursing a flask, his alcohol-fuelled ramblings hint at the man he used to be.", traits: [], quote: null, sortOrder: 20, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/jebediah-m6Ljng86nNh0LOPK.jpeg" },
  { name: "Jolene", age: "38", role: "THE HEALER", characterType: "supporting", bio: "The group's resident healer, a former nurse who combines her professional knowledge with improvisation to treat injuries and illnesses. Calm under pressure, she's the one everyone turns to when things go wrong.", traits: [], quote: null, sortOrder: 21, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/jolene-YZ9xqyMJJ2HJvj4R.jpeg" },
  { name: "Lurk", age: null, role: "CREATURE", characterType: "antagonist", bio: "Leader of a cauldron of gigantic bats with leathery wings that stretch over eight feet. Their fur is jet-black, and their eyes glow a haunting color. Shadow Bats are nearly silent as they swoop down to snatch prey.", traits: [], quote: null, sortOrder: 22, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/lurk-AVL1EwPq5JI7ayq3.jpeg" },
  { name: "Millie", age: "11", role: "THE SCOUT", characterType: "supporting", bio: "Quick-witted and full of curiosity, Millie's small size and agility make her an excellent scout, often slipping into places adults can't reach. She has a sharp memory and absorbs survival skills like a sponge.", traits: [], quote: null, sortOrder: 23, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/millie-ALp73E8a4btbEbON.jpeg" },
  { name: "Omen", age: null, role: "CREATURE", characterType: "antagonist", bio: "A mysterious figure who predicts danger through unexplained means. Their warnings are cryptic but usually accurate, leading a murder of crows with massive hooked beaks and glowing green eyes that patrol the skies.", traits: [], quote: null, sortOrder: 24, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/omen-mP42aqZj88hDz26O.jpeg" },
  { name: "Otis", age: "45", role: "THE TINKERER", characterType: "supporting", bio: "The group's tinkerer, a mechanical genius who can transform junk into ingenious gadgets. His trailer is packed with half-finished inventions, spare parts, and tools, giving it the appearance of a chaotic workshop.", traits: [], quote: null, sortOrder: 25, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/otis-YZ9xqyMJ38I94ov0.jpeg" },
  { name: "Scorch", age: null, role: "VILLAIN", characterType: "antagonist", bio: "The cunning and ruthless leader of the Fever Foxes, Scorch is a wiry, flame-furred fox with a sharp mind and a fiercer bite. His ember-like glow and hypnotic movements command fear and respect among his pack.", traits: [], quote: null, sortOrder: 26, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/scorch-YX4avQ2qgkfZR43D.jpeg" },
  { name: "Scrap", age: "12", role: "TECH PRODIGY", characterType: "supporting", bio: "Trixie's son, a tech prodigy with an uncanny ability to repair broken gadgets and create ingenious contraptions from discarded parts. He experiments with everything from radios to rudimentary robots.", traits: [], quote: null, sortOrder: 27, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/scrap-YZ9xqyMOj4hB76Kk.jpeg" },
  { name: "Tanner", age: "45", role: "LEATHERWORKER", characterType: "supporting", bio: "A skilled leatherworker who provides the group with essential protective gear crafted from scavenged materials. His creations range from sturdy armor to practical utility belts, viewing his craft as both an art and a duty.", traits: [], quote: null, sortOrder: 28, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/tanner-AzG35qOV14uJEljy.jpeg" },
  { name: "Trixie", age: "35", role: "THE ACROBAT", characterType: "supporting", bio: "Once a circus performer, Trixie has adapted her acrobatic skills to the wasteland, excelling as a scout and nimble problem-solver. Her quick reflexes and fearless nature make her invaluable for navigating dangerous territories.", traits: [], quote: null, sortOrder: 29, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/trixie-mp8qZaM23NUbR4Jl.jpeg" },
  { name: "Wanda", age: "50", role: "FORAGER", characterType: "supporting", bio: "An expert in wilderness survival and foraging, ensuring the group stays fed and hydrated even in the harshest environments. Her extensive knowledge of edible plants, hunting techniques, and tracking makes her indispensable.", traits: [], quote: null, sortOrder: 30, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/wanda-mePb4ly6LVHXp03O.jpeg" },
  { name: "Zeke", age: "13", role: "THE PROTECTOR", characterType: "supporting", bio: "A tough, resourceful teenager who takes after his father, Tanner. Despite his young age, Zeke is fiercely protective of the group and has a knack for crafting simple yet effective tools to help them survive.", traits: [], quote: null, sortOrder: 31, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/zeke-YZ9xqyMO6Nh8NjWw.jpeg" },
  { name: "The Blight Hounds", age: null, role: "CREATURE", characterType: "antagonist", bio: "Rabid dogs that roam the park in vicious packs. Their fur is patchy and covered in lesions, and their jaws have mutated to open impossibly wide. Their eyes glow red, and their growls sound like deep, guttural growls mixed with static.", traits: [], quote: null, sortOrder: 32, imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/blight-hounds-AwvDx7OzBEH1RPr2.jpeg" },
];

// ─── Episodes ─────────────────────────────────────────────────
const episodes = [
  { title: "The Fuglys Official Trailer", videoType: "trailer", youtubeUrl: "https://www.youtube.com/shorts/XgwfSjIJre4", youtubeId: "XgwfSjIJre4", description: "Meet The Fuglys — wasteland weirdos, wild adventures, zero regrets.", featured: true, publishedAt: "2026-01-15T00:00:00Z" },
  { title: "Blister's Big Night", videoType: "episode", youtubeUrl: "", youtubeId: "", description: "When the gang's hideout is overrun with toxic fumes, they realize the culprit is none other than Blister, the most revolting possum in the wasteland.", featured: false, publishedAt: "2026-04-01T00:00:00Z" },
  { title: "Axel's Almost Apocalypse", videoType: "episode", youtubeUrl: "", youtubeId: "", description: "Axel gets his hands on an old, rusty detonator and—against every warning—decides to push the button.", featured: false, publishedAt: "2026-04-15T00:00:00Z" },
  { title: "The Great Trash Heist", videoType: "episode", youtubeUrl: "", youtubeId: "", description: "Clyde stumbles upon the ultimate jackpot—an untouched landfill rumored to be loaded with pre-apocalypse treasure.", featured: false, publishedAt: "2026-05-01T00:00:00Z" },
  { title: "Daisy's Lost & Found", videoType: "episode", youtubeUrl: "", youtubeId: "", description: "While exploring the wasteland, Daisy discovers an abandoned relic from the past—a rusted-out amusement park hidden in the ruins.", featured: false, publishedAt: "2026-05-15T00:00:00Z" },
];

// ─── Blog Posts ───────────────────────────────────────────────
const blogPosts = [
  { title: "Blister: The Possum Nobody Asked For", category: "lore", excerpt: "Deep in the trailer park, something stirs. Something oozing, something hissing, something that smells like three kinds of wrong. We go behind the scenes on the creation of the Fuglys' most repulsive cast member.", publishedAt: "2026-03-15T00:00:00Z" },
  { title: "Building the Wasteland: Our World Design Process", category: "bts", excerpt: "Every rusted fence post, every cracked trailer window, every scorched patch of dirt was a decision. Here's how we built the world of The Fuglys from the ground up.", publishedAt: "2026-02-20T00:00:00Z" },
  { title: "The Razor Boars: Designing Wasteland Creatures", category: "bts", excerpt: "Mutant pigs with armored hides and glowing orange eyes don't design themselves. We walk through the concept art, iteration, and final look of the Razor Boars.", publishedAt: "2026-02-10T00:00:00Z" },
  { title: "Why Post-Apocalyptic? The Story Behind The Fuglys", category: "dispatches", excerpt: "It started with a simple question: what happens to the people the hero stories forget? The weird ones, the broken ones, the ones just trying to survive Tuesday.", publishedAt: "2026-01-25T00:00:00Z" },
  { title: "Axel's Slingshot: Prop Design in Animation", category: "bts", excerpt: "A slingshot has to feel dangerous when a 9-year-old carries it. It has to look handmade, scavenged, loved, and feared all at once.", publishedAt: "2026-01-10T00:00:00Z" },
  { title: "Chaos Theory: Writing Comedy Into the Apocalypse", category: "dispatches", excerpt: "The wasteland is grim. The Fuglys are not. Threading genuine laughs through a post-apocalyptic world without undermining the stakes is harder than it sounds.", publishedAt: "2025-12-15T00:00:00Z" },
];

// ─── Categories ───────────────────────────────────────────────
const categories = [
  { title: "Apparel", description: "T-shirts, hoodies, caps — wasteland-approved", sortOrder: 1 },
  { title: "Collectibles", description: "Stickers, enamel pins, art prints", sortOrder: 2 },
  { title: "Accessories", description: "Keychains, patches, mugs", sortOrder: 3 },
];

// ─── Site Settings ────────────────────────────────────────────
const siteSettings = {
  _id: 'siteSettings',
  _type: 'siteSettings',
  siteName: 'The Fuglys',
  tagline: 'Wasteland Weirdos, Wild Adventures, Zero Regrets!',
  siteDescription: 'Join The Fuglys — an unruly band of wasteland misfits — in animated adventures, blog stories & merch drops.',
  contactEmail: 'contact@thefuglys.com',
  youtubeChannel: 'https://www.youtube.com/@TheFuglys',
  socialLinks: [
    { _type: 'object', _key: 'fb', platform: 'Facebook', url: 'https://www.facebook.com/thefuglysmedia' },
    { _type: 'object', _key: 'ig', platform: 'Instagram', url: 'https://www.instagram.com/the_fuglys' },
    { _type: 'object', _key: 'yt', platform: 'YouTube', url: 'https://www.youtube.com/@TheFuglys' },
    { _type: 'object', _key: 'tt', platform: 'TikTok', url: 'https://www.tiktok.com/@thefuglys' },
    { _type: 'object', _key: 'x', platform: 'X', url: 'https://x.com/TheFuglysMedia' },
  ],
  footerText: '© The Metavision 2026. All rights reserved.',
  newsletterHeadline: 'Stay Weird. Stay Wild. Stay in the Loop!',
  newsletterSubtext: 'Subscribe to our newsletter',
};

// ─── Migration Runner ─────────────────────────────────────────
async function migrate() {
  console.log('🔥 Starting The Fuglys content migration...\n');

  // Site Settings
  console.log('📋 Creating site settings...');
  await client.createOrReplace(siteSettings);
  console.log('   ✅ Site settings created\n');

  // Characters
  console.log('👥 Creating characters...');
  for (const char of characters) {
    const doc = {
      _type: 'character',
      _id: `character-${slugify(char.name)}`,
      name: char.name,
      slug: { _type: 'slug', current: slugify(char.name) },
      age: char.age,
      role: char.role,
      characterType: char.characterType,
      bio: char.bio,
      traits: char.traits,
      quote: char.quote,
      sortOrder: char.sortOrder,
      seoTitle: `${char.name} — The Fuglys Character`,
      seoDescription: char.bio.substring(0, 155) + '...',
      // Note: Images will reference external URLs initially.
      // Upload to Sanity later via Studio for full image pipeline.
    };
    await client.createOrReplace(doc);
    console.log(`   ✅ ${char.name}`);
  }
  console.log(`   → ${characters.length} characters created\n`);

  // Episodes
  console.log('🎬 Creating episodes...');
  for (const ep of episodes) {
    const doc = {
      _type: 'episode',
      _id: `episode-${slugify(ep.title)}`,
      title: ep.title,
      slug: { _type: 'slug', current: slugify(ep.title) },
      videoType: ep.videoType,
      youtubeUrl: ep.youtubeUrl,
      youtubeId: ep.youtubeId,
      description: ep.description,
      featured: ep.featured,
      publishedAt: ep.publishedAt,
      seoTitle: `${ep.title} — The Fuglys`,
      seoDescription: ep.description.substring(0, 155) + '...',
    };
    await client.createOrReplace(doc);
    console.log(`   ✅ ${ep.title}`);
  }
  console.log(`   → ${episodes.length} episodes created\n`);

  // Blog Posts
  console.log('📝 Creating blog posts...');
  for (const post of blogPosts) {
    const doc = {
      _type: 'blogPost',
      _id: `post-${slugify(post.title)}`,
      title: post.title,
      slug: { _type: 'slug', current: slugify(post.title) },
      category: post.category,
      excerpt: post.excerpt,
      body: [
        {
          _type: 'block',
          _key: 'placeholder',
          style: 'normal',
          markDefs: [],
          children: [
            {
              _type: 'span',
              _key: 'span1',
              text: post.excerpt + ' [Full article content to be added in Sanity Studio]',
              marks: [],
            },
          ],
        },
      ],
      publishedAt: post.publishedAt,
      seoTitle: `${post.title} — Wasteland Whispers`,
      seoDescription: post.excerpt.substring(0, 155) + '...',
    };
    await client.createOrReplace(doc);
    console.log(`   ✅ ${post.title}`);
  }
  console.log(`   → ${blogPosts.length} blog posts created\n`);

  // Categories
  console.log('🏷️  Creating merch categories...');
  for (const cat of categories) {
    const doc = {
      _type: 'category',
      _id: `category-${slugify(cat.title)}`,
      title: cat.title,
      slug: { _type: 'slug', current: slugify(cat.title) },
      description: cat.description,
      sortOrder: cat.sortOrder,
    };
    await client.createOrReplace(doc);
    console.log(`   ✅ ${cat.title}`);
  }
  console.log(`   → ${categories.length} categories created\n`);

  console.log('═══════════════════════════════════════════');
  console.log('🎉 Migration complete!');
  console.log(`   ${characters.length} characters`);
  console.log(`   ${episodes.length} episodes`);
  console.log(`   ${blogPosts.length} blog posts`);
  console.log(`   ${categories.length} categories`);
  console.log(`   1 site settings document`);
  console.log('═══════════════════════════════════════════');
  console.log('\nNext steps:');
  console.log('  1. Open thefuglys.sanity.studio and verify content');
  console.log('  2. Upload character portrait images via Studio');
  console.log('  3. Add full blog post body content');
  console.log('  4. Add YouTube IDs to upcoming episodes when published');
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
