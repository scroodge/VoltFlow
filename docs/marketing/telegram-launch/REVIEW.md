# Screenshot review — 2026-10-07

Capture: `2026-10-07T13:05:41.698Z`; 20 primary screens plus 42 scroll panels.
Automated capture passed with zero browser errors and zero local HTTP failures.
All 62 PNGs were visually inspected in six contact sheets; charge detail and
active dashboard were additionally inspected at full resolution. Review status:
**reviewed with observations**, not publication approval.

## Data and capture corrections

- Ordinary fictional-user authentication and RLS retained; authenticated navigation
  stays in one context, public knowledge uses a separate anonymous context.
- Hydrated links and actual fixture content are awaited before screenshots;
  visible loading placeholders are rejected. All images use phone-sized panels.
- Existing hourly telemetry and daily SOH functions materialize the seeded raw
  measurements: 76 samples, 27 hourly buckets and four SOH days.
- Independent data audit passed before capture and after restoring parked state:
  one 45.1 kWh car, four completed charges, 12 trips / 482 km, three service
  records / 175 BYN. Receipt: 51% → 86%, 16.107 grid kWh, 8.86 BYN.
- Seven external browser attempts were fulfilled locally (Vercel scripts and one
  labelled map placeholder); no other external attempts occurred. This is browser
  interception evidence, not a server-egress packet audit.

## Observations and caption limits

- History calls a user-defined provider **Custom**, while charge detail correctly
  shows **Malanka**. This existing display issue is not corrected by changing fake
  data. Avoid claiming the history label identifies the provider correctly.
- Active dashboard and vehicle use different target horizons (100% versus the
  session target), so their estimates differ; do not caption them as identical ETAs.
- Active vehicle's delta chart honestly reports no session points. GPS, resting
  auxiliary-battery history and full-charge balancing cycles are intentionally
  absent; their insufficient-data states are not successful measurement proofs.
- The public calculator is a separate generic example, including its displayed
  currency/default capacity; it is not the authenticated 45.1 kWh / BYN receipt.
- Hard-load active-ETA hydration was not fixed; capture proves ordinary in-app
  navigation only. Real Mate delivery, Telegram, remote commands and other external
  integrations remain unverified. Login/signup/recovery are outside this pack.

The channel was not created and no messages were published. Review the gallery
and Russian drafts before separately authorizing publication.
