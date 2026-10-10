# DentEra

DentEra is a dental-practice demo for doctors, with appointment management, patient charts, treatment plans, billing, and the Era assistant.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:8100`. To use Era's hosted female Sofia voice, set `NVIDIA_API_KEY` in a local `.env` file (or as a Render secret). If the hosted service is unavailable, Era prefers a female voice provided by the browser or operating system; text assistance remains available without either voice service.

## Deploy to Render

The repository-root `render.yaml` Blueprint deploys the DentEra service from `apps/dental`. Create a Blueprint from the repository and deploy the `dentera` web service. Render generates `JWT_SECRET` automatically and prompts for the optional `NVIDIA_API_KEY` as a secret; without it, the browser-provided female voice fallback is used.

The free service uses temporary local SQLite storage. Treat this deployment as a demo only: records can be lost when the service restarts or is redeployed. Do not enter real patient or other sensitive health information. Persistent clinic use needs durable database storage and appropriate privacy/security controls.
