---
name: MIME parsing root causes
description: Four root-cause bugs found and fixed in the Communications email parsing pipeline
---

# MIME Parsing Root Causes

## Bug 1 — `parseHeader` drops folded continuation lines
**File**: `artifacts/api-server/src/lib/comm-sync.ts`  
**Rule**: `parseHeader` must split by `\r?\n`, then collect continuation lines (starting with space/tab) until a non-continuation line is hit. The old `.+` regex only captured the first line, so `Content-Type: multipart/mixed;\r\n\tboundary="abc"` → returned `"multipart/mixed;"` with no boundary. `parsePart` then returned early → both `text` and `html` remained empty → body stored as `"(empty)"`.

**Why**: JavaScript `.` does not match newlines; applying `.replace(/\r?\n[ \t]+/g, " ")` to a single-line capture is a no-op.

## Bug 2 — `snippetOf` greeting regex too greedy
**File**: `artifacts/api-server/src/lib/comm-sync.ts`  
**Rule**: Never use a sentence-level `[^.!?]*` to strip greetings. That strips from "Hello" all the way to the first period. Instead: split text by `\r?\n`, drop lines whose ENTIRE content is a short (≤80 char) greeting phrase, then join and normalize. Also strip an inline `^greeting[,.]? ` prefix as a safety net.

**Why**: "Hello, Your order has shipped." after the old regex → `trimmed = ""` (< 10 chars) → fell back to `content` which starts with "Hello".

## Bug 3 — `extractQuotedContent` returns `primary: ""` (empty string, not null)
**File**: `artifacts/vertex-ai-mailer/src/pages/Communications.tsx`  
**Rule**: Use `||` not `??` when falling back from `primaryHtml` to `msg.htmlBody`. Empty string is not nullish, so `"" ?? msg.htmlBody` = `""` and `HtmlEmailRenderer` renders nothing.

## Bug 4 — Missing Content-Type defaults & CRLF separator length
**File**: `artifacts/api-server/src/lib/comm-sync.ts`  
**Rule**: RFC 2045 §5.2: absent Content-Type defaults to `text/plain`. Also use `match()` to get the actual separator match length when slicing header from body — the old `charAt(sep+1) === "\r" ? 4 : 2` check looked at the wrong character and returned 2 instead of 4 for `\r\n\r\n` separators.

## Debug logging
Set env var `COMM_MIME_DEBUG=1` on the API server to log per-email: Content-Type, Content-Transfer-Encoding, source/header/body lengths, text length, HTML length, snippet length, and snippet text.
