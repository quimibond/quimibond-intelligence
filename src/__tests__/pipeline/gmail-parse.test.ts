import { describe, it, expect } from "vitest";
import { parseMessage, collectBodies, INGEST_VERSION } from "@/lib/pipeline/gmail";

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64url");

const ACCOUNT = { email: "ventas@quimibond.com", department: "Ventas" };

function outlookReplyMessage() {
  const plain = [
    "Luis, give me chance to check with my planning team.",
    "",
    "De: Desousa, Luis <desousa@shawmutcorporation.com>",
    "Enviado: Wednesday, 16 September 2026 09:59:01",
    "Para: Innovacion Quimibond",
    "Asunto: Re: SL 3254 release for W38",
    "",
    "Thank you Luis!",
  ].join("\r\n");
  const html = "<html><body><div>Luis, give me chance to check with my planning team.</div></body></html>";
  return {
    id: "1a0ab0c0bf9c16de",
    threadId: "1a0aacd16c3de705",
    labelIds: ["INBOX", "IMPORTANT"],
    snippet: "Luis, give me chance to check",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "Jessica Francisco <innovacion@quimibond.com>" },
        { name: "To", value: "Desousa, Luis <desousa@shawmutcorporation.com>" },
        { name: "Cc", value: "Dorian, Steve <dorian@shawmutcorporation.com>" },
        { name: "Subject", value: "RE: SL 3254 release for W38" },
        { name: "Date", value: "Wed, 16 Sep 2026 12:05:00 -0600" },
        { name: "Message-ID", value: "<abc123@quimibond.com>" },
        { name: "In-Reply-To", value: "<xyz789@shawmutcorporation.com>" },
        { name: "References", value: "<root@shawmutcorporation.com> <xyz789@shawmutcorporation.com>" },
      ],
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: b64(plain), size: plain.length } },
            { mimeType: "text/html", body: { data: b64(html), size: html.length } },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "release_W38.pdf",
          body: { attachmentId: "ANGjdJ_abc", size: 84000 },
        },
        {
          mimeType: "image/png",
          filename: "image001.png",
          body: { attachmentId: "ANGjdJ_img", size: 16220 },
        },
      ],
    },
  };
}

describe("parseMessage (ingest v2)", () => {
  it("conserva cuerpo completo, HTML, headers de threading, cc y labels", () => {
    const e = parseMessage(outlookReplyMessage(), ACCOUNT)!;
    expect(e).not.toBeNull();
    expect(e.ingest_version).toBe(INGEST_VERSION);
    expect(e.body_full).toContain("De: Desousa, Luis");
    expect(e.body_full).toContain("Thank you Luis!");
    expect(e.body_html).toContain("<div>Luis");
    expect(e.body_clean).toBe("Luis, give me chance to check with my planning team.");
    expect(e.cc).toContain("dorian@shawmutcorporation.com");
    expect(e.message_id_hdr).toBe("<abc123@quimibond.com>");
    expect(e.in_reply_to_hdr).toBe("<xyz789@shawmutcorporation.com>");
    expect(e.references_hdr).toEqual(["<root@shawmutcorporation.com>", "<xyz789@shawmutcorporation.com>"]);
    expect(e.labels).toEqual(["INBOX", "IMPORTANT"]);
    expect(e.is_reply).toBe(true);
    expect(e.sender_type).toBe("internal");
    expect(e.from_email).toBe("innovacion@quimibond.com");
  });

  it("body legacy sigue colapsado a una línea (compat)", () => {
    const e = parseMessage(outlookReplyMessage(), ACCOUNT)!;
    expect(e.body).not.toContain("\n");
    expect(e.body.startsWith("Luis, give me chance")).toBe(true);
  });

  it("lista adjuntos con attachmentId y guarda el payload crudo", () => {
    const e = parseMessage(outlookReplyMessage(), ACCOUNT)!;
    expect(e.attachments.map((a) => a.filename)).toEqual(["release_W38.pdf", "image001.png"]);
    expect(e.attachments[0].attachmentId).toBe("ANGjdJ_abc");
    expect(e.has_attachments).toBe(true);
    expect(e.raw_size_bytes).toBeGreaterThan(500);
    expect((e.raw_payload as { id: string }).id).toBe("1a0ab0c0bf9c16de");
  });

  it("cae a HTML→texto cuando no hay text/plain", () => {
    const html = "<p>Hola,</p><p>Confirmo 40 rollos.</p><blockquote>El lunes X escribió:<br>viejo</blockquote>";
    const msg = {
      id: "m2",
      threadId: "t2",
      payload: {
        mimeType: "text/html",
        headers: [
          { name: "From", value: "cliente@acme.com" },
          { name: "Subject", value: "Pedido" },
          { name: "Date", value: "Wed, 16 Sep 2026 12:05:00 -0600" },
        ],
        body: { data: b64(html), size: html.length },
      },
    };
    const e = parseMessage(msg, ACCOUNT)!;
    expect(e.body_full).toBe("Hola,\n\nConfirmo 40 rollos.\n\nEl lunes X escribió:\nviejo");
    expect(e.body_clean).toBe("Hola,\n\nConfirmo 40 rollos.");
    expect(e.body_html).toBe(html);
    expect(e.sender_type).toBe("external");
    expect(e.is_reply).toBe(false);
  });

  it("collectBodies ignora partes con filename aunque sean text/plain", () => {
    const r = collectBodies({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", filename: "notas.txt", body: { data: b64("archivo"), attachmentId: "x" } },
        { mimeType: "text/plain", body: { data: b64("cuerpo") } },
      ],
    });
    expect(Buffer.from(r.plain!, "base64url").toString()).toBe("cuerpo");
    expect(r.html).toBeNull();
  });

  it("devuelve null sin id o payload", () => {
    expect(parseMessage({ id: "x" }, ACCOUNT)).toBeNull();
    expect(parseMessage(null, ACCOUNT)).toBeNull();
  });
});
