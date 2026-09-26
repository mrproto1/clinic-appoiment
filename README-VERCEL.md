# Deployment to Vercel

This project is a frontend app with a PHP/MySQL backend. Vercel can host the frontend static files, but the PHP API and MySQL database must be hosted separately.

## 1) Frontend deployment

1. Push this project to GitHub.
2. Open Vercel and import the repository.
3. Set the project root to the repository root.
4. Use the following settings:
   - Framework: Other
   - Build Command: leave blank
   - Output Directory: src
5. Deploy.

## 2) API deployment

Because this app uses PHP and MySQL, the backend in `api/index.php` should be deployed to a PHP-capable host such as:
- Render
- Railway
- VPS / cPanel
- a custom PHP server

Make sure the backend is publicly reachable at a URL like:
- `https://your-backend-url.com/api`

## 3) Configure runtime API URL

Before deploying the frontend, set the runtime API base in the browser:

```html
<script>
  window.__APP_API_BASE__ = 'https://your-backend-url.com/api';
</script>
```

Place it before the app scripts in the HTML file, or set it from the deployed environment.

## 4) Important note

The current app uses local PHP + MySQL under XAMPP. That setup will not work on Vercel directly. Vercel is only suitable for the static frontend portion.

## 5) Suggested production architecture

- Frontend: Vercel
- Backend: Render / Railway / VPS
- Database: MySQL or Postgres service
- API URL: stored in runtime config or environment

## 6) Example env pattern

If you later wire this to a hosted backend, use:

```js
window.__APP_API_BASE__ = 'https://your-backend-url.com/api';
```
