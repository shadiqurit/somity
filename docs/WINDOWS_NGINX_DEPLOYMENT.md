# Deploy somity.shadiqur.bd with Nginx on Windows

This configuration uses the existing Nginx installation at `C:\nginx` and the app checkout at `D:\app\somity`. Nginx serves the frontend and sends API requests to `127.0.0.1:3004`.

## Build and start Somity

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
npm.cmd run db:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed.' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
npm.cmd run start -w backend
```

The last command runs the API in the foreground. For automatic startup, use the existing Somity API service or adapt the [WinSW API template](../deploy/windows/somity-api.xml) with `D:\app\somity\backend` as its working directory and a writable log directory. The service runs `node dist/src/server.js` from that working directory. Restart it after changing `.env` or rebuilding the backend.

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
