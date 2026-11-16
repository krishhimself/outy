# Deployment checklist

Settings that live outside this repository. Nothing here can be checked by the tests, so go through it by hand before real users arrive.

## Order of deployment

Deploy the **backend first**, then ship the app. The app expects endpoints (`/gallery/count`, `/health`) that older backends do not have.

## Render (backend)

- [ ] Root directory is `backend`; build command `pip install -r requirements.txt`; start command `uvicorn server:app --host 0.0.0.0 --port $PORT`.
- [ ] Environment variables set: `MONGO_URL`, `DB_NAME`, `RESEND_API_KEY`. Leave `GOOGLE_AUTH_ENABLED` unset.
- [ ] Auto-deploy points at the `main` branch.
- [ ] After a deploy, open `https://<service>.onrender.com/health` and expect `{"status":"ok"}`.
- [ ] The free tier sleeps when idle and takes up to a minute to wake. A paid instance removes this.

## MongoDB Atlas

- [ ] **Database user:** a long random password, used only by this app. Role `readWrite` on the `outy` database, not an admin role.
- [ ] **Network access:** Render shows each service's outbound IP addresses in its dashboard. Allowing only those in Atlas is the tighter option. If Atlas is set to `0.0.0.0/0` (allow from anywhere), the database password is the only lock, so the previous item matters.
- [ ] If the connection string was ever pasted into a chat, a screenshot or a commit, rotate the password in Atlas and update `MONGO_URL` on Render and in `backend/.env`.
- [ ] Free (M0) clusters pause after long inactivity and must be resumed by hand in the Atlas dashboard.
- [ ] Check whether your cluster tier includes backups; if not, export the data before any risky change.

## Resend (email)

- [ ] Until a sending domain is verified, reset emails only reach the Resend account owner.
- [ ] After verifying a domain, change the `from` address in `backend/app/routers/auth.py`.
- [ ] If the API key was ever shared, create a new one and delete the old one.

## Uptime monitor

- [ ] Monitor URL is `https://<service>.onrender.com/health`.

## Expo

- [ ] `frontend/.env` has `EXPO_PUBLIC_BACKEND_URL` pointing at the Render URL (no `/api`, no trailing slash).
- [ ] The project is on Expo SDK 54; the newest is SDK 58. Expo Go from the stores runs only the newest SDK, so updating Expo Go on a phone can stop it opening this project until the SDK is upgraded.
