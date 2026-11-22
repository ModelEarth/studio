# Crew

Crew members bid on project issues (GitHub issues shown on the projects hub), deliver
creative work, and get paid through Stripe Connect. Sponsors can offer a bounty for a
satisfactory production of an issue, and people watching a production can send tips and fees.

Crew is a Cloudflare Worker with a D1 database, deployed at https://studio.model.earth and
run locally on http://localhost:4201. The one Worker serves the whole site:

| Path              | What it serves                                                          |
|-------------------|-------------------------------------------------------------------------|
| `/crew/`          | Crew pages (`CREW_BASE_PATH`)                                           |
| `/projects/`      | The projects hub, from the `crew/projects` submodule                    |
| `/localsite/`     | localsite, from the `crew/localsite` submodule, which the hub loads     |
| `/engine/`        | ModelEarth `engine`, from the `crew/engine` submodule                   |
| `/keys/`          | ModelEarth `keys`, from the `crew/keys` submodule                       |
| `/profile/`       | ModelEarth `profile`, from the `crew/profile` submodule                 |
| `/project/`       | ModelEarth `project`, from the `crew/project` submodule                 |
| `/realitystream/` | ModelEarth `realitystream`, from the `crew/realitystream` submodule     |
| everything else   | The ArtCraft webapp (Vite on 4202 locally, the built app when deployed) |

Crew uses its own Stripe account, separate from the ArtCraft account in storyteller-web, set by
the `STRIPE_CREW_` keys in the crew env file: live keys for the deployed site, and sandbox keys
that only localhost uses.

`crew/projects` is the [ModelEarth/projects](https://github.com/ModelEarth/projects) submodule.
Its hub (`projects/hub/`) shows Bid, Payment and Bounty buttons on each issue. On this site
they open `/crew` on the same host; on localhost, `http://localhost:4201/crew`; and on other
sites that show the hub, `https://studio.model.earth/crew`.

## How it works

1. A crew member signs in with GitHub and opens **Bid** on an issue: amount and what they'll deliver.
2. A site admin (`CREW_ADMIN_GITHUB_LOGINS`) accepts or rejects bids.
3. The crew member sets up payouts (**Payouts** page) with their email, which creates a Stripe
   Express account on the crew platform (Accounts v2, as a recipient of transfers) and walks
   them through Stripe onboarding.
4. When work is delivered, the crew member adds a link (such as the pull request).
5. On the **Payment** page, a signed-in user pays the accepted bid, or sends a tip to any crew
   member on that issue. A sponsor who offered a bounty (**Bounty** page: the amount, and what
   a satisfactory production includes) pays it to a crew member whose bid was accepted, once
   the work satisfies them. Stripe Checkout takes the payment, keeps `CREW_PLATFORM_FEE_PERCENT`
   for the site host, and sends the rest to the crew member's Stripe account.
6. Stripe's webhook marks payments paid, failed, expired or refunded, and tracks whether each
   crew member can receive payments.

## Local setup

Settings live in an env file outside the repo, at the path in `crew_env_file:` in
`automation/paths.yaml`. That file is created from `automation/paths.example.yaml` on first
use. To use another env file, run `npm run dev -- --env-file <path>` once and `paths.yaml`
remembers it.

```bash
# from studio: copy crew/.env.example to the crew_env_file: path, then fill it in (see below)
./automation/webapp-dev.sh              # ArtCraft webapp dev server on 4202
cd crew
npm install
npm run dev                             # D1 migrations, then http://localhost:4201
```

Without a GitHub OAuth app, set `CREW_DEV_LOGIN=true` and sign in on localhost with
`http://localhost:4201/crew/dev-login?login=some-name`. It only works on localhost.

### Stripe (second account)

The crew env file holds two sets of keys from the crew Stripe account:

| Keys                                                                   | Used by                       |
|------------------------------------------------------------------------|-------------------------------|
| `STRIPE_CREW_SECRET_KEY`, `STRIPE_CREW_WEBHOOK_SECRET`                 | The deployed site (live mode) |
| `STRIPE_CREW_SANDBOX_SECRET_KEY`, `STRIPE_CREW_SANDBOX_WEBHOOK_SECRET` | Localhost only (a sandbox)    |

Localhost never uses the live keys, so local testing can't take real payments, and
`npm run deploy` never uploads the sandbox keys. Crew only needs secret keys
(`sk_live_...`, `sk_test_...`), not the publishable ones.

**Sandbox, for localhost**

1. In a sandbox of the crew account, turn on **Connect** (Express accounts), then put its
   secret key in `STRIPE_CREW_SANDBOX_SECRET_KEY`.
2. Forward webhooks locally with the Stripe CLI, and put the `whsec_...` it prints in
   `STRIPE_CREW_SANDBOX_WEBHOOK_SECRET`. It prints the same secret each time on this machine.

   ```bash
   npm install -g @stripe/cli   # once
   stripe login                 # then approve in the browser and run: stripe login --complete-device
   stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,charge.refunded,account.updated \
     --forward-to localhost:4201/crew/webhook --forward-connect-to localhost:4201/crew/webhook
   ```

**Live, for the deployed site**

1. In live mode, turn on **Connect** and complete the account's activation, then put the live
   secret key in `STRIPE_CREW_SECRET_KEY`.
2. Under **Developers > Webhooks**, add two event destinations, both at
   `https://studio.model.earth/crew/webhook`:
   - **Your account**: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`
   - **Connected accounts**: `account.updated`
3. Put both signing secrets in `STRIPE_CREW_WEBHOOK_SECRET`, comma-separated, and run
   `npm run deploy`. `npm run check` says whether both live values are set.

### GitHub sign-in

Create a GitHub OAuth app for each site under **GitHub > Settings > Developer settings >
OAuth Apps > New OAuth App** (the GitHub CLI and API can't create OAuth apps). Its redirect
(callback) URL is the site's `/crew/auth/callback`. Leave wildcard matching and Device Flow off.

The crew env file can hold several apps. Give each a name in its keys, and list its hosts:

| Key                           | Value                                            |
| ----------------------------- | ------------------------------------------------ |
| `GITHUB_<NAME>_NAME`          | The app's GitHub application name (optional)     |
| `GITHUB_<NAME>_HOST`          | Its hosts, comma-separated: `studio.model.earth` |
| `GITHUB_<NAME>_CLIENT_ID`     | The app's client ID                              |
| `GITHUB_<NAME>_CLIENT_SECRET` | A client secret generated for the app            |

For example `GITHUB_EARTH_1_*` for `studio.model.earth` (named "Model.Earth Studio"),
`GITHUB_CREW_1_*` for `crew.dreamstudio.com` and `GITHUB_LOCAL_1_*` for `localhost:4201`
(callback `http://localhost:4201/crew/auth/callback`). Each request uses the app named for its
host, and hosts without one use `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
`npm run deploy` doesn't upload apps whose hosts are all localhost, and `npm run check` says
whether the deployed site has an app.

## Deploy to Cloudflare

```bash
npm run check                         # read-only: lists what the deploy still needs
npm run deploy                        # from crew: publishes https://studio.model.earth
npm run deploy -- --skip-webapp-build # reuse the last webapp build
```

It takes `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the shell when set there,
otherwise from the crew env file, otherwise from the env file at `cloudflare_env_file:` in
`automation/paths.yaml` (for example the one CloudRoot uses).
With `--wrangler-login` it uses a `npx wrangler login` session instead. The token needs
Workers Scripts, D1 and Workers custom domain (model.earth zone) edit access. Then it:

1. Creates the `studio-crew` D1 database on the first run and saves its id in `wrangler.jsonc`.
2. Applies `migrations/` to it.
3. Builds the webapp, and copies it with `projects` and `localsite` into `./site` (not committed).
4. Deploys with every set value in the crew env file as a Worker secret, except
   `CREW_DEV_LOGIN`, the Stripe sandbox keys, localhost-only GitHub apps and the `vars` in
   `wrangler.jsonc`.
5. Attaches `studio.model.earth` (a custom domain, so Cloudflare adds its DNS record and
   certificate) and checks `/crew/health`.

Set `CREW_ADMIN_GITHUB_LOGINS` to real GitHub logins before deploying. The hub pages the site
serves get `window.crewBaseUrl = "/crew"`, so their links stay on the same host.

## ArtCraft accounts on studio.model.earth

The webapp's accounts, credits and subscriptions live in ArtCraft's backend
(`https://api.storyteller.ai`). That API only accepts browser requests from ArtCraft's own
sites, and ArtCraft's Google sign-in only works there, so sign-up and login fail on
studio.model.earth ("Failed to fetch", and Google's "Missing required parameter: client_id").

Until ArtCraft allows this site, `ARTCRAFT_ACCOUNTS_URL=https://app.getartcraft.com` in the
crew env file sends account pages to ArtCraft:

- Opening or moving within the webapp to `/login`, `/signup`, `/set-password`,
  `/forgot-password`, or a signed-in-only page (`/library`, `/media`, `/video-editor`,
  `/referrals`, `/onboarding`, `/checkout/...`) goes to the same page on app.getartcraft.com,
  keeping `?from=` so people land back on the page they wanted, on ArtCraft.
- The home page, the `create-` pages, `/pricing` and `/welcome` stay on studio.model.earth for
  previewing. "Continue with Google" is hidden here; it remains on ArtCraft's sign-up page.
- Localhost is never redirected, since it uses the local backend.
- The webapp's "Couldn't load models" notice, which here only means ArtCraft's API refused
  this site, is hidden by `crew/css/studio.css` on the deployed site. Other notices still show.

## Folders served at the site root

`crew/site-folders.json` lists the submodules in `crew/` served at the site root
(`/engine/`, `/projects/`, ...). The Worker and `scripts/crew.mjs` both read it, and
`crew/site.assetsignore` keeps files out of the site (dot-files, key files, servers and data
caches, as on cloud.model.earth). To add another ModelEarth repo, from studio:

```bash
git submodule add https://github.com/ModelEarth/<name> crew/<name>
```

then add `<name>` to `crew/site-folders.json`, keep `.gitmodules` in alphabetical order, and
run `npm run deploy`. Each file must be under Cloudflare's 25 MiB limit, and the whole site
under 20,000 files.

## Added to every page

The Worker adds these to pages without changing the webapp's or the hub's files
(`crew/src/site.ts`, and `crew/src/html.ts` for the crew pages):

- localsite's stylesheet and script, `/localsite/css/base.css` and
  `/localsite/js/localsite.js?showheader=true&showsearch=true`, unless the page already loads
  them (the hub's pages do).
- On webapp pages, `crew/css/studio.css` (served at `/crew/css/studio.css`) and short
  scripts that fit the webapp below localsite's header and switch it to light colors while
  localsite is in light mode (its dark mode toggle or Settings). With no saved choice,
  localsite and the webapp are dark.
- On the deployed webapp pages, the account-redirect script described above.

Put further style changes for the webapp in `crew/css/studio.css`.

Leave the value empty and run `npm run deploy` to turn this off, once ArtCraft has made the
changes below.

### Note for ArtCraft

> **Allowing studio.model.earth to use ArtCraft accounts**
>
> https://studio.model.earth is a Model.earth site that serves the ArtCraft webapp, built from
> an unmodified copy of artcraft-services (github.com/ModelEarth/studio), alongside our crew
> pages and projects hub. Its visitors would sign up for ArtCraft accounts and buy ArtCraft
> credits and subscriptions through ArtCraft's own API and Stripe account, so every
> purchase made there is ArtCraft revenue. For now we send sign-up and login to
> app.getartcraft.com, because two settings only allow ArtCraft's own sites:
>
> 1. **API CORS.** Add `https://studio.model.earth` as an allowed origin in
>    `crates/lib/actix_cors_configs/src/configs/artcraft_webapp.rs` (`add_artcraft_webapp`),
>    so `https://api.storyteller.ai` answers its requests. Today a preflight from that origin
>    returns 400, while `https://app.getartcraft.com` gets 200.
> 2. **Google sign-in.** Add `https://studio.model.earth` to the Authorized JavaScript origins
>    of the Google OAuth client the webapp uses, and let us build with that client's ID
>    (`VITE_GOOGLE_CLIENT_ID`, which is public in the built app), so Google sign-ins from
>    the site are verified by your backend like any other.
>
> We make no other changes to the webapp or backend, and can point the site at any
> ArtCraft API host or referral setup you prefer. Thank you!

## Pages

| Path                        | Method | What it does                                        |
|-----------------------------|--------|-----------------------------------------------------|
| `/crew/`                    | GET    | Your bids and payments; bids to review for admins   |
| `/crew/bid?repo=&issue=`    | GET    | Bids on an issue and the bid form                   |
| `/crew/bid`                 | POST   | Place or update your open bid                       |
| `/crew/bid/:id/:action`     | POST   | Accept/reject (admins), withdraw/deliver (bidder)   |
| `/crew/bounty?repo=&issue=` | GET    | Bounties offered for the issue and the bounty form  |
| `/crew/bounty`              | POST   | Offer or update your open bounty                    |
| `/crew/bounty/:id/withdraw` | POST   | Withdraw your open bounty                           |
| `/crew/pay?repo=&issue=`    | GET    | Pay accepted bids, send tips, see what was received |
| `/crew/pay/work`            | POST   | Stripe Checkout for an accepted bid                 |
| `/crew/pay/tip`             | POST   | Stripe Checkout for a tip or fee                    |
| `/crew/pay/bounty`          | POST   | Stripe Checkout for your bounty                     |
| `/crew/connect`             | GET    | Payout setup status                                 |
| `/crew/health`              | GET    | Returns ok                                          |
| `/crew/webhook`             | POST   | Stripe webhook (signed)                             |

Tables are in `migrations/`: `crew_members`, `crew_sessions`, `crew_bids`, `crew_bounties`,
`crew_payments` and `crew_stripe_events`.
