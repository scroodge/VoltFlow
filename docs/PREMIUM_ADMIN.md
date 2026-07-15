# Premium and data retention

VoltFlow supports account entitlements that may change available features and data
retention. The active entitlement is evaluated server-side for every authenticated request.

## Retention

| Data | Standard access | Extended access |
| --- | --- | --- |
| Detailed telemetry | Limited retention | Longer retention where available |
| Route-track points | Limited retention | Longer retention where available |
| Hourly aggregates | Long-term retention | Long-term retention |

Retention is applied by scheduled server-side jobs. Users can export available data from
the application before it expires.

## Security

- Entitlements are evaluated on the server and protected by Row Level Security.
- Administrative access is not granted through client-side flags.
- Billing, payment, and operational administration are not part of this public document.
