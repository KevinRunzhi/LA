# Deployment assets

This directory contains executable deployment contracts for the competition platform:

- `gunicorn.conf.py`: production WSGI process settings;
- `env/production.env.example`: non-secret runtime configuration template;
- `systemd/la-case-platform.service`: hardened native Linux service;
- `nginx/la-case-platform.conf`: optional reverse proxy and static asset cache;
- `loongarch/scripts/`: environment check, install, preflight, start, stop, health, backup, restore and reset.

The LoongArch route is native Linux deployment. Docker is intentionally not required because target-image compatibility must not be assumed without validation on the actual `loongarch64` host.

See `Docs/competition-submission-deployment-guide.md` for the operational sequence.
