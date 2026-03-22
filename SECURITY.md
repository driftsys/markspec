# Security Policy

## Supported Versions

Only the **latest release** of each driftsys project receives security updates.
If you are using an older version, please upgrade before reporting.

## Reporting a Vulnerability

**Please do not open a public issue or pull request for security
vulnerabilities.**

Report vulnerabilities through
[GitHub's private vulnerability reporting][gh-pvr] on the affected repository.
Go to the **Security** tab and select **Report a vulnerability**.

If you cannot use GitHub, email <security@driftsys.org>.

[gh-pvr]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability

## Response

- **Acknowledgment** within 48 hours of your report.
- **Assessment** within 7 days: we will confirm whether the issue is accepted,
  request more information, or explain why it was declined.
- **Fix timeline** depends on severity. We aim to release a patch within 30 days
  for confirmed vulnerabilities.

## Disclosure

We follow coordinated disclosure:

1. We work on a fix in private.
2. We release the fix and publish a security advisory.
3. We credit the reporter (unless anonymity is requested).

We ask that you do not disclose the vulnerability publicly until a fix has been
released or 90 days have passed since your initial report, whichever comes
first.

## Third-Party Dependencies

If the vulnerability is in a dependency rather than driftsys code, please report
it to the upstream maintainer directly and let us know so we can track the fix.
