# Legal Agreement Integration Baseline

## Canonical artifact

- File: `legal/2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.docx`
- Application version: `2026-v1.4`
- SHA-256: `566eb770dfff39987de06ce08a0c936235cd5f51bedac657d633e19f9d3de179`
- Structural review: 84 paragraphs, no tables, two embedded images, no comments, and no tracked changes.
- Embedded images: Savians Tax Advisors logo and Nagesh Mishra signature.

The DOCX is an immutable legal source. The portal may not silently rewrite wording, replace the signature, or normalize the title. A legal revision requires a new version and hash; existing signatures remain tied to the exact version accepted.

## Portal presentation and evidence

- Immutable portal PDF generated and visually verified: `legal/rendered/2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.pdf`.
- Portal PDF SHA-256: `12b86ceede1bcff2fda8f8489da01e0077d2ee4c145a6132c21f3d0720a98735` (5 pages).
- Store the source DOCX and rendered PDF under a versioned, read-only S3 key.
- Display the complete agreement before payment and before QuickBooks customer/invoice creation.
- Display the agreement date as read-only.
- Require an acknowledgement checkbox and typed full legal name.
- Keep submission disabled until both are supplied.
- Store template ID, version, DOCX hash, PDF hash, typed name, displayed date, UTC acceptance time, IP, user agent, session ID, client ID when available, and consent-text version.
- Generate a tamper-evident signed evidence copy and retain it with the session for seven years.

## Business/legal observations

- The approved title contains **Tax Assessment Plan**, while the portal product name intentionally does not use "Plans." Do not change the contract title without legal approval.
- The agreement identifies Savians LLC and Savians Tax Advisors Tulsa LLC.
- It permits electronic signatures and makes the last-signature date the effective date.
- It contains the Nagesh Mishra signature image and a blank client signature/name/date area.
- It says it supplements a prior Assessment Agreement. Counsel should confirm whether every direct-sign client has one; this does not block engineering.
- The implementation-fee clause says "Effective July 1 of the current year." Counsel should confirm whether a future revision should name the year.
- The confidentiality clause allows legally required retention. Confirm the seven-year policy with counsel/accounting before launch.

This is an implementation review, not legal advice. Engineers must not resolve wording questions by editing the contract.
