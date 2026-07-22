# Lock down data + read-only share link — Setup

Two related changes:

- **Migration 004** makes each project private to its owner (`created_by = auth.uid()`).
  Before this, anyone who opened the public URL could read **and edit** everything.
- **Migration 005** adds an unguessable read-only link so a manager can *view* one
  project without an account, while everything else stays locked down.

## Order of operations (do not skip / reorder)

1. **Sign in with email first.** Open the app, click the sidebar profile, sign in
   with your email, and confirm the magic link. See `setup-email-login.md`.
   (Migration 004 assigns all existing projects to this account.)
2. **Run migration 004** — `docs/migrations/004_lockdown_rls.sql` in the Supabase
   SQL Editor. **Edit the `owner_email` line** to your email before running.
   - After this: the app shows your data only when you are signed in. Other
     devices/people who are **not** signed in see an empty app.
3. **Run migration 005** — `docs/migrations/005_readonly_share.sql`. Adds the
   `share_token` column and the read-only accessor functions.

> If you run 004 without doing step 1 first, it will raise an error instead of
> orphaning your data (the null-check is intentional). Fix `owner_email` and re-run.

## How to share a project (read-only) with your manager

1. Open the project in the app (signed in).
2. Toolbar → **💽 Data & Export** → **🔗 Share read-only link**.
3. The link is copied to your clipboard (and shown so you can copy it manually).
   Send it to your manager.

Your manager opens the link (`…/?share=<token>`) — no account needed. They see the
Gantt / Kanban / Calendar / Dashboard for that one project, fully **read-only**:
no add/edit/delete, no drag, no settings. All other projects stay private.

### Revoking / rotating a link

- Generating a link again for the same project **reuses** the existing token
  (the link is stable).
- To revoke, clear the token in SQL:
  `update public.projects set share_token = null where id = '<project-id>';`
  The old link then shows "ลิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว".

## Notes

- The read-only functions are `SECURITY DEFINER` and only ever return rows whose
  `share_token` matches the token in the link — nothing else is exposed.
- Progress-log **attachments** in a shared view: the file list shows, but opening
  a file needs a signed Storage URL. If you want attachments openable for viewers,
  that requires additional Storage policy work (out of scope here).
