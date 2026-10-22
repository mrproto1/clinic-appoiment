# Deployment to Vercel

This project runs its PHP frontend and API in Vercel's Container Runtime. The MySQL database remains a separate managed service.

## 1) Frontend deployment

1. Push this project to GitHub.
2. Import the repository in Vercel and leave Root Directory at the repository root.
3. Keep the Framework Preset as Other and do not set a static output directory.
4. Deploy with the Container Runtime enabled for the project.

## 2) API deployment

Vercel builds `Dockerfile.vercel` and routes the site and `/api/*` requests to the same container. Set `APP_SECRET`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASS`, `MYSQL_DB`, and `MYSQL_SSL_CA` in Vercel Project Settings under Environment Variables. `MYSQL_SSL_CA` must contain the CA certificate supplied by your database provider. The configured MySQL database must already exist and be reachable from Vercel.

After a suspected security incident, use new database credentials and a new `APP_SECRET`. Restore only from a backup you trust. Never put credentials in frontend code or commit them.

## 3) Configure runtime API URL

`src/js/runtime-config.js` uses the same-origin `/api` endpoint in production and auto-detects the local project path on localhost:

- `http://localhost/<project-folder>/api`
- `https://your-vercel-domain/api`

## 4) Important note

The container image serves the static files and PHP API. Vercel does not provide this app's MySQL database; provision one separately and configure the connection variables before using the API.

## 5) Suggested production architecture

- Frontend and backend: Vercel Container Runtime
- Database: trusted managed MySQL service
- API URL: same-origin `/api`

## 6) Optional API override

The Vercel container uses same-origin routing by default. Only set an override if the API is hosted on a different domain:

```js
window.APP_API_BASE_URL = 'https://your-backend-url.com/api';
```
