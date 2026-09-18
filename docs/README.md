# Documentation index

Technical documents kept with the source. Written in Spanish, the language the system
operates in.

| Document | What it explains | Read it when |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Component boundaries, threat model, persistence and authorisation decisions, challenge state machine, privacy limits | You want the design rationale and what the system deliberately does not guarantee |
| [FACE_IDENTIFICATION.md](FACE_IDENTIFICATION.md) | 1:N matching: alignment, embeddings, two-best-template average, median across queries, threshold and margin | You want to understand how a face becomes an identity |
| [FACE_ENROLLMENT.md](FACE_ENROLLMENT.md) | Consent, active challenge, six samples, duplicate prevention, transactional replacement | You want to understand how a person is registered |
| [FACE_LIVENESS.md](FACE_LIVENESS.md) | Geometric presence checks during enrolment: blink EAR, yaw transitions, continuity, timings | You want the exact scope of the liveness checks |
| [IDENTIFICATION_UX_CHANGE.md](IDENTIFICATION_UX_CHANGE.md) | Why identification dropped active challenges, and what that costs in anti-spoofing terms | You are assessing the security trade-off |
| [FACE_IDENTIFICATION_CALIBRATION.md](FACE_IDENTIFICATION_CALIBRATION.md) | How to calibrate threshold and margin for a local population | You are tuning the matcher |
| [AUDITORIA_NOMINA_COLOMBIA_2026.md](AUDITORIA_NOMINA_COLOMBIA_2026.md) | Payroll parameters contrasted against Colombian regulations, with the reference date | You want to check the payroll rules |
| [CONTENEDOR_UNICO.md](CONTENEDOR_UNICO.md) | Day-to-day operation of the single container: volume, backups, recovery | You are running or restoring the system |
| [OFFLINE_INSTALLATION.md](OFFLINE_INSTALLATION.md) | Building the offline package and installing it on a machine without internet | You are deploying to a new machine |
