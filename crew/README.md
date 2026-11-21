# Crew

Crew members bid on project issues (GitHub issues shown on the projects hub), deliver
creative work, and get paid through Stripe Connect. People watching a production can also
send them tips and fees.

Crew is a Cloudflare Worker with a D1 database, deployed at https://studio.model.earth and
run locally on http://localhost:4201. The one Worker serves the whole site:

| Path            | What it serves                                                          |
|-----------------|-------------------------------------------------------------------------|
| `/crew/`        | Crew pages (`CREW_BASE_PATH`)                                           |
| `/projects/`    | The projects hub, from the `crew/projects` submodule                    |
| `/localsite/`   | localsite, from the `crew/localsite` submodule, which the hub loads     |
| everything else | The ArtCraft webapp (Vite on 4202 locally, the built app when deployed) |

Crew uses its own Stripe account, separate from the ArtCraft account in storyteller-web, set by
`STRIPE_CREW_SECRET_KEY` in the crew env file.

`crew/projects` is the [ModelEarth/projects](https://github.com/ModelEarth/projects) submodule.
Its hub (`projects/hub/`) shows Bid and Payment links on each issue, on localhost only
(`class="local"`). On this site they open `/crew` on the same host.

## How it works

1. A crew member signs in with GitHub and opens **Bid** on an issue: amount and what they'll deliver.
2. A site admin (`CREW_ADMIN_GITHUB_LOGINS`) accepts or rejects bids.
3. The crew member sets up payouts (**Payouts** page), which creates a Stripe Express account
   on the crew platform and walks them through Stripe onboarding.
4. When work is delivered, the crew member adds a link (such as the pull request).
5. On the **Payment** page, a signed-in user pays the accepted bid, or sends a tip to any crew
   member on that issue. Stripe Checkout takes the payment, keeps `CREW_PLATFORM_FEE_PERCENT`
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

1. In the crew Stripe account, turn on **Connect** (Express accounts).
2. Put the test secret key in `STRIPE_CREW_SECRET_KEY`.
3. Forward webhooks locally with the Stripe CLI, and put the `whsec_...` it prints in
   `STRIPE_CREW_WEBHOOK_SECRET`:

   ```bash
   stripe listen --forward-to localhost:4201/crew/webhook --forward-connect-to localhost:4201/crew/webhook
   ```

   When deployed, add a webhook endpoint at `https://studio.model.earth/crew/webhook` with
   "Listen to events on connected accounts" turned on, for these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`,
   `account.updated`.

### GitHub sign-in

Create a GitHub OAuth app with callback URL `http://localhost:4201/crew/auth/callback`
(and another for `https://studio.model.earth/crew/auth/callback`), and put its ID and secret
in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

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
   `CREW_DEV_LOGIN` and the `vars` in `wrangler.jsonc`.
5. Attaches `studio.model.earth` (a custom domain, so Cloudflare adds its DNS record and
   certificate) and checks `/crew/health`.

Set `CREW_ADMIN_GITHUB_LOGINS` to real GitHub logins before deploying. The hub pages the site
serves get `window.crewBaseUrl = "/crew"`, so their links stay on the same host.

## Pages

| Path                     | Method | What it does                                        |
|--------------------------|--------|-----------------------------------------------------|
| `/crew/`                 | GET    | Your bids and payments; bids to review for admins   |
| `/crew/bid?repo=&issue=` | GET    | Bids on an issue and the bid form                   |
| `/crew/bid`              | POST   | Place or update your open bid                       |
| `/crew/bid/:id/:action`  | POST   | Accept/reject (admins), withdraw/deliver (bidder)   |
| `/crew/pay?repo=&issue=` | GET    | Pay accepted bids, send tips, see what was received |
| `/crew/pay/work`         | POST   | Stripe Checkout for an accepted bid                 |
| `/crew/pay/tip`          | POST   | Stripe Checkout for a tip or fee                    |
| `/crew/connect`          | GET    | Payout setup status                                 |
| `/crew/health`           | GET    | Returns ok                                          |
| `/crew/webhook`          | POST   | Stripe webhook (signed)                             |

Tables are in `migrations/0001_crew.sql`: `crew_members`, `crew_sessions`, `crew_bids`,
`crew_payments` and `crew_stripe_events`.
