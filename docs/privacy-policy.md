# Privacy Policy — Tile Tally

**Last updated: 3 September 2026**

Tile Tally is made by Tangent. This policy explains what the app collects, why,
and what you can do about it. It is written to be read rather than to be
survived, and it describes what the app actually does — if the two ever
disagree, the app is the bug.

---

## The short version

- The app works entirely on your device. Scoring a hand never needs an account
  or a network connection.
- An account is created for you automatically, with no name, email or password,
  so your data has an owner. You are never asked to register.
- Photographs of your tiles stay on your phone unless you turn on photo backup,
  which is a paid feature.
- Nothing is sold, shared with advertisers, or used to train anything.
- You can delete everything, from inside the app, at any time.

---

## What the app stores on your device

Everything the app needs to work:

- **Sessions and hands** — players' names as you typed them, the tiles in each
  hand, what it scored, and the running totals.
- **Rulesets** you have created or edited.
- **Photographs** of hands you have scored, if you took any.
- **One preference**: which ruleset new sessions start on.

This data never leaves your device unless you are signed in and syncing.

## What the app stores on our servers

The app uses [Supabase](https://supabase.com) for accounts and storage.

### Your account

On first launch the app creates an **anonymous account**. This is a random
identifier and nothing else — no name, no email, no password, no device
fingerprint, no advertising id. Its only purpose is to own your rows in the
database so that nobody else can read them.

If you later sign in with an email address or a Google account, that identifier
stays the same and gains those credentials. We then store:

- your email address, if you signed in with one;
- a display name and a handle, if you choose to set them.

### Your games

When you are signed in, your sessions, hands and rulesets are copied to the
server so you can reach them from another device. These contain the names you
typed for the players at your table. **Please only enter names other people
would be comfortable with** — a first name or a nickname is enough, and the app
never asks for anything more.

### Photographs

Photographs of your hands stay on your device by default.

If you subscribe and turn on photo backup, they are uploaded to private storage
that only your account can read. A photograph of a mahjong table may show other
people's hands, drinks, and the room — please consider that before turning it
on, and be aware that shared sessions never include photographs.

### Payments

If you subscribe, the payment is handled by Apple or Google. We never see your
card details. We receive a record from [RevenueCat](https://revenuecat.com)
saying whether your subscription is active, and store that against your account.

---

## What the app does not do

- No advertising, and no advertising identifiers.
- No analytics or tracking SDKs.
- No selling or sharing of data with third parties.
- No training of machine-learning models on your data. The tile recognition
  models ship with the app, are fixed, and never send your photographs anywhere.
- No location, no contacts, no microphone.

## Permissions

- **Camera** — to photograph a hand. Used only when you tap the camera.
- **Photo library** — only when you choose an existing photo.

Both are asked for at the moment they are first needed, and the app works
without either: hands can always be entered by hand.

---

## Sharing with other people

Nothing you record is visible to anyone else unless you explicitly share it.

- **Friends** are added by handle, and either side can remove the connection.
- **Sharing a session** is per session and off by default. A shared session
  shows the hands, the scores and the players' names. It never includes
  photographs. You can stop sharing at any time.

---

## Deleting your data

Two ways, both complete:

- **Erase all data** in the app's Settings removes everything stored on the
  device.
- **Delete account** on your profile deletes your account and every row
  belonging to it on the server, including any photographs. This cannot be
  undone.

Deleted rows are removed from the live database immediately. Encrypted backups
may retain them for up to 30 days before rotating out.

If you cannot reach the app, email the address below and we will delete your
account on request.

## Children

Tile Tally is not directed at children under 13 and we do not knowingly collect
data from them. There is nothing in the app that asks a child for information.

## Where data is held

Servers are in the United States. If you use the app elsewhere, your data is
transferred there.

## Changes

If this policy changes in a way that affects what is collected or who can see
it, the app will say so before the change takes effect.

## Contact

Tangent — **dylansken@gmail.com**

---

<!--
  Not yet published. This needs a public URL before either store will accept
  the app, and the Google OAuth consent screen asks for one too. Once a domain
  exists, publish this and the terms alongside it, and put both links on the
  profile screen.

  Two things to check before publishing: confirm the legal entity name, and
  confirm the Supabase region actually is us-east-1 (the project says AWS
  us-east-1 today).
-->
