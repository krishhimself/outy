# Security review

November 2026, two rounds. Every item under "Fixed" has a test in `backend/tests/test_security.py` that failed before the fix and passes after it.

## Fixed

### Any signed-in user could read or change other people's outings

The API checked that a request came from a signed-in user, but most routes never checked that the user belonged to the outing. Anyone with an account who knew an outing id could:

- read its details, invite code, expenses, balances, to-dos and every photo
- edit its name, dates and description
- delete any expense or to-do, and mark to-dos done

Every outing route now goes through one check (`app/access.py`). Editing an outing is limited to its creator. Deleting an expense is limited to the payer, the person who added it, or the outing's creator.

### Password reset codes could be guessed

The reset code is six digits, and nothing limited wrong guesses, so all one million codes could be tried inside the 15-minute window to take over an account. Now:

- five wrong guesses destroy the code
- codes are generated with a secure random source and stored hashed
- a new code can be requested once a minute per account
- a successful reset signs out every existing session
- the response no longer reveals whether an email has an account

### No limit on password or invite-code guessing

- Sign-in: eight wrong passwords for one email locks that email for 15 minutes.
- Join by code: ten wrong codes in ten minutes blocks further tries for that user.
- Sign-up and reset requests have a loose per-IP limit.

### Other fixes

| Issue | Fix |
| --- | --- |
| Session tokens stored in plain text | Stored as SHA-256 hashes; existing sessions keep working and are upgraded on next use |
| Google sign-in endpoint was live, trusted a third-party server, and reused that server's token as the Outy session | Off unless `GOOGLE_AUTH_ENABLED=true`; always issues its own token |
| Expenses accepted negative amounts, non-members as payer, and made-up display names | Amounts must be positive; payer and participants must be crew; names come from the crew list |
| Gallery accepted any content of any size | Images only, capped at about 7.5 MB; requests over 12 MB are refused |
| No length limits on names, messages, titles | Limits on every text field |
| Dates and cover links were not validated | Dates must be real and in order; cover must be a web link |
| Invite codes used a predictable random source | Uses `secrets`; codes are checked for uniqueness |
| Passwords could be six characters | Eight minimum for new passwords |

## Round two

| Area | Result |
| --- | --- |
| Backend packages | 21 known vulnerabilities in `starlette` and `pymongo`; upgraded FastAPI, Starlette, Motor and PyMongo; the scan is now clean |
| Frontend packages | 34 advisories, almost all in build tools that run on the developer's machine, not in the app. Safe updates applied (34 down to 20, no critical left). The rest need the Expo SDK upgrade |
| Settlement maths | 300 randomly generated trips: balances always sum to zero and the payment plan always settles everyone |
| Dates | Outings created between midnight and 5:30 am India time were saved one day early; "upcoming" and "past" switched at 5:30 am instead of midnight. Both fixed |
| Silent failures | Profile save, invite accept and decline, and adding a to-do failed without any message. They now say what went wrong |
| Remaining screens | Create, profile, invites, join by code, custom split, gallery, memories, password reset: run in a browser, 15 of 15 checks pass |

Settings outside the repository (Render, Atlas, Resend) are in `deployment-checklist.md`.

## Not fixed yet

- **Photos live in MongoDB as base64.** Profile photos are also copied into every outing and chat message, so the database grows quickly. Moving images to object storage (Cloudinary is the plan) fixes both.
- **No email verification at sign-up.** Someone can register with an email address they do not own.
- **Rate limits are in memory.** They reset when the server restarts and would not be shared across several server instances.
- **No way to leave an outing, remove a member, or change an invite code.** A leaked code stays valid for the life of the outing.
- **Expired sessions are never cleaned up.** They are rejected, but the rows stay in the database.
- **On web, the session token is in browser storage.** That is normal for this kind of app, but it means any script-injection bug would expose it.
- **Expo SDK is four versions behind** (54, newest 58). The remaining frontend advisories and Expo Go compatibility both depend on upgrading.
- **Nothing has been run on a real phone or against a real MongoDB server.** The tests use an in-memory database and the web build.
