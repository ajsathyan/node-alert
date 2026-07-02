# node-alert

Deprecated Online Tail node monitor for https://agora.pluralis.ai/.

The scheduled GitHub Actions monitor has been removed and no longer runs. The
remaining Node app is kept only for local reference or manual dry runs.

Historically, the monitor opened the Agora site with Playwright, went to the
Nodes tab, filtered Status to Online, searched for Tail, and emailed when
either:

- one or more displayed Tail machine names do not contain `Pluralis`
- more than two displayed Tail machine names do contain `Pluralis`

The app code lives in `node-alert/`.

## Deprecated GitHub Setup

No GitHub workflow is installed. These repository secrets are no longer used by
automation and can be removed if no other workflow needs them:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`

Optional:

- `ALERT_TO`, defaults to `akhil.js33@gmail.com`

## Local Dry Run

```sh
cd node-alert
npm install
npm run check:dry
```
