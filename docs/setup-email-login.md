# Email Login (Magic Link) — Setup & Migration

Tier 2 of the auth plan: let the owner sign in with an email so the data is tied
to a **person**, not to one browser. After signing in, the same data is reachable
from any device / after clearing cache.

The app keeps working **without** login (anonymous sign-in is the fallback), so
this is purely additive — nothing breaks if you never sign in.

---

## How it works

- On first visit the app still calls `signInAnonymously()` — you can use it right away.
- The sidebar profile item (bottom-left) opens the **Account** modal.
- While anonymous, entering an email calls `auth.updateUser({ email })`, which
  **upgrades the current anonymous account in place**. The user id (`auth.uid()`)
  stays the same, so every project/task you already created stays yours — no data
  migration needed.
- On another device, entering the same email calls `auth.signInWithOtp({ email })`
  and signs you into that same account, so you see the same data.
- Signing out reloads the app and drops back to a fresh anonymous session.

`onAuthStateChange` reloads the project list whenever the identity changes (e.g.
after clicking the magic link), so the correct data appears automatically.

---

## Supabase Dashboard configuration (one time)

ทำใน **เว็บ Supabase Dashboard** (supabase.com → เข้าโปรเจกต์) ไม่ใช่ในโค้ด

**ศัพท์:** *Magic link* = ลิงก์เข้าระบบที่ส่งไปทางอีเมล คลิกแล้วเข้าเลย ไม่ต้องมีรหัสผ่าน ·
*Site URL* = ที่อยู่เว็บแอปจริง · *Redirect URLs* = URL ที่อนุญาตให้ลิงก์เด้งกลับมาได้ ·
*SMTP* = ระบบส่งอีเมล

**1. เปิดล็อกอินด้วยอีเมล**
- ซ้ายมือ → **Authentication** (ไอคอนกุญแจ/โล่) → เมนูย่อย **Sign In / Providers**
- แถว **Email** → เปิดเป็น **Enabled** และให้แน่ใจว่า **Email OTP / Magic Link** เปิดอยู่

**2. เช็คว่า Anonymous ยังเปิด**
- หน้าเดียวกัน แถว **Anonymous Sign-Ins** → ต้อง **Enabled** (แอปใช้เป็น fallback ห้ามปิด)

**3. ใส่ URL ของเว็บ (สำคัญสุด — พลาดตรงนี้ลิงก์จะกดไม่ได้)**
- **Authentication → URL Configuration**
- **Site URL**: ที่อยู่เว็บแอป เช่น `https://ga-dx-platform.github.io/ga-schedule/`
- **Redirect URLs** → **Add URL** ใส่ URL เดียวกัน (และ `http://localhost:3000` ถ้าจะเทสในเครื่อง) → **Save**
- ไม่รู้ URL เว็บ? ไปที่ repo บน GitHub → **Settings → Pages** จะโชว์ *"Your site is live at ..."*

**4. SMTP — ข้ามได้** ตัวส่งเมลในตัวของ Supabase ใช้ได้เลย (จำกัดไม่กี่ฉบับ/ชม.) พอสำหรับผู้ใช้คนเดียว
ค่อยตั้ง custom SMTP ทีหลังถ้าจะแจกหลายคน

---

## Migrating your existing data (do this once)

Your current projects are owned by the **anonymous** user stored in the browser
you have been using. To keep them:

1. Open the app **on that same browser** (the one that already shows your projects).
2. Click the profile item → enter your email → **ส่งลิงก์**.
3. Open the confirmation link from your inbox. Because this *upgrades* the
   anonymous account, `auth.uid()` is unchanged and all your data stays attached.
4. From then on, sign in with that email on any other device to see the same data.

> ⚠️ Do **not** do the first sign-in on a fresh browser that has no data — that
> would create/switch to an account with a different id and your original
> (anonymous) data would not be attached to it.

### Fallback: reassign ownership by SQL

If the data ever ends up "orphaned" (owned by an old anonymous id you can no
longer sign into), reassign it in the Supabase SQL editor. Find the ids first:

```sql
-- your current (email) user id
select id, email from auth.users where email = 'you@example.com';

-- which anonymous id owns the orphaned projects
select distinct created_by from public.projects;
```

Then repoint the projects (tasks/deps/etc. cascade via project_id + RLS):

```sql
update public.projects
set created_by = '<your-email-user-id>'
where created_by = '<old-anonymous-user-id>';
```

---

## Notes / limits

- This does **not** add multi-user sharing or viewer roles — that is the separate
  Tier 1 (read-only share link) proposal, intentionally out of scope here.
- RLS is unchanged (`created_by = auth.uid()`); email login just gives you a
  stable `auth.uid()` across devices.
