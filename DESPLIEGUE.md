# DEPLOYMENT - COMANDOS RÁPIDOS

## Deploy completo

```bash
./proxmox/proxmoxDeploy.sh
```

## Conectar al server

```bash
./proxmox/proxmoxConnect.sh
```

Luego en remoto:

```bash
pm2 logs app
exit
```

## Redirección puerto 80→3000 (opcional):

```bash
./proxmox/proxmoxSetupRedirect80.sh
```
