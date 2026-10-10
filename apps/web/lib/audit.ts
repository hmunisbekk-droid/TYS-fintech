// Hash-chained audit log (SHA-256 via WebCrypto). Each entry commits to the previous hash, so any
// later edit of an earlier entry is detectable. Exported as JSON with the case.
export interface AuditEntry { seq: number; ts: string; event: string; payloadHash: string; prevHash: string; hash: string; summary: string }

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class AuditLog {
  entries: AuditEntry[] = [];
  async append(event: string, payload: unknown, summary: string): Promise<AuditEntry> {
    const prev = this.entries.length ? this.entries[this.entries.length - 1].hash : "0".repeat(64);
    const payloadHash = await sha256(JSON.stringify(payload ?? null));
    const seq = this.entries.length + 1;
    const ts = new Date().toISOString();
    const hash = await sha256(`${seq}|${ts}|${event}|${payloadHash}|${prev}`);
    const e = { seq, ts, event, payloadHash, prevHash: prev, hash, summary };
    this.entries.push(e);
    return e;
  }
  async verify(): Promise<boolean> {
    let prev = "0".repeat(64);
    for (const e of this.entries) {
      if (e.prevHash !== prev) return false;
      const h = await sha256(`${e.seq}|${e.ts}|${e.event}|${e.payloadHash}|${e.prevHash}`);
      if (h !== e.hash) return false;
      prev = e.hash;
    }
    return true;
  }
}
