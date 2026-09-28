# everyline backend

The control plane: theaters, auditoriums, booth appliances, shows, and
patron discovery. The cue stream itself stays on the auditorium LAN
(see `demo/protocol.md`); this service never sees caption content.

## Run

```sh
npm install
OPERATOR_TOKEN=your-secret PORT=3000 npm start
```

A SQLite file `everyline.db` is created in the working directory
(override with `DATABASE_PATH`). Zero setup.

## Test

```sh
npm test
```

## API (v1)

Operator endpoints take `Authorization: Bearer $OPERATOR_TOKEN`.

- `POST /v1/theaters` `{name, chain?, city?}`
- `GET /v1/theaters`
- `POST /v1/theaters/:id/auditoriums` `{name, serverVendor?, serverModel?, seats?}`
- `GET /v1/theaters/:id/auditoriums`
- `POST /v1/auditoriums/:id/appliance` `{label?}` → `{appliance, apiKey}`
  (the key is shown exactly once; only its hash is stored; one per auditorium)
- `GET /v1/appliances` (fleet health: status, version, last seen)
- `POST /v1/auditoriums/:id/shows` `{title, startsAt?, languages?}`
- `GET /v1/auditoriums/:id/shows`
- `GET /v1/discovery?theaterId=` — what the patron app calls: per auditorium,
  the current show, whether captions are available, and the booth's LAN
  cue-stream URL (only when the appliance was seen in the last 2 minutes)

Appliance endpoints take `X-Api-Key`:

- `POST /v1/appliances/heartbeat` `{status?, version?, cueStreamUrl?}`
