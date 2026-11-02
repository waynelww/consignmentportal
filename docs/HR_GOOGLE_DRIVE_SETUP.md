# HR receipts → Google Drive: one-time setup (about 10 minutes)

When this is done, every claim receipt and MC slip you approve in HR Admin is
also copied to your Google Drive:

    Xocks HR Receipts / 2026-11 / Aisyah / 2026-11-02 RM32.50 Transport / mileage.jpg

The app can only see the files and folders it creates itself (Google's
`drive.file` permission), nothing else in your Drive.

Do steps 1–4 signed in as the Google account that should own the folder.

## 1. Create a Google Cloud project

1. Open https://console.cloud.google.com/projectcreate
2. Project name: `Xocks HR` → **Create**, and make sure it is selected (top bar).

## 2. Turn on the Google Drive API

1. Open https://console.cloud.google.com/apis/library/drive.googleapis.com
2. Click **Enable**.

## 3. Set up the consent screen

1. Open https://console.cloud.google.com/auth/overview → **Get started**.
2. App name `Xocks HR`, support email = your email → Next.
3. Audience: **External** → Next. Contact email = your email → Next → agree → **Create**.
4. **Data access** → Add or remove scopes → tick `.../auth/drive.file`
   (search "drive.file"), plus `openid` and `.../auth/userinfo.email` → Update → **Save**.
5. **Audience** → **Publish app** → Confirm, so it says *In production*.
   (Skip this and Google disconnects the app every 7 days.)

## 4. Create the login client

1. Open https://console.cloud.google.com/auth/clients → **Create client**.
2. Application type: **Web application**, name `XCMS`.
3. Authorized redirect URIs → **Add URI**:
   `https://consignmentportal.vercel.app/api/hr/drive/callback`
4. **Create**. Keep the window with the **Client ID** and **Client secret** open.

## 5. Put the two values in Vercel

1. Vercel → project **consignmentportal** → Settings → **Environment Variables**.
2. Add `GOOGLE_DRIVE_CLIENT_ID` = the Client ID (Production).
3. Add `GOOGLE_DRIVE_CLIENT_SECRET` = the Client secret (Production).
4. Deployments → latest → ⋯ → **Redeploy**.

## 6. Connect

1. XCMS → **HR Admin** → **Report & settings** → **Connect Google Drive**.
2. Pick the Google account. Google will say *"Google hasn't verified this app"*
   (normal for your own private app): **Advanced** → **Go to Xocks HR** →
   **Continue** / **Allow**.
3. You land back on HR Admin with "Google Drive connected".
4. If there are approved files from before, click **Copy N waiting files now**.

To stop: HR Admin → Disconnect (files already in Drive stay), or remove
"Xocks HR" at https://myaccount.google.com/permissions.
