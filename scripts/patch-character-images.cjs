#!/usr/bin/env node

/**
 * The Fuglys — Patch Character Image URLs
 *
 * Adds imageUrl (Zyro CDN) to all 32 characters in Sanity.
 * Run ONCE after updating the character schema to include the imageUrl field.
 *
 * Usage:
 *   $env:SANITY_TOKEN="your_editor_token"
 *   node patch-character-images.cjs
 */

const { createClient } = require('@sanity/client');

const client = createClient({
  projectId: 'ngx60q2x',
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const imageMap = [
  { name: "Luna", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/luna-mxBMLvzD5vHZM6jl.jpeg" },
  { name: "Flint", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/flint-A3QOv0BzLPURXbJl.jpeg" },
  { name: "Axel", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/axel-m5KLqVPN9aUGlLB3.jpeg" },
  { name: "Big Ma", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/big-ma-YanqXr74V0UO8DOV.jpeg" },
  { name: "Billy Ray", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/billy-ray-dJo5Mjl1XDFGbDnX.jpeg" },
  { name: "Bud", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/bud-m7V56r2n7DHM1J2g.jpeg" },
  { name: "Blister", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/blister-mnlqD12avLuGLW5W.jpeg" },
  { name: "Bristleback", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/bristleback-YanqXr74o0Hlv9Ly.jpeg" },
  { name: "Clyde", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/clyde-dJo5Mjl1y5i4Nn4Q.jpeg" },
  { name: "Cletus", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/cletus-AQEDON35k7CpGW1R.jpeg" },
  { name: "Daisy", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/daisy-dWxB7XnNONHNLE03.jpeg" },
  { name: "Dixie", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/dixie-d957JRMb0Vf46N5o.jpeg" },
  { name: "Elmer", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/elmer-mxBMLvzqgOS2y83q.jpeg" },
  { name: "Ellie Mae", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/ellie-mae-mp8qZaMxKys1LZj3.jpeg" },
  { name: "Festus", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/festus-YD0BV1r2JpHRx29e.jpeg" },
  { name: "Flame", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/flame-YbNqQobKQwFbeZno.jpeg" },
  { name: "Grimey", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/grimey-mP42aqZjWnfyyK5G.jpeg" },
  { name: "Harlan", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/harlan-YrDqen3jyktR6pVZ.jpeg" },
  { name: "Hucklebob", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/hucklebob-A85EWoDJx7cWN20L.jpeg" },
  { name: "Jebediah", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/jebediah-m6Ljng86nNh0LOPK.jpeg" },
  { name: "Jolene", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/jolene-YZ9xqyMJJ2HJvj4R.jpeg" },
  { name: "Lurk", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/lurk-AVL1EwPq5JI7ayq3.jpeg" },
  { name: "Millie", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/millie-ALp73E8a4btbEbON.jpeg" },
  { name: "Omen", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/omen-mP42aqZj88hDz26O.jpeg" },
  { name: "Otis", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/otis-YZ9xqyMJ38I94ov0.jpeg" },
  { name: "Scorch", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/scorch-YX4avQ2qgkfZR43D.jpeg" },
  { name: "Scrap", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/scrap-YZ9xqyMOj4hB76Kk.jpeg" },
  { name: "Tanner", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/tanner-AzG35qOV14uJEljy.jpeg" },
  { name: "Trixie", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/trixie-mp8qZaM23NUbR4Jl.jpeg" },
  { name: "Wanda", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/wanda-mePb4ly6LVHXp03O.jpeg" },
  { name: "Zeke", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/zeke-YZ9xqyMO6Nh8NjWw.jpeg" },
  { name: "The Blight Hounds", imageUrl: "https://assets.zyrosite.com/cdn-cgi/image/format=auto,w=375,h=619,fit=crop/Y4LxzG2RBzt2zBlj/blight-hounds-AwvDx7OzBEH1RPr2.jpeg" },
];

async function run() {
  console.log('Patching 32 characters with imageUrl...\n');

  for (const entry of imageMap) {
    const id = `character-${slugify(entry.name)}`;
    try {
      await client.patch(id).set({ imageUrl: entry.imageUrl }).commit();
      console.log(`  ✅ ${entry.name}`);
    } catch (err) {
      console.error(`  ❌ ${entry.name}: ${err.message}`);
    }
  }

  console.log('\nDone! All characters patched with imageUrl.');
}

run().catch(e => console.error(e));
