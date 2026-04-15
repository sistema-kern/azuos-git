import nodemailer from "nodemailer";
import { db } from "@workspace/db";
import { settingsTable, tenantAdminsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { getBaseUrl } from "./baseUrl.js";
import { sendPushToTenant } from "../routes/push.js";

const SMTP_KEYS = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from_name", "smtp_from_email"] as const;
type SmtpKey = (typeof SMTP_KEYS)[number];

async function getSmtpSetting(key: SmtpKey): Promise<string | null> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const [host, port, user, pass, fromName, fromEmail] = await Promise.all([
    getSmtpSetting("smtp_host"),
    getSmtpSetting("smtp_port"),
    getSmtpSetting("smtp_user"),
    getSmtpSetting("smtp_pass"),
    getSmtpSetting("smtp_from_name"),
    getSmtpSetting("smtp_from_email"),
  ]);

  if (!host || !user || !pass || !fromEmail) return null;

  return {
    host,
    port: Number(port) || 587,
    user,
    pass,
    fromName: fromName || "Azuos Esportes",
    fromEmail,
  };
}

async function createTransporter(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    tls: { rejectUnauthorized: false },
  });
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const config = await getSmtpConfig();
    if (!config) {
      console.warn("[email] SMTP não configurado — email não enviado");
      return false;
    }
    const transporter = await createTransporter(config);
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to,
      subject,
      html,
    });
    console.info(`[email] Enviado para ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error("[email] Erro ao enviar email:", err);
    return false;
  }
}

export async function testSmtpConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = await getSmtpConfig();
    if (!config) return { ok: false, error: "SMTP não configurado" };
    const transporter = await createTransporter(config);
    await transporter.verify();
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    return { ok: false, error: msg };
  }
}

const DEFAULT_BRAND_COLOR = "#c9a227";

async function getBrandColor(tenantId = 1): Promise<string> {
  const rows = await db.select().from(settingsTable).where(and(eq(settingsTable.tenantId, tenantId), eq(settingsTable.key, "theme_primary"))).limit(1);
  return rows[0]?.value ?? DEFAULT_BRAND_COLOR;
}

async function getLogoUrl(tenantId = 1): Promise<string | null> {
  const rows = await db.select().from(settingsTable).where(and(eq(settingsTable.tenantId, tenantId), eq(settingsTable.key, "logo_url"))).limit(1);
  const value = rows[0]?.value;
  if (!value) return null;
  if (value.startsWith("http")) return value;
  const base = getBaseUrl();
  if (value.startsWith("/objects/")) return `${base}/api/storage${value}`; // legacy GCS
  if (value.startsWith("/tenant-")) return `${base}/api/uploads${value}`; // local disk
  if (value.startsWith("/api/")) return `${base}${value}`; // already full API path
  return value;
}

async function getCompanyName(tenantId = 1): Promise<string> {
  const rows = await db.select().from(settingsTable).where(and(eq(settingsTable.tenantId, tenantId), eq(settingsTable.key, "company_name"))).limit(1);
  return rows[0]?.value ?? "Arenix";
}

function baseTemplate(content: string, brandColor: string, logoUrl: string | null, companyName: string): string {
  const headerContent = logoUrl
    ? `<img src="${logoUrl}" alt="${companyName}" style="max-width:280px;height:auto;max-height:100px;object-fit:contain;" />`
    : `<div style="display:inline-block;background:#111;border-radius:12px;padding:16px 32px;border:1px solid #333;">
         <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:${brandColor};text-transform:uppercase;">${companyName}</span>
       </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${companyName}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#e0e0e0;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <!-- Header -->
    <div style="text-align:center;padding:32px 0 24px;">
      ${headerContent}
    </div>
    <!-- Content -->
    <div style="background:#111;border-radius:12px;border:1px solid #222;padding:32px 24px;">
      ${content}
    </div>
    <!-- Footer -->
    <div style="text-align:center;padding:24px 0 8px;color:#555;font-size:12px;">
      <p style="margin:0;">${companyName}</p>
      <p style="margin:4px 0 0;">Este e-mail foi enviado automaticamente. Por favor, não responda.</p>
    </div>
  </div>
</body>
</html>`;
}

function infoRow(icon: string, label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 12px;color:#888;font-size:13px;white-space:nowrap;">${icon} ${label}</td>
    <td style="padding:10px 12px;font-size:14px;font-weight:600;color:#e0e0e0;">${value}</td>
  </tr>`;
}

function infoTable(rows: string): string {
  return `<table style="width:100%;border-collapse:collapse;background:#0d0d0d;border-radius:8px;overflow:hidden;margin:20px 0;">
    <tbody>${rows}</tbody>
  </table>`;
}

function heading(text: string): string {
  return `<h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#fff;">${text}</h2>`;
}

function subheading(text: string): string {
  return `<p style="margin:0 0 20px;color:#888;font-size:14px;">${text}</p>`;
}

function badge(text: string, color: string = BRAND_COLOR): string {
  return `<span style="display:inline-block;background:${color}22;color:${color};border:1px solid ${color}44;border-radius:20px;padding:4px 14px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">${text}</span>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #222;margin:20px 0;" />`;
}

function greeting(name: string): string {
  return `<p style="margin:0 0 20px;font-size:16px;color:#ccc;">Olá, <strong style="color:#fff;">${name}</strong>! 👋</p>`;
}

const DAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return `${DAY_NAMES[dow]}, ${d} de ${MONTH_NAMES[m - 1]} de ${y}`;
}

function calcEndTime(time: string, durationHours: number): string {
  const [h, m] = time.split(":").map(Number);
  const totalMins = h * 60 + m + Math.round(Number(durationHours) * 60);
  return `${String(Math.floor(totalMins / 60) % 24).padStart(2, "0")}:${String(totalMins % 60).padStart(2, "0")}`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h${m}`;
}

// ──────────────────────────────────────────────────
// EMAIL: Campanha MKT — usa template da marca
// ──────────────────────────────────────────────────
/** Fix relative src/href paths in HTML to absolute URLs for email delivery */
function absolutifyUrls(html: string, base: string): string {
  if (!base) return html;
  return html
    .replace(/(<(?:img|video|source)[^>]+src=["'])(\/)(?!\/)/gi, `$1${base}/`)
    .replace(/(<a[^>]+href=["'])(\/)(?!\/)/gi, `$1${base}/`);
}

function constrainImages(html: string): string {
  return html.replace(/<img(\s[^>]*?)?\/?>/gi, (match, attrs = "") => {
    const existingStyle = (attrs.match(/style=["']([^"']*)["']/i) ?? [])[1] ?? "";
    const newStyle = [
      "max-width:100%",
      "height:auto",
      "display:block",
      "border-radius:6px",
      existingStyle,
    ].filter(Boolean).join(";");
    const cleanAttrs = attrs.replace(/style=["'][^"']*["']/i, "").trim();
    return `<img${cleanAttrs ? " " + cleanAttrs : ""} style="${newStyle}" />`;
  });
}

export async function buildCampaignEmail(campaignContent: string, bgColor: string, tenantId = 1): Promise<string> {
  const [brandColor, logoUrl, companyName] = await Promise.all([getBrandColor(tenantId), getLogoUrl(tenantId), getCompanyName(tenantId)]);
  const base = getBaseUrl();
  const content = constrainImages(absolutifyUrls(campaignContent, base));

  const headerContent = logoUrl
    ? `<img src="${logoUrl}" alt="${companyName}" style="max-width:280px;height:auto;max-height:100px;object-fit:contain;" />`
    : `<div style="display:inline-block;background:#111;border-radius:12px;padding:16px 32px;border:1px solid #333;">
         <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:${brandColor};text-transform:uppercase;">${companyName}</span>
       </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${companyName}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#e0e0e0;">
  <div style="max-width:620px;margin:0 auto;padding:24px 16px;">
    <div style="text-align:center;padding:32px 0 24px;">
      ${headerContent}
    </div>
    <div style="background:${bgColor || "#111"};border-radius:12px;border:1px solid #222;padding:32px 24px;color:#e0e0e0;overflow:hidden;word-wrap:break-word;">
      ${content}
    </div>
    <div style="text-align:center;padding:24px 0 8px;color:#555;font-size:12px;">
      <p style="margin:0;">${companyName}</p>
      <p style="margin:4px 0 0;">Este e-mail foi enviado automaticamente. Por favor, não responda.</p>
    </div>
  </div>
</body>
</html>`;
}

// ──────────────────────────────────────────────────
// EMAIL: Confirmação de Reserva de Quadra (Individual)
// ──────────────────────────────────────────────────
export interface CourtBookingEmailData {
  customerName: string;
  customerEmail: string;
  date: string;
  time: string;
  durationHours: number;
  courtNumber: number;
  amount: number;
  bookingId: number;
  tenantId?: number;
  /** Optional: pass grouped slots for multi-booking emails */
  slots?: { time: string; durationHours: number }[];
}

export async function sendCourtBookingConfirmation(data: CourtBookingEmailData): Promise<void> {
  const tid = data.tenantId ?? 1;
  const [brandColor, logoUrl, companyName] = await Promise.all([getBrandColor(tid), getLogoUrl(tid), getCompanyName(tid)]);

  // Build slot list: use explicit slots array if provided, otherwise single slot from time/durationHours
  const rawSlots: { time: string; durationHours: number }[] =
    data.slots && data.slots.length > 0
      ? data.slots
      : [{ time: data.time, durationHours: data.durationHours }];

  const horarioStr = rawSlots
    .map(s => `${s.time} às ${calcEndTime(s.time, s.durationHours)}`)
    .join(" &nbsp;•&nbsp; ");

  const totalSlots = rawSlots.reduce((s, r) => s + r.durationHours, 0);

  const content = `
    ${greeting(data.customerName)}
    ${heading("Reserva de Quadra Confirmada!")}
    ${subheading("Sua reserva está confirmada. Até lá!")}
    ${badge("Confirmado", "#22c55e")}
    ${infoTable(
      infoRow("📅", "Data", formatDate(data.date)) +
      infoRow("⏰", "Horário", horarioStr) +
      infoRow("🏟️", "Quadra", `Quadra ${data.courtNumber}`) +
      infoRow("⏱️", "Duração", formatDuration(totalSlots)) +
      infoRow("💳", "Valor", `R$ ${data.amount.toFixed(2).replace(".", ",")}`) +
      infoRow("#️⃣", "Código", `#${data.bookingId}`)
    )}
    ${divider()}
    <p style="margin:0;color:#888;font-size:13px;text-align:center;">Lembre-se de chegar com alguns minutos de antecedência. Caso precise cancelar, entre em contato com antecedência.</p>
  `;
  await sendEmail(data.customerEmail, `✅ Reserva de Quadra Confirmada – ${companyName}`, baseTemplate(content, brandColor, logoUrl, companyName));
}

// ──────────────────────────────────────────────────
// EMAIL: Confirmação de Aula
// ──────────────────────────────────────────────────
export interface ClassBookingEmailData {
  customerName: string;
  customerEmail: string;
  date: string;
  time: string;
  numberOfPeople: number;
  amount: number;
  bookingId: number;
  tenantId?: number;
}

export async function sendClassBookingConfirmation(data: ClassBookingEmailData): Promise<void> {
  const tid = data.tenantId ?? 1;
  const [brandColor, logoUrl, companyName] = await Promise.all([getBrandColor(tid), getLogoUrl(tid), getCompanyName(tid)]);
  const content = `
    ${greeting(data.customerName)}
    ${heading("Aula Confirmada!")}
    ${subheading("Sua aula está confirmada. Até lá!")}
    ${badge("Confirmado", "#22c55e")}
    ${infoTable(
      infoRow("📅", "Data", formatDate(data.date)) +
      infoRow("⏰", "Horário", data.time) +
      infoRow("👥", "Pessoas", `${data.numberOfPeople} pessoa${data.numberOfPeople > 1 ? "s" : ""}`) +
      infoRow("💳", "Valor", `R$ ${data.amount.toFixed(2).replace(".", ",")}`) +
      infoRow("#️⃣", "Código", `#${data.bookingId}`)
    )}
    ${divider()}
    <p style="margin:0;color:#888;font-size:13px;text-align:center;">Lembre-se de chegar com alguns minutos de antecedência. Traga sua raquete e boa diversão!</p>
  `;
  await sendEmail(data.customerEmail, `✅ Aula Confirmada – ${companyName}`, baseTemplate(content, brandColor, logoUrl, companyName));
}

// ──────────────────────────────────────────────────
// EMAIL: Cancelamento de Reserva de Quadra
// ──────────────────────────────────────────────────
export interface CourtBookingCancellationData {
  customerName: string;
  customerEmail: string;
  date: string;
  time: string;
  durationHours: number;
  courtNumber: number;
  bookingId: number;
  tenantId?: number;
}

export async function sendCourtBookingCancellation(data: CourtBookingCancellationData): Promise<void> {
  const tid = data.tenantId ?? 1;
  const [brandColor, logoUrl, companyName] = await Promise.all([getBrandColor(tid), getLogoUrl(tid), getCompanyName(tid)]);
  const endTime = calcEndTime(data.time, data.durationHours);
  const content = `
    ${greeting(data.customerName)}
    ${heading("Reserva Cancelada")}
    ${subheading("Sua reserva de quadra foi cancelada.")}
    ${badge("Cancelado", "#ef4444")}
    ${infoTable(
      infoRow("📅", "Data", formatDate(data.date)) +
      infoRow("⏰", "Horário", `${data.time} às ${endTime}`) +
      infoRow("🏟️", "Quadra", `Quadra ${data.courtNumber}`) +
      infoRow("#️⃣", "Código", `#${data.bookingId}`)
    )}
    ${divider()}
    <p style="margin:0;color:#888;font-size:13px;text-align:center;">Se você acredita que isso foi um engano, entre em contato conosco.</p>
  `;
  await sendEmail(data.customerEmail, `❌ Reserva de Quadra Cancelada – ${companyName}`, baseTemplate(content, brandColor, logoUrl, companyName));
}

// ──────────────────────────────────────────────────
// EMAIL: Cancelamento de Aula
// ──────────────────────────────────────────────────
export interface ClassBookingCancellationData {
  customerName: string;
  customerEmail: string;
  date: string;
  time: string;
  numberOfPeople: number;
  bookingId: number;
  tenantId?: number;
}

export async function sendClassBookingCancellation(data: ClassBookingCancellationData): Promise<void> {
  const tid = data.tenantId ?? 1;
  const [brandColor, logoUrl, companyName] = await Promise.all([getBrandColor(tid), getLogoUrl(tid), getCompanyName(tid)]);
  const content = `
    ${greeting(data.customerName)}
    ${heading("Aula Cancelada")}
    ${subheading("Sua aula foi cancelada.")}
    ${badge("Cancelado", "#ef4444")}
    ${infoTable(
      infoRow("📅", "Data", formatDate(data.date)) +
      infoRow("⏰", "Horário", data.time) +
      infoRow("👥", "Pessoas", `${data.numberOfPeople} pessoa${data.numberOfPeople > 1 ? "s" : ""}`) +
      infoRow("#️⃣", "Código", `#${data.bookingId}`)
    )}
    ${divider()}
    <p style="margin:0;color:#888;font-size:13px;text-align:center;">Se você acredita que isso foi um engano, entre em contato conosco.</p>
  `;
  await sendEmail(data.customerEmail, `❌ Aula Cancelada – ${companyName}`, baseTemplate(content, brandColor, logoUrl, companyName));
}

// ──────────────────────────────────────────────────
// EMAIL: Boas-vindas ao Plano Mensalista
// ──────────────────────────────────────────────────
const DAY_OF_WEEK_LABELS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export interface PlanWelcomeEmailData {
  customerName: string;
  customerEmail: string;
  planType: "court" | "class";
  dayOfWeek: number;
  time: string;
  durationHours?: number;
  courtNumber?: number;
  numberOfPeople?: number;
  tenantId?: number;
}

export async function sendPlanWelcomeEmail(data: PlanWelcomeEmailData): Promise<void> {
  const tid = data.tenantId ?? 1;
  const [brandColor, logoUrl, companyName] = await Promise.all([getBrandColor(tid), getLogoUrl(tid), getCompanyName(tid)]);
  const isCourtPlan = data.planType === "court";
  const tableRows = isCourtPlan
    ? infoRow("🏟️", "Quadra", `Quadra ${data.courtNumber}`) +
      infoRow("⏱️", "Duração", formatDuration(data.durationHours ?? 1)) +
      infoRow("📅", "Dia", DAY_OF_WEEK_LABELS[data.dayOfWeek]) +
      infoRow("⏰", "Horário", data.time)
    : infoRow("🏖️", "Modalidade", "Aula de Beach Tennis") +
      infoRow("📅", "Dia", DAY_OF_WEEK_LABELS[data.dayOfWeek]) +
      infoRow("⏰", "Horário", data.time) +
      infoRow("👥", "Vagas", `${data.numberOfPeople} pessoa${(data.numberOfPeople ?? 1) > 1 ? "s" : ""}`);

  const content = `
    ${greeting(data.customerName)}
    ${heading("Seu Plano Mensalista está Ativo! 🏆")}
    ${subheading("Bem-vindo(a) ao clube! Suas reservas foram confirmadas para o ano todo.")}
    ${badge("Plano Ativo", brandColor)}
    ${infoTable(tableRows)}
    ${divider()}
    <p style="margin:0;color:#888;font-size:13px;text-align:center;">Você receberá lembretes por e-mail 1 dia antes de cada reserva. Boas jogadas!</p>
  `;
  await sendEmail(data.customerEmail, `🏆 Seu Plano Mensalista ${companyName} está Ativo!`, baseTemplate(content, brandColor, logoUrl, companyName));
}

// ──────────────────────────────────────────────────
// EMAIL: Lembrete de Reserva (1 dia antes)
// ──────────────────────────────────────────────────
export interface BookingReminderEmailData {
  customerName: string;
  customerEmail: string;
  date: string;
  time: string;
  durationHours?: number;
  bookingType: "court" | "class";
  courtNumber?: number;
  numberOfPeople?: number;
  tenantId?: number;
}

// ──────────────────────────────────────────────────
// EMAIL: Confirmação de Inscrição em Torneio
// ──────────────────────────────────────────────────
export interface TournamentRegistrationEmailData {
  tournamentName: string;
  tournamentDate?: string;
  tournamentLocation?: string;
  registrationType: "individual" | "dupla" | "trio";
  categoryName?: string;
  price: string;
  players: Array<{ fullName: string; nickname?: string | null; email: string }>;
  pixCopiaECola?: string | null;
  isConfirmed?: boolean;
  isCancelled?: boolean;
  tenantId?: number;
}

export async function sendTournamentRegistrationEmail(data: TournamentRegistrationEmailData): Promise<void> {
  const tid = data.tenantId ?? 1;
  const [brandColor, logoUrl, companyName] = await Promise.all([getBrandColor(tid), getLogoUrl(tid), getCompanyName(tid)]);

  const typeLabel = data.registrationType === "individual" ? "Individual" : data.registrationType === "dupla" ? "Dupla" : "Trio";
  const isConfirmed = data.isConfirmed ?? false;
  const isCancelled = data.isCancelled ?? false;

  const playerRows = data.players
    .map(
      (p, i) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #222;font-size:13px;color:#aaa;">${i + 1}.</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #222;font-weight:700;">${p.fullName}${p.nickname ? ` <span style="color:#888;">(${p.nickname})</span>` : ""}</td></tr>`,
    )
    .join("");

  const titleText = isCancelled ? "Inscrição Cancelada" : isConfirmed ? "Inscrição Confirmada! 🎉" : "Inscrição Recebida! 🏆";
  const subtitleText = isCancelled
    ? `Sua inscrição no torneio <strong>${data.tournamentName}</strong> foi cancelada pelo organizador.`
    : isConfirmed
    ? `Sua inscrição no torneio <strong>${data.tournamentName}</strong> está confirmada. Prepare-se para competir!`
    : `Sua inscrição no torneio <strong>${data.tournamentName}</strong> foi recebida com sucesso.`;
  const badgeText = isCancelled ? "❌ Inscrição Cancelada" : isConfirmed ? "✅ Pagamento Confirmado" : "Inscrição Pendente de Pagamento";
  const badgeColor = isCancelled ? "#ef4444" : isConfirmed ? "#22c55e" : "#c9a227";
  const footerText = isCancelled
    ? "Se tiver dúvidas sobre o cancelamento, entre em contato com o organizador do torneio."
    : isConfirmed
    ? "Sua vaga está garantida! Lembre-se de chegar com antecedência. Boa sorte! 🏐🔥"
    : "Sua inscrição só será confirmada após a confirmação do pagamento. Boa sorte! 🏐";

  const bodyShared = `
    ${heading(titleText)}
    ${subheading(subtitleText)}
    ${badge(badgeText, badgeColor)}
    ${infoTable(
      infoRow("🏆", "Torneio", data.tournamentName) +
        (data.tournamentDate ? infoRow("📅", "Data", formatDate(data.tournamentDate)) : "") +
        (data.tournamentLocation ? infoRow("📍", "Local", data.tournamentLocation) : "") +
        (data.categoryName ? infoRow("🏅", "Categoria", data.categoryName) : "") +
        infoRow("👥", "Modalidade", typeLabel) +
        infoRow("💰", "Valor", `R$ ${Number(data.price).toFixed(2).replace(".", ",")}`)
    )}
    <div style="margin:20px 0;">
      <p style="margin:0 0 10px;font-weight:700;font-size:14px;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Jogadores Inscritos</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#111;border-radius:8px;overflow:hidden;border:1px solid #222;">
        ${playerRows}
      </table>
    </div>
    ${divider()}
    <p style="margin:0;color:#888;font-size:13px;text-align:center;">${footerText}</p>
  `;

  const subject = isCancelled
    ? `❌ Inscrição Cancelada – ${data.tournamentName} | ${companyName}`
    : isConfirmed
    ? `✅ Inscrição Confirmada – ${data.tournamentName} | ${companyName}`
    : `🏆 Inscrição no Torneio ${data.tournamentName} – ${companyName}`;

  for (const player of data.players) {
    const content = `${greeting(player.fullName)}${bodyShared}`;
    await sendEmail(player.email, subject, baseTemplate(content, brandColor, logoUrl, companyName));
  }
}

export async function sendBookingReminderEmail(data: BookingReminderEmailData): Promise<void> {
  const tid = data.tenantId ?? 1;
  const [brandColor, logoUrl, companyName] = await Promise.all([getBrandColor(tid), getLogoUrl(tid), getCompanyName(tid)]);
  const isCourtBooking = data.bookingType === "court";
  const endTime = data.durationHours ? calcEndTime(data.time, data.durationHours) : null;

  const tableRows = isCourtBooking
    ? infoRow("📅", "Data", formatDate(data.date)) +
      infoRow("⏰", "Horário", endTime ? `${data.time} – ${endTime}` : data.time) +
      infoRow("🏟️", "Quadra", `Quadra ${data.courtNumber}`)
    : infoRow("📅", "Data", formatDate(data.date)) +
      infoRow("⏰", "Horário", data.time) +
      infoRow("🏖️", "Modalidade", "Aula de Beach Tennis") +
      (data.numberOfPeople ? infoRow("👥", "Pessoas", `${data.numberOfPeople} pessoa${data.numberOfPeople > 1 ? "s" : ""}`) : "");

  const content = `
    ${greeting(data.customerName)}
    ${heading("Lembrete: Você tem uma reserva amanhã! ⏰")}
    ${subheading("Só para lembrar que sua reserva está confirmada para amanhã.")}
    ${badge("Lembrete", "#3b82f6")}
    ${infoTable(tableRows)}
    ${divider()}
    <p style="margin:0;color:#888;font-size:13px;text-align:center;">Lembre-se de chegar com alguns minutos de antecedência. Boa jogada!</p>
  `;
  const subject = isCourtBooking
    ? `⏰ Lembrete: Reserva Amanhã – ${companyName}`
    : `⏰ Lembrete: Aula Amanhã – ${companyName}`;
  await sendEmail(data.customerEmail, subject, baseTemplate(content, brandColor, logoUrl, companyName));
}

// ──────────────────────────────────────────────────
// EMAIL: Notificação interna para admins do tenant
// ──────────────────────────────────────────────────

export interface AdminBookingNotificationData {
  tenantId: number;
  bookingId: number;
  type: "court" | "class";
  customerName: string;
  date: string;
  time: string;
  amount: number;
  /** For court bookings */
  courtName?: string;
  /** For class bookings */
  numberOfPeople?: number;
}

export async function sendAdminBookingNotification(data: AdminBookingNotificationData): Promise<void> {
  try {
    const notifyAdmins = await db
      .select({ email: tenantAdminsTable.email, name: tenantAdminsTable.name })
      .from(tenantAdminsTable)
      .where(
        and(
          eq(tenantAdminsTable.tenantId, data.tenantId),
          eq(tenantAdminsTable.active, true),
          eq(tenantAdminsTable.notifyBookings, true),
        )
      );

    if (notifyAdmins.length === 0) return;

    const [brandColor, logoUrl, companyName] = await Promise.all([
      getBrandColor(data.tenantId),
      getLogoUrl(data.tenantId),
      getCompanyName(data.tenantId),
    ]);

    const details = data.type === "court"
      ? infoRow("🏟️", "Quadra", data.courtName ?? `Quadra`) + infoRow("⏰", "Horário", data.time)
      : infoRow("⏰", "Horário", data.time) + infoRow("👥", "Pessoas", `${data.numberOfPeople ?? 1}`);

    const content = `
      <p style="margin:0 0 16px;font-size:15px;color:#d4d4d4;">Olá! Uma nova reserva foi <strong style="color:#22c55e;">confirmada</strong> no sistema.</p>
      ${heading(data.type === "court" ? "Nova Reserva de Quadra ✅" : "Nova Aula Confirmada ✅")}
      ${badge("Confirmado", "#22c55e")}
      ${infoTable(
        infoRow("👤", "Cliente", data.customerName) +
        infoRow("📅", "Data", formatDate(data.date)) +
        details +
        infoRow("💳", "Valor", `R$ ${Number(data.amount).toFixed(2).replace(".", ",")}`) +
        infoRow("#️⃣", "Código", `#${data.bookingId}`)
      )}
      ${divider()}
      <p style="margin:0;color:#888;font-size:13px;text-align:center;">Este é um aviso automático enviado ao administrador da ${companyName}.</p>
    `;

    const subject = `🔔 Nova reserva confirmada – ${data.customerName} (${formatDate(data.date)})`;
    const html = baseTemplate(content, brandColor, logoUrl, companyName);

    const typeLabel = data.type === "court" ? `${data.courtName ?? "Quadra"}` : "Aula";
    const pushBody = `${data.customerName} agendou ${typeLabel} em ${formatDate(data.date)} ${data.time}`;

    await Promise.all([
      ...notifyAdmins.map(admin => sendEmail(admin.email, subject, html)),
      sendPushToTenant(data.tenantId, {
        title: `🔔 Nova reserva confirmada`,
        body: pushBody,
        url: "/admin",
      }),
    ]);
  } catch (err) {
    console.error("[email] Erro ao notificar admins:", err);
  }
}
