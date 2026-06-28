# node-alert

Public GitHub Actions monitor for Online Tail nodes on https://agora.pluralis.ai/.

The monitor opens the Agora site with Playwright, goes to the Nodes tab, filters Status to Online, searches for Tail, and emails only when the resulting machine list includes one or more displayed names that do not contain `Pluralis`.

The app code lives in `node-alert/`.

## GitHub Secrets

Set these repository secrets:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`

Optional:

- `ALERT_TO`, defaults to `akhil.js33@gmail.com`

## Local Run

```sh
cd node-alert
npm install
npm run check:dry
```
