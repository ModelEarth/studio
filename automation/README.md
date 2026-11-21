# Automation

Local helper scripts for the crew site. See `crew/AGENTS.md` for the start steps.

| File                  | What it does                                                                |
|-----------------------|-----------------------------------------------------------------------------|
| `paths.example.yaml`  | Default locations of env files kept outside the repo                        |
| `paths.yaml`          | Your locations (not committed), created from the example on first use       |
| `env-file.mjs`        | Finds an env file from `paths.yaml`, same rules as CloudRoot's              |
| `webapp-dev.sh`       | ArtCraft webapp dev server on 4202, behind the crew site on 4201            |
| `frontend-install.sh` | `npm ci` in frontend when its lockfile changed; never rewrites the lockfile |

`crew_env_file:` points to the crew env file outside the repo, and the optional
`cloudflare_env_file:` to another env file with `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. Give crew a different file once with `npm run dev -- --env-file <path>` in `crew`,
and `paths.yaml` remembers it.
