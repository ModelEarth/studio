# Crew AGENTS.md

## Where to edit

studio is our copy of artcraft-services (upstream: storytold/artcraft-services). In studio,
limit edits to these folders:

- `crew/`: the studio site's Worker (this folder), including the `crew/projects` and
  `crew/localsite` submodules
- `automation/`: local scripts and `paths.yaml`
- `support/`

Leave the rest of studio unchanged (Rust backend, frontend, script, root config), so upstream
changes merge cleanly. Root `.gitmodules` may change only to add or update the crew submodules.

## The studio site

One Cloudflare Worker serves all three on http://localhost:4201, and when deployed at
https://studio.model.earth:

| Path            | What it serves                                                           |
|-----------------|--------------------------------------------------------------------------|
| `/crew/`        | Crew pages: bids on GitHub issues, Stripe Connect payments and tips      |
| `/projects/`    | The projects hub (`crew/projects` submodule), with Bid and Payment links |
| `/localsite/`   | localsite (`crew/localsite` submodule), which the hub loads              |
| everything else | The ArtCraft webapp                                                      |

Locally the Worker forwards webapp paths to the webapp's Vite dev server on 4202.
Deployed, the webapp is the built app copied into `crew/site`.

Env files stay outside the repo. `automation/paths.yaml` (not committed, created from
`automation/paths.example.yaml`) says where they are:

- `crew_env_file:` the crew settings (see `crew/.env.example`), including
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for deploys
- `cloudflare_env_file:` optional, another env file to take those two Cloudflare keys from,
  such as the one CloudRoot uses for cloud.model.earth

Name only these keys in docs and code, never the folders they point to, since each
machine's `paths.yaml` can differ.

## Deploy

From the crew folder, `npm run deploy` publishes https://studio.model.earth. It creates the D1
database on the first run, applies its migrations, builds the webapp, assembles `crew/site`,
uploads the crew settings as Worker secrets (not `CREW_DEV_LOGIN`), and attaches the custom
domain. `npm run check` is read-only and lists what a deploy still needs.
A deploy publishes the live site, so confirm with the user before running it.
Details are in `crew/README.md`.

## Start commands

"Start Artcraft", "Start Studio" and "Start Crew" all start the combined site on 4201.
"Start Artcraft Backend" starts the API on 12345, only when requested.
Run each in the background, and wait until its port responds before opening a Brave tab.

### Studio 4201

1. In the studio folder, start the webapp dev server on 4202:

   ./automation/webapp-dev.sh

   It runs the same preflight as script/website/unix_frontend_webapp_dev.sh, then installs with
   `npm ci` (automation/frontend-install.sh) so frontend/package-lock.json stays unchanged,
   with `VITE_USE_LOCAL_API=true` so API calls go to the local backend on 12345.
   The first run takes a few minutes.

2. In the studio/crew folder, start the site on 4201:

   npm run dev

   It applies the local D1 migrations, then serves http://localhost:4201 with the crew pages at
   /crew/ and the hub at /projects/hub/. Run `npm install` there first if node_modules is missing,
   and `git submodule update --init crew/projects crew/localsite` from the studio folder if
   those folders are empty.

Open http://localhost:4201/ (webapp), http://localhost:4201/crew/ and
http://localhost:4201/projects/hub/. Don't also run script/website/unix_frontend_webapp_dev.sh,
which takes port 4201 for the webapp alone.

The marketing website (Next.js, port 3000) starts only when requested, with
./script/website/unix_frontend_website_dev.sh from the studio folder.

### Artcraft Backend 12345

Starts storyteller-web from ../artcraft-services, where it is built and its local secrets file
lives. Its local services must be running first:

- MySQL 8.4 (3306) and Redis (6379): `brew services start mysql@8.4` and `brew services start redis`
- Elasticsearch 8.19.25 (9200): `~/opt/elasticsearch-8.19.25/bin/elasticsearch -d -p ~/opt/elasticsearch-8.19.25/es.pid`
- SeaweedFS S3 storage (8333, plus 9333, 9340, 18888 and 12535): `nohup ~/opt/seaweedfs/start.sh > ~/opt/seaweedfs/weed.log 2>&1 &`

Then in the ../artcraft-services folder, run:

SQLX_OFFLINE=true cargo run -p storyteller-web

Local keys and bucket settings are in its gitignored
crates/service/web/storyteller_web/config/storyteller-web.development-secrets.env.
Database migrations: `diesel migration run` (diesel is in ~/.cargo/bin).
