import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "../lib/email.js";

const router: IRouter = Router();

router.post("/", async (req, res) => {
  const tenantId = req.tenantId!;
  const { name, email, phone, message } = req.body as {
    name?: string;
    email?: string;
    phone?: string;
    message?: string;
  };

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    res.status(400).json({ error: "Nome, email e mensagem são obrigatórios" });
    return;
  }

  const [contactRow, nameRow] = await Promise.all([
    db.select().from(settingsTable)
      .where(and(eq(settingsTable.tenantId, tenantId), eq(settingsTable.key, "contact_email")))
      .limit(1),
    db.select().from(settingsTable)
      .where(and(eq(settingsTable.tenantId, tenantId), eq(settingsTable.key, "company_name")))
      .limit(1),
  ]);

  const contactEmail = contactRow[0]?.value;
  const companyName = nameRow[0]?.value ?? "Arena";

  if (!contactEmail) {
    res.status(400).json({ error: "Email de contato não configurado pelo administrador" });
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Novo Contato</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#e0e0e0;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="background:#111;border-radius:12px;border:1px solid #222;padding:32px 24px;">
      <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#ffffff;text-transform:uppercase;letter-spacing:1px;">
        📬 Nova Mensagem de Contato
      </h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #222;color:#999;font-size:13px;width:120px;vertical-align:top;">Nome</td>
          <td style="padding:10px 0;border-bottom:1px solid #222;color:#fff;font-size:14px;font-weight:600;">${name}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #222;color:#999;font-size:13px;vertical-align:top;">Email</td>
          <td style="padding:10px 0;border-bottom:1px solid #222;font-size:14px;">
            <a href="mailto:${email}" style="color:#c9a227;text-decoration:none;">${email}</a>
          </td>
        </tr>
        ${phone ? `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #222;color:#999;font-size:13px;vertical-align:top;">Telefone</td>
          <td style="padding:10px 0;border-bottom:1px solid #222;color:#fff;font-size:14px;">${phone}</td>
        </tr>` : ""}
        <tr>
          <td style="padding:10px 0;color:#999;font-size:13px;vertical-align:top;">Mensagem</td>
          <td style="padding:10px 0;color:#e0e0e0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${message}</td>
        </tr>
      </table>
      <div style="margin-top:24px;padding:16px;background:#1a1a1a;border-radius:8px;border:1px solid #333;">
        <p style="margin:0;font-size:12px;color:#666;">Responder para: <a href="mailto:${email}" style="color:#c9a227;">${email}</a></p>
      </div>
    </div>
    <p style="text-align:center;font-size:12px;color:#444;margin-top:16px;">Mensagem recebida pelo formulário de contato de ${companyName}</p>
  </div>
</body>
</html>`;

  try {
    await sendEmail(contactEmail, `Nova mensagem de contato — ${name}`, html);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Erro ao enviar mensagem. Tente novamente." });
  }
});

export default router;
