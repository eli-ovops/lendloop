# LendLoop — implementation and verification notes

LendLoop is a neighbourhood tool-lending take-home project, built with Next.js,
TypeScript, Clerk, Convex and n8n. See [README.md](./README.md) for the
setup instructions, architecture, permissions and workflow exports.

## Source publication

This public repository was imported from a supplied source archive. The archive
did not contain a `.git` directory, so this repository starts with a new initial
import rather than presenting reconstructed development history.

Private application correspondence and internal delivery notes are excluded
from the public version. The README now reflects the loan-state and email
delivery checks added after the initial import.

## Integration boundary

Clerk, Convex, SMTP and n8n require the accounts and environment configuration
listed in the README. The checked-in Convex generated-reference files are
stand-ins that are replaced by the official code generator when a deployment is
connected. Source publication is not evidence that the hosted authentication,
notification and email flows have been connected or exercised end to end.

No external deployment or scheduled workflow is activated by publishing this
repository.

## Checks run for this publication — 2026-11-17

- Dependency installation completed from the lockfile with lifecycle scripts
  disabled.
- `next typegen` followed by `tsc --noEmit --incremental false` passed.
- `npm run build` passed, generating `/`, `/my`, `/admin` and the proxy.

The build used synthetic public configuration values. These checks establish
local type-checking and build results; they do not establish that real Clerk,
Convex, n8n or email integrations have been exercised.

## Portfolio revision checks — 2026-11-18

- `npm test` passed 8 tests. The suite exercises the Convex handlers through
  a simulated database and checks both n8n exports, including their signing
  and receipt code with mock workflow data.
- `npm run lint` and `tsc --noEmit --incremental false` passed.
- `npm run build` passed using synthetic public configuration. Testing
  with live Clerk, Convex, n8n and a test mailbox is a separate setup step.
