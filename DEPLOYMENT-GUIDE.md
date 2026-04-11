# The Fuglys — Phase 3 Deployment Guide

## What's In This Package

Your Bolt frontend with the full backend wired in:

- **Sanity CMS** (8 schemas: character, episode, blogPost, product, category, faq, page, siteSettings)
- **Sanity client + GROQ queries** (`src/lib/sanity.ts` — 15 query functions ready to plug into pages)
- **Cart system** (`src/lib/cart.ts` — nanostores state management)
- **CartDrawer** (`src/components/CartDrawer.tsx` — React island, matches your design system)
- **Netlify Functions** (create-checkout, stripe-webhook, printful-webhook)
- **Content migration script** (all 32 characters, 5 episodes, 6 blog posts, 3 categories, site settings)
- **AEO/GEO layer** (JSON-LD schemas, llms.txt, robots.txt, sitemap, Open Graph tags)
- **JSON-LD schema library** (`src/lib/schema.ts` — Organization, WebSite, TVSeries, FictionalCharacter, Product, Article, VideoObject, FAQ, Collection)

Your existing pages, components, and styles are **untouched**. The backend plugs in alongside them.

---

## Step-by-Step Deployment

### 1. Create the project folder

```
mkdir C:\Users\chris\Downloads\thefuglys
```

Unzip the delivered package into this folder. You should see:

```
thefuglys/
├── astro.config.mjs
├── netlify.toml
├── package.json
├── .env.example
├── .gitignore
├── tsconfig.json
├── public/
│   ├── favicon.svg
│   ├── image.png
│   ├── robots.txt
│   └── llms.txt
├── src/
│   ├── components/    (Nav, Footer, Newsletter, CartDrawer)
│   ├── data/          (characters.ts — original Bolt data, kept as fallback)
│   ├── layouts/       (Layout.astro — updated with JSON-LD + OG tags)
│   ├── lib/           (sanity.ts, cart.ts, schema.ts)
│   └── pages/         (all 6 pages from Bolt)
├── sanity/
│   ├── sanity.config.js
│   └── schemas/       (8 schema files + index)
├── netlify/
│   └── functions/     (3 serverless functions)
└── scripts/
    └── migrate-content.mjs
```

### 2. Install dependencies

```
cd C:\Users\chris\Downloads\thefuglys
npm install
```

### 3. Set up environment variables

```
copy .env.example .env
```

Edit `.env` and fill in your real values:

- `SANITY_PROJECT_ID` — already set to `ngx60q2x`
- `SANITY_DATASET` — already set to `production`
- `SANITY_API_TOKEN` — create at https://www.sanity.io/manage/project/ngx60q2x/api#tokens (needs Editor or higher permissions)
- `STRIPE_SECRET_KEY` — from Stripe dashboard (use test key first: `sk_test_...`)
- `STRIPE_PUBLISHABLE_KEY` — from Stripe dashboard (`pk_test_...`)
- `STRIPE_WEBHOOK_SECRET` — set up after Netlify deploy (Step 7)
- `PRINTFUL_API_KEY` — from Printful dashboard → Settings → API
- `SITE_URL` — `https://thefuglys.com` (or your Netlify URL initially)

### 4. Deploy Sanity schemas to Studio

Your Studio is already live at `thefuglys.sanity.studio`. To update it with the new schemas:

```
cd sanity
npm install sanity @sanity/cli
npx sanity deploy
```

When prompted, confirm the studio hostname as `thefuglys`.

### 5. Run the content migration

This populates Sanity with all 32 characters, episodes, blog posts, categories, and site settings:

```
cd ..
npm install dotenv
npm run migrate
```

You should see:
```
🔥 Starting The Fuglys content migration...
👥 Creating characters...
   ✅ Luna
   ✅ Flint
   ... (all 32)
🎉 Migration complete!
```

Verify at https://thefuglys.sanity.studio — you should see all content populated.

### 6. Create GitHub repo and connect to Netlify

```
git init
git add .
git commit -m "Phase 3: Full backend integration — Sanity, Stripe, Printful, AEO/GEO"
```

Go to https://github.com/new and create a repo called `thefuglys`.

```
git remote add origin https://github.com/YOUR_USERNAME/thefuglys.git
git branch -M main
git push -u origin main
```

Then in Netlify:
1. Go to https://app.netlify.com → **Add new site** → **Import an existing project**
2. Connect your GitHub account and select the `thefuglys` repo
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Under **Environment variables**, add ALL the values from your `.env` file
6. Click **Deploy site**

### 7. Set up Stripe webhook

After your first deploy, note the Netlify URL (e.g., `https://thefuglys.netlify.app`).

1. Go to Stripe Dashboard → Developers → Webhooks
2. **Add endpoint**: `https://thefuglys.netlify.app/.netlify/functions/stripe-webhook`
3. Select events: `checkout.session.completed`
4. Copy the **Signing secret** (`whsec_...`)
5. Add it to Netlify environment variables as `STRIPE_WEBHOOK_SECRET`
6. Redeploy

### 8. Set up Printful webhook

1. Go to Printful Dashboard → Settings → API → Webhooks
2. **Add webhook URL**: `https://thefuglys.netlify.app/.netlify/functions/printful-webhook`
3. Select events: `package_shipped`, `order_created`, `order_failed`

### 9. Connect custom domain

In Netlify → Domain settings → Add custom domain → `thefuglys.com`

Update your DNS at your registrar to point to Netlify's nameservers or add a CNAME record.

### 10. Set up Sanity webhook for auto-rebuild

1. Go to https://www.sanity.io/manage/project/ngx60q2x → API → Webhooks
2. Add webhook:
   - Name: `Netlify rebuild`
   - URL: Your Netlify build hook URL (create one in Netlify → Build & deploy → Build hooks)
   - Trigger on: Create, Update, Delete
   - Filter: Leave blank (triggers on all document changes)

---

## How to Wire Pages to Sanity

Your pages currently use hardcoded data. Here's how to switch each page to pull from Sanity. **This is the next step after deployment.**

### Meet The Misfits page

Replace the frontmatter in `src/pages/meet-the-misfits.astro`:

```astro
---
import Layout from '../layouts/Layout.astro';
import Nav from '../components/Nav.astro';
import Footer from '../components/Footer.astro';
import Newsletter from '../components/Newsletter.astro';
import { getAllCharacters } from '../lib/sanity';
import { collectionSchema, breadcrumbSchema } from '../lib/schema';

const allCharacters = await getAllCharacters();

// Map Sanity characterType to Bolt's type system
const typeMap = { main: 'hero', supporting: 'hero', antagonist: 'creature' };

const coreSix = allCharacters
  .filter(c => c.characterType === 'main')
  .map(c => ({
    name: c.name,
    age: c.age ? `Age ${c.age}` : undefined,
    role: c.role,
    description: c.bio,
    // Use Sanity image if uploaded, otherwise fall back to Zyro CDN URL
    image: c.portrait ? urlFor(c.portrait).width(375).height(619).url() : undefined,
    type: typeMap[c.characterType] || 'hero',
    coreSix: true,
  }));

const restOfCrew = allCharacters
  .filter(c => c.characterType !== 'main')
  .map(c => ({
    name: c.name,
    age: c.age ? `Age ${c.age}` : undefined,
    role: c.role,
    description: c.bio,
    image: c.portrait ? urlFor(c.portrait).width(375).height(619).url() : undefined,
    type: c.role === 'VILLAIN' ? 'villain' : (c.characterType === 'antagonist' ? 'creature' : 'hero'),
  }));
---
```

The rest of the template stays identical — same HTML, same classes, same styles.

### Wasteland Whispers (Blog)

Replace the hardcoded `posts` array with:

```astro
---
import { getAllBlogPosts } from '../lib/sanity';
const posts = (await getAllBlogPosts()).map(p => ({
  title: p.title,
  date: new Date(p.publishedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  excerpt: p.excerpt,
  tag: p.category === 'lore' ? 'Character Spotlight'
     : p.category === 'bts' ? 'Behind the Scenes'
     : p.category === 'dispatches' ? 'From the Creator'
     : p.category === 'merch' ? 'Merch Drop'
     : 'Community',
  slug: p.slug,
}));
---
```

### Media page

Replace the hardcoded `episodes` array with:

```astro
---
import { getAllEpisodes } from '../lib/sanity';
const episodes = (await getAllEpisodes()).map(ep => ({
  title: ep.title,
  description: ep.description,
  status: ep.youtubeId ? 'WATCH NOW' : 'COMING SOON',
  youtubeId: ep.youtubeId,
  image: ep.thumbnail ? urlFor(ep.thumbnail).width(600).height(400).url() : undefined,
}));
---
```

### Homepage carousel

The carousel data can also be pulled from Sanity:

```astro
---
import { getCoreSixCharacters } from '../lib/sanity';
const coreSix = await getCoreSixCharacters();
const carouselCharacters = coreSix.map(c => ({
  name: c.name,
  role: c.role,
  quote: c.quote || '',
  image: c.portrait ? urlFor(c.portrait).width(900).auto('format').url()
    : `https://assets.zyrosite.com/...`, // fallback
}));
---
```

---

## File Reference

| File | Purpose |
|------|---------|
| `src/lib/sanity.ts` | Sanity client + 15 GROQ queries |
| `src/lib/cart.ts` | Cart state (nanostores) |
| `src/lib/schema.ts` | JSON-LD structured data generators |
| `src/components/CartDrawer.tsx` | React cart drawer component |
| `src/layouts/Layout.astro` | Updated with JSON-LD, OG, Twitter cards |
| `netlify/functions/create-checkout.mjs` | Stripe Checkout session creator |
| `netlify/functions/stripe-webhook.mjs` | Stripe → Printful order pipeline |
| `netlify/functions/printful-webhook.mjs` | Shipment notification handler |
| `sanity/schemas/*.js` | 8 Sanity document schemas |
| `sanity/sanity.config.js` | Studio configuration |
| `scripts/migrate-content.mjs` | Content migration (32 chars + episodes + posts) |
| `public/llms.txt` | AI engine discoverability |
| `public/robots.txt` | Search engine directives |
| `.env.example` | Environment variables template |
| `netlify.toml` | Netlify build config (Node 22) |

---

## What's Next After Deployment

1. **Upload character images to Sanity** — Currently characters reference external Zyro URLs. Upload the actual images via Sanity Studio for the full image pipeline (automatic resizing, WebP, CDN).

2. **Wire pages to Sanity** — Use the code snippets above to replace hardcoded data with CMS queries. Do this page by page, testing each one.

3. **Add CartDrawer to Layout** — Add `import CartDrawer from '../components/CartDrawer.tsx'` and `<CartDrawer client:load />` to the Layout when the merch store is ready.

4. **Create Stripe products** — Set up products and prices in Stripe Dashboard, then add the Price IDs to Sanity product documents.

5. **Connect Printful** — Sync products to Printful, map variant IDs to Sanity product documents.

6. **Add blog post content** — The migration creates placeholder body text. Write full articles in Sanity Studio.

7. **Roll out to remaining 3 IP brands** — Same stack, same process: Cats On Crack, Biker Babies, Labrats.
