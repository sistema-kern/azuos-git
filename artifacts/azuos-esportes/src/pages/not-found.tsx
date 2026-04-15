import { Link } from "wouter";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground text-center px-4">
      <h1 className="text-9xl font-display font-bold gold-gradient-text mb-4">404</h1>
      <h2 className="text-3xl font-bold mb-6">Página não encontrada</h2>
      <p className="text-muted-foreground mb-8 max-w-md">
        A quadra que você está procurando não existe ou foi movida. Volte para a arena principal.
      </p>
      <Link href="/">
        <Button variant="gold" size="lg">
          Voltar para Home
        </Button>
      </Link>
    </div>
  );
}
