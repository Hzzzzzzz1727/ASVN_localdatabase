# Cloudflare Tunnel mien phi

Muc tieu:

- frontend van deploy tren Vercel
- backend va SQL Server van chay tren may Windows cua ban
- web cong khai goi API qua tunnel mien phi

## 1. Chay backend local

Trong may Windows:

```bash
npm run local-api
```

Mac dinh API local:

```text
http://127.0.0.1:3030
```

## 2. Tao quick tunnel mien phi

Tai `cloudflared`:

- https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Sau do chay:

```bash
cloudflared tunnel --url http://127.0.0.1:3030
```

Ban se nhan duoc 1 URL dang:

```text
https://abcxyz.trycloudflare.com
```

## 3. Noi frontend vao tunnel

### Cach on dinh hon: set tren Vercel va redeploy

Them env trong Vercel:

```env
VITE_PUBLIC_API_BASE=https://abcxyz.trycloudflare.com/api
VITE_PUBLIC_MEDIA_BASE=https://abcxyz.trycloudflare.com
```

Roi redeploy.

### Cach nhanh de test ngay, khong can redeploy

Mo web, nhan `F12`, vao Console va chay:

```js
localStorage.setItem('tv-repair-api-base', 'https://abcxyz.trycloudflare.com/api')
localStorage.setItem('tv-repair-media-base', 'https://abcxyz.trycloudflare.com')
location.reload()
```

Neu muon xoa override va quay lai mac dinh:

```js
localStorage.removeItem('tv-repair-api-base')
localStorage.removeItem('tv-repair-media-base')
location.reload()
```

Ban cung co the set tam bang query param:

```text
https://ten-web.vercel.app/?apiBase=https://abcxyz.trycloudflare.com/api&mediaBase=https://abcxyz.trycloudflare.com
```

## 4. Kiem tra da dung chua

Trong Console / Network, login dung thi request phai di toi:

```text
https://abcxyz.trycloudflare.com/api/auth/login
```

Khong duoc di toi `supabase.co`.

## 5. Nhung dieu can nho

1. May cua ban phai mo thi web moi chay.
2. Quick tunnel `trycloudflare.com` co the doi URL moi khi ban tat/mo lai.
3. Neu muon URL co dinh va van mien phi, ban can dung Cloudflare account + domain rieng.
4. SQL Server van nam tren may ban, khong can mo truc tiep port `1433` ra internet.
