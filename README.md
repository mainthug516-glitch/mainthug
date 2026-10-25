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

This project is ready to deploy as a single Node service on Render using the included `render.yaml` file.

1. Push the project to GitHub.
2. In Render, create a new "Web Service" and connect the repository.
3. Select the default Node runtime.
4. Render will read `render.yaml` automatically for the service configuration.
5. Add or confirm the environment variables:
   - `NODE_ENV=production`
   - `HOST=0.0.0.0`
   - `PORT=3000`
   - `SESSION_SECRET` generated from `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`
   - `FRONTEND_ORIGIN=https://your-render-app.onrender.com`
   - `DATABASE_DIR=/var/data/luma`
6. Click deploy. The app will serve the dashboard and API from the same origin.

For a custom domain, add the domain in Render, then update the DNS records and set `FRONTEND_ORIGIN` to the final HTTPS origin.
