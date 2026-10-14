# Deploying on Replit

The app is one Node process: the API also serves the built web app. You need a hosted Postgres and one LLM key.

## 1. Import
Import this repository into Replit (GitHub import), branch `claude/nifty-edison-s6kot1` or whichever you merge to.
`.replit` already sets the build (`npm ci && npm run build`) and run (`npm run start:prod`) commands.

## 2. Database (required for a real deployment)
Replit deployments do not keep files between restarts, so the built-in local database (PGlite) would lose your data.
Use a hosted Postgres and set `DATABASE_URL` (Replit's Postgres/Neon, Supabase, RDS, ...). Tables are created automatically on start.
TLS is on by default for non-local hosts (`PGSSL=false` turns it off).

## 3. Secrets (Replit "Secrets" tab, not committed)
| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` | LLM. Without one, the app serves illustrative mock data |
| `OPENROUTER_MODEL` (optional) | e.g. a DeepSeek model id from openrouter.ai/models |
| `OPENROUTER_PROVIDERS` (optional) | pin which hosts may serve the model |
| `NODE_ENV=production` | set by `start:prod` already |

## 4. Before you put real client data in
- **There is no login.** Anyone who can open the deployment URL can read and change everything. The "Viewing as" switcher
  only simulates roles; it is not security. Use your host's option to restrict access (for example a private deployment, if
  your Replit plan offers it) or keep the data to non-sensitive test clients.
- Confirm your firm's policy approves the LLM provider, model and hosts you configured.
- `config/independence.yaml` holds **placeholder** audit-gate rules. Have Risk / Independence confirm them.
- Check the startup log: it prints the LLM provider, the database kind and the warnings above.

## 5. Verify
Open the URL, qualify a client, then reload the page: it should still be in the Clients list (proves the database persists).
`GET /api/health` returns `{ ok: true, llm: ... }`.

## Scaling note
Dev data in `.data/` is for local development only; do not commit it (it is git-ignored).
