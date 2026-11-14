# Deploy somity.shadiqur.bd with Nginx on Windows

This configuration uses the existing Nginx installation at `C:\nginx` and the app checkout at `D:\app\somity`. Nginx serves the frontend and sends API requests to `127.0.0.1:3004`.

## Build Somity

Set these values in `D:\app\somity\backend\.env`. Keep the production `DATABASE_URL` and `JWT_ACCESS_SECRET` there as well. Create the uploads directory and give the account running the API permission to write to it. If moving an existing installation, copy its uploaded files there along with restoring its database. Leave `VITE_API_URL` unset or empty for the same-origin frontend build.

```dotenv
NODE_ENV=production
PORT=3004
FRONTEND_ORIGIN=https://somity.shadiqur.bd
TRUST_PROXY=1
STORAGE_DIR=D:/app/somity-data/uploads
```

`TRUST_PROXY=1` assumes Nginx connects directly to the loopback API. For a new database or an upgrade, follow the [MySQL, migration, and seed steps](WINDOWS_DEPLOYMENT.md#2-prepare-mysql-and-the-application) using the paths and environment values on this page. With the database ready, run these commands on the VPS.

```powershell
Set-Location D:\app\somity
npm.cmd ci --include=dev
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
```

The backend build generates Prisma Client before compiling TypeScript. On an older checkout, run `npm.cmd run db:generate` before `npm.cmd run build` if the compiler reports missing `@prisma/client` exports.

## Start the backend with PM2

Run these commands from `D:\app\somity` under the Windows account that will manage PM2. If an earlier Somity backend is already listening on port `3004`, stop that process before the first PM2 start.

```powershell
# Install once if PM2 is missing.
npm.cmd install --global pm2
pm2.cmd startOrRestart .\ecosystem.config.js
pm2.cmd status somity-api
Invoke-RestMethod http://127.0.0.1:3004/api/health
```

The [PM2 config](../ecosystem.config.js) starts one instance of `backend\dist\src\server.js`, with `backend` as the working directory so dotenv loads `backend\.env`. It sets production mode and port `3004`. After rebuilding or changing `.env`, run `pm2.cmd startOrRestart .\ecosystem.config.js` again. Use `pm2.cmd logs somity-api --lines 50 --nostream` to inspect startup errors. [PM2 ecosystem configuration](https://pm2.keymetrics.io/docs/usage/application-declaration/)

Once the health check returns `status: ok`, run `pm2.cmd save`. For automatic recovery after a Windows reboot, use your existing PM2 startup setup or create an **At startup** task in Windows Task Scheduler that runs `pm2.cmd resurrect`. Set the action to `cmd.exe` with arguments `/d /c ""C:\path\to\pm2.cmd" resurrect"`, using the full path from `(Get-Command pm2.cmd).Source`. Run the task under the same account and with the same `PM2_HOME` if customized. Select **Run whether user is logged on or not** and configure a short startup delay so MySQL can start first. [PM2 startup and restore](https://pm2.keymetrics.io/docs/usage/startup/) · [Windows startup triggers](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasktrigger?view=windowsserver2025-ps)

## Load the Nginx site

Copy [`somity.conf`](../deploy/windows/nginx/somity.conf) to `C:\nginx\conf\somity.conf`. Replace the previous Somity server blocks with this include inside the existing `http { ... }` block. If your Nginx setup already loads site files from another directory, replace the existing Somity file there.

```nginx
include conf/somity.conf;
```

The files `C:\nginx\ssl\shadiqur.bd.crt` and `C:\nginx\ssl\shadiqur.bd.key` must be readable by Nginx. The certificate must cover `somity.shadiqur.bd` and include any required intermediate certificates. Point DNS at the VPS and allow inbound TCP 80 and 443. [Nginx HTTPS configuration](https://nginx.org/en/docs/http/configuring_https_servers.html)

```powershell
Set-Location C:\nginx
.\nginx.exe -t
if ($LASTEXITCODE -ne 0) { throw 'Nginx configuration test failed.' }
.\nginx.exe -s reload
if ($LASTEXITCODE -ne 0) { throw 'Nginx reload failed.' }
```

Run these with the same Nginx prefix and configuration as the running instance. If Nginx is stopped, start it using its existing service or startup command after `nginx.exe -t` succeeds. [Nginx on Windows](https://nginx.org/en/docs/windows.html)

## Verify

```powershell
Invoke-RestMethod http://127.0.0.1:3004/api/health
Invoke-RestMethod https://somity.shadiqur.bd/api/health
Invoke-RestMethod https://somity.shadiqur.bd/health
```

All three should return `status: ok`. `/health` uses the same upstream handler as `/api/health`. Open `/login` in your browser and sign in. Select a society and refresh `/members` to confirm that Nginx serves Vue routes directly.
