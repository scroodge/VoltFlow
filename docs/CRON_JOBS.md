# Cron jobs

VoltFlow exposes protected HTTP routes for maintenance jobs. They are not
scheduled by Vercel, GitHub Actions, or a database extension. Production uses
the owner's Contabo crontab.

## 12V auxiliary-battery health

`POST /api/cron/aux-battery-health` evaluates completed UTC days from
`bydmate_aux_voltage_daily.v_resting` and sends the acute alert or weekly
decline digest when applicable.

### Required configuration

1. Set the same strong `CRON_SECRET` value in the Vercel production
   environment and the Contabo crontab.
2. Set `VOLTFLOW_ORIGIN` from the canonical origin in
   [`src/lib/site-url.ts`](../src/lib/site-url.ts). Do not copy a Vercel preview,
   `www`, or legacy hostname into the command.
3. Install **only** the battery-health entry shown below.

The endpoint fails closed: when `CRON_SECRET` is unset in Vercel, missing, or
wrong, it returns HTTP 401 and performs no evaluation.

Copy these lines into the owner's crontab, replacing both placeholders. The
current `VOLTFLOW_ORIGIN` value must match `DEFAULT_SITE_URL` in
`src/lib/site-url.ts`:

```cron
CRON_TZ=UTC
VOLTFLOW_ORIGIN=<DEFAULT_SITE_URL-from-src/lib/site-url.ts-without-trailing-slash>
VOLTFLOW_CRON_SECRET=<same-strong-value-configured-as-CRON_SECRET-in-Vercel>
17 4 * * * /usr/bin/curl --fail --silent --show-error --request POST --header "x-cron-secret: ${VOLTFLOW_CRON_SECRET}" "${VOLTFLOW_ORIGIN}/api/cron/aux-battery-health" >> /var/log/voltflow-aux-battery-cron.log 2>&1
```

The job runs at **04:17 UTC daily**. `v_resting` is a per-UTC-day value, so an
early same-day evaluation would see an incomplete day. The route itself reads
only completed UTC days; the additional four-hour delay allows late overnight
telemetry to arrive. Minute 17 also avoids the common top-of-hour cron spike.

Manual smoke test (same variables as above):

```sh
/usr/bin/curl --fail --silent --show-error --request POST \
  --header "x-cron-secret: ${VOLTFLOW_CRON_SECRET}" \
  "${VOLTFLOW_ORIGIN}/api/cron/aux-battery-health"
```

## Inactivity check — do not schedule casually

> **DANGER — DO NOT COPY OR SCHEDULE THE INACTIVITY ENDPOINT AS PART OF THE
> BATTERY-ALERT SETUP.** `POST /api/cron/inactivity-check` sends a warning at
> 30 days and then **DELETES ACCOUNTS at 60 days**. It appears never to have run
> automatically against production data, and its warning-email step was
> previously broken. Activating it could silently turn on an unproven account-
> deletion path. It requires a separate audit, dry run, and explicit approval.

The inactivity route is listed here only so both existing cron endpoints are
discoverable. The crontab instructions above are intentionally scoped to
`/api/cron/aux-battery-health` and must not be generalized to other routes.
