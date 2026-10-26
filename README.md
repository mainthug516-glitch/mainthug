# Luma account backend

The dashboard includes an interactive Settings area for profile details, security, notifications, appearance, currency, language, trading preferences, privacy, verification, connected devices, help, and account actions. Settings are currently a front-end preview and are not persisted to the account backend. The Notifications page uses clearly labeled illustrative demo items; notification read state and non-sensitive notification preferences are saved in the current browser's `localStorage`, not sent to the server. The demo does not create actual deposit, withdrawal, sign-in, or live market alerts. The dashboard also has account sign-up and sign-in backed by an Express server. Accounts are stored in SQLite, passwords are hashed with Argon2id, and authentication uses server-side sessions in an HTTP-only cookie. This does not process payments or trade crypto. Email verification and password recovery are not implemented; add those before using this for a public production service.

## Run locally

1. Install Node.js 20.17 or later.
2. Copy `.env.example` to `.env`.
3. Generate a unique session secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and replace the example `SESSION_SECRET` in `.env`.
4. Run `npm install`.
5. Run `npm start` and open `http://localhost:3000`.

The Express server serves the dashboard and its API from the same origin by default. User and session records are stored in the ignored `data` directory. The API routes are `POST /api/auth/signup`, `POST /api/auth/login`, and `POST /api/auth/logout`; `GET /api/auth/me` checks the current session.

## Deployment

Deploy behind HTTPS. Set `NODE_ENV=production`, a unique `SESSION_SECRET`, `FRONTEND_ORIGIN` to the exact HTTPS origin of the frontend (origin only, with no path), and `DATABASE_DIR` to persistent storage. Configure the reverse proxy to forward the original protocol so secure cookies work. If the frontend is hosted separately, set the `api-base` meta tag in `home.html` to the API origin (for example, `https://api.lunacrypto.com`); keep the frontend and API on the same site for the `SameSite=Lax` session cookie. Keep `.env`, the database directory, and session secrets private.

### Render deployment

This project deploys as a single Node web service on Render using the included `render.yaml` Blueprint. The service serves the dashboard and its account API from the same HTTPS origin. It uses Render's free plan, which has an ephemeral filesystem; demo accounts and sessions stored in SQLite can be lost when the service restarts or is redeployed. This dashboard uses simulated market and portfolio data and does not process payments or trade crypto.

1. Push the project to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com/), choose **New +** → **Blueprint** and connect `mainthug516-glitch/mainthug`.
3. Select the `main` branch. Render reads `render.yaml` and shows the service configuration for review.
4. Apply the Blueprint to create and deploy the `luma-crypto-dashboard` web service. Render generates the `SESSION_SECRET`; the other service settings are defined in `render.yaml`.
5. When the deploy finishes, open the service URL shown in Render. It should be `https://luma-crypto-dashboard.onrender.com`.

The free plan does not provide persistent storage for the SQLite database. Before relying on accounts, upgrade to a plan that supports a persistent disk and attach one at `/var/data/luma`, or move the user and session stores to a managed database. Do not store production account data on ephemeral storage. Email verification and password recovery are not implemented, so add these before making accounts available as a production service.

For a custom domain, add the domain in Render, configure its DNS records, and set `FRONTEND_ORIGIN` to the final HTTPS origin.
