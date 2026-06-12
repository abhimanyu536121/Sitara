# Security Specification for Sitara (AI Assistant Database)

This specification defines the access control rules and data security invariants for Sitara's backend.

## 1. Data Invariants

1. **Profile Ownership**: Every user profile is bound to a unique Firebase user ID (`uid`). Users can only read or write their own profile document (`/profiles/{uid}`).
2. **Message Integrity**: A message cannot exist without a valid associated profile. Users can only write or read messages in their own `/profiles/{uid}/messages/{messageId}` collection.
3. **Temporal Validity**: Timestamp fields (`updatedAt` and `timestamp`) must match `request.time` exactly on any write.
4. **Name Preservation**: Creators cannot spoof or replace another person's user profile.
5. **No Anonymous Privilege Escalation**: Only verified users can perform writes.

---

## 2. The "Dirty Dozen" Threat Payloads

Here are the 12 malicious payloads intended to breach security:

1. **T1: Profile Spoofing (Identity Theft)** - Writing to `/profiles/someone_else` as user `abhimanyu`.
2. **T2: Name Hijacking** - Attempting to change `uid` in your profile to another user's UID.
3. **T3: Orphaned Message Direct Hack** - Writing a message under another user's profile path (`/profiles/someone_else/messages/m1`).
4. **T4: Future/Past Fake Timestamp** - Submitting a custom `updatedAt` value like `2099-12-31T23:59:59Z` instead of standard `request.time`.
5. **T5: Message Spoofing** - Submitting a message under your profile but setting `sender` to `user` when it's an AI message, or vice-versa, or spoofing the message's internal `uid` to a different UID.
6. **T6: PII Scraping (Blanket Read)** - Fetching another user's profile preferences.
7. **T7: Shadow Fields Injection** - Injecting extra custom properties (e.g., `isAdmin: true` or `verifiedStatus: true`) into the profile payload.
8. **T8: Resource Poisoning ID Size Attack** - Creating a profile with a 10KB string as the UID or document ID to trigger billing/wallet exhausting attacks.
9. **T9: Content Type Poisoning** - Submitting `preferences` as a number or boolean instead of a string.
10. **T10: Unauthorized Message Deletion/Modification** - Modifying or deleting historic conversation messages that belong to another user (or your own if marked terminal/historical).
11. **T11: Unauthenticated Read/Write** - Accessing messages or profiles without being logged in via Google Auth.
12. **T12: Value Range Abuse** - Submitting high-volume fields or fields exceeding reasonable bounds (e.g., creatorName size > 128 characters).

---

## 3. Test Runner Definition (`firestore.rules.test.ts`)

The tests below verify that all insecure operations return permission denied.

```typescript
// firestore.rules.test.ts (Draft Spec)
// This file serves as the test specification for of our rules.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

// Test suites verifying standard and malicious data payloads against firestore.rules.
```
