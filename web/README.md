# Chalk web

Next.js App Router front end for Chalk. Mobile first, installable, single user.

## Running it locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Needs a `.env.local` in this directory with all four variables below. The three
Supabase and Odds values are the same ones the ingest scripts use at the repo
root, so the quickest way is to copy that file and add a password:

```bash
cp ../.env .env.local
echo 'CHALK_PASSWORD=pick-something' >> .env.local
```

## Environment variables

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL. Server only. |
| `SUPABASE_SERVICE_KEY` | Service role key. Server only, and the reason nothing here is a client component that touches data. |
| `ODDS_API_KEY` | Carried so the same env works for the ingest scripts. The web app does not call the Odds API. |
| `CHALK_PASSWORD` | The single password for the whole site. |

None of these are prefixed `NEXT_PUBLIC_`, so none of them reach the browser.
`src/lib/supabase.ts` imports `server-only`, which turns any accidental client
import of the database layer into a build error.

## Deploying to Vercel

1. New Project, point it at this repository.
2. **Set the Root Directory to `web`.** The repo root is the ingest scripts,
   not the site. That also means `web/package.json` has to list every package
   the app imports, even one the repo root already depends on: locally Node
   walks up and finds the root `node_modules`, but Vercel never sees it, so a
   missing entry builds here and fails there. `csv-parse` is listed for exactly
   that reason — `src/lib/tdData.ts` parses the nflverse schedule file.
3. Framework preset is Next.js. `vercel.json` here covers the rest.
4. Add the four variables above under Settings, Environment Variables, for
   Production and Preview. Do not add them to `vercel.json`; they are secrets.
5. Deploy, then open the site once and log in so the cookie is set.

The tables have RLS enabled with no policies, so reads only work with the
service key from the server. There is nothing to configure on the Supabase side.

## How the gate works

`src/proxy.ts` runs before every route. Next 16 renamed the `middleware`
convention to `proxy`; with a `src` directory it has to sit at `src/proxy.ts`
or it is silently not applied.

The cookie holds a SHA-256 digest of `CHALK_PASSWORD`, so the password itself
never travels back to the browser. `/login`, `/api/login`, the manifest, the
service worker and the icons stay reachable so the app can be installed and
logged into.

Changing `CHALK_PASSWORD` invalidates every existing session, which is the
intended way to log yourself out everywhere.

## Weights

`src/data/weights.json` is a copy of the root `weights.json`, because Vercel
only uploads this directory. After changing the root file:

```bash
npm run sync:weights
```

The About page reads the weights out of that file, so it describes the rating
that is actually running rather than one written down once.
