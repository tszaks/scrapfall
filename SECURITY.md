# Security policy

## Supported versions

Only the live build at https://szakacsmedia.com/game/ (the latest `main`) gets security fixes.

| Version | Supported |
|---|---|
| Latest `main` (live site) | Yes |
| Older builds | No |

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. If that is not available to you, email tyler@szakacsmedia.com.

Please include what you found, what an attacker could do with it, and steps to reproduce. You can expect a first reply within a few days.

## What counts

- **The TURN credential endpoint** (`api/turn.ts`). It mints short-lived Cloudflare TURN credentials for co-op. The key id and token stay on the server. Anything that leaks them, or lets a caller abuse the relay, matters.
- **Co-op messages.** Players connect browser to browser through PeerJS. The host is authoritative. A guest that can crash a host, forge host state or read another player's data matters.
- **The static site.** Anything that lets a page run script it should not, or reaches another origin's data.

Scrapfall has no accounts and stores no personal data. See the FAQ in the [README](README.md#faq).
