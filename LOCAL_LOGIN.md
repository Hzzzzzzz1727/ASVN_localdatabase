# Dang nhap local

## Chay app local

```powershell
npm run dev:local
```

Mac dinh:

- Frontend: `http://localhost:5173`
- Backend local: `http://127.0.0.1:3030`
- SQL Server DB: `ASVN_Local`

## Tai khoan local sau khi migrate

Tat ca profile co san trong bang `profiles` se duoc tao tai khoan local tu dong trong bang `local_auth_accounts`.

Mat khau mac dinh hien tai:

```text
123456
```

## Neu Supabase bi khoa

Neu ban dang chay bang local:

- dang nhap van hoat dong
- them / sua / xoa ca van hoat dong
- share page van hoat dong qua backend local
- upload media moi van luu local

Luu y:

- media cu trong Supabase Storage chua duoc copy ve local tu dong
- buoc tiep theo co the migrate bucket `media` ve thu muc `local-media`

## Tai media tu Supabase ve local

Neu can lay toan bo anh/video cu ve local:

```powershell
$env:SUPABASE_ANON_KEY="service-role-key"
npm run migrate:supabase:media
```

Lenh nay chi doc file trong Supabase Storage va tai ve `local-media/media`, khong xoa hay sua du lieu tren Supabase.
