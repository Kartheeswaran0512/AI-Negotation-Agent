# Negotiation Agent — mobile client

React Native (Expo, TypeScript) front end for the negotiation backend in the parent
directory. The backend is unmodified; this app is built entirely against its existing
HTTP contract.

## Run it

```bash
# 1. Start the backend (from the repository root, in another terminal)
npm run migrate && npm run seed
npm start          # API on :3000
npm run worker     # the agent loop

# 2. Start the app
cd mobile
npm install
npm start          # then press a / i, or scan the QR code
```

On first launch the app opens **Connection**. Enter:

| Field | Value |
| --- | --- |
| Server address | `http://localhost:3000` on a simulator, or your machine's **LAN IP** on a physical device (`http://192.168.x.x:3000`) |
| API key | whatever `API_KEY` is set to in the backend `.env`; leave blank if it is unset |
| Buyer id | `1` after `npm run seed` — required to accept an offer |

`npm run seed` also creates suppliers with ids **2, 3 and 4**, which is what you enter on
the *Add supplier* screen.

## Verify

```bash
npm run typecheck   # tsc --noEmit, strict
npm test            # 91 tests
npm run verify      # both
```

Nothing in the test run touches the network — `fetch` is stubbed and the native storage
modules are replaced with in-memory doubles.

## A note on two screens

The backend has no endpoint that lists a buyer's requirements and no supplier directory,
so the app keeps a **local index** of requirement ids and supplier labels on the device.
Requirements created here appear on Home automatically; one created elsewhere can be
added with **Track by id**. No backend change was made to work around this.
