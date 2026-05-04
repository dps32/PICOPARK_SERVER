# PICOPARK_SERVER

Servidor Node.js para el juego cooperativo PICOPARK.

## Arquitectura

El proyecto se divide en dos capas principales:

- Servidor de juego en tiempo real: Express + WebSocket para la partida activa.
- API de datos de ejemplo: rutas REST bajo `/api` que exponen colecciones tipo MongoDB para niveles, jugadores, partidas, movimientos y récords de tiempo.

Flujo general:

```text
Cliente Flutter / Web
	|
	+--> WebSocket -> server/app.js -> gameLogic.js -> utilsWebSockets.js
	|
	+--> REST /api -> mongodbRoutes.js -> mongodbStore.js -> server/mongodb/*.json
```

### Componentes principales

- [server/app.js](server/app.js): arranque de Express, WebSocket, ciclo de juego y apagado limpio.
- [server/gameLogic.js](server/gameLogic.js): lógica del juego, jugadores conectados, estado de partida y física.
- [server/utilsWebSockets.js](server/utilsWebSockets.js): gestión de sockets, heartbeat y envío de mensajes.
- [server/mongodbRoutes.js](server/mongodbRoutes.js): API REST de colecciones estilo MongoDB.
- [server/mongodbStore.js](server/mongodbStore.js): carga de datos desde JSON locales.
- [server/mongodb/](server/mongodb/): colecciones de ejemplo.
- [server/assets/levels/](server/assets/levels/): definición del nivel que usa la lógica del juego.

## API REST

Rutas disponibles:

- `GET /api/schema`
- `GET /api/nivells`
- `GET /api/jugadors`
- `GET /api/partides?estat=&nivell_id=&jugador_id=`
- `GET /api/moviments?partida_id=&jugador_id=&tipus_moviment=&direccio=`
- `GET /api/records_temps?nivell_id=&partida_id=&jugador_id=`

## Datos de ejemplo

Las colecciones de ejemplo están pensadas para el dominio actual del juego:

- `nivells`
- `jugadors`
- `partides`
- `moviments`
- `records_temps`

Las relaciones entre documentos usan ids de dominio:

- `partides.nivell_id` referencia `nivells._id`
- `partides.jugador_ids[]` referencia `jugadors._id`
- `moviments.partida_id` referencia `partides._id`
- `moviments.jugador_id` referencia `jugadors._id`
- `records_temps.nivell_id` referencia `nivells._id`
- `records_temps.partida_id` referencia `partides._id`
- `records_temps.jugador_id` referencia `jugadors._id`

## Ejecución

Script principal:

```bash
npm run dev
```

Variables útiles:

- `PORT`: puerto HTTP, por defecto `3000`
- `DEBUG_WS=1`: activa logs de WebSocket
- `SERVE_STATIC=1`: sirve `public/` y expone `/qr`
- `WEB_ADMIN_PASSWORD`: protege `/api/admin/restart-match`

## Estructura

```text
PICOPARK_SERVER/
├── public/
├── server/
│   ├── app.js
│   ├── gameLogic.js
│   ├── mongodbRoutes.js
│   ├── mongodbStore.js
│   ├── mongodb/
│   └── assets/
├── proxmox/
└── README.md
```

