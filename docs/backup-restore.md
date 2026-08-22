# Backup and restore

Everything lives in one SQLite database, so backup is copying one file safely.

## Backup

```sh
bun run backup -- ./backups
```

Backups use SQLite `VACUUM INTO`, are written with mode `0600`, and old backups past `BACKUP_RETENTION_DAYS` are pruned. Encrypt backups before they leave the host.

## Restore

```sh
# stop the application first
bun run restore -- ./backups/<backup.sqlite>
```

Restore replaces the live database file. Test a restore into a blank volume before you need one for real.

## Stats

```sh
bun run admin:stats
```

Prints account, form, and submission counts without touching any payload.
