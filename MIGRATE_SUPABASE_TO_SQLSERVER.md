# Chuyen du lieu tu Supabase sang SQL Server local

Bo script nay chi doc du lieu tu Supabase va tao goi import cho SQL Server local. No khong xoa, khong sua, khong ghi nguoc len Supabase.

## 1. Xuat du lieu tu Supabase

Can chay trong PowerShell tai thu muc project:

```powershell
$env:SUPABASE_EMAIL="email-dang-nhap-supabase"
$env:SUPABASE_PASSWORD="mat-khau-supabase"
npm run migrate:supabase:sqlserver
```

Neu bang cua ban cho phep doc bang `anon` thi co the bo qua 2 bien moi truong tren, nhung thong thuong nen dang nhap de doc day du du lieu.

Sau khi chay xong, project se tao thu muc `migration-output` gom:

- `customers.json`
- `profiles.json`
- `customer_share_links.json`
- `import-sqlserver.sql`
- `migration-report.json`

## 2. Import vao SQL Server local

Cach on dinh hon cho du lieu lon la chay script PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\import-sqlserver-from-json.ps1
```

Mac dinh script se:

- ket noi `localhost`
- tao database `ASVN_Local` neu chua co
- doc cac file JSON trong `migration-output`
- `MERGE` vao local theo khoa chinh

Neu can server/database khac:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\import-sqlserver-from-json.ps1 -ServerInstance "localhost" -DatabaseName "TenDB"
```

Script import chi `INSERT`/`UPDATE` tren local, khong co lenh nao xoa du lieu tren Supabase.

## 3. Luu y ve kieu database

Supabase dung PostgreSQL, con SSMS cua ban dang la SQL Server. Vi vay script import se map du lieu sang kieu tuong duong:

- `json/jsonb` -> `NVARCHAR(MAX)`
- `uuid` -> `UNIQUEIDENTIFIER`
- `timestamptz` -> `DATETIME2`
- `boolean` -> `BIT`

Neu ban muon app Vue hien tai bo Supabase va doc/ghi truc tiep tu SQL Server local, can them mot backend trung gian. Frontend hien tai khong the noi thang den SQL Server nhu cach dang dung voi Supabase.
