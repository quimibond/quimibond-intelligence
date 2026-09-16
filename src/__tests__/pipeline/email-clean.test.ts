import { describe, it, expect } from "vitest";
import {
  htmlToText,
  decodeEntities,
  stripQuotedText,
  stripQuotedTextDetailed,
  legacyBody,
} from "@/lib/pipeline/email-clean";

describe("htmlToText", () => {
  it("conserva saltos de línea de párrafos y <br>", () => {
    const html = "<div>Hola Luis,</div><div><br></div><p>Te confirmo 3,000 yd para la semana 38.</p>";
    expect(htmlToText(html)).toBe("Hola Luis,\n\nTe confirmo 3,000 yd para la semana 38.");
  });

  it("decodifica entidades y quita style/script", () => {
    const html = "<style>p{color:red}</style><p>Precio: $12&nbsp;MXN &amp; IVA &aacute;rea &#x1F600;</p>";
    expect(htmlToText(html)).toBe("Precio: $12 MXN & IVA área 😀");
  });

  it("separa celdas de tabla con tab y filas con salto", () => {
    const html = "<table><tr><td>WJ053</td><td>1,200 m</td></tr><tr><td>X140</td><td>800 m</td></tr></table>";
    expect(htmlToText(html)).toBe("WJ053\t1,200 m\nX140\t800 m");
  });

  it("decodeEntities ignora entidades desconocidas", () => {
    expect(decodeEntities("a &foo; b &lt;c&gt;")).toBe("a &foo; b <c>");
  });
});

describe("stripQuotedText", () => {
  it("corta en el encabezado de Outlook en español", () => {
    const text = [
      "Luis, give me chance to check with my planning team.",
      "Tomorrow I will check with them",
      "",
      "De: Desousa, Luis",
      "Enviado: Wednesday, 16 September 2026 09:59:01",
      "Para: Innovacion Quimibond",
      "Asunto: Re: SL 3254 release for W38",
      "",
      "Thank you Luis!",
    ].join("\n");
    expect(stripQuotedText(text)).toBe(
      "Luis, give me chance to check with my planning team.\nTomorrow I will check with them",
    );
  });

  it("corta en el encabezado de Outlook en inglés y quita banners", () => {
    const text = [
      "CAUTION: EXTERNAL SENDER",
      "Jessica, thank you for the explanation.",
      "[cid:image001.png@01DD45D6.B1AD1090]",
      "website | blog | news | shop",
      "From: Innovacion Quimibond",
      "Sent: Wednesday, September 16, 2026 12:05 PM",
      "To: Desousa, Luis",
      "Subject: Re: SL 3254",
      "Hi Luis, no problems on our end.",
    ].join("\n");
    expect(stripQuotedText(text)).toBe("Jessica, thank you for the explanation.");
  });

  it("no corta en un 'De:' que no es encabezado de cita", () => {
    const text = "De: la última corrida salieron 40 rollos.\nQuedamos pendientes del resto.";
    expect(stripQuotedText(text)).toBe(text);
  });

  it("corta en 'El ... escribió:' de Gmail, incluso partido en dos líneas", () => {
    const one = "Confirmado, sale el jueves.\n\nEl mié, 16 sept 2026 a las 9:59, Luis (<l@x.com>) escribió:\n> hola";
    expect(stripQuotedText(one)).toBe("Confirmado, sale el jueves.");
    const two = "Confirmado, sale el jueves.\nEl mié, 16 sept 2026 a las 9:59, Luis (<l@x.com>)\nescribió:\n> hola";
    expect(stripQuotedText(two)).toBe("Confirmado, sale el jueves.");
  });

  it("omite líneas con > sin cortar (respuestas inline)", () => {
    const text = "> ¿Cuándo sale?\nEl jueves.\n> ¿Cuántos rollos?\n40 rollos.";
    expect(stripQuotedText(text)).toBe("El jueves.\n40 rollos.");
  });

  it("corta la firma con '-- ' y con 'Saludos'", () => {
    expect(stripQuotedText("Va la cotización.\n-- \nJessica\nQuimibond")).toBe("Va la cotización.");
    expect(stripQuotedText("Va la cotización.\nSaludos cordiales,\nJessica")).toBe("Va la cotización.");
  });

  it("corta en el separador ____ de Outlook", () => {
    const text = "Gracias.\n________________________________\nDe: Alguien\nEnviado: hoy\nHola";
    expect(stripQuotedText(text)).toBe("Gracias.");
  });

  it("si no queda nada (forward puro) conserva el inicio del original", () => {
    const text = "---------- Forwarded message ---------\nDe: Proveedor\nFecha: hoy\nAsunto: Lista de precios\n\nPrecio hilo 30/1: $58/kg";
    const r = stripQuotedTextDetailed(text);
    expect(r.clean).toContain("Precio hilo 30/1");
    expect(r.cutBy).toBe("quote:fallback");
  });
});

describe("legacyBody", () => {
  it("colapsa espacios y corta a 5000 como el ingest viejo", () => {
    expect(legacyBody("a\n\n b\t c")).toBe("a b c");
    expect(legacyBody("x".repeat(6000)).length).toBe(5000);
  });
});
