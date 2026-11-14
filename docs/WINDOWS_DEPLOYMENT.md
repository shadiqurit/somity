# Deploy Somity on a Windows VPS

This setup uses `C:\Somity\app` for the repository and `C:\Somity\data\uploads` for private member photos. Caddy serves the Vue build over HTTPS and forwards `/api` to the Express server at `127.0.0.1:4000`. The examples assume one VPS with MySQL on the same machine and an x64 Windows installation.

## 1. Prepare the VPS

- Install [Node.js 24 LTS](https://nodejs.org/en/download), [Git for Windows](https://git-scm.com/download/win), and [MySQL Community Server 8.4](https://dev.mysql.com/doc/refman/8.4/en/windows-installation.html). In MySQL Configurator, enable automatic Windows service startup. Bind MySQL to `127.0.0.1` and leave its firewall port closed to the internet.
- Point a DNS `A` record for your hostname at the VPS public IPv4 address. Publish an `AAAA` record only if the server also accepts public IPv6 traffic. Allow inbound TCP 80 and 443 in the VPS provider's firewall and Windows Firewall. Ports 80 and 443 must be available to Caddy. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- Download [Caddy for Windows](https://caddyserver.com/download) and `WinSW-x64.exe` from the [WinSW v2.12.0 release](https://github.com/winsw/winsw/releases/tag/v2.12.0).

From an elevated PowerShell session on the VPS, create a dedicated directory with access limited to administrators, SYSTEM, and the two service accounts. The firewall command assumes you need a new rule for both web ports.

```powershell
New-Item -ItemType Directory -Path C:\Somity -ErrorAction Stop
icacls C:\Somity /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:RX' '*S-1-5-20:RX'
if ($LASTEXITCODE -ne 0) { throw 'Directory permissions could not be set.' }
icacls C:\Somity /inheritance:r
if ($LASTEXITCODE -ne 0) { throw 'Inherited permissions could not be removed.' }
New-Item -ItemType Directory -Force -Path 'C:\Somity\data\uploads', 'C:\Somity\services\api-logs', 'C:\Somity\services\web-logs', 'C:\Somity\services\caddy-state'
git clone https://github.com/shadiqurit/somity.git C:\Somity\app
if ($LASTEXITCODE -ne 0) { throw 'Repository clone failed.' }
New-NetFirewallRule -Name SomityWeb -DisplayName 'Somity HTTP and HTTPS' -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
```

The checkout on the VPS needs the `deploy\windows` folder from this release. Copy the folder from your local checkout if it has yet to reach the Git remote.

## 2. Prepare MySQL and the application

For a new database, run the following in MySQL as an administrator. Replace both password placeholders with distinct strong passwords. The API account can read and write application data. The migration account can also change the schema.

```sql
CREATE DATABASE somity CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'somity_app'@'127.0.0.1' IDENTIFIED BY 'APP_PASSWORD';
CREATE USER 'somity_migrate'@'127.0.0.1' IDENTIFIED BY 'MIGRATION_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON somity.* TO 'somity_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON somity.* TO 'somity_migrate'@'127.0.0.1';
```

If moving an existing installation, pause writes on the source before taking a MySQL dump that includes `_prisma_migrations`. Restore the dump into the empty `somity` database and copy the matching files from the source `STORAGE_DIR` into `C:\Somity\data\uploads`. Use the existing superadmin email when you run the seed so it synchronizes roles for the restored database. Historical dumps in the project's local `backups` folder may predate current records.

Generate a signing secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Save the following as `C:\Somity\app\backend\.env`. Replace the hostname, signing secret, database password and seed settings. URL-encode the database password in `DATABASE_URL`. The initial admin password must contain uppercase, lowercase and a number and be 12–128 characters long. Leave `VITE_API_URL` unset or empty to use `/api` on the same HTTPS origin.

```dotenv
NODE_ENV=production
PORT=4000
DATABASE_URL="mysql://somity_app:URL_ENCODED_APP_PASSWORD@127.0.0.1:3306/somity"
JWT_ACCESS_SECRET=RANDOM_SECRET_FROM_NODE
FRONTEND_ORIGIN=https://somity.example.com
STORAGE_DIR=C:/Somity/data/uploads
TRUST_PROXY=1
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_NAME=Super Administrator
SEED_ADMIN_PASSWORD="INITIAL_ADMIN_PASSWORD"
```

Set `TRUST_PROXY=1` for this direct Caddy setup. Build the app and run the committed migrations, using the migration account only for the migration command. The `Get-Credential` dialog keeps that password out of PowerShell history.

```powershell
Set-Location C:\Somity\app
npm.cmd ci --include=dev
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed.' }
npm.cmd run db:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

$migrationCredential = Get-Credential -UserName somity_migrate -Message 'Enter the MySQL migration password'
$migrationPassword = [uri]::EscapeDataString($migrationCredential.GetNetworkCredential().Password)
$env:DATABASE_URL = "mysql://somity_migrate:${migrationPassword}@127.0.0.1:3306/somity"
try {
    npm.cmd run db:migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
} finally {
    Remove-Item Env:DATABASE_URL
    Remove-Variable migrationPassword,migrationCredential
}

npm.cmd run db:seed
if ($LASTEXITCODE -ne 0) { throw 'Database seed failed.' }
```

Remove `SEED_ADMIN_PASSWORD` from `.env` after the seed succeeds. Keep `SEED_ADMIN_EMAIL` for subsequent role synchronization. The API uses `backend\.env` when it starts with `backend` as its working directory.

## 3. Install the Windows services

Copy `caddy.exe` into `C:\Somity\services`. Copy `WinSW-x64.exe` into that directory twice as `somity-api.exe` and `somity-web.exe`. Copy the repo templates and replace `somity.example.com` in the installed `Caddyfile` with the hostname from `FRONTEND_ORIGIN`. Update the Node executable path in `somity-api.xml` if Node was installed somewhere else. [Caddy's Windows service instructions](https://caddyserver.com/docs/running#windows-service) · [WinSW v2 configuration](https://github.com/winsw/winsw/blob/v2.12.0/doc/xmlConfigFile.md)

```powershell
Copy-Item C:\Somity\app\deploy\windows\* C:\Somity\services\
notepad.exe C:\Somity\services\Caddyfile
```

Grant the API's `LocalService` account read access to the application and write access to uploads and API logs. Give Caddy's `NetworkService` account access to its binaries, the built frontend, its logs and certificate state. The ACLs below are for a fresh, dedicated `C:\Somity` directory. The SID-based grants work on localized Windows installations.

```powershell
icacls C:\Somity\app /grant '*S-1-5-19:(OI)(CI)RX'
icacls C:\Somity\app\frontend\dist /grant '*S-1-5-20:(OI)(CI)RX'
icacls C:\Somity\services /grant '*S-1-5-19:(OI)(CI)RX' '*S-1-5-20:(OI)(CI)RX'
icacls C:\Somity\services\api-logs /grant '*S-1-5-19:(OI)(CI)M'
icacls C:\Somity\services\web-logs /grant '*S-1-5-20:(OI)(CI)M'
icacls C:\Somity\data\uploads /grant '*S-1-5-19:(OI)(CI)M'
icacls C:\Somity\services\caddy-state /grant:r '*S-1-5-20:(OI)(CI)M' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
icacls C:\Somity\services\caddy-state /inheritance:r
```

Validate the Caddy config and install and start both services from elevated PowerShell. MySQL should already be running.

```powershell
Set-Location C:\Somity\services
.\caddy.exe validate --config .\Caddyfile --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Caddy configuration is invalid.' }
.\somity-api.exe install
if ($LASTEXITCODE -ne 0) { throw 'API service installation failed.' }
.\somity-web.exe install
if ($LASTEXITCODE -ne 0) { throw 'Web service installation failed.' }
Start-Service SomityApi,SomityWeb -ErrorAction Stop
```

## 4. Verify the deployment

```powershell
Get-Service SomityApi,SomityWeb
Invoke-RestMethod http://127.0.0.1:4000/api/health
Invoke-RestMethod https://somity.example.com/api/health
```

The health responses should show `status: ok`, which confirms the API can reach MySQL. Open the HTTPS site from another device, sign in, and change the initial password if prompted. Select a society and reload `/members` to check that the frontend route and sign-in persist. Check an existing member photo if you migrated uploads. WinSW writes service output to `C:\Somity\services\api-logs` and `C:\Somity\services\web-logs`.

## Updates

Before an upgrade, stop `SomityApi` and back up MySQL and the uploads directory together. Pull the intended release with `git pull --ff-only`, then repeat the build and migration commands in step 2. Run `db:seed` when the release changes roles or permissions. Reapply the `NetworkService` read grant on `frontend\dist` if your deployment replaced the directory. Start `SomityApi` and check the public health endpoint. Restart `SomityWeb` when its binary or installed Caddyfile changes.
