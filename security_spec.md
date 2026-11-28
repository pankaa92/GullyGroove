# GullyGroove Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Owner-Only PII Isolation**: User profiles (`/users/{userId}`) contain PII (`email`) and MUST only be readable and writable by the authenticated user whose `request.auth.uid == userId` with verified email on writes.
2. **Private Personal Records**: All `/users/{userId}/preferences/*`, `/users/{userId}/personalPlaylists/*`, `/users/{userId}/personalPlaylists/*/tracks/*`, `/users/{userId}/likedSongs/*`, and `/users/{userId}/recentlyPlayed/*` documents MUST enforce `ownerId == request.auth.uid` and strictly block access from any other user or unauthenticated guest.
3. **Personal Playlist Privacy**: Every `PersonalPlaylist` MUST have `isPrivate == true` and belong to `request.auth.uid`.
4. **Master Gate & Immutability**: Personal playlist track additions MUST verify the parent `/users/{userId}/personalPlaylists/{playlistId}` exists (`exists(...)`) and belongs to the same `userId`. Immutable fields (`uid`, `ownerId`, `createdAt`, `addedByUid`, `addedAt`, `firstContributedAt`) MUST NOT change on update.
5. **Strict Server Timestamps**: `createdAt`, `updatedAt`, `addedAt`, `likedAt`, `playedAt`, `firstContributedAt`, and `lastContributedAt` MUST match `request.time` on create/update as applicable.
6. **Shared Playlist Access & Contributor Atomicity**: Shared playlists (`/sharedPlaylists/{playlistId}`) and their `sharedTracks` and `contributors` are readable only when `isShared == true`, contain zero PII (`email`), and any `sharedTracks` creation MUST verify `allowContributions == true` (or playlist owner) and atomically guarantee via `existsAfter(...)` that the writer's `contributors/{uid}` document exists.

## 2. The "Dirty Dozen" Payloads (Expected: `PERMISSION_DENIED`)
1. **Cross-User PII Read**: User B attempts `get(/users/userA)` -> `PERMISSION_DENIED`.
2. **Cross-User Profile Spoof**: User B attempts `create(/users/userA, { uid: 'userA', ... })` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection on Profile**: User A attempts `create(/users/userA, { ..., isAdmin: true })` -> `PERMISSION_DENIED` (`keys().hasOnly(...)`).
4. **Client-Forged Timestamp**: User A attempts `create(/users/userA, { ..., createdAt: '2020-01-01T00:00:00Z' })` -> `PERMISSION_DENIED` (`createdAt == request.time`).
5. **Public Personal Playlist Bypass**: User A attempts `create(/users/userA/personalPlaylists/p1, { ..., isPrivate: false })` -> `PERMISSION_DENIED`.
6. **Orphaned Personal Track Write**: User A attempts `create(/users/userA/personalPlaylists/missing/tracks/t1, ...)` without parent playlist -> `PERMISSION_DENIED` (`exists(...)`).
7. **Cross-User Liked Song List**: User B attempts `list(/users/userA/likedSongs)` -> `PERMISSION_DENIED`.
8. **Unverified Email Write**: User with `email_verified: false` attempts `create(/sharedPlaylists/p1, ...)` -> `PERMISSION_DENIED`.
9. **Locked Shared Playlist Contribution**: Non-owner User B attempts `create(/sharedPlaylists/locked/sharedTracks/t1, ...)` where `allowContributions == false` -> `PERMISSION_DENIED`.
10. **Missing Contributor Atomicity**: User B attempts `create(/sharedPlaylists/p1/sharedTracks/t1, ...)` without creating/having `/sharedPlaylists/p1/contributors/userB` in the batch -> `PERMISSION_DENIED` (`existsAfter(...)`).
11. **Contributor Role Escalation**: Non-owner User B attempts `create(/sharedPlaylists/p1/contributors/userB, { ..., role: 'owner' })` -> `PERMISSION_DENIED`.
12. **ID Poisoning**: User A attempts `create(/sharedPlaylists/<150-char-invalid-id!@#>, ...)` -> `PERMISSION_DENIED` (`isValidId(...)`).
