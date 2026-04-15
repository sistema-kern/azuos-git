import { PageLayout } from "@/components/layout/PageLayout";
import { Button, Card, Input, Label } from "@/components/ui";
import { useCreateCourtBooking } from "@workspace/api-client-react";
import { useState, useEffect } from "react";
import { format, addDays, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar as CalendarIcon, Clock, User, Phone, Mail, Copy, CheckCheck, CheckCircle, Shield, CalendarDays, CreditCard, FileText, DollarSign } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { showToast } from "@/lib/toast";

const maskPhone = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
};

const maskCPF = (value: string): string => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

const bookingSchema = z.object({
  customerName: z.string().min(3, "Nome muito curto"),
  customerEmail: z.string().email("Email inválido"),
  customerPhone: z.string().min(10, "Telefone inválido"),
});

type BookingForm = z.infer<typeof bookingSchema>;

interface SlotInfo {
  time: string;
  available: boolean;
  price: number;
}

interface PixData {
  bookingId: number;
  pixQrCode: string;
  pixQrCodeBase64: string;
  amount: number;
  selectedTimes?: string[];
}


function PixModal({ data, onClose, onPaymentConfirmed }: { data: PixData; onClose: () => void; onPaymentConfirmed?: (times: string[]) => void }) {
  const [copied, setCopied] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  const handleCopy = () => {
    void navigator.clipboard.writeText(data.pixQrCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;
    let isMounted = true;

    const checkStatus = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/bookings/${data.bookingId}/status`);
        if (!res.ok) return;
        const result = await res.json();
        if (isMounted) {
          setPaymentStatus(result.status);
          if (result.status === "confirmed") {
            setIsChecking(false);
            if (pollInterval) clearInterval(pollInterval);
            if (onPaymentConfirmed && data.selectedTimes) {
              onPaymentConfirmed(data.selectedTimes);
            }
          }
        }
      } catch (err) {
        console.error("Erro ao verificar status do pagamento:", err);
      }
    };

    checkStatus();
    pollInterval = setInterval(checkStatus, 2000);

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [data.bookingId]);

  if (paymentStatus === "confirmed") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4" onClick={onClose}>
        <div
          className="bg-card border border-white/10 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle size={40} className="text-green-500" />
            </div>
          </div>
          <h2 className="text-3xl font-display font-bold text-green-400 mb-2">Pagamento Confirmado!</h2>
          <p className="text-muted-foreground mb-4">Sua reserva foi confirmada com sucesso.</p>
          <div className="bg-primary/10 rounded-lg p-4 mb-6 border border-primary/20">
            <p className="text-xs text-muted-foreground mb-1">Pedido</p>
            <p className="text-2xl font-bold text-primary">#{data.bookingId}</p>
          </div>
          <Button variant="gold" className="w-full" onClick={onClose}>
            Voltar para Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4" onClick={onClose}>
      <div
        className="bg-card border border-white/10 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-display font-bold gold-gradient-text mb-2">Pague com PIX</h2>
        <p className="text-muted-foreground text-sm mb-6">
          Valor: <span className="text-primary font-bold text-lg">{formatCurrency(data.amount)}</span>
        </p>

        {data.pixQrCodeBase64 ? (
          <div className="flex justify-center mb-6">
            <img
              src={`data:image/png;base64,${data.pixQrCodeBase64}`}
              alt="QR Code PIX"
              className="w-52 h-52 rounded-xl border border-white/10"
            />
          </div>
        ) : (
          <div className="flex justify-center mb-6">
            <div className="w-52 h-52 rounded-xl border border-dashed border-white/20 flex items-center justify-center text-muted-foreground text-sm">
              QR Code indisponível
            </div>
          </div>
        )}

        {data.pixQrCode && (
          <div className="mb-6">
            <p className="text-xs text-muted-foreground mb-2">Ou copie o código PIX:</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={data.pixQrCode}
                className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono truncate text-muted-foreground"
              />
              <button
                onClick={handleCopy}
                className={cn(
                  "shrink-0 px-3 py-2 rounded-lg border text-sm font-bold transition-all",
                  copied
                    ? "border-green-500 text-green-400 bg-green-500/10"
                    : "border-primary text-primary hover:bg-primary/10"
                )}
              >
                {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        )}

        {isChecking && (
          <div className="flex items-center justify-center gap-2 mb-6 p-3 bg-primary/10 rounded-lg border border-primary/20">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
            <p className="text-xs text-primary font-medium">Verificando pagamento...</p>
          </div>
        )}

        <p className="text-xs text-muted-foreground mb-6">
          O pagamento é confirmado automaticamente após a transferência.
          Pedido #{data.bookingId}
        </p>

        <Button variant="outline" className="w-full border-white/10" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

interface CourtRecord {
  id: number;
  name: string;
  number: number;
  description: string | null;
  active: boolean;
}

interface MonthlyCourtPricing {
  weekday: { morning: number; afternoon: number; night: number };
  weekend: { morning: number; afternoon: number; night: number };
}

function getMonthlyPrice(pricing: MonthlyCourtPricing, dateStr: string, timeStr: string): number {
  const hour = parseInt(timeStr.split(":")[0], 10);
  const dow = new Date(dateStr + "T12:00:00").getDay();
  const isWeekend = dow === 0 || dow === 6;
  const dp = isWeekend ? pricing.weekend : pricing.weekday;
  if (hour < 12) return dp.morning;
  if (hour < 18) return dp.afternoon;
  return dp.night;
}

// Returns all dates matching dayOfWeek in the same calendar month as startDate,
// from startDate through end of month.
function getCalendarMonthDates(startDate: Date, dayOfWeek: number): Date[] {
  const year = startDate.getFullYear();
  const month = startDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dates: Date[] = [];
  for (let d = startDate.getDate(); d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    if (dt.getDay() === dayOfWeek) dates.push(dt);
  }
  return dates;
}

// Returns all dates matching dayOfWeek in the next calendar month after startDate.
function getNextCalendarMonthDates(startDate: Date, dayOfWeek: number): Date[] {
  let year = startDate.getFullYear();
  let month = startDate.getMonth() + 1;
  if (month > 11) { month = 0; year++; }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dates: Date[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    if (dt.getDay() === dayOfWeek) dates.push(dt);
  }
  return dates;
}

export default function Agendamento() {
  const [date, setDate] = useState<Date>(new Date());
  const [courts, setCourts] = useState<CourtRecord[]>([]);
  const [courtsLoading, setCourtsLoading] = useState(true);
  const [selectedCourt, setSelectedCourt] = useState<number | null>(null);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [selectedTimes, setSelectedTimes] = useState<Set<string>>(new Set());
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [blockedTimes, setBlockedTimes] = useState<Set<string>>(new Set());
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [bookingType, setBookingType] = useState<"individual" | "monthly">("individual");
  const [monthlyIncludeNext, setMonthlyIncludeNext] = useState(false);
  const [monthlyCpf, setMonthlyCpf] = useState("");
  const [monthlyNotes, setMonthlyNotes] = useState("");
  const [monthlyPricing, setMonthlyPricing] = useState<MonthlyCourtPricing>({
    weekday: { morning: 80, afternoon: 80, night: 100 },
    weekend: { morning: 100, afternoon: 100, night: 120 },
  });
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; type: string; value: number } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/courts`)
      .then(r => r.json())
      .then((data: CourtRecord[]) => {
        const active = Array.isArray(data) ? data.filter(c => c.active) : [];
        setCourts(active);
      })
      .catch(() => setCourts([]))
      .finally(() => setCourtsLoading(false));
  }, []);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/settings/monthly-court-pricing`)
      .then(r => r.json())
      .then((d: MonthlyCourtPricing) => {
        if (d?.weekday) setMonthlyPricing(d);
      })
      .catch(() => undefined);
  }, []);

  const createBooking = useCreateCourtBooking();

  const { register, handleSubmit, formState: { errors }, reset } = useForm<BookingForm>({
    resolver: zodResolver(bookingSchema),
  });

  // Fetch availability whenever date or court changes
  useEffect(() => {
    if (!selectedCourt) {
      setSlots([]);
      return;
    }
    setIsLoadingSlots(true);
    setSelectedTimes(new Set());

    const dateStr = format(date, 'yyyy-MM-dd');
    const monthlyParam = bookingType === "monthly" ? "&monthly=true" : "";
    fetch(`${import.meta.env.BASE_URL}api/bookings/availability?date=${dateStr}&type=futvolei&courtNumber=${selectedCourt}${monthlyParam}`)
      .then(r => r.json())
      .then((d: { slots: SlotInfo[] }) => setSlots(d.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setIsLoadingSlots(false));
  }, [date, selectedCourt, bookingType]);

  // Poll availability every 10 seconds when court is selected
  useEffect(() => {
    if (!selectedCourt) return;
    const interval = setInterval(() => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const monthlyParam = bookingType === "monthly" ? "&monthly=true" : "";
      fetch(`${import.meta.env.BASE_URL}api/bookings/availability?date=${dateStr}&type=futvolei&courtNumber=${selectedCourt}${monthlyParam}`)
        .then(r => r.json())
        .then((d: { slots: SlotInfo[] }) => setSlots(d.slots ?? []))
        .catch(() => undefined);
    }, 10000);
    return () => clearInterval(interval);
  }, [date, selectedCourt, bookingType]);

  const slotPriceMap: Record<string, number> = {};
  for (const slot of slots) {
    slotPriceMap[slot.time] = slot.price;
  }

  const sortedTimes = Array.from(selectedTimes).sort();
  const firstTime = sortedTimes[0] ?? null;
  const duration = sortedTimes.length;
  const dateStr = format(date, 'yyyy-MM-dd');
  const monthlyPricePerSession = firstTime
    ? getMonthlyPrice(monthlyPricing, dateStr, firstTime)
    : 0;

  // Calendar-month logic: dates of same weekday in current month (from selected date),
  // plus optionally all dates in the next calendar month.
  const selectedDow = date.getDay();
  const currentMonthDates = firstTime ? getCalendarMonthDates(date, selectedDow) : [];
  const nextMonthDates = firstTime ? getNextCalendarMonthDates(date, selectedDow) : [];
  const monthlyDates = monthlyIncludeNext
    ? [...currentMonthDates, ...nextMonthDates]
    : currentMonthDates;
  const monthlyTotal = monthlyPricePerSession * monthlyDates.length;

  const nextMonthLabel = format(addMonths(date, 1), "MMMM", { locale: ptBR });
  const currentMonthLabel = format(date, "MMMM", { locale: ptBR });

  const price = bookingType === "monthly"
    ? monthlyTotal
    : sortedTimes.reduce((sum, t) => sum + (slotPriceMap[t] ?? 0), 0);

  const discountAmount = appliedCoupon
    ? appliedCoupon.type === "percentage"
      ? Math.round(price * appliedCoupon.value / 100 * 100) / 100
      : Math.min(appliedCoupon.value, price)
    : 0;
  const finalPrice = Math.max(0, price - discountAmount);

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponError("");
    setCheckingCoupon(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/coupons/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode.trim() }),
      });
      const data = await res.json() as { error?: string; id?: number; code?: string; type?: string; value?: number };
      if (!res.ok) {
        setCouponError(data.error ?? "Cupom inválido");
        setAppliedCoupon(null);
      } else {
        setAppliedCoupon({ code: data.code!, type: data.type!, value: data.value! });
        setCouponError("");
        showToast.success("Cupom aplicado!");
      }
    } catch {
      setCouponError("Erro ao validar cupom");
    } finally {
      setCheckingCoupon(false);
    }
  };

  const handleDateChange = (d: Date) => {
    setDate(d);
    setSelectedTimes(new Set());
  };

  const handleCourtChange = (c: number) => {
    setSelectedCourt(c);
    setSelectedTimes(new Set());
    const courtData = courts.find(ct => ct.number === c);
    if (courtData?.photoUrl) {
      setShowPhotoModal(true);
    }
  };

  const selectedCourtData = selectedCourt ? courts.find(c => c.number === selectedCourt) ?? null : null;

  const handleTimeToggle = (time: string) => {
    if (bookingType === "monthly") {
      if (selectedTimes.has(time)) {
        setSelectedTimes(new Set());
      } else {
        setSelectedTimes(new Set([time]));
      }
      return;
    }
    const newTimes = new Set(selectedTimes);
    if (newTimes.has(time)) {
      newTimes.delete(time);
    } else {
      newTimes.add(time);
    }
    setSelectedTimes(newTimes);
  };

  const onSubmit = (data: BookingForm) => {
    if (!selectedCourt) return showToast.error("Selecione uma quadra");
    if (selectedTimes.size === 0) return showToast.error("Selecione pelo menos um horário");
    if (bookingType === "monthly" && monthlyDates.length < 4) return showToast.error("Plano mensal requer mínimo 4 sessões. Selecione uma data que permita 4 ocorrências ou ative o próximo mês.");

    createBooking.mutate({
      data: {
        ...data,
        date: format(date, 'yyyy-MM-dd'),
        time: firstTime!,
        durationHours: bookingType === "monthly" ? 1 : duration,
        selectedTimes: sortedTimes,
        courtNumber: selectedCourt,
        bookingType,
        ...(appliedCoupon && { couponCode: appliedCoupon.code }),
        ...(bookingType === "monthly" && {
          cpf: monthlyCpf.replace(/\D/g, "") || undefined,
          notes: monthlyNotes.trim() || undefined,
          specificDates: monthlyDates.map(d => format(d, 'yyyy-MM-dd')),
        }),
      } as Parameters<typeof createBooking.mutate>[0]["data"]
    }, {
      onSuccess: (res) => {
        setPixData({
          bookingId: res.bookingId,
          pixQrCode: res.pixQrCode ?? "",
          pixQrCodeBase64: res.pixQrCodeBase64 ?? "",
          amount: res.amount,
          selectedTimes: sortedTimes,
        });
        reset();
        setSelectedTimes(new Set());
      },
      onError: (err: unknown) => {
        const raw = (err as { message?: string })?.message ?? "";
        const colonIdx = raw.indexOf(": ");
        const extracted = colonIdx !== -1 ? raw.slice(colonIdx + 2) : raw;
        if (extracted && extracted.length < 300) {
          showToast.error(extracted);
        } else {
          showToast.error("Erro ao criar reserva. Tente novamente.");
        }
      }
    });
  };

  const days = (() => {
    const today = new Date();
    const endOfYear = new Date(today.getFullYear(), 11, 31);
    const daysCount = Math.floor((endOfYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return Array.from({ length: daysCount }).map((_, i) => addDays(today, i));
  })();

  return (
    <PageLayout>
      {selectedCourtData?.photoUrl && showPhotoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4" onClick={() => setShowPhotoModal(false)}>
          <div
            className="bg-card border border-white/10 rounded-2xl overflow-hidden max-w-xl w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="max-h-96">
              <img src={selectedCourtData.photoUrl} alt={selectedCourtData.name} className="w-full h-full object-contain bg-black/20" />
            </div>
            <div className="border-t border-white/10 p-4">
              <button
                onClick={() => setShowPhotoModal(false)}
                className="w-full px-4 py-2 bg-primary text-black font-bold rounded-lg hover:bg-primary/90 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
      {pixData && (
        <PixModal
          data={pixData}
          onClose={() => setPixData(null)}
          onPaymentConfirmed={(times) => {
            const newBlocked = new Set(blockedTimes);
            times.forEach(t => newBlocked.add(t));
            setBlockedTimes(newBlocked);
          }}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-display font-bold gold-gradient-text mb-4">AGENDAR QUADRA</h1>
          <p className="text-xl text-muted-foreground">Escolha a quadra, o dia e o horário.</p>
        </div>

        {/* Booking Type Toggle */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex rounded-2xl border border-white/10 bg-black/30 p-1 gap-1">
            <button
              type="button"
              onClick={() => { setBookingType("individual"); setSelectedTimes(new Set()); }}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all",
                bookingType === "individual"
                  ? "bg-primary text-black shadow-lg shadow-primary/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarIcon size={15} /> Reserva
            </button>
            <button
              type="button"
              onClick={() => { setBookingType("monthly"); setSelectedTimes(new Set()); }}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all hidden",
                bookingType === "monthly"
                  ? "bg-primary text-black shadow-lg shadow-primary/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarDays size={15} /> Plano Mensal
            </button>
          </div>
        </div>

        {bookingType === "monthly" && (
          <div className="mb-8 p-4 bg-primary/10 border border-primary/20 rounded-2xl text-sm text-center text-primary/90">
            <strong>Plano Mensal:</strong> Selecione 1 horário. Criaremos reservas com desconto para as ocorrências do dia no mês (mín. 4 sessões). Você paga tudo de uma vez via PIX.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* LEFT: Date, Court & Time Selection */}
          <div className="lg:col-span-7 space-y-8">

            {/* Step 1: Date */}
            <Card className="p-6">
              <h3 className="text-2xl font-display mb-4 flex items-center gap-2">
                <CalendarIcon className="text-primary" /> 1. Escolha a Data
              </h3>
              <div className="flex overflow-x-auto pb-4 gap-3 hide-scrollbar">
                {days.map((d) => {
                  const isSelected = format(d, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
                  return (
                    <button
                      key={d.toISOString()}
                      onClick={() => handleDateChange(d)}
                      className={cn(
                        "flex flex-col items-center justify-center min-w-[80px] p-3 rounded-xl border-2 transition-all",
                        isSelected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background hover:border-primary/50"
                      )}
                    >
                      <span className="text-sm font-medium uppercase">{format(d, 'EEE', { locale: ptBR })}</span>
                      <span className="text-2xl font-bold font-display">{format(d, 'dd')}</span>
                      <span className="text-xs">{format(d, 'MMM', { locale: ptBR })}</span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Step 2: Court Selection */}
            <Card className="p-6">
              <h3 className="text-2xl font-display mb-4 flex items-center gap-2">
                <Shield className="text-primary" /> 2. Escolha a Quadra
              </h3>
              {courtsLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary"></div>
                </div>
              ) : courts.length === 0 ? (
                <p className="text-muted-foreground text-center py-6">Nenhuma quadra disponível no momento.</p>
              ) : (
                <div className={cn("grid gap-3", courts.length <= 4 ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4")}>
                  {courts.map((court) => (
                    <button
                      key={court.id}
                      onClick={() => handleCourtChange(court.number)}
                      className={cn(
                        "py-5 rounded-xl border-2 font-display font-bold text-2xl transition-all flex flex-col items-center justify-center gap-1",
                        selectedCourt === court.number
                          ? "border-primary bg-primary text-black shadow-lg shadow-primary/30 scale-105"
                          : "border-border bg-background hover:border-primary/50 hover:bg-primary/5"
                      )}
                    >
                      <span>{court.number}</span>
                      <span className={cn(
                        "text-xs font-sans font-normal leading-tight px-1 text-center",
                        selectedCourt === court.number ? "text-black/70" : "text-muted-foreground"
                      )}>
                        {court.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            {/* Step 3: Time Selection */}
            <Card className="p-6">
              <h3 className="text-2xl font-display mb-4 flex items-center gap-2">
                <Clock className="text-primary" /> 3. Escolha o Horário
              </h3>

              {!selectedCourt ? (
                <p className="text-muted-foreground text-center py-6">Selecione uma quadra acima para ver os horários disponíveis.</p>
              ) : isLoadingSlots ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  {slots.map((slot) => {
                    const isSelected = selectedTimes.has(slot.time);
                    const isBlocked = blockedTimes.has(slot.time);
                    const displayPrice = bookingType === "monthly"
                      ? getMonthlyPrice(monthlyPricing, dateStr, slot.time)
                      : slot.price;
                    
                    // Check if time slot has already passed (only for today)
                    const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                    const now = new Date();
                    const [slotHour, slotMin] = slot.time.split(':').map(Number);
                    const slotTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), slotHour, slotMin);
                    const isPassed = isToday && now >= slotTime;
                    
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        disabled={!slot.available || isBlocked || isPassed}
                        onClick={() => handleTimeToggle(slot.time)}
                        className={cn(
                          "py-2 px-1 rounded-xl text-center font-bold transition-all border-2 flex flex-col items-center gap-0.5",
                          (!slot.available || isBlocked || isPassed) && "opacity-30 cursor-not-allowed border-border bg-muted/50",
                          slot.available && !isBlocked && !isPassed && !isSelected && "border-border bg-background hover:border-primary/50 hover:bg-primary/5 text-foreground",
                          isSelected && "border-primary bg-primary text-black shadow-lg shadow-primary/30 transform scale-105"
                        )}
                      >
                        <span className="text-sm font-bold">{slot.time}</span>
                        <span className={cn("text-xs", isSelected ? "text-black/70" : "text-muted-foreground")}>
                          R${displayPrice}
                        </span>
                      </button>
                    );
                  })}
                  {slots.length === 0 && (
                    <p className="col-span-full text-center text-muted-foreground py-4">Nenhum horário disponível nesta data.</p>
                  )}
                </div>
              )}
            </Card>

            {/* Monthly: include next month toggle */}
            {bookingType === "monthly" && selectedTimes.size > 0 && (
              <Card className="p-5 border-primary/30 bg-primary/5 space-y-3">
                {/* Current month dates */}
                <div>
                  <p className="text-xs text-muted-foreground capitalize mb-1.5">
                    {currentMonthLabel} ({currentMonthDates.length} {currentMonthDates.length === 1 ? "data" : "datas"})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {currentMonthDates.map(d => (
                      <span key={d.toISOString()} className="text-xs bg-primary/15 border border-primary/30 text-primary px-2 py-0.5 rounded-full font-medium">
                        {format(d, 'dd/MM')}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Next month toggle */}
                <label className="flex items-start gap-3 cursor-pointer select-none pt-2 border-t border-white/10">
                  <input
                    type="checkbox"
                    checked={monthlyIncludeNext}
                    onChange={e => setMonthlyIncludeNext(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded accent-primary flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-bold block leading-tight capitalize">
                      Incluir {nextMonthLabel} também ({nextMonthDates.length} {nextMonthDates.length === 1 ? "data" : "datas"})
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Pague os dois meses de uma vez via PIX.
                    </span>
                    {monthlyIncludeNext && nextMonthDates.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {nextMonthDates.map(d => (
                          <span key={d.toISOString()} className="text-xs bg-primary/15 border border-primary/30 text-primary/70 px-2 py-0.5 rounded-full font-medium">
                            {format(d, 'dd/MM')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              </Card>
            )}
          </div>

          {/* RIGHT: Booking Form */}
          <div className="lg:col-span-5">
            <Card className="p-6 sticky top-28 border-primary/20 bg-gradient-to-b from-card to-background">
              <h3 className="text-2xl font-display mb-6 border-b border-white/10 pb-4">Seus Dados</h3>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><User size={14}/> Nome Completo</Label>
                  <Input placeholder="Seu nome" {...register("customerName")} />
                  {errors.customerName && <p className="text-destructive text-sm">{errors.customerName.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><Mail size={14}/> Email</Label>
                  <Input type="email" placeholder="seu@email.com" {...register("customerEmail")} />
                  {errors.customerEmail && <p className="text-destructive text-sm">{errors.customerEmail.message}</p>}
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><Phone size={14}/> WhatsApp</Label>
                  <Input
                    placeholder="(11) 99999-9999"
                    inputMode="numeric"
                    {...register("customerPhone", {
                      onChange: (e) => {
                        const masked = maskPhone(e.target.value);
                        e.target.value = masked;
                      }
                    })}
                  />
                  {errors.customerPhone && <p className="text-destructive text-sm">{errors.customerPhone.message}</p>}
                </div>

                {bookingType === "monthly" && (
                  <>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2"><CreditCard size={14}/> CPF <span className="text-muted-foreground text-xs">(opcional)</span></Label>
                      <Input
                        placeholder="000.000.000-00"
                        inputMode="numeric"
                        value={maskCPF(monthlyCpf)}
                        onChange={e => setMonthlyCpf(e.target.value.replace(/\D/g, ""))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2"><FileText size={14}/> Observação <span className="text-muted-foreground text-xs">(opcional)</span></Label>
                      <Input
                        placeholder="Alguma observação?"
                        value={monthlyNotes}
                        onChange={e => setMonthlyNotes(e.target.value)}
                      />
                    </div>
                  </>
                )}

                {/* Cupom de desconto */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><DollarSign size={14}/> Cupom de Desconto <span className="text-muted-foreground text-xs">(opcional)</span></Label>
                  {appliedCoupon ? (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/30">
                      <span className="text-green-400 text-sm font-bold flex-1">
                        ✓ {appliedCoupon.code} — {appliedCoupon.type === "percentage" ? `${appliedCoupon.value}% off` : `${formatCurrency(appliedCoupon.value)} off`}
                      </span>
                      <button onClick={() => { setAppliedCoupon(null); setCouponCode(""); }} className="text-xs text-muted-foreground hover:text-red-400 transition-colors">Remover</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        placeholder="CÓDIGO"
                        value={couponCode}
                        onChange={e => setCouponCode(e.target.value.toUpperCase())}
                        className="uppercase text-sm"
                        onKeyDown={e => e.key === "Enter" && void handleApplyCoupon()}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => void handleApplyCoupon()} disabled={checkingCoupon || !couponCode.trim()} className="shrink-0">
                        {checkingCoupon ? "..." : "Aplicar"}
                      </Button>
                    </div>
                  )}
                  {couponError && <p className="text-destructive text-xs">{couponError}</p>}
                </div>

                <div className="mt-8 p-4 bg-black/50 rounded-xl border border-white/5 space-y-2">
                  {bookingType === "monthly" ? (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Tipo:</span>
                        <span className="font-bold text-primary">Plano Mensal</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Quadra:</span>
                        <span className="font-bold text-primary">
                          {selectedCourt
                            ? (courts.find(c => c.number === selectedCourt)?.name ?? `Quadra ${selectedCourt}`)
                            : "Selecione"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Horário:</span>
                        <span className="font-bold text-primary">
                          {firstTime ?? "Selecione"}
                        </span>
                      </div>
                      {monthlyDates.length > 0 && (
                        <div className="pt-2">
                          <p className="text-xs text-muted-foreground mb-1">{monthlyDates.length} {monthlyDates.length === 1 ? "sessão reservada" : "sessões reservadas"}:</p>
                          <div className="flex flex-wrap gap-1">
                            {monthlyDates.map((d, i) => (
                              <span key={i} className="text-xs bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                                {format(d, 'dd/MM (EEE)', { locale: ptBR })}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {monthlyPricePerSession > 0 && (
                        <div className="flex justify-between items-center text-sm pt-1">
                          <span className="text-muted-foreground">Por sessão:</span>
                          <span className="font-bold">{formatCurrency(monthlyPricePerSession)}</span>
                        </div>
                      )}
                      {discountAmount > 0 && (
                        <div className="flex justify-between items-center text-sm text-green-400">
                          <span>Desconto ({appliedCoupon?.code}):</span>
                          <span>- {formatCurrency(discountAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-3 border-t border-white/10">
                        <span className="text-lg">Total ({monthlyDates.length}×):</span>
                        <span className="text-3xl font-display font-bold gold-gradient-text">{formatCurrency(finalPrice)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Data:</span>
                        <span className="font-bold">{format(date, 'dd/MM/yyyy')}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Quadra:</span>
                        <span className="font-bold text-primary">
                          {selectedCourt
                            ? (courts.find(c => c.number === selectedCourt)?.name ?? `Quadra ${selectedCourt}`)
                            : "Selecione"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Horários:</span>
                        <span className="font-bold text-primary">
                          {selectedTimes.size > 0 ? sortedTimes.join(", ") : "Selecione"}
                        </span>
                      </div>
                      {duration > 0 && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Duração:</span>
                          <span className="font-bold">{duration} {duration === 1 ? "hora" : "horas"}</span>
                        </div>
                      )}
                      {discountAmount > 0 && (
                        <div className="flex justify-between items-center text-sm text-green-400">
                          <span>Desconto ({appliedCoupon?.code}):</span>
                          <span>- {formatCurrency(discountAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-3 border-t border-white/10">
                        <span className="text-lg">Total:</span>
                        <span className="text-3xl font-display font-bold gold-gradient-text">{formatCurrency(finalPrice)}</span>
                      </div>
                    </>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="gold"
                  size="lg"
                  className="w-full mt-4"
                  disabled={!selectedCourt || selectedTimes.size === 0 || createBooking.isPending}
                  isLoading={createBooking.isPending}
                >
                  Gerar PIX para Pagamento
                </Button>
              </form>
            </Card>
          </div>

        </div>
      </div>
    </PageLayout>
  );
}
