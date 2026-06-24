---
name: Composer image and attachment system
description: How inline images and file attachments work end-to-end in the Single Email Composer
---

## Images (inline base64 embedding)
- Image toolbar button opens a hidden `<input type="file" accept="image/*">` via `imageInputRef`
- `handleImageFile` reads the file with `FileReader.readAsDataURL` → inserts `<img src="data:...">` at saved cursor position via `document.execCommand("insertHTML")`
- Base64 data URL lives inside the editor HTML → stored in `composerDraftsTable.body` → automatically preserved in drafts, previews, and sent emails
- No server upload needed for images
- **Why:** Inline base64 is the simplest approach that survives draft round-trips without any server-side storage or URL management

## Attachments (server-side immediate upload)
- File selected → immediately uploaded via `POST /api/composer/upload-attachment` (multer disk storage)
- Files saved to `data/composer-uploads/` (workspace root, relative from `artifacts/api-server/` via `path.join(process.cwd(), "../../data/composer-uploads")`)
- Filename format: `{UUID}__{sanitized-original-name}` (double underscore separator for name recovery)
- Upload returns `AttachmentMeta { id, name, size, type }` — state stores these, NOT raw File objects
- DB column `attachments_meta TEXT DEFAULT '[]'` on `composerDraftsTable` stores JSON array of `AttachmentMeta`
- Draft save/load: `attachmentsMeta: JSON.stringify(attachments)` in payload; `setAttachments(JSON.parse(d.attachmentsMeta))` on load
- Send/test: `fd.append("attachmentIds", JSON.stringify(attachments.map(a => a.id)))` — backend calls `resolveAttachmentIds()` to load buffers from disk
- After successful send: temp files deleted from disk via `fs.unlinkSync`
- **Why:** Immediate upload decouples attachment state from browser File objects, enabling cross-session draft persistence without object storage or base64 bloat in the DB

## Migration
- Column added via raw SQL: `ALTER TABLE composer_drafts ADD COLUMN IF NOT EXISTS attachments_meta TEXT NOT NULL DEFAULT '[]'`
- Schema file: `lib/db/src/schema/composer_drafts.ts` — add `attachmentsMeta: text("attachments_meta").notNull().default("[]")`
