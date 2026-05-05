# MongoDB sample collections

This folder contains example MongoDB collections for the game domain.

Collections:
- `nivells`
- `jugadors`
- `partides`
- `moviments`
- `records_temps`

REST API endpoints available in the current server:
- `GET /api/schema`
- `GET /api/nivells`
- `GET /api/jugadors`
- `GET /api/partides?estat=&nivell_id=&jugador_id=`
- `GET /api/moviments?partida_id=&jugador_id=&tipus_moviment=&direccio=`
- `GET /api/records_temps?nivell_id=&partida_id=&jugador_id=`

Relationship model:
- `partides.nivell_id` references `nivells._id`
- `partides.jugador_ids[]` references `jugadors._id`
- `moviments.partida_id` references `partides._id`
- `moviments.jugador_id` references `jugadors._id`
- `records_temps.nivell_id` references `nivells._id`
- `records_temps.partida_id` references `partides._id`
- `records_temps.jugador_id` references `jugadors._id`

Import order:
1. `nivells`
2. `jugadors`
3. `partides`
4. `moviments`
5. `records_temps`

Example import commands:

```bash
mongoimport --db picopark --collection nivells --file nivells.json --jsonArray
mongoimport --db picopark --collection jugadors --file jugadors.json --jsonArray
mongoimport --db picopark --collection partides --file partides.json --jsonArray
mongoimport --db picopark --collection moviments --file moviments.json --jsonArray
mongoimport --db picopark --collection records_temps --file records_temps.json --jsonArray
```

The sample data is aligned with the current server level file at `server/assets/levels/game_data.json`.