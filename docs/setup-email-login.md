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

1. **Authentication → Providers → Email**: make sure it is **enabled**
   (magic-link / OTP works through this provider; no password needed).
2. **Authentication → Providers → Anonymous sign-ins**: keep **enabled**
   (the app relies on it as the fallback).
3. **Authentication → URL Configuration**:
   - **Site URL**: the deployed app URL, e.g.
     `https://ga-dx-platform.github.io/ga-schedule/`
   - **Redirect URLs**: add the same URL (and `http://localhost:3000` for local
     testing). The magic link redirects here; unlisted URLs are rejected.
4. *(Optional but recommended)* **Authentication → Emails / SMTP**: the built-in
   email sender is rate-limited (a few messages per hour). For reliable delivery
   configure custom SMTP. For a single user the default is usually fine.

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
