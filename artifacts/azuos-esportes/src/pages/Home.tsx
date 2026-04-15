import { PageLayout } from "@/components/layout/PageLayout";
import { Button, Card } from "@/components/ui";
import { Link } from "wouter";
import { Calendar, Trophy, Image as ImageIcon, ArrowRight, ChevronLeft, ChevronRight, Instagram, Star } from "lucide-react";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";

type ApiSlide = {
  id: number;
  title: string;
  subtitle: string | null;
  cta1Label: string | null;
  cta1Href: string | null;
  cta1Icon: string | null;
  cta2Label: string | null;
  cta2Href: string | null;
  cta2Icon: string | null;
  bgImageUrl: string | null;
  gradient: string | null;
  displayOrder: number | null;
};

type ApiCard = {
  id: number;
  title: string;
  description: string | null;
  icon: string | null;
  linkHref: string | null;
  linkLabel: string | null;
  highlight: boolean | null;
  displayOrder: number | null;
};

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir < 0 ? "100%" : "-100%", opacity: 0 }),
};

function SlideIcon({ icon, size = 20, className = "" }: { icon: string | null; size?: number; className?: string }) {
  if (icon === "calendar") return <Calendar size={size} className={className} />;
  if (icon === "trophy") return <Trophy size={size} className={className} />;
  if (icon === "image") return <ImageIcon size={size} className={className} />;
  return null;
}

function CardIcon({ icon, size = 32, className = "" }: { icon: string | null; size?: number; className?: string }) {
  if (icon === "calendar") return <Calendar size={size} className={className} />;
  if (icon === "trophy") return <Trophy size={size} className={className} />;
  if (icon === "image") return <ImageIcon size={size} className={className} />;
  return <Star size={size} className={className} />;
}

function HeroSlider({ slides, loaded }: { slides: ApiSlide[]; loaded: boolean }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  // Track loaded image URLs via a ref (no stale closure issues) + state (triggers re-render)
  const readyRef = useRef<Set<string>>(new Set());
  const [, forceUpdate] = useState(0);

  const markReady = useCallback((url: string) => {
    readyRef.current.add(url);
    forceUpdate(n => n + 1);
  }, []);

  // Preload all slide images immediately when slides arrive
  useEffect(() => {
    slides.forEach(slide => {
      if (!slide.bgImageUrl || readyRef.current.has(slide.bgImageUrl)) return;
      const img = new Image();
      img.onload = () => markReady(slide.bgImageUrl!);
      img.onerror = () => markReady(slide.bgImageUrl!); // don't block on error
      img.src = slide.bgImageUrl;
    });
  }, [slides, markReady]);

  const navigate = useCallback((delta: number, toIdx?: number) => {
    const nextIdx = toIdx ?? (index + delta + slides.length) % slides.length;
    setDirection(delta);
    setIndex(nextIdx);
  }, [index, slides.length]);

  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [slides.length]);

  // Autoplay: waits for next slide's image to be ready before advancing
  useEffect(() => {
    if (slides.length <= 1) return;
    const INTERVAL = 8000;
    const MAX_WAIT = 4000;
    const POLL = 150;

    let mainTimer: ReturnType<typeof setTimeout>;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let waited = 0;

    const advance = () => {
      const nextIdx = (index + 1) % slides.length;
      const nextUrl = slides[nextIdx]?.bgImageUrl;
      if (!nextUrl || readyRef.current.has(nextUrl)) {
        navigate(1, nextIdx);
        return;
      }
      waited = 0;
      pollTimer = setInterval(() => {
        waited += POLL;
        if (readyRef.current.has(nextUrl) || waited >= MAX_WAIT) {
          clearInterval(pollTimer!);
          pollTimer = null;
          navigate(1, nextIdx);
        }
      }, POLL);
    };

    mainTimer = setTimeout(advance, INTERVAL);
    return () => {
      clearTimeout(mainTimer);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [index, slides, navigate]);

  if (!loaded || slides.length === 0) return null;

  const slide = slides[index];
  if (!slide) return null;

  const isImageReady = !slide.bgImageUrl || readyRef.current.has(slide.bgImageUrl);

  const bgStyle = slide.bgImageUrl
    ? { backgroundImage: `url(${slide.bgImageUrl})` }
    : {};

  return (
    <section className="relative h-[82vh] flex items-center justify-center overflow-hidden">
      <AnimatePresence custom={direction} initial={false}>
        <motion.div
          key={slide.id}
          className="absolute inset-0 z-0"
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.6, ease: "easeInOut" }}
        >
          <div
            className="w-full h-full bg-cover bg-center bg-gray-900 transition-opacity duration-700"
            style={{ ...bgStyle, opacity: isImageReady ? 1 : 0 }}
          />
          {!isImageReady && <div className="absolute inset-0 bg-gray-900 animate-pulse" />}
          <div className={`absolute inset-0 bg-gradient-to-t ${slide.gradient || "from-background via-background/65 to-transparent"}`} />
        </motion.div>
      </AnimatePresence>

      <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <h1 className="text-6xl md:text-8xl font-display font-bold gold-gradient-text drop-shadow-2xl mb-6">
              {slide.title}
            </h1>
            {slide.subtitle && (
              <p className="text-xl md:text-2xl text-foreground/80 mb-10 font-light">
                {slide.subtitle}
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {slide.cta1Label && slide.cta1Href && (
                <Link href={slide.cta1Href}>
                  <Button variant="gold" size="lg" className="w-full sm:w-auto text-lg gap-2">
                    <SlideIcon icon={slide.cta1Icon} size={20} />
                    {slide.cta1Label}
                  </Button>
                </Link>
              )}
              {slide.cta2Label && slide.cta2Href && (
                <Link href={slide.cta2Href}>
                  <Button variant="outline" size="lg" className="w-full sm:w-auto text-lg gap-2 bg-black/50 backdrop-blur-md border-primary/50 text-white hover:bg-primary/20">
                    <SlideIcon icon={slide.cta2Icon} size={20} className="text-primary" />
                    {slide.cta2Label}
                  </Button>
                </Link>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {slides.length > 1 && (
        <>
          <button onClick={() => navigate(-1)} className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-black/50 border border-white/20 flex items-center justify-center hover:bg-primary/40 transition-colors" aria-label="Anterior">
            <ChevronLeft size={24} />
          </button>
          <button onClick={() => navigate(1)} className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-black/50 border border-white/20 flex items-center justify-center hover:bg-primary/40 transition-colors" aria-label="Próximo">
            <ChevronRight size={24} />
          </button>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex gap-2">
            {slides.map((s, i) => (
              <button key={s.id} onClick={() => navigate(i > index ? 1 : -1, i)}
                className={`w-3 h-3 rounded-full transition-all duration-300 ${i === index ? "bg-primary scale-125" : "bg-white/30 hover:bg-white/60"}`}
                aria-label={`Ir para slide ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function HomeCard({ card, profile }: { card: ApiCard; profile: ReturnType<typeof useCompanyProfile>["profile"] }) {
  const title = card.title;
  if (card.highlight) {
    return (
      <Card className="p-8 hover:-translate-y-2 transition-transform duration-300 group bg-gradient-to-br from-primary/20 to-background border-primary/50 relative overflow-hidden">
        <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <div className="relative z-10">
          <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mb-6 group-hover:bg-primary/30 transition-colors">
            <CardIcon icon={card.icon} size={32} className="text-primary" />
          </div>
          <h3 className="text-3xl font-display font-bold mb-4 uppercase">{title}</h3>
          {card.description && (
            <p className="text-muted-foreground mb-6 leading-relaxed">{card.description}</p>
          )}
          {card.linkHref && (
            <Link href={card.linkHref}>
              <Button variant="gold" className="gap-2">
                {card.linkLabel || "Saiba mais"} <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-8 hover:-translate-y-2 transition-transform duration-300 group bg-background/50 border-white/10 hover:border-primary/30">
      <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
        <CardIcon icon={card.icon} size={32} className="text-primary" />
      </div>
      <h3 className="text-3xl font-display font-bold mb-4 uppercase">{title}</h3>
      {card.description && (
        <p className="text-muted-foreground mb-6 leading-relaxed">{card.description}</p>
      )}
      {card.linkHref && (
        <Link href={card.linkHref} className="text-primary font-semibold flex items-center gap-2 hover:gap-3 transition-all">
          {card.linkLabel || "Saiba mais"} <ArrowRight className="ml-2 w-4 h-4" />
        </Link>
      )}
    </Card>
  );
}

export default function Home() {
  const { profile } = useCompanyProfile();
  const [slides, setSlides] = useState<ApiSlide[]>([]);
  const [cards, setCards] = useState<ApiCard[]>([]);
  const [slidesLoaded, setSlidesLoaded] = useState(false);
  const [cardsLoaded, setCardsLoaded] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/home/slides`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSlides(data);
      })
      .catch(() => {})
      .finally(() => setSlidesLoaded(true));
    fetch(`${import.meta.env.BASE_URL}api/home/cards`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCards(data);
      })
      .catch(() => {})
      .finally(() => setCardsLoaded(true));
  }, []);

  return (
    <PageLayout>
      <HeroSlider slides={slides} loaded={slidesLoaded} />

      {cardsLoaded && cards.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 -mt-20 relative z-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {cards.map((card) => (
              <HomeCard key={card.id} card={card} profile={profile} />
            ))}
          </div>
        </section>
      )}

      {profile.instagram_handle && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-20">
          <Card className="p-8 hover:-translate-y-2 transition-transform duration-300 group bg-gradient-to-br from-primary/10 to-background border-primary/30">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-3xl font-display font-bold mb-3 flex items-center gap-3">
                  <Instagram className="text-primary" size={32} />
                  Feed do Instagram
                </h3>
                <p className="text-muted-foreground mb-4">
                  {profile.instagram_description || "Acompanhe nossos melhores momentos, promoções e novidades em tempo real."}
                </p>
              </div>
              <a href={`https://instagram.com/${profile.instagram_handle.replace("@", "")}`} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex">
                <Button variant="gold" size="lg" className="gap-2">
                  <Instagram size={20} />
                  Seguir @{profile.instagram_handle.replace("@", "")}
                </Button>
              </a>
            </div>
            <a href={`https://instagram.com/${profile.instagram_handle.replace("@", "")}`} target="_blank" rel="noopener noreferrer" className="block sm:hidden w-full mt-4">
              <Button variant="gold" className="w-full gap-2">
                <Instagram size={20} />
                Seguir @{profile.instagram_handle.replace("@", "")}
              </Button>
            </a>
          </Card>
        </section>
      )}
    </PageLayout>
  );
}
