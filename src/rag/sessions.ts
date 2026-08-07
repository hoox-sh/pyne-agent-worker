// Copyright (c) 2026 HOOX · PYNE · jango-blockchained
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChatMessage } from "../ai/workers-ai";

function id(): string {
  return crypto.randomUUID();
}

export type SessionRow = {
  id: string;
  created_at: number;
  updated_at: number;
  title: string | null;
};

export async function createSession(
  env: Env,
  title?: string
): Promise<SessionRow> {
  const now = Date.now();
  const sid = id();
  await env.DB.prepare(
    `INSERT INTO sessions (id, created_at, updated_at, title) VALUES (?, ?, ?, ?)`
  )
    .bind(sid, now, now, title ?? null)
    .run();
  return { id: sid, created_at: now, updated_at: now, title: title ?? null };
}

export async function getSession(
  env: Env,
  sessionId: string
): Promise<SessionRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, created_at, updated_at, title FROM sessions WHERE id = ?`
    )
      .bind(sessionId)
      .first<SessionRow>()) || null
  );
}

export async function appendMessage(
  env: Env,
  sessionId: string,
  role: ChatMessage["role"],
  content: string,
  meta?: Record<string, unknown>
): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO messages (id, session_id, role, content, created_at, meta_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      id(),
      sessionId,
      role,
      content,
      now,
      meta ? JSON.stringify(meta) : null
    ),
    env.DB.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).bind(
      now,
      sessionId
    ),
  ]);
}

export async function listMessages(
  env: Env,
  sessionId: string,
  limit = 40
): Promise<ChatMessage[]> {
  const rows = await env.DB.prepare(
    `SELECT role, content FROM messages
     WHERE session_id = ?
     ORDER BY created_at ASC
     LIMIT ?`
  )
    .bind(sessionId, limit)
    .all<{ role: ChatMessage["role"]; content: string }>();

  return (rows.results || []).map((r) => ({
    role: r.role,
    content: r.content,
  }));
}
