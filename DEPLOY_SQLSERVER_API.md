# Deploy API SQL Server

Backend hien tai da duoc tach de co the:

- chay local bang `npm run local-api`
- deploy API dang serverless qua `api/[...route].js`
- giu nguyen frontend goi `/api/...`
- upload media len Vercel Blob neu co `BLOB_READ_WRITE_TOKEN`

## Bien moi truong can co

Toi thieu can set:

```env
SQLSERVER_CONNECTION_STRING=Server=your-host;Database=your-db;User ID=your-user;Password=your-password;TrustServerCertificate=True;Encrypt=True;
API_SESSION_SECRET=mot-chuoi-bi-mat-rat-dai
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_token
```

Neu khong dung connection string day du, co the set:

```env
SQLSERVER_HOST=your-host
SQLSERVER_DATABASE=your-db
SQLSERVER_USER=your-user
SQLSERVER_PASSWORD=your-password
API_SESSION_SECRET=mot-chuoi-bi-mat-rat-dai
```

Neu muon bat Vercel Blob ro rang, co the them:

```env
STORAGE_BACKEND=vercel-blob
```

## Vercel

Phan API da co san entry:

- `api/[...route].js`

Route media da duoc rewrite:

- `/media/*` -> `/api/media/*`

## Luu y quan trong

1. SQL Server phai truy cap duoc tu internet hoac private network ma nen tang deploy ho tro.
2. Session da chuyen sang token ky HMAC, phu hop hon cho serverless.
3. Upload media hien van dang ghi file vao `local-media/`.
4. Neu co `BLOB_READ_WRITE_TOKEN`, upload media se chuyen sang Vercel Blob.
5. Neu khong co token Blob, backend se fallback ve `local-media/`.

Khi deploy len Vercel, nen tao Blob store Public trong dashboard de file anh/video co URL cong khai va ben vung.

## Chay local

```bash
npm run dev:local
```

## Migrate media cu len Blob

Script nay:

- copy media len Blob
- chi update DB khi upload thanh cong
- khong xoa file cu trong `local-media`
- ghi bao cao chi tiet vao `migration-output`

Chay:

```bash
npm run migrate:blob:media
```

## Build frontend

```bash
npm run build
```
