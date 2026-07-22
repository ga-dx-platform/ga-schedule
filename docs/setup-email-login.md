# Email Login (Magic Link) — Setup & Migration

Tier 2 of the auth plan: let the owner sign in with an email so the data is tied
to a **person**, not to one browser. After signing in, the same data is reachable
from any device / after clearing cache.

The editing app **requires an email login** (paired with the RLS lock-down in
migration 004). Read-only share links (`?share=…`) are the exception — viewers
need no account.

---

## How it works

- If you are not signed in, the app shows a **login gate** instead of a usable
  empty app. Enter your email → Supabase sends a magic link → click it → you are
  signed in and the app loads. No password.
- The **same email on any device** signs into the same account, so you see the
  same data everywhere ("work anywhere").
- The sidebar profile item (bottom-left) opens the **Account** modal to see who
  you are signed in as and to sign out.
- Read-only share links bypass the gate entirely (they use the anon API key +
  SECURITY DEFINER RPCs, not a login).
- `onAuthStateChange` reloads the page whenever you sign in or out, so the app
  boots cleanly into the right state.

---

## Supabase Dashboard configuration (one time)

ทำใน **เว็บ Supabase Dashboard** (supabase.com → เข้าโปรเจกต์) ไม่ใช่ในโค้ด

**ศัพท์:** *Magic link* = ลิงก์เข้าระบบที่ส่งไปทางอีเมล คลิกแล้วเข้าเลย ไม่ต้องมีรหัสผ่าน ·
*Site URL* = ที่อยู่เว็บแอปจริง · *Redirect URLs* = URL ที่อนุญาตให้ลิงก์เด้งกลับมาได้ ·
*SMTP* = ระบบส่งอีเมล

**1. เปิดล็อกอินด้วยอีเมล**
- ซ้ายมือ → **Authentication** (ไอคอนกุญแจ/โล่) → เมนูย่อย **Sign In / Providers**
- แถว **Email** → เปิดเป็น **Enabled** และให้แน่ใจว่า **Email OTP / Magic Link** เปิดอยู่

**2. Anonymous Sign-Ins — ปิดได้แล้ว**
- หน้าเดียวกัน แถว **Anonymous Sign-Ins** → **ปิดได้** เพื่อความปลอดภัยเพิ่ม
  (แอปไม่ใช้ anonymous แล้ว เปลี่ยนเป็นบังคับล็อกอิน ส่วนลิงก์แชร์ใช้ anon API key + RPC ไม่ใช่ anonymous auth)
  จะเปิดค้างไว้ก็ไม่เป็นไร เพราะไม่มีอะไรเรียกใช้

**3. ใส่ URL ของเว็บ (สำคัญสุด — พลาดตรงนี้ลิงก์จะกดไม่ได้)**
- **Authentication → URL Configuration**
- **Site URL**: ที่อยู่เว็บแอป เช่น `https://ga-dx-platform.github.io/ga-schedule/`
- **Redirect URLs** → **Add URL** ใส่ URL เดียวกัน (และ `http://localhost:3000` ถ้าจะเทสในเครื่อง) → **Save**
- ไม่รู้ URL เว็บ? ไปที่ repo บน GitHub → **Settings → Pages** จะโชว์ *"Your site is live at ..."*

**4. SMTP — ข้ามได้** ตัวส่งเมลในตัวของ Supabase ใช้ได้เลย (จำกัดไม่กี่ฉบับ/ชม.) พอสำหรับผู้ใช้คนเดียว
ค่อยตั้ง custom SMTP ทีหลังถ้าจะแจกหลายคน

---

## Claiming your existing data (do this once)

Your existing projects were created anonymously, so their `created_by` is
currently `null`. Claim them under your email:

1. Sign in with your email at the login gate.
2. Run **migration 004** (`docs/migrations/004_lockdown_rls.sql`, see
   `setup-lockdown-sharing.md`). It assigns every existing project to your
   account and locks everything to per-owner access.

After that your data is private and reachable from any device you sign in on.

> Order matters: sign in **first** (so your `auth.users` row exists), then run
> 004. If you run 004 before signing in, it raises an error instead of orphaning
> data — just sign in and re-run.

---

## Notes / limits

- Multi-user editing / viewer roles are out of scope. Managers view via the
  read-only share link (`setup-lockdown-sharing.md`).
- After migration 004, RLS is per-owner (`created_by = auth.uid()`); email login
  gives you a stable `auth.uid()` across devices.
