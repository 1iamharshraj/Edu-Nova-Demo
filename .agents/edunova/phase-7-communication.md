# Phase 7 — Communication (feed, messaging, notifications, meetings, calendar audience)

> Same conventions. Replaces blob keys `feed`, `threads`, `meetings`, `events`.

## Model
```
Post           id, schoolId, authorId, audience School|Class|Role, classId?, role?, title?, body, mediaFileIds String[], pinned, publishedAt, createdAt
PostReaction   id, postId, userId                                                 unique(postId, userId)
PostComment    id, postId, authorId, body, createdAt
Conversation   id, schoolId, kind DM|Group, title?, classId?, createdById, createdAt
Participant    id, conversationId, userId, lastReadAt?                            unique(conversationId, userId)
Message        id, conversationId, senderId, body, fileIds String[], sentAt
Notification   id, schoolId, userId, kind, title, body?, link?, readAt?, createdAt
Meeting        id, schoolId, requesterId, withUserId, studentId?, purpose, scheduledAt, durationMin (default 30), link?, status Requested|Scheduled|Completed|Cancelled|Declined, decidedById?, decidedAt?, note?
CalendarEvent  id, schoolId, title, date, endDate?, type holiday|exam|event, audience School|Class, classId?, termId?, createdById
```

## Rules
- **Post audience**: School (everyone), Class (students + their guardians + teachers of that class + staff/admin), Role (all users of that role + staff/admin). Authors: admin/staff/teacher (teacher only School? no — teacher may post to their classes or School). Edit/delete: author or admin.
- **Conversations**: allowed pairs — parent ↔ teacher of a ward's class (incl. class teacher) or staff/admin; student ↔ own teachers; teacher ↔ teacher/staff/admin; staff/admin ↔ anyone. Group conversations: created by teacher/staff/admin for a class (all guardians + students of the class + class teachers). No bots, no auto-replies.
- **Notifications** are created by services: new post for my audience; new message (if not read within the socket session); leave decision; fee reminder; marks published; homework assigned/graded; meeting requested/decided; timetable published; substitution assigned.
- **Meetings**: requester parent/student/teacher; `withUserId` a teacher (or admin); teacher/admin decides. Link: on Scheduled, generate `https://meet.jit.si/edunova-<schoolShort>-<id>` unless `MEET_PROVIDER=none`.
- **Realtime**: SSE endpoint `GET /api/events/stream` (auth via `?token=`) broadcasting `{type:"message"|"notification", payload}` to the user; frontend keeps an EventSource and falls back to 30s polling if it fails.

## Endpoints
`/api/feed`: GET `/?audience` (filtered for the caller), POST, PATCH/DELETE `/:id`, POST `/:id/react` (toggle), GET/POST `/:id/comments`, DELETE `/:id/comments/:cid`, POST `/:id/pin` (admin).
`/api/messages`: GET `/conversations` (mine, with last message + unread), POST `/conversations` `{ userIds[] | classId, title? }` (rules), GET `/conversations/:id/messages?before`, POST `/conversations/:id/messages`, POST `/conversations/:id/read`, GET `/contacts` (people the caller may start a conversation with, grouped).
`/api/notifications`: GET `/?unread`, POST `/:id/read`, POST `/read-all`.
`/api/meetings`: GET (mine / for teacher / all for admin), POST, POST `/:id/approve|decline|cancel|complete`.
`/api/calendar`: GET `/?termId&from&to` (audience-filtered), POST/PATCH/DELETE (staff/admin).
`/api/events/stream` SSE.

`GET /api/data` drops `feed`, `threads`, `meetings`, `events`.

## Sample data
Port the 5 seed posts (audience School) with reactions/comments; conversations: Nisha↔Meera (DM, seed messages), Nisha↔Arjun, Meera↔Arjun, Meera↔Sofia; meetings m1–m3; calendar events ported with audience School.

## Frontend
- `FeedMod`: compose (admin/staff/teacher) with audience picker + image upload; per-user reaction; comments with delete; edit/delete own; pinned first.
- `MessagesMod`: conversation list with unread badges; **New conversation** picker from `/messages/contacts`; thread view; live updates via SSE; read receipts from participants' `lastReadAt`. Remove `autoReplyText`, fake presence, dead call buttons.
- Notification bell in the header (all roles) with dropdown + "mark all read"; deep-links via `link` (module id).
- `MeetingsMod`: request → approve → join link; decline/cancel/complete.
- `CalendarMod`/`CalendarAdminMod`: audience field; students/parents see school + their class.
- `HighlightsMod`: leave as Empty (Phase 9).
