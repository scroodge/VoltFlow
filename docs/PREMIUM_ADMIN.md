# Account access, donations, and data retention

VoltFlow supports account entitlements that may change available features and data
retention. The active entitlement is evaluated server-side for every authenticated request.

Premium access is an administrative account setting, independent of financial support.
Voluntary donations do not grant, extend, or change Premium access or data retention.
There is no recurring subscription or automatic renewal in the application.

## Retention

| Data | Standard access | Extended access |
| --- | --- | --- |
| Detailed telemetry | 30 days | Retained while the account is active |
| Route-track points | 30 days | Retained while the account is active |
| Hourly aggregates | 3 years | Retained while the account is active |

Retention is applied by scheduled server-side jobs. Users can export available data from
the application before it expires.

## Security

- Entitlements are evaluated on the server and protected by Row Level Security.
- Administrative access is not granted through client-side flags.
- Administrators may record a reported donation for statistics without changing account
  access. Historical payment records are retained as history and are not reclassified as
  donations.
- The donation record is app-owned operational data in Postgres. The support page
  shows transfer details after sign-in and asks for a receipt plus account email and
  ID so an administrator can attribute the donation. The current admin statistics
  form records only account-linked donations. No donation data is stored in localStorage.
- Payment processing and operational administration are not part of this public document.
