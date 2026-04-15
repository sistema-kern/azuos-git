import { PageLayout } from "@/components/layout/PageLayout";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import { useGetAvailability, useCreateClassBooking } from "@workspace/api-client-react";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calendar as CalendarIcon, Clock, Users, ArrowRight, Copy, CheckCheck, CheckCircle, AlertCircle, DollarSign } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { showToast } from "@/lib/toast";

const maskPhone = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
};

const unmaskPhone = (value: string): string => {
  return value.replace(/\D/g, "");
};

const maskCPF = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
};

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

  // Poll for payment confirmation
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
          
          // Stop polling if confirmed
          if (result.status === "confirmed") {
            setIsChecking(false);
            if (pollInterval) clearInterval(pollInterval);
            // Notify parent about confirmed times
            if (onPaymentConfirmed && data.selectedTimes) {
              onPaymentConfirmed(data.selectedTimes);
            }
          }
        }
      } catch (err) {
        console.error("Erro ao verificar status do pagamento:", err);
      }
    };

    // Initial check
    checkStatus();

    // Poll every 2 seconds for payment confirmation
    pollInterval = setInterval(checkStatus, 2000);

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [data.bookingId]);

  // Show success screen after payment confirmed
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

const bookingSchema = z.object({
  customerName: z.string().min(3, "Nome muito curto"),
  customerEmail: z.string().email("Email inválido"),
  customerPhone: z.string().min(10, "Telefone inválido"),
  numberOfPeople: z.coerce.number().min(1).max(4),
  cpf: z.string().optional(),
  notes: z.string().optional(),
});

type BookingForm = z.infer<typeof bookingSchema>;

interface PricesData {
  courtPricePerHour: number;
  classPrices: Record<number, number>;
}

export default function BeachTennis() {
  const [date, setDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [blockedTimes, setBlockedTimes] = useState<Set<string>>(new Set());
  const [bookingType, setBookingType] = useState<"individual" | "monthly">("individual");
  const [monthlyIncludeNext, setMonthlyIncludeNext] = useState(false);
  const [monthlyCpf, setMonthlyCpf] = useState("");
  const [monthlyNotes, setMonthlyNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; type: string; value: number } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const { data: pricesData } = useQuery<PricesData>({
    queryKey: ["prices"],
    queryFn: () => fetch("/api/settings/prices").then((r) => r.json() as Promise<PricesData>),
    staleTime: 0,
    refetchInterval: 5000,
  });
  const classPrices: Record<number, number> = pricesData?.classPrices ?? { 1: 65, 2: 55, 3: 50, 4: 45 };

  const { data: availability, isLoading: isLoadingSlots, refetch } = useGetAvailability({
    date: format(date, 'yyyy-MM-dd'),
    type: 'beach_tennis'
  });

  // Poll for availability updates every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void refetch();
    }, 10000);

    return () => clearInterval(interval);
  }, [refetch]);

  const createBooking = useCreateClassBooking();

  // Compute monthly dates (all occurrences of the same weekday in the current month)
  const selectedDow = date.getDay();
  const currentMonthDates = selectedTime ? getCalendarMonthDates(date, selectedDow) : [];
  const nextMonthDates = selectedTime ? getNextCalendarMonthDates(date, selectedDow) : [];
  const monthlyDates = monthlyIncludeNext
    ? [...currentMonthDates, ...nextMonthDates]
    : currentMonthDates;

  const nextMonthLabel = format(addMonths(date, 1), "MMMM", { locale: ptBR });
  const currentMonthLabel = format(date, "MMMM", { locale: ptBR });

  const { register, handleSubmit, formState: { errors }, watch, reset } = useForm<BookingForm>({
    resolver: zodResolver(bookingSchema),
    defaultValues: { numberOfPeople: 1 }
  });

  const numPeople = Number(watch("numberOfPeople"));
  
  const getPricePerPerson = (n: number) => classPrices[n] ?? classPrices[1] ?? 65;
  
  const pricePerPerson = getPricePerPerson(numPeople);
  const total = bookingType === "monthly" 
    ? pricePerPerson * numPeople * monthlyDates.length
    : pricePerPerson * numPeople;

  const discountAmount = appliedCoupon
    ? appliedCoupon.type === "percentage"
      ? Math.round(total * appliedCoupon.value / 100 * 100) / 100
      : Math.min(appliedCoupon.value, total)
    : 0;
  const finalTotal = Math.max(0, total - discountAmount);

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

  const onSubmit = (data: BookingForm): void => {
    if (!selectedTime) {
      showToast.error("Selecione um horário");
      return;
    }
    if (bookingType === "monthly" && monthlyDates.length < 4) {
      showToast.error("Plano mensal requer mínimo 4 sessões. Selecione uma data que permita 4 ocorrências ou ative o próximo mês.");
      return;
    }
    
    createBooking.mutate({
      data: {
        ...data,
        date: format(date, 'yyyy-MM-dd'),
        time: selectedTime,
        ...(appliedCoupon && { couponCode: appliedCoupon.code }),
        ...(bookingType === "monthly" && {
          cpf: monthlyCpf.replace(/\D/g, "") || undefined,
          notes: monthlyNotes.trim() || undefined,
          specificDates: monthlyDates.map(d => format(d, 'yyyy-MM-dd')),
          isMonthly: true,
        }),
      }
    }, {
      onSuccess: (res) => {
        setPixData({
          bookingId: res.bookingId,
          pixQrCode: res.pixQrCode ?? "",
          pixQrCodeBase64: res.pixQrCodeBase64 ?? "",
          amount: res.amount,
          selectedTimes: selectedTime ? [selectedTime] : [],
        });
        reset();
        setSelectedTime(null);
        setMonthlyCpf("");
        setMonthlyNotes("");
        setMonthlyIncludeNext(false);
      },
      onError: () => {
        showToast.error("Erro ao criar reserva. Tente novamente.");
      }
    });
  };

  const days = Array.from({ length: 7 }).map((_, i) => addDays(new Date(), i));

  return (
    <PageLayout>
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

      {/* Hero Section */}
      <section className="relative h-[40vh] flex items-center justify-center overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        </div>
        <div className="relative z-10 text-center px-4">
          <h1 className="text-5xl md:text-7xl font-display font-bold text-white drop-shadow-lg mb-4">
            AULAS DE <span className="gold-gradient-text">BEACH TENNIS</span>
          </h1>
          <p className="text-xl text-white/80 max-w-2xl mx-auto">
            Aprenda, jogue e evolua no esporte que mais cresce no Brasil. Traga seus amigos e ganhe descontos!
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Info & Pricing */}
          <div className="lg:col-span-5 space-y-8">
            <div>
              <h2 className="text-3xl font-display font-bold mb-4 flex items-center gap-2">
                <Users className="text-primary" /> TABELA DE VALORES
              </h2>
              <p className="text-muted-foreground mb-6">Nossos valores são progressivos. Quanto mais amigos você trouxer, mais barato fica a aula para cada um!</p>
              
              <div className="space-y-3">
                {([1, 2, 3, 4] as const).map((n) => (
                  <div key={n} className={cn(
                    "flex items-center justify-between p-4 rounded-xl border transition-all",
                    numPeople === n ? "border-primary bg-primary/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]" : "border-white/10 bg-card"
                  )}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center font-bold">
                        {n}
                      </div>
                      <span className="font-medium">{n === 1 ? 'Pessoa' : 'Pessoas'}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-primary">{formatCurrency(classPrices[n] ?? 65)}</div>
                      <div className="text-xs text-muted-foreground">por pessoa</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <Card className="p-6 bg-primary/5 border-primary/20">
              <h3 className="text-xl font-bold mb-2">O que está incluso?</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><ArrowRight size={14} className="text-primary"/> Raquetes fornecidas no local</li>
                <li className="flex items-center gap-2"><ArrowRight size={14} className="text-primary"/> Professor capacitado</li>
                <li className="flex items-center gap-2"><ArrowRight size={14} className="text-primary"/> Bolinhas profissionais</li>
                <li className="flex items-center gap-2"><ArrowRight size={14} className="text-primary"/> 1 hora de duração</li>
              </ul>
            </Card>
          </div>

          {/* Booking Area */}
          <div className="lg:col-span-7">
            <Card className="p-6 md:p-8 border-t-4 border-t-primary shadow-2xl">
              <h2 className="text-3xl font-display font-bold mb-8">Agende sua Aula</h2>

              {/* Booking Type Tabs */}
              <div className="flex gap-2 mb-8 border-b border-white/10">
                <button
                  onClick={() => {
                    setBookingType("individual");
                    setSelectedTime(null);
                    setMonthlyIncludeNext(false);
                  }}
                  className={cn(
                    "px-6 py-3 font-bold text-sm transition-colors border-b-2",
                    bookingType === "individual"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-white"
                  )}
                >
                  Aula Individual
                </button>
                <button
                  onClick={() => {
                    setBookingType("monthly");
                    setSelectedTime(null);
                  }}
                  className={cn(
                    "px-6 py-3 font-bold text-sm transition-colors border-b-2",
                    bookingType === "monthly"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-white"
                  )}
                >
                  Plano Mensal
                </button>
              </div>

              {bookingType === "monthly" && (
                <div className="mb-8 p-4 bg-primary/10 border border-primary/20 rounded-2xl text-sm text-center text-primary/90">
                  <strong>Plano Mensal:</strong> Selecione 1 horário. Criaremos reservas com desconto para as ocorrências do dia no mês (mín. 4 sessões). Você paga tudo de uma vez via PIX.
                </div>
              )}
              
              <div className="space-y-8">
                {/* Date */}
                <div>
                  <Label className="text-lg mb-3 block">1. Selecione a Data</Label>
                  <div className="flex overflow-x-auto pb-2 gap-3 hide-scrollbar">
                    {days.map((d) => {
                      const isSelected = format(d, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
                      return (
                        <button
                          key={d.toISOString()}
                          onClick={() => { setDate(d); setSelectedTime(null); }}
                          className={cn(
                            "flex flex-col items-center justify-center min-w-[70px] p-3 rounded-xl border transition-all",
                            isSelected ? "border-primary bg-primary text-black" : "border-white/10 bg-background hover:border-primary/50"
                          )}
                        >
                          <span className="text-xs uppercase">{format(d, 'EEE', { locale: ptBR })}</span>
                          <span className="text-xl font-bold font-display leading-none my-1">{format(d, 'dd')}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Time */}
                <div>
                  <Label className="text-lg mb-3 block">2. Selecione o Horário</Label>
                  {isLoadingSlots ? (
                    <div className="flex gap-2"><div className="w-4 h-4 rounded-full bg-primary animate-pulse"></div> Carregando...</div>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                      {availability?.slots.map((slot) => {
                        const isBlocked = blockedTimes.has(slot.time);
                        
                        // Check if time slot has already passed (only for today)
                        const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                        const now = new Date();
                        const [slotHour, slotMin] = slot.time.split(':').map(Number);
                        const slotTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), slotHour, slotMin);
                        const isPassed = isToday && now >= slotTime;
                        
                        return (
                          <button
                            key={slot.time}
                            disabled={!slot.available || isBlocked || isPassed}
                            onClick={() => setSelectedTime(slot.time)}
                            className={cn(
                              "py-2 rounded-lg text-sm font-bold border transition-all",
                              (!slot.available || isBlocked || isPassed) ? "opacity-20 border-white/5" :
                              selectedTime === slot.time ? "border-primary bg-primary/20 text-primary" : "border-white/10 hover:border-primary/50"
                            )}
                          >
                            {slot.time}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Monthly: date pills and next month toggle */}
                {bookingType === "monthly" && selectedTime && (
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

                {/* Form */}
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-6 border-t border-white/10">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Quantidade de Pessoas</Label>
                      <Select {...register("numberOfPeople")}>
                        <option value="1">1 Pessoa</option>
                        <option value="2">2 Pessoas</option>
                        <option value="3">3 Pessoas</option>
                        <option value="4">4 Pessoas</option>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Nome</Label>
                      <Input placeholder="Nome principal" {...register("customerName")} />
                    </div>
                    <div className="space-y-2">
                      <Label>WhatsApp</Label>
                      <Input 
                        placeholder="(11) 9..." 
                        inputMode="numeric"
                        {...register("customerPhone", {
                          onChange: (e) => {
                            const masked = maskPhone(e.target.value);
                            e.target.value = masked;
                          }
                        })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input type="email" placeholder="Email" {...register("customerEmail")} />
                    </div>
                  </div>

                  {bookingType === "monthly" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/10">
                      <div className="space-y-2">
                        <Label>CPF (opcional)</Label>
                        <Input 
                          placeholder="000.000.000-00" 
                          inputMode="numeric"
                          value={monthlyCpf}
                          onChange={(e) => setMonthlyCpf(maskCPF(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Observações (opcional)</Label>
                        <Input 
                          placeholder="Ex: Alergia..." 
                          value={monthlyNotes}
                          onChange={(e) => setMonthlyNotes(e.target.value)}
                          maxLength={200}
                        />
                      </div>
                    </div>
                  )}

                  {/* Cupom de desconto */}
                  <div className="space-y-2 mt-2">
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

                  <div className="bg-black/40 p-4 rounded-xl flex justify-between items-center mt-6 border border-white/5">
                    <div>
                      {bookingType === "monthly" ? (
                        <>
                          <div className="text-sm text-muted-foreground">{monthlyDates.length} sessões × {numPeople} {numPeople === 1 ? 'pessoa' : 'pessoas'}:</div>
                          <div className="text-xs text-primary">{monthlyDates.length}x {numPeople}x {formatCurrency(pricePerPerson)}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-sm text-muted-foreground">Total para {numPeople} {numPeople === 1 ? 'pessoa' : 'pessoas'}:</div>
                          <div className="text-xs text-primary">{numPeople}x {formatCurrency(pricePerPerson)}</div>
                        </>
                      )}
                      {discountAmount > 0 && (
                        <div className="text-xs text-green-400 mt-1">Desconto ({appliedCoupon?.code}): - {formatCurrency(discountAmount)}</div>
                      )}
                    </div>
                    <div className="text-3xl font-display font-bold gold-gradient-text">{formatCurrency(finalTotal)}</div>
                  </div>

                  <Button 
                    type="submit" 
                    variant="gold" 
                    size="lg" 
                    className="w-full h-14 text-lg mt-4"
                    disabled={!selectedTime || createBooking.isPending || (bookingType === "monthly" && monthlyDates.length < 4)}
                    isLoading={createBooking.isPending}
                  >
                    {bookingType === "monthly" ? `Gerar PIX - ${monthlyDates.length} Aulas` : "Gerar PIX para Pagamento"}
                  </Button>
                </form>
              </div>
            </Card>
          </div>

        </div>
      </div>
    </PageLayout>
  );
}
