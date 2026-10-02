# Security Policy

## Secret handling

Never commit Discord bot tokens, OAuth client secrets, provider secrets, database passwords, private keys or session secrets.

Use environment variables or an external secret store.

## Local management API

The management API is bearer-key protected and defaults to loopback. Do not expose it directly to the public internet.

## Reports

Do not publish credentials or exploit details in a public issue. Report suspected vulnerabilities privately.