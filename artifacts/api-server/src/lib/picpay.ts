/**
 * PicPay E-Commerce API helper
 * API docs: https://picpay.github.io/picpay-docs-digital-payments/
 *
 * Auth: x-picpay-token header
 * Base URL: https://appws.picpay.com/ecommerce/public
 */

const PICPAY_BASE = "https://appws.picpay.com/ecommerce/public";

export interface PicPayPixResult {
  referenceId: string;
  pixQrCode: string;       // copy-paste PIX string
  pixQrCodeBase64: string; // base64 image (sem o prefixo data:image/png;base64,)
  paymentUrl: string;
  expiresAt: string;
}

interface PicPayPaymentResponse {
  referenceId?: string;
  paymentUrl?: string;
  qrcode?: {
    content?: string;
    base64?: string;
  };
  expiresAt?: string;
  error?: string;
  message?: string;
}

interface PicPayStatusResponse {
  referenceId?: string;
  status?: {
    code?: number;
    message?: string;
  };
  authorizationId?: string;
}

/**
 * Gera um QR Code PIX via PicPay.
 * O referenceId é único por pagamento — use booking-{id} ou plan-{id}.
 * O callbackUrl recebe a notificação quando o pagamento é aprovado.
 */
export async function generatePicPayPix(params: {
  token: string;
  referenceId: string;
  callbackUrl: string;
  amount: number;
  buyer: {
    firstName: string;
    lastName: string;
    email: string;
    document?: string;
    phone?: string;
  };
  expiresAt?: Date;
}): Promise<PicPayPixResult> {
  const body: Record<string, unknown> = {
    referenceId: params.referenceId,
    callbackUrl: params.callbackUrl,
    value: Number(params.amount.toFixed(2)),
    buyer: {
      firstName: params.buyer.firstName,
      lastName: params.buyer.lastName || "-",
      email: params.buyer.email,
      ...(params.buyer.document ? { document: params.buyer.document } : {}),
      ...(params.buyer.phone ? { phone: params.buyer.phone } : {}),
    },
  };

  if (params.expiresAt) {
    body.expiresAt = params.expiresAt.toISOString();
  }

  const res = await fetch(`${PICPAY_BASE}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-picpay-token": params.token,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json() as PicPayPaymentResponse;

  if (!res.ok) {
    throw new Error(
      `PicPay API error ${res.status}: ${data.message ?? data.error ?? JSON.stringify(data)}`
    );
  }

  const rawBase64 = data.qrcode?.base64 ?? "";
  // PicPay às vezes retorna com o prefixo, às vezes sem
  const base64Clean = rawBase64.startsWith("data:")
    ? rawBase64.replace(/^data:image\/[^;]+;base64,/, "")
    : rawBase64;

  return {
    referenceId: data.referenceId ?? params.referenceId,
    pixQrCode: data.qrcode?.content ?? "",
    pixQrCodeBase64: base64Clean,
    paymentUrl: data.paymentUrl ?? "",
    expiresAt: data.expiresAt ?? "",
  };
}

/**
 * Verifica o status de um pagamento PicPay via API.
 * Retorna true se o pagamento foi aprovado (code 103 = Paid ou 104 = Completed).
 */
export async function verifyPicPayPayment(
  token: string,
  referenceId: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `${PICPAY_BASE}/payments/${encodeURIComponent(referenceId)}/status`,
      {
        headers: { "x-picpay-token": token },
      }
    );

    if (!res.ok) return false;

    const data = await res.json() as PicPayStatusResponse;
    const code = data.status?.code ?? 0;
    return code === 103 || code === 104;
  } catch {
    return false;
  }
}

/**
 * Valida um webhook do PicPay usando um token secreto passado como query param.
 * PicPay não usa HMAC — a validação é feita via token na URL + verificação de status via API.
 */
export function verifyPicPayWebhookToken(
  incomingToken: string | undefined,
  expectedToken: string | null
): boolean {
  if (!expectedToken) return true; // sem token configurado: aceita (desenvolvimento)
  if (!incomingToken) return false;
  return incomingToken === expectedToken;
}
